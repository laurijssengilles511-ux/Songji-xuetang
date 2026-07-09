-- ============================================================
-- 诵记学堂 · Supabase 数据库 Schema
-- 在 Supabase Dashboard → SQL Editor 中执行此文件
-- ============================================================

-- -------------------------------------------------------
-- 1. profiles 表：用户资料（与 auth.users 1:1 关联）
-- -------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  avatar_id   text default 'cat-cream',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 自动为新注册用户创建 profile（通过数据库触发器）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, avatar_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_id', 'cat-cream')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------
-- 2. custom_books 表：用户自建牌组
-- -------------------------------------------------------
create table if not exists public.custom_books (
  id          text not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  description text default '',
  tags        text[] default '{}',
  is_public   boolean default false,
  mode        text default 'anki',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  primary key (owner_id, id)
);

-- -------------------------------------------------------
-- 3. custom_cards 表：用户自建卡片
-- -------------------------------------------------------
create table if not exists public.custom_cards (
  id          bigserial primary key,
  book_id     text not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  front       text not null,
  back        text not null,
  hint        text default '',
  extra       text default '',
  card_index  int not null default 0,
  created_at  timestamptz default now(),
  foreign key (book_id, owner_id) references public.custom_books(id, owner_id) on delete cascade
);

create index if not exists idx_custom_cards_book on public.custom_cards(book_id, owner_id);

-- -------------------------------------------------------
-- 4. practice_data 表：默写/练习数据
--    存储每个用户的收藏词、错题集、进度等
-- -------------------------------------------------------
create table if not exists public.practice_data (
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  text not null,
  favorites   jsonb default '[]'::jsonb,
  wrong_list  jsonb default '[]'::jsonb,
  progress    jsonb default '{}'::jsonb,
  ratings     jsonb default '{}'::jsonb,
  updated_at  timestamptz default now(),
  primary key (user_id, project_id)
);

-- -------------------------------------------------------
-- 5. srs_data 表：SRS 间隔重复数据
--    存储卡片状态、配置、统计
-- -------------------------------------------------------
create table if not exists public.srs_data (
  user_id       uuid not null references auth.users(id) on delete cascade,
  card_states   jsonb default '{}'::jsonb,
  deck_config   jsonb default '{}'::jsonb,
  stats         jsonb default '{}'::jsonb,
  deck_new_today jsonb default '{}'::jsonb,
  updated_at    timestamptz default now(),
  primary key (user_id)
);

-- -------------------------------------------------------
-- 6. favorite_projects 表：用户收藏的项目
-- -------------------------------------------------------
create table if not exists public.favorite_projects (
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  text not null,
  created_at  timestamptz default now(),
  primary key (user_id, project_id)
);

-- -------------------------------------------------------
-- 7. lunyu_data 表：论语学习数据
-- -------------------------------------------------------
create table if not exists public.lunyu_data (
  user_id       uuid not null references auth.users(id) on delete cascade,
  sentence_id   text not null,
  grade         text,
  favorite      boolean default false,
  review_count  int default 0,
  updated_at    timestamptz default now(),
  primary key (user_id, sentence_id)
);

-- ============================================================
-- RLS (Row Level Security) 策略
-- 每个用户只能访问自己的数据
-- ============================================================

alter table public.profiles enable row level security;
alter table public.custom_books enable row level security;
alter table public.custom_cards enable row level security;
alter table public.practice_data enable row level security;
alter table public.srs_data enable row level security;
alter table public.favorite_projects enable row level security;
alter table public.lunyu_data enable row level security;

-- profiles: 用户可以查看所有 profile（显示公开牌组的作者），
-- 但只能修改自己的
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (true);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- custom_books: 用户可以查看公开牌组 + 自己的牌组，
-- 只能增删改自己的
drop policy if exists "books_select" on public.custom_books;
drop policy if exists "books_insert_own" on public.custom_books;
drop policy if exists "books_update_own" on public.custom_books;
drop policy if exists "books_delete_own" on public.custom_books;
create policy "books_select" on public.custom_books
  for select using (is_public = true or owner_id = auth.uid());
create policy "books_insert_own" on public.custom_books
  for insert with check (owner_id = auth.uid());
create policy "books_update_own" on public.custom_books
  for update using (owner_id = auth.uid());
create policy "books_delete_own" on public.custom_books
  for delete using (owner_id = auth.uid());

-- custom_cards: 跟随 book 的权限
drop policy if exists "cards_select" on public.custom_cards;
drop policy if exists "cards_insert_own" on public.custom_cards;
drop policy if exists "cards_update_own" on public.custom_cards;
drop policy if exists "cards_delete_own" on public.custom_cards;
create policy "cards_select" on public.custom_cards
  for select using (
    exists (
      select 1 from public.custom_books
      where custom_books.id = custom_cards.book_id
      and custom_books.owner_id = custom_cards.owner_id
      and (is_public = true or owner_id = auth.uid())
    )
  );
create policy "cards_insert_own" on public.custom_cards
  for insert with check (owner_id = auth.uid());
create policy "cards_update_own" on public.custom_cards
  for update using (owner_id = auth.uid());
create policy "cards_delete_own" on public.custom_cards
  for delete using (owner_id = auth.uid());

-- practice_data: 只有自己能访问
drop policy if exists "practice_all_own" on public.practice_data;
create policy "practice_all_own" on public.practice_data
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- srs_data: 只有自己能访问
drop policy if exists "srs_all_own" on public.srs_data;
create policy "srs_all_own" on public.srs_data
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- favorite_projects: 只有自己能访问
drop policy if exists "favorites_all_own" on public.favorite_projects;
create policy "favorites_all_own" on public.favorite_projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- lunyu_data: 只有自己能访问
drop policy if exists "lunyu_all_own" on public.lunyu_data;
create policy "lunyu_all_own" on public.lunyu_data
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- 更新时间触发器（自动维护 updated_at）
-- ============================================================
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_profiles_updated_at on public.profiles;
drop trigger if exists update_custom_books_updated_at on public.custom_books;
drop trigger if exists update_practice_data_updated_at on public.practice_data;
drop trigger if exists update_srs_data_updated_at on public.srs_data;
drop trigger if exists update_lunyu_data_updated_at on public.lunyu_data;

create trigger update_profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at();
create trigger update_custom_books_updated_at before update on public.custom_books
  for each row execute function public.update_updated_at();
create trigger update_practice_data_updated_at before update on public.practice_data
  for each row execute function public.update_updated_at();
create trigger update_srs_data_updated_at before update on public.srs_data
  for each row execute function public.update_updated_at();
create trigger update_lunyu_data_updated_at before update on public.lunyu_data
  for each row execute function public.update_updated_at();

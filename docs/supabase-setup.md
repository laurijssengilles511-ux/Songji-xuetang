# Supabase 接入步骤

## 1. 创建 Supabase 项目

在 Supabase Dashboard 新建项目，进入 `Project Settings -> API`，复制：

- `Project URL`
- `anon public` key

## 2. 创建数据库表和权限

打开 `SQL Editor`，把项目根目录的 `supabase-schema.sql` 全部复制进去执行。

这个 SQL 会创建：

- `profiles`：用户资料
- `custom_books` / `custom_cards`：自建牌组和卡片
- `favorite_projects`：收藏牌组
- `practice_data` / `srs_data` / `lunyu_data`：后续练习数据表
- RLS 策略：用户只能读写自己的私有数据，公开牌组可被其他用户读取

## 3. 填写前端配置

编辑根目录的 `supabase-config.js`：

```js
window.SONGJI_SUPABASE_CONFIG = {
  url: "https://你的项目.supabase.co",
  anonKey: "你的 anon public key",
};
```

保存后直接打开 `index.html` 或用本地静态服务器访问页面即可。

## 4. 验证第一阶段功能

1. 点击右上角 `登录 / 注册`。
2. 用邮箱、昵称、密码注册。
3. 如果项目开启了邮箱确认，先到邮箱里完成验证，再登录。
4. 进入 `创建` 页面，新建一个牌组。
5. 到 Supabase 的 Table Editor 查看 `custom_books` 和 `custom_cards` 是否出现数据。
6. 到 `牌组` 页面收藏一个项目，检查 `favorite_projects` 是否出现记录。

## 5. 配置智慧创建

智慧创建通过 Supabase Edge Function 代理大模型调用。用户自己的模型 API Key 在 `我的` 页面配置，只保存在当前浏览器，不写入数据库。

1. 安装并登录 Supabase CLI。
2. 部署函数：`supabase functions deploy smart-create-cards`
3. 用户进入 `我的` 页面，在 `智慧创建 API` 中选择服务商并填写 API Key 和模型名。
4. 回到 `创建` 页面，上传 `.md` 或 `.markdown` 文件，点击 `生成并保存牌组`。

当前支持：

- ChatGPT / OpenAI：默认 `gpt-4.1-mini`
- DeepSeek：默认 `deepseek-v4-flash`
- Claude / Anthropic：默认 `claude-sonnet-4-5`

如果希望提供管理员兜底配置，也可以设置服务端密钥：

```bash
supabase secrets set OPENAI_API_KEY=你的OpenAI密钥
supabase secrets set DEEPSEEK_API_KEY=你的DeepSeek密钥
supabase secrets set ANTHROPIC_API_KEY=你的Anthropic密钥
```

## 当前接入范围

已接入 Supabase：

- 邮箱注册/登录/退出
- 用户 profile 自动创建
- 自建牌组创建、编辑、删除
- 公开/私密牌组读取
- 收藏项目同步
- 智慧创建 Markdown 牌组

仍保留本地存储，后续可继续迁移：

- SRS 复习进度
- 具体默写错题/收藏词
- 论语学习状态

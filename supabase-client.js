(function () {
  "use strict";

  const config = window.SONGJI_SUPABASE_CONFIG || {};
  const configured = Boolean(config.url && config.anonKey && window.supabase?.createClient);
  const client = configured
    ? window.supabase.createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

  function normalizeBook(row, cards) {
    return {
      id: row.id,
      name: row.title,
      description: row.description || "",
      tag: (row.tags && row.tags[0]) || "自建",
      visibility: row.is_public ? "public" : "private",
      mode: row.mode || "anki",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      words: (cards || [])
        .filter((card) => card.owner_id === row.owner_id && card.book_id === row.id)
        .sort((a, b) => (a.card_index || 0) - (b.card_index || 0))
        .map((card) => ({
          word: card.back,
          hint: card.front,
          definition: card.front,
          pos: card.extra || "",
        })),
    };
  }

  function profileName(profile, fallbackEmail) {
    return profile?.username || (fallbackEmail ? fallbackEmail.split("@")[0] : "用户");
  }

  async function getSessionUser() {
    if (!client) return null;
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return null;
    return data.user;
  }

  async function loadWorkspace() {
    if (!client) return null;
    const user = await getSessionUser();
    if (!user) return { users: [], session: null };

    const [
      { data: profiles, error: profileError },
      { data: books, error: bookError },
      { data: cards, error: cardError },
      { data: favoriteProjects, error: favoriteError },
    ] = await Promise.all([
        client.from("profiles").select("id, username, avatar_id"),
        client.from("custom_books").select("*").order("created_at", { ascending: false }),
        client.from("custom_cards").select("*").order("card_index", { ascending: true }),
        client.from("favorite_projects").select("project_id").eq("user_id", user.id),
      ]);

    if (profileError) throw profileError;
    if (bookError) throw bookError;
    if (cardError) throw cardError;
    if (favoriteError) throw favoriteError;

    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
    const owners = new Map();
    (books || []).forEach((book) => {
      if (!owners.has(book.owner_id)) {
        const profile = profileMap.get(book.owner_id);
        owners.set(book.owner_id, {
          id: book.owner_id,
          name: book.owner_id === user.id ? profileName(profile, user.email) : profileName(profile),
          email: book.owner_id === user.id ? user.email : "",
          avatarId: profile?.avatar_id || "cat-cream",
          customBooks: [],
        });
      }
      owners.get(book.owner_id).customBooks.push(normalizeBook(book, cards || []));
    });

    if (!owners.has(user.id)) {
      const profile = profileMap.get(user.id);
      owners.set(user.id, {
        id: user.id,
        name: profileName(profile, user.email),
        email: user.email,
        avatarId: profile?.avatar_id || "cat-cream",
        customBooks: [],
      });
    }

    return {
      users: Array.from(owners.values()),
      session: { type: "user", userId: user.id },
      practiceData: {
        favoriteProjects: (favoriteProjects || []).map((item) => item.project_id),
      },
    };
  }

  async function signUp({ email, password, username, avatarId }) {
    if (!client) throw new Error("Supabase 尚未配置。");
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          avatar_id: avatarId || "cat-cream",
        },
      },
    });
    if (error) throw error;
    return data;
  }

  async function signIn({ email, password }) {
    if (!client) throw new Error("Supabase 尚未配置。");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  async function upsertBook(ownerId, book) {
    if (!client) return;
    const row = {
      id: book.id,
      owner_id: ownerId,
      title: book.name,
      description: book.description || "",
      tags: [book.tag || "自建"],
      is_public: (book.visibility || "private") === "public",
      mode: book.mode || "anki",
    };
    const { error: bookError } = await client.from("custom_books").upsert(row, { onConflict: "owner_id,id" });
    if (bookError) throw bookError;

    const { error: deleteError } = await client.from("custom_cards").delete().eq("owner_id", ownerId).eq("book_id", book.id);
    if (deleteError) throw deleteError;

    const cards = (book.words || []).map((word, index) => ({
      owner_id: ownerId,
      book_id: book.id,
      front: word.hint || word.definition || "",
      back: word.word || "",
      hint: word.hint || "",
      extra: word.pos || "",
      card_index: index,
    }));
    if (!cards.length) return;
    const { error: cardError } = await client.from("custom_cards").insert(cards);
    if (cardError) throw cardError;
  }

  async function deleteBook(ownerId, bookId) {
    if (!client) return;
    const { error } = await client.from("custom_books").delete().eq("owner_id", ownerId).eq("id", bookId);
    if (error) throw error;
  }

  async function loadPracticeData(userId, projectId) {
    if (!client || !userId || !projectId) return null;
    const { data, error } = await client.from("practice_data").select("*").eq("user_id", userId).eq("project_id", projectId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function savePracticeData(userId, projectId, data) {
    if (!client || !userId || !projectId) return;
    const { error } = await client.from("practice_data").upsert(
      {
        user_id: userId,
        project_id: projectId,
        favorites: data.favorites || [],
        wrong_list: data.wrongList || [],
        progress: data.progress || {},
        ratings: data.ratings || {},
      },
      { onConflict: "user_id,project_id" },
    );
    if (error) throw error;
  }

  async function syncFavoriteProjects(userId, projectIds) {
    if (!client || !userId) return;
    const { error: deleteError } = await client.from("favorite_projects").delete().eq("user_id", userId);
    if (deleteError) throw deleteError;
    const rows = (projectIds || []).map((projectId) => ({ user_id: userId, project_id: projectId }));
    if (!rows.length) return;
    const { error: insertError } = await client.from("favorite_projects").insert(rows);
    if (insertError) throw insertError;
  }

  async function smartCreateCards(payload) {
    if (!client) throw new Error("Supabase 尚未配置。");
    const { data, error } = await client.functions.invoke("smart-create-cards", {
      body: payload,
    });
    if (error) {
      let message = error.message || "智慧创建服务调用失败。";
      if (/failed to send/i.test(message)) {
        message = "无法连接智慧创建后端代理。请确认 Supabase Edge Function `smart-create-cards` 已部署到当前项目。";
      }
      try {
        if (error.context && typeof error.context.json === "function") {
          const body = await error.context.json();
          message = body?.error || message;
        }
      } catch (_ignored) {}
      throw new Error(message);
    }
    return data;
  }

  async function checkSmartCreateService() {
    if (!client || !config.url) throw new Error("Supabase 尚未配置。");
    const url = `${config.url.replace(/\/$/, "")}/functions/v1/smart-create-cards`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
        },
      });
      if (response.status === 404) {
        throw new Error("未找到 smart-create-cards Edge Function，请先部署。");
      }
      if (!response.ok) {
        throw new Error(`智慧创建后端代理不可用（HTTP ${response.status}）。`);
      }
      return response.json();
    } catch (error) {
      if (error instanceof Error && error.message && !/failed to fetch|network/i.test(error.message)) throw error;
      throw new Error("无法连接智慧创建后端代理。请确认 smart-create-cards Edge Function 已部署。");
    }
  }

  window.SongjiSupabase = {
    client,
    isConfigured: configured,
    loadWorkspace,
    signUp,
    signIn,
    signOut,
    upsertBook,
    deleteBook,
    loadPracticeData,
    savePracticeData,
    syncFavoriteProjects,
    smartCreateCards,
    checkSmartCreateService,
  };
})();

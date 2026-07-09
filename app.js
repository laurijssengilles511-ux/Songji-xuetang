(function () {
  const AUTH_KEY = "songji-auth-v1";
  const PRACTICE_KEY = "songji-foreign-dictation-v1";
  const AI_CONFIG_KEY = "songji-ai-config-v1";
  const AI_PROVIDER_DEFAULTS = {
    openai: { label: "ChatGPT / OpenAI", model: "gpt-4.1-mini", placeholder: "sk-..." },
    deepseek: { label: "DeepSeek", model: "deepseek-v4-flash", placeholder: "sk-..." },
    anthropic: { label: "Claude / Anthropic", model: "claude-sonnet-4-5", placeholder: "sk-ant-..." },
  };

  const nav = [
    { href: "index.html", label: "首页" },
    { href: "dictation.html", label: "牌组" },
    { href: "stats.html", label: "统计" },
    { href: "browser.html", label: "卡片" },
    { href: "create.html", label: "创建" },
    { href: "profile.html", label: "我的" },
  ];

  const DEFAULT_AVATARS = [
    { id: "cat-cream", name: "奶油小猫", src: "assets/avatars/cat-cream.png" },
    { id: "dog-caramel", name: "焦糖小狗", src: "assets/avatars/dog-caramel.png" },
    { id: "cat-tuxedo", name: "领结小猫", src: "assets/avatars/cat-tuxedo.png" },
    { id: "dog-corgi", name: "柯基小狗", src: "assets/avatars/dog-corgi.png" },
  ];

  const PROJECT_TAGS = [
    { id: "all", label: "全部", value: null },
    { id: "official", label: "官方", value: "官方" },
    { id: "foreign", label: "外语", value: "外语" },
    { id: "classic", label: "经典", value: "经典" },
    { id: "custom", label: "自建", value: "自建" },
    { id: "favorite", label: "收藏", value: null },
  ];

  const CUSTOM_PROJECT_TAGS = PROJECT_TAGS.filter((tag) => ["foreign", "classic", "custom"].includes(tag.id));

  function projectTagLabel(value) {
    return CUSTOM_PROJECT_TAGS.find((tag) => tag.value === value)?.label || "自建";
  }

  function defaultAvatarFor(value) {
    const text = String(value || "guest");
    const sum = Array.from(text).reduce((total, char) => total + char.charCodeAt(0), 0);
    return DEFAULT_AVATARS[sum % DEFAULT_AVATARS.length];
  }

  function avatarFor(account) {
    if (account?.avatarId) return DEFAULT_AVATARS.find((avatar) => avatar.id === account.avatarId) || DEFAULT_AVATARS[0];
    return defaultAvatarFor(account?.id || account?.name);
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function richHTML(value) {
    const text = String(value ?? "");
    const parts = [];
    let lastIndex = 0;
    const imagePattern = /\[img:(data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=]+)\]/g;
    let match;
    while ((match = imagePattern.exec(text))) {
      parts.push(escapeHTML(text.slice(lastIndex, match.index)));
      parts.push(`<img class="card-inline-image" src="${match[1]}" alt="卡片图片" />`);
      lastIndex = match.index + match[0].length;
    }
    parts.push(escapeHTML(text.slice(lastIndex)));
    return parts.join("").replace(/\n/g, "<br>");
  }

  function loadAuthStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(AUTH_KEY));
      return parsed && typeof parsed === "object" ? parsed : { users: [], session: null };
    } catch (error) {
      return { users: [], session: null };
    }
  }

  let authStore = loadAuthStore();
  authStore.users = authStore.users || [];

  function remoteStore() {
    return window.SongjiSupabase;
  }

  function isRemoteEnabled() {
    return Boolean(remoteStore()?.isConfigured);
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} 超时`)), ms);
      }),
    ]);
  }

  async function hydrateRemoteAuthStore() {
    if (!isRemoteEnabled()) return;
    try {
      const previousSession = JSON.stringify(authStore.session || null);
      const remote = await withTimeout(remoteStore().loadWorkspace(), 2500, "Supabase 数据加载");
      if (!remote) return;
      authStore = {
        users: remote.users || [],
        session: remote.session,
      };
      if (remote.session?.userId && remote.practiceData) {
        const existing = loadPracticeData(remote.session.userId);
        savePracticeData(remote.session.userId, { ...existing, ...remote.practiceData });
      }
      saveAuthStore();
      return previousSession !== JSON.stringify(authStore.session || null);
    } catch (error) {
      console.error("Supabase 数据加载失败", error);
      return false;
    }
  }

  function saveAuthStore() {
    localStorage.setItem(AUTH_KEY, JSON.stringify(authStore));
  }

  function simpleHash(value) {
    return btoa(unescape(encodeURIComponent(`songji:${value}`)));
  }

  function currentAccount() {
    const session = authStore.session;
    if (!session || session.type === "guest") return { type: "guest", id: "guest", name: "访客", avatarId: "cat-cream" };
    const user = authStore.users.find((item) => item.id === session.userId);
    return user ? { type: "user", ...user } : { type: "guest", id: "guest", name: "访客" };
  }

  async function setGuestSession() {
    if (isRemoteEnabled()) {
      try {
        await remoteStore().signOut();
      } catch (error) {
        console.error("Supabase 退出失败", error);
      }
    }
    authStore.session = { type: "guest" };
    saveAuthStore();
    location.reload();
  }

  function setUserSession(userId) {
    authStore.session = { type: "user", userId };
    saveAuthStore();
    location.reload();
  }

  function updateUser(userId, updater) {
    const index = authStore.users.findIndex((user) => user.id === userId);
    if (index === -1) return null;
    const next = updater({ ...authStore.users[index] });
    authStore.users[index] = next;
    saveAuthStore();
    return next;
  }

  function loadPracticeData(accountId) {
    try {
      const parsed = JSON.parse(localStorage.getItem(`${PRACTICE_KEY}:${accountId}`));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function savePracticeData(accountId, data) {
    try {
      localStorage.setItem(`${PRACTICE_KEY}:${accountId}`, JSON.stringify(data));
    } catch (error) {
      // Profile and favorites still render without persisted practice data.
    }
  }

  function loadAIConfig(accountId) {
    try {
      const parsed = JSON.parse(localStorage.getItem(`${AI_CONFIG_KEY}:${accountId}`));
      const provider = AI_PROVIDER_DEFAULTS[parsed?.provider] ? parsed.provider : "openai";
      return {
        provider,
        apiKey: parsed?.apiKey || "",
        model: parsed?.model || AI_PROVIDER_DEFAULTS[provider].model,
      };
    } catch (error) {
      return { provider: "openai", apiKey: "", model: AI_PROVIDER_DEFAULTS.openai.model };
    }
  }

  function saveAIConfig(accountId, config) {
    const provider = AI_PROVIDER_DEFAULTS[config.provider] ? config.provider : "openai";
    localStorage.setItem(
      `${AI_CONFIG_KEY}:${accountId}`,
      JSON.stringify({
        provider,
        apiKey: String(config.apiKey || "").trim(),
        model: String(config.model || AI_PROVIDER_DEFAULTS[provider].model).trim() || AI_PROVIDER_DEFAULTS[provider].model,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  function clearAIConfig(accountId) {
    localStorage.removeItem(`${AI_CONFIG_KEY}:${accountId}`);
  }

  function customProjectId(ownerId, bookId) {
    return `custom:${ownerId}::${bookId}`;
  }

  function findCustomBook(ownerId, bookId) {
    const owner = authStore.users.find((user) => user.id === ownerId);
    const book = owner?.customBooks?.find((item) => item.id === bookId);
    return owner && book ? { owner, book } : null;
  }

  function removeFavoriteProjectReferences(projectId) {
    authStore.users.forEach((user) => {
      const data = loadPracticeData(user.id);
      if (Array.isArray(data.favoriteProjects) && data.favoriteProjects.includes(projectId)) {
        data.favoriteProjects = data.favoriteProjects.filter((id) => id !== projectId);
        savePracticeData(user.id, data);
      }
    });
  }

  async function deleteCustomBook(accountId, bookId) {
    const projectId = customProjectId(accountId, bookId);
    const next = updateUser(accountId, (user) => {
      user.customBooks = (user.customBooks || []).filter((book) => book.id !== bookId);
      return user;
    });
    if (isRemoteEnabled()) {
      await remoteStore().deleteBook(accountId, bookId);
    }
    removeFavoriteProjectReferences(projectId);
    return next;
  }

  async function updateCustomBook(accountId, bookId, patch) {
    const next = updateUser(accountId, (user) => {
      user.customBooks = (user.customBooks || []).map((book) =>
        book.id === bookId ? { ...book, ...patch, updatedAt: new Date().toISOString() } : book,
      );
      return user;
    });
    const book = next?.customBooks?.find((item) => item.id === bookId);
    if (isRemoteEnabled() && book) {
      await remoteStore().upsertBook(accountId, book);
    }
    return next;
  }

  function openAuthDialog(mode = "login") {
    const dialog = document.getElementById("authDialog");
    if (!dialog) return;
    dialog.hidden = false;
    dialog.dataset.mode = mode;
    renderAuthDialog();
  }

  function closeAuthDialog() {
    const dialog = document.getElementById("authDialog");
    if (dialog) dialog.hidden = true;
  }

  function renderTopbar() {
    const host = document.getElementById("topbar");
    if (!host) return;

    const current = location.pathname.split("/").pop() || "index.html";
    const account = currentAccount();
    host.innerHTML = `
      <div class="topbar-inner">
        <a href="index.html" class="brand">
          <span class="seal">忆</span>
          <span>诵记学堂<br><small>背诵记忆学习平台</small></span>
        </a>
        <nav class="topnav">
          ${nav
            .map((item) => `<a href="${item.href}" class="${item.href === current ? "active" : ""}">${item.label}</a>`)
            .join("")}
        </nav>
        <div class="auth-status">
          ${
            account.type === "user"
              ? `<a class="account-pill ${current === "profile.html" ? "active" : ""}" href="profile.html" title="进入我的主页">
                  <img class="avatar xs" src="${avatarFor(account).src}" alt="${escapeHTML(account.name)}的头像" />
                  <span class="auth-name">${escapeHTML(account.name)}</span>
                </a>`
              : `<span class="account-pill muted">
                  <img class="avatar xs" src="${avatarFor(account).src}" alt="访客头像" />
                  <span class="auth-name">${escapeHTML(account.name)}</span>
                </span>`
          }
          ${
            account.type === "user"
              ? '<button class="btn sm ghost" id="logoutBtn" type="button">退出</button>'
              : '<button class="btn sm ghost" id="guestBtn" type="button">访客</button><button class="btn sm primary" id="loginOpenBtn" type="button">登录 / 注册</button>'
          }
        </div>
      </div>
      <div class="auth-dialog" id="authDialog" hidden></div>`;

    document.getElementById("guestBtn")?.addEventListener("click", () => setGuestSession());
    document.getElementById("loginOpenBtn")?.addEventListener("click", () => openAuthDialog("login"));
    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
      if (isRemoteEnabled()) {
        try {
          await remoteStore().signOut();
        } catch (error) {
          console.error("Supabase 退出失败", error);
        }
      }
      authStore.session = null;
      saveAuthStore();
      location.reload();
    });
    renderAuthDialog();
  }

  function renderAuthDialog(message = "") {
    const dialog = document.getElementById("authDialog");
    if (!dialog) return;
    const mode = dialog.dataset.mode || "login";
    const isLogin = mode === "login";
    const isRemote = isRemoteEnabled();
    dialog.innerHTML = `
      <div class="auth-panel" role="dialog" aria-modal="true" aria-label="${isLogin ? "用户登录" : "用户注册"}">
        <button class="icon-button auth-close" id="authCloseBtn" type="button" aria-label="关闭">×</button>
        <h2>${isLogin ? (isRemote ? "登录云端资料空间" : "进入本地资料空间") : isRemote ? "创建云端资料空间" : "创建本地资料空间"}</h2>
        <p>${
          isRemote
            ? "使用 Supabase Auth 登录；自建牌组和收藏会保存到云端数据库。"
            : isLogin
              ? "资料只保存在当前浏览器中；换设备前请在卡片浏览器导出备份。"
              : "这是当前浏览器内的本地资料空间，不会自动云同步。"
        }</p>
        <form id="authForm">
          <div class="field">
            <label>${isRemote ? "邮箱" : "用户名"}</label>
            <input class="input" id="authName" type="${isRemote ? "email" : "text"}" autocomplete="${isRemote ? "email" : "username"}" required />
          </div>
          ${
            isRemote && !isLogin
              ? `<div class="field">
                  <label>昵称</label>
                  <input class="input" id="authUsername" autocomplete="nickname" required />
                </div>`
              : ""
          }
          <div class="field">
            <label>密码</label>
            <input class="input" id="authPassword" type="password" autocomplete="${isLogin ? "current-password" : "new-password"}" required />
          </div>
          ${message ? `<div class="feedback ${message.includes("成功") ? "ok" : "err"}">${escapeHTML(message)}</div>` : ""}
          <button class="btn primary auth-submit" type="submit">${isLogin ? "进入" : "创建并进入"}</button>
        </form>
        <div class="auth-switch">
          <button class="link-button" id="authModeBtn" type="button">${isLogin ? "还没有资料空间？立即创建" : "已有资料空间？返回进入"}</button>
          <button class="link-button" id="authGuestBtn" type="button">以访客身份使用官方牌组</button>
        </div>
      </div>`;

    document.getElementById("authCloseBtn")?.addEventListener("click", closeAuthDialog);
    document.getElementById("authGuestBtn")?.addEventListener("click", () => setGuestSession());
    document.getElementById("authModeBtn")?.addEventListener("click", () => {
      dialog.dataset.mode = isLogin ? "register" : "login";
      renderAuthDialog();
    });
    document.getElementById("authForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = document.getElementById("authName").value.trim();
      const password = document.getElementById("authPassword").value;
      if (!name || !password) return;

      if (isRemote) {
        const submit = event.submitter || document.querySelector(".auth-submit");
        if (submit) submit.disabled = true;
        try {
          let authResult;
          if (isLogin) {
            await remoteStore().signIn({ email: name, password });
          } else {
            const username = document.getElementById("authUsername").value.trim();
            if (!username) {
              renderAuthDialog("请填写昵称。");
              return;
            }
            authResult = await remoteStore().signUp({
              email: name,
              password,
              username,
              avatarId: DEFAULT_AVATARS[authStore.users.length % DEFAULT_AVATARS.length].id,
            });
            if (!authResult?.session) {
              renderAuthDialog("注册成功，请检查邮箱并完成验证后再登录。");
              return;
            }
          }
          await hydrateRemoteAuthStore();
          saveAuthStore();
          location.reload();
        } catch (error) {
          renderAuthDialog(error.message || "登录失败，请稍后重试。");
        } finally {
          if (submit) submit.disabled = false;
        }
        return;
      }

      if (isLogin) {
        const user = authStore.users.find((item) => item.name === name);
        if (!user || user.passwordHash !== simpleHash(password)) {
          renderAuthDialog("用户名或密码不正确。");
          return;
        }
        setUserSession(user.id);
        return;
      }

      if (authStore.users.some((item) => item.name === name)) {
        renderAuthDialog("这个用户名已经被注册。");
        return;
      }
      const user = {
        id: `u-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        passwordHash: simpleHash(password),
        avatarId: DEFAULT_AVATARS[authStore.users.length % DEFAULT_AVATARS.length].id,
        customBooks: [],
        createdAt: new Date().toISOString(),
      };
      authStore.users.push(user);
      setUserSession(user.id);
    });
  }

  function bindTagRows() {
    document.querySelectorAll(".tag-row").forEach((row) => {
      row.querySelectorAll(".tag-pick").forEach((button) => {
        button.addEventListener("click", () => {
          row.querySelectorAll(".tag-pick").forEach((item) => item.classList.remove("active"));
          button.classList.add("active");
        });
      });
    });
  }

  function normalizeAnswer(value) {
    return value
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function answerMatches(input, expected) {
    const normalizedInput = normalizeAnswer(input);
    const answers = expected
      .split("/")
      .map((item) => normalizeAnswer(item))
      .filter(Boolean);
    return answers.includes(normalizedInput);
  }

  function shuffle(items) {
    const list = items.slice();
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function parseCustomRows(value) {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.includes("|")
          ? line.split("|").map((part) => part.trim())
          : line.split(/\t+/).map((part) => part.trim());
        if (parts.length < 2 || !parts[0] || !parts[1]) return null;
        return {
          word: parts[0],
          hint: parts[1],
          definition: parts[1],
          pos: parts[2] || "",
        };
      })
      .filter(Boolean);
  }

  async function createCustomBook(account, name, words, visibility = "private", tag = "自建") {
    const book = {
      id: `book-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      words,
      visibility,
      tag: tag || "自建",
      createdAt: new Date().toISOString(),
    };
    const next = updateUser(account.id, (user) => {
      user.customBooks = user.customBooks || [];
      user.customBooks.push(book);
      return user;
    });
    if (isRemoteEnabled()) {
      await remoteStore().upsertBook(account.id, book);
    }
    return next;
  }

  function visibleCustomSRSUnits(account) {
    return authStore.users.flatMap((user) =>
      (user.customBooks || [])
        .filter((book) => (book.visibility || "private") === "public" || (account.type === "user" && user.id === account.id))
        .map((book) => ({
          source: "custom",
          deckId: "custom:" + user.id + "_" + book.id,
          deckName: book.name,
          ownerId: user.id,
          bookId: book.id,
          words: book.words || [],
        })),
    );
  }

  function getVisibleSRSDeckSources(account) {
    const sources = [];
    if (window.COLLEGE_ENGLISH_IV) {
      sources.push({
        source: "english",
        deckId: "english:" + window.COLLEGE_ENGLISH_IV.id,
        deckName: window.COLLEGE_ENGLISH_IV.name || "大学英语 IV",
        book: window.COLLEGE_ENGLISH_IV,
      });
    }
    if (window.RUSSIAN_WORDBOOK) {
      sources.push({
        source: "russian",
        deckId: "russian:" + window.RUSSIAN_WORDBOOK.id,
        deckName: window.RUSSIAN_WORDBOOK.name || "俄语 I",
        book: window.RUSSIAN_WORDBOOK,
      });
    }
    visibleCustomSRSUnits(account).forEach((unit) => sources.push(unit));
    if (window.LUNYU_TRANSLATIONS) {
      sources.push({
        source: "lunyu",
        deckId: "lunyu:default",
        deckName: "论语",
        book: window.LUNYU_TRANSLATIONS,
      });
    }
    return sources;
  }

  function getSRSCardIdsForSource(ds) {
    const ids = [];
    if (ds.source === "lunyu" && ds.book) {
      ds.book.chapters.forEach((chapter) => {
        chapter.sentences.forEach((sentence) => ids.push("lunyu:default:" + sentence.id));
      });
    } else if (Array.isArray(ds.words)) {
      ds.words.forEach((word) => ids.push(ds.deckId + ":" + word.word));
    } else if (ds.book) {
      ds.book.units.forEach((unit) => {
        unit.words.forEach((word) => ids.push(ds.source + ":" + ds.book.id + ":" + word.word));
      });
    }
    return ids;
  }

  function initForeignDictation() {
    if (!document.getElementById("languageList")) return;

    const englishBook = window.COLLEGE_ENGLISH_IV;
    const russianBook = window.RUSSIAN_WORDBOOK;
    const account = currentAccount();
    let customBook = buildCustomBook();
    let languages = [
      {
        id: "college-english",
        name: "大学英语",
        title: "大学英语 IV",
        icon: "英",
        tone: "#b5502f",
        toneSoft: "#f3e3dc",
        book: englishBook,
        tags: ["官方", "外语"],
        desc: englishBook ? "已导入大学英语 IV，可按 Unit 进入间隔复习。" : "词书待导入。",
      },
      {
        id: "russian",
        name: "俄语",
        title: "俄语 I",
        icon: "俄",
        tone: "#7a4f9f",
        toneSoft: "#eee7f5",
        book: russianBook,
        tags: ["官方", "外语"],
        desc: russianBook ? "已导入俄语 I，可按课进入间隔复习，也可查看词表。" : "词书待导入。",
      },
      {
        id: "lunyu",
        name: "论语",
        title: "《论语》字词 · 翻译",
        icon: "文",
        tone: "#3d6b5e",
        toneSoft: "#e0ebe6",
        href: "lunyu.html",
        tags: ["官方", "经典"],
        desc: "原文与翻译已接入今日复习；独立页面可用于按章浏览。",
      },
    ];
    languages.push({
      id: "custom",
        name: "自建牌组",
        title: "自建牌组",
      icon: "创",
      tone: "#3d6b5e",
      toneSoft: "#e0ebe6",
      book: customBook,
      tags: ["自建"],
        desc: account.type === "user" ? "查看公开牌组和自己的私密牌组。" : "查看用户公开的记忆牌组。",
    });

    const state = {
      languageId: null,
      unitId: null,
      order: "shuffle",
      direction: "dictation",
      queue: [],
      index: 0,
      correct: 0,
      answered: false,
      wrongItems: [],
      skipped: 0,
      practiceWords: [],
      practiceLabel: "",
      collectionType: null,
      projectTag: "all",
      ankiQueue: [],
      ankiIndex: 0,
      ankiFlipped: false,
      ankiRatings: { again: 0, hard: 0, good: 0, easy: 0 },
      ankiRequeued: 0,
      ankiPracticeWords: [],
      ankiLabel: "",
      // SRS 间隔复习
      srsQueue: [],           // 当前复习队列（cardId 数组）
      srsIndex: 0,            // 队列中当前位置
      srsCompletedCount: 0,   // 本轮已经处理的卡片数
      srsInitialTotal: 0,     // 本轮初始卡片数，用于稳定显示进度
      srsFlipped: false,      // 是否已翻面
      srsRatings: { again: 0, hard: 0, good: 0, easy: 0 },
      srsStartTime: 0,        // 本轮开始时间戳
      srsCardStartTime: 0,    // 当前卡片开始时间戳
      srsUndoStack: [],       // 本轮可撤销操作快照
    };

    const $ = (id) => document.getElementById(id);
    const wordIndex = new Map();
    const srsContentMap = new Map(); // cardId → content 对象

    function buildCustomBook() {
      const books = authStore.users.flatMap((user) =>
        (user.customBooks || [])
          .filter((book) => (book.visibility || "private") === "public" || (account.type === "user" && user.id === account.id))
          .map((book) => ({
            ...book,
            ownerId: user.id,
            ownerName: user.name,
            visibility: book.visibility || "private",
            tag: book.tag || "自建",
          })),
      );
      return {
        id: `custom-${account.id}`,
        name: "自建牌组",
        language: "自建",
        units: books.map((book) => ({
          id: `${book.ownerId}::${book.id}`,
          bookId: book.id,
          ownerId: book.ownerId,
          name: book.name,
          ownerName: book.ownerName,
          visibility: book.visibility,
          tag: book.tag || "自建",
          words: (book.words || []).map((word, index) => ({
            word: word.word,
            hint: word.hint,
            definition: word.definition || word.hint,
            pos: word.pos || "",
            __customIndex: index,
          })),
        })),
      };
    }

    function refreshCustomLanguage() {
      customBook = buildCustomBook();
      const custom = languages.find((language) => language.id === "custom");
      if (custom) {
        custom.book = customBook;
        custom.desc = account.type === "user" ? "查看公开牌组和自己的私密牌组。" : "查看用户公开的记忆牌组。";
      }
      rebuildWordIndex();
    }

    function indexBook(book) {
      if (!book) return;
      book.units.forEach((unit) => {
        unit.words.forEach((word) => {
          const id = `${book.id}::${unit.id}::${word.word}`;
          if (!Object.prototype.hasOwnProperty.call(word, "__id")) {
            Object.defineProperties(word, {
              __id: { value: id },
              __unitId: { value: unit.id },
              __unitName: { value: unit.name },
            });
          }
          word.hint = word.hint || word.definition;
          word.definition = word.definition || word.hint;
          wordIndex.set(id, word);
        });
      });
    }

    function rebuildWordIndex() {
      wordIndex.clear();
      indexBook(englishBook);
      indexBook(russianBook);
      indexBook(customBook);
    }

    rebuildWordIndex();

    /* ===== SRS 内容映射 ===== */
    // 将 cardId 映射到展示内容（正面/背面/标签/颜色等），供 SRS 复习界面使用
    function buildSRSContentMap() {
      srsContentMap.clear();

      // 英语词书：默认 anki 方向（看英语单词 → 记中文含义）
      if (englishBook) {
        englishBook.units.forEach(function (unit) {
          unit.words.forEach(function (word) {
            var cardId = "english:" + englishBook.id + ":" + word.word;
            srsContentMap.set(cardId, {
              cardId: cardId,
              front: word.word,
              back: word.hint || word.definition,
              frontLabel: "英语单词",
              backLabel: "中文释义",
              frontHint: "在脑中回忆中文含义后点击查看",
              extra: word.definition && word.definition !== (word.hint || word.definition) ? word.definition : null,
              sourceName: "大学英语 IV",
              tone: "#b5502f",
              toneSoft: "#f3e3dc",
            });
          });
        });
      }

      // 俄语词书：中文释义 → 俄语单词（固定 anki 方向）
      if (russianBook) {
        russianBook.units.forEach(function (unit) {
          unit.words.forEach(function (word) {
            var cardId = "russian:" + russianBook.id + ":" + word.word;
            srsContentMap.set(cardId, {
              cardId: cardId,
              front: word.definition || word.hint,
              back: word.word,
              frontLabel: "中文释义",
              backLabel: "俄语单词",
              frontHint: "在脑中回忆俄语单词后点击查看",
              extra: null,
              sourceName: "俄语 I",
              tone: "#7a4f9f",
              toneSoft: "#eee7f5",
            });
          });
        });
      }

      // 自建牌组：正面（提示） → 背面（答案）
      customBook.units.forEach(function (unit) {
        unit.words.forEach(function (word) {
          var deckId = unit.ownerId + "_" + unit.bookId; // 用 _ 替代 :: 以避免与 cardId 的 : 分隔冲突
          var cardId = "custom:" + deckId + ":" + word.word;
          srsContentMap.set(cardId, {
            cardId: cardId,
            front: word.hint || word.definition,
            back: word.word,
            frontLabel: "正面",
            backLabel: "背面",
            frontHint: "在脑中回忆背面内容后点击查看",
            extra: word.definition && word.definition !== (word.hint || word.definition) ? word.definition : null,
            sourceName: unit.name,
            tone: "#3d6b5e",
            toneSoft: "#e0ebe6",
          });
        });
      });

      // 论语：原文 → 翻译
      var lunyuBook = window.LUNYU_TRANSLATIONS;
      if (lunyuBook) {
        lunyuBook.chapters.forEach(function (chapter) {
          chapter.sentences.forEach(function (sentence) {
            var cardId = "lunyu:default:" + sentence.id;
            srsContentMap.set(cardId, {
              cardId: cardId,
              front: sentence.original,
              back: sentence.translation,
              frontLabel: "原文",
              backLabel: "白话翻译",
              frontHint: "在脑中回忆翻译后点击查看",
              extra: null,
              sourceName: "论语 · " + chapter.name,
              tone: "#3d6b5e",
              toneSoft: "#e0ebe6",
            });
          });
        });
      }
    }

    buildSRSContentMap();

    function srsSourceForLanguage(language) {
      if (!language) return "";
      if (language.id === "college-english") return "english";
      if (language.id === "russian") return "russian";
      if (language.id === "custom") return "custom";
      return language.id;
    }

    function srsDeckSources() {
      return getVisibleSRSDeckSources(account);
    }

    function cardIdsForSRSSource(ds) {
      return getSRSCardIdsForSource(ds);
    }

    function buildSRSQueueSummary(options) {
      options = options || {};
      const accountId = account.type === "user" ? account.id : "guest";
      const SRS = window.SRSEngine;
      if (!SRS) return { queue: [], dueCount: 0, newCount: 0, totalCount: 0 };
      const includeNew = options.includeNew === true;

      const srsData = SRS.loadSRSData(accountId);
      const tagFilter = (options.tag || "").trim().toLowerCase();
      function matchesTag(cardId) {
        if (!tagFilter) return true;
        const card = srsData.cardStates[cardId];
        return Boolean(card && (card.tags || []).some(function (tag) {
          return tag.toLowerCase().includes(tagFilter);
        }));
      }

      const queue = SRS.getDueCards(accountId)
        .map(function (card) { return card.cardId; })
        .filter(matchesTag);
      const queued = new Set(queue);
      const seenNew = new Set();
      const dueCount = queue.length;
      let newCount = 0;

      srsDeckSources().forEach(function (ds) {
        const newIds = SRS.getAvailableNewCards(
          accountId,
          ds.deckId,
          cardIdsForSRSSource(ds)
        );
        newIds.filter(matchesTag).forEach(function (id) {
          if (queued.has(id) || seenNew.has(id)) return;
          seenNew.add(id);
          newCount++;
          if (!includeNew) return;
          queue.push(id);
          queued.add(id);
        });
      });

      return { queue: queue, dueCount: dueCount, newCount: newCount, totalCount: queue.length };
    }

    function loadUserData() {
      try {
        const parsed = JSON.parse(localStorage.getItem(`${PRACTICE_KEY}:${account.id}`));
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (error) {
        return {};
      }
    }

    let userData = loadUserData();

    function saveUserData() {
      try {
        localStorage.setItem(`${PRACTICE_KEY}:${account.id}`, JSON.stringify(userData));
      } catch (error) {
        // Local progress is optional; the trainer still works if browser storage is unavailable.
      }
    }

    function syncProjectFavorites() {
      if (!isRemoteEnabled() || account.type !== "user" || !Array.isArray(userData.favoriteProjects)) return;
      remoteStore()
        .syncFavoriteProjects(account.id, userData.favoriteProjects)
        .catch((error) => console.error("Supabase 收藏同步失败", error));
    }

    function projectFavorites() {
      userData.favoriteProjects = userData.favoriteProjects || [];
      return userData.favoriteProjects;
    }

    function isProjectFavorite(project) {
      return projectFavorites().includes(project.projectId);
    }

    function toggleProjectFavorite(project) {
      const favorites = projectFavorites();
      if (favorites.includes(project.projectId)) {
        userData.favoriteProjects = favorites.filter((id) => id !== project.projectId);
      } else {
        favorites.push(project.projectId);
      }
      saveUserData();
      syncProjectFavorites();
      renderLanguages();
    }

    function currentBookStore() {
      const book = currentBook() || englishBook;
      if (!book) return null;
      userData.books = userData.books || {};
      userData.books[book.id] = userData.books[book.id] || { favorites: [], wrongs: {}, progress: {}, ratings: {} };
      userData.books[book.id].favorites = userData.books[book.id].favorites || [];
      userData.books[book.id].wrongs = userData.books[book.id].wrongs || {};
      userData.books[book.id].progress = userData.books[book.id].progress || {};
      userData.books[book.id].ratings = userData.books[book.id].ratings || {};
      return userData.books[book.id];
    }

    function isFavorite(word) {
      const store = currentBookStore();
      return Boolean(store && store.favorites.includes(word.__id));
    }

    function getFavoriteWords() {
      const store = currentBookStore();
      return store ? store.favorites.map((id) => wordIndex.get(id)).filter(Boolean) : [];
    }

    function getWrongWords() {
      const store = currentBookStore();
      return store ? Object.keys(store.wrongs).map((id) => wordIndex.get(id)).filter(Boolean) : [];
    }

    function updateLibraryTools() {
      if (!$("favoriteCount") || !currentBookStore()) return;
      $("favoriteCount").textContent = `${getFavoriteWords().length} 个`;
      $("wrongCount").textContent = `${getWrongWords().length} 个`;
      const book = currentBook();
      const isAnki = book && book.mode === "anki";
      const wrongsBtn = $("openWrongsBtn");
      if (wrongsBtn) wrongsBtn.hidden = isAnki;
    }

    function toggleFavorite(word) {
      const store = currentBookStore();
      if (!store || !word) return;
      if (store.favorites.includes(word.__id)) {
        store.favorites = store.favorites.filter((id) => id !== word.__id);
      } else {
        store.favorites.push(word.__id);
      }
      saveUserData();
      updateFavoriteButton();
      updateLibraryTools();
      if (state.collectionType === "favorites") renderCollection("favorites");
    }

    function removeWrong(word) {
      const store = currentBookStore();
      if (!store || !word) return;
      delete store.wrongs[word.__id];
      saveUserData();
      updateLibraryTools();
      if (state.collectionType === "wrongs") renderCollection("wrongs");
    }

    function recordAttempt(word, result) {
      const store = currentBookStore();
      if (!store || !word) return;
      const now = new Date().toISOString();
      const item = store.progress[word.__id] || { attempts: 0, correct: 0, wrong: 0, skipped: 0 };
      item.attempts += 1;
      item.lastResult = result;
      item.lastAt = now;

      if (result === "correct") {
        item.correct += 1;
        delete store.wrongs[word.__id];
      } else if (result === "skipped") {
        item.skipped += 1;
        store.wrongs[word.__id] = { count: (store.wrongs[word.__id]?.count || 0) + 1, lastAt: now };
      } else {
        item.wrong += 1;
        store.wrongs[word.__id] = { count: (store.wrongs[word.__id]?.count || 0) + 1, lastAt: now };
      }

      store.progress[word.__id] = item;
      saveUserData();
      updateLibraryTools();
    }

    function unitProgress(unit) {
      const store = currentBookStore();
      if (!store) return { practiced: 0, rate: null };
      const records = unit.words.map((word) => store.progress[word.__id]).filter(Boolean);
      const correct = records.reduce((sum, item) => sum + item.correct, 0);
      const attempts = records.reduce((sum, item) => sum + item.correct + item.wrong + item.skipped, 0);
      return {
        practiced: records.length,
        rate: attempts ? Math.round((correct / attempts) * 100) : null,
      };
    }

    function unitAnkiReviewed(unit) {
      const store = currentBookStore();
      if (!store || !store.ratings) return 0;
      return unit.words.filter((word) => store.ratings[word.__id]).length;
    }

    /* ===== SRS 进度辅助函数 ===== */

    function getSRSProgressForUnit(source, bookId, unit, preloadedSRSData) {
      // 获取某个单元内所有卡片的 SRS 状态统计
      var accountId = account.type === "user" ? account.id : "guest";
      var SRS = window.SRSEngine;
      if (!SRS) return { newCount: unit.words.length, learningCount: 0, reviewCount: 0, relearningCount: 0, dueCount: 0, suspendedCount: 0 };
      var srsData = preloadedSRSData || SRS.loadSRSData(accountId);
      var stats = { newCount: 0, learningCount: 0, reviewCount: 0, relearningCount: 0, dueCount: 0, suspendedCount: 0 };
      var now = Date.now();
      unit.words.forEach(function (word) {
        var cardId = source === "custom"
          ? "custom:" + unit.ownerId + "_" + unit.bookId + ":" + word.word
          : source + ":" + bookId + ":" + word.word;
        var cardState = srsData.cardStates[cardId];
        if (!cardState) {
          stats.newCount++;
        } else if (cardState.suspended) {
          stats.suspendedCount++;
        } else if (cardState.state === "learning") {
          stats.learningCount++;
          if (cardState.due <= now) stats.dueCount++;
        } else if (cardState.state === "review") {
          stats.reviewCount++;
          if (cardState.due <= now) stats.dueCount++;
        } else if (cardState.state === "relearning") {
          stats.relearningCount++;
          if (cardState.due <= now) stats.dueCount++;
        }
      });
      return stats;
    }

    function getSRSProgressForLunyuChapter(chapter) {
      var accountId = account.type === "user" ? account.id : "guest";
      var SRS = window.SRSEngine;
      if (!SRS) return { newCount: chapter.sentences.length, learningCount: 0, reviewCount: 0, relearningCount: 0, dueCount: 0 };
      var srsData = SRS.loadSRSData(accountId);
      var stats = { newCount: 0, learningCount: 0, reviewCount: 0, relearningCount: 0, dueCount: 0 };
      var now = Date.now();
      chapter.sentences.forEach(function (sentence) {
        var cardId = "lunyu:default:" + sentence.id;
        var cardState = srsData.cardStates[cardId];
        if (!cardState) {
          stats.newCount++;
        } else if (cardState.state === "learning") {
          stats.learningCount++;
          if (cardState.due <= now) stats.dueCount++;
        } else if (cardState.state === "review") {
          stats.reviewCount++;
          if (cardState.due <= now) stats.dueCount++;
        } else if (cardState.state === "relearning") {
          stats.relearningCount++;
          if (cardState.due <= now) stats.dueCount++;
        }
      });
      return stats;
    }

    function recordRating(word, rating) {
      const store = currentBookStore();
      if (!store || !word) return;
      const item = store.ratings[word.__id] || { again: 0, hard: 0, good: 0, easy: 0, reviewCount: 0 };
      item[rating] = (item[rating] || 0) + 1;
      item.reviewCount += 1;
      item.lastRating = rating;
      item.lastAt = new Date().toISOString();
      store.ratings[word.__id] = item;
      saveUserData();
    }

    function getAnkiReviewWords() {
      const store = currentBookStore();
      if (!store || !store.ratings) return [];
      const book = currentBook();
      if (!book) return [];
      return book.units
        .flatMap((unit) => unit.words)
        .filter((word) => {
          const r = store.ratings[word.__id];
          return r && r.lastRating === "hard";
        });
    }

    function updateFavoriteButton() {
      const button = $("favoriteToggleBtn");
      const current = state.queue[state.index];
      if (!button || !current) return;
      const active = isFavorite(current);
      button.classList.toggle("active", active);
      button.textContent = active ? "★" : "☆";
      button.setAttribute("aria-label", active ? "取消收藏当前单词" : "收藏当前单词");
      button.title = active ? "取消收藏当前单词" : "收藏当前单词";
    }

    function currentLanguage() {
      return languages.find((language) => language.id === state.languageId);
    }

    function currentBook() {
      return currentLanguage() && currentLanguage().book;
    }

    function selectedUnit() {
      const book = currentBook();
      return book && book.units.find((unit) => unit.id === state.unitId);
    }

    function setVisible(view) {
      $("languageSetup").hidden = view !== "languages";
      $("unitSetup").hidden = view !== "units";
      $("wordViewer").hidden = view !== "viewer";
      $("wordCollection").hidden = view !== "collection";
      $("trainer").hidden = view !== "trainer";
      $("result").hidden = view !== "result";
      $("ankiTrainer").hidden = view !== "ankiTrainer";
      $("ankiResult").hidden = view !== "ankiResult";
      $("srsReview").hidden = view !== "srsReview";
      $("srsResult").hidden = view !== "srsResult";
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    }

    function buildProjectItems() {
      const officialProjects = languages
        .filter((language) => language.id !== "custom")
        .map((language) => {
          const totalWords = language.book ? language.book.units.reduce((sum, unit) => sum + unit.words.length, 0) : 0;
          const unitLabel = language.book?.language === "俄语" ? "课" : "Unit";
          return {
            projectId: `official:${language.id}`,
            type: "official",
            languageId: language.id,
            name: language.name,
            icon: language.icon,
            tone: language.tone,
            toneSoft: language.toneSoft,
            tags: language.tags || ["官方"],
            desc: language.desc,
            chip: language.book ? `${language.book.units.length} ${unitLabel} · ${totalWords} 词` : "官方牌组",
            go: language.book || language.href ? "进入 →" : "未开放",
          };
        });

      const customProjects = customBook.units.map((unit) => ({
        projectId: customProjectId(unit.ownerId, unit.bookId),
        type: "custom",
        languageId: "custom",
        unitId: unit.id,
        name: unit.name,
        icon: "创",
        tone: "#3d6b5e",
        toneSoft: "#e0ebe6",
        tags: ["自建", unit.tag || "自建"],
        desc: `${unit.visibility === "public" ? "公开" : "私密"} · ${unit.ownerName || "用户"} · ${unit.words.length} 个词条。`,
        chip: `${projectTagLabel(unit.tag)} · ${unit.words.length} 词`,
        go: "开始 →",
      }));

      return officialProjects.concat(customProjects);
    }

    function filteredProjects() {
      const activeTag = PROJECT_TAGS.find((tag) => tag.id === state.projectTag) || PROJECT_TAGS[0];
      return buildProjectItems().filter((project) => {
        if (activeTag.id === "all") return true;
        if (activeTag.id === "favorite") return isProjectFavorite(project);
        return project.tags.includes(activeTag.value);
      });
    }

    function renderProjectStats(projects) {
      if (!$("projectStats")) return;
      const customCount = customBook.units.length;
      const totalWords = projects.reduce((sum, project) => {
        if (project.type === "custom") {
          const unit = customBook.units.find((item) => item.id === project.unitId);
          return sum + (unit?.words.length || 0);
        }
        const language = languages.find((item) => item.id === project.languageId);
        return sum + (language?.book?.units?.reduce((unitSum, unit) => unitSum + unit.words.length, 0) || 0);
      }, 0);
      // SRS 复习统计（clearExpiredBuries 和 migrateAll 在初始化时已执行，不再每次渲染重复调用）
      const accountId = account.type === "user" ? account.id : "guest";
      const SRS = window.SRSEngine;
      const srsSummary = SRS ? buildSRSQueueSummary() : { totalCount: 0, dueCount: 0, newCount: 0 };
      const dueCount = srsSummary.dueCount;
      const todayStats = SRS ? SRS.getTodayStats(accountId) : { reviews: 0, newCards: 0 };
      const dueLabel = srsSummary.dueCount > 0
        ? `${srsSummary.dueCount} 张到期`
        : srsSummary.newCount > 0
          ? "选择单元学习新卡"
          : "暂无任务";
      $("projectStats").innerHTML = `
        <div class="stat srs-stat-entry" id="srsStatEntry">
          <button class="srs-stat-btn" id="srsStatBtn" type="button" ${dueCount === 0 ? "disabled" : ""}>
            <div class="n">${dueCount}</div><div class="l">${dueLabel}</div>
          </button>
        </div>
        <div class="stat stat-reviewed"><div class="n">${todayStats.reviews}</div><div class="l">已复习</div></div>
          <div class="stat stat-streak"><div class="n">${customCount}</div><div class="l">自建牌组</div></div>
        <div class="stat stat-retention"><div class="n">${totalWords}</div><div class="l">当前词条</div></div>
      `;
      const srsBtn = $("srsStatBtn");
      if (srsBtn) {
        srsBtn.addEventListener("click", () => startSRSReview());
      }
    }

    function openProject(project) {
      state.languageId = project.languageId;
      state.unitId = project.unitId || null;
      if (currentLanguage()?.requiresLogin && account.type !== "user") {
        openAuthDialog("login");
        return;
      }
      if (currentLanguage()?.href) {
        location.href = currentLanguage().href;
        return;
      }
      if (project.type === "custom") {
        const unit = selectedUnit();
        if (unit?.words?.length) startSRSReviewForUnit(unit);
        return;
      }
      if (currentBook()) {
        renderUnits();
        setVisible("units");
      } else {
        renderUnavailable();
        setVisible("units");
      }
    }

    function renderProjectTags() {
      const row = $("projectTagFilters");
      if (!row) return;
      row.innerHTML = PROJECT_TAGS.map(
        (tag) => `<button class="tag-pick ${tag.id === state.projectTag ? "active" : ""}" data-project-tag="${tag.id}" type="button">${tag.label}</button>`,
      ).join("");
      row.querySelectorAll("[data-project-tag]").forEach((button) => {
        button.addEventListener("click", () => {
          state.projectTag = button.dataset.projectTag;
          renderLanguages();
        });
      });
    }

    function renderLanguages() {
      refreshCustomLanguage();
      renderProjectTags();
      const projects = filteredProjects();
      renderProjectStats(projects);
      $("languageList").innerHTML = projects.length
        ? projects
            .map((project, index) => {
              const active = isProjectFavorite(project);
              return `
                <article class="card mod-card language-card project-card" data-project="${index}" style="--tone:${project.tone};--tone-soft:${project.toneSoft}" role="button" tabindex="0">
                  <button class="icon-button project-favorite ${active ? "active" : ""}" data-favorite-project="${index}" type="button" aria-label="${active ? "取消收藏牌组" : "收藏牌组"}" title="${active ? "取消收藏牌组" : "收藏牌组"}">${active ? "★" : "☆"}</button>
                  <div class="icon">${project.icon}</div>
                  <h3>${escapeHTML(project.name)}</h3>
                  <p>${escapeHTML(project.desc)}</p>
                  <div class="foot">
                    <span class="chip tone">${escapeHTML(project.chip)}</span>
                    <span class="go">${project.go}</span>
                  </div>
                </article>
              `;
            })
            .join("")
        : `
          <div class="card empty">
            <div class="big">☆</div>
                    <p>${state.projectTag === "favorite" ? "还没有收藏牌组。" : "当前标签下还没有牌组。"}</p>
          </div>
        `;

      $("languageList").querySelectorAll("[data-project]").forEach((card) => {
        const project = projects[Number(card.dataset.project)];
        card.addEventListener("click", () => openProject(project));
        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openProject(project);
          }
        });
      });

      $("languageList").querySelectorAll("[data-favorite-project]").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const project = projects[Number(button.dataset.favoriteProject)];
          if (project) toggleProjectFavorite(project);
        });
      });
    }

    function renderUnavailable() {
      const language = currentLanguage();
      $("languageCrumb").textContent = language.name;
      $("languageTitle").textContent = language.name;
      $("languageIntro").textContent = `${language.name}词书尚未导入，之后导入后会在这里选择单元并开始默写。`;
      $("bookStats").innerHTML = `
        <div class="stat"><div class="n">0</div><div class="l">单元</div></div>
        <div class="stat"><div class="n">0</div><div class="l">词条</div></div>
        <div class="stat"><div class="n">待导入</div><div class="l">状态</div></div>
      `;
      $("unitList").innerHTML = `
        <div class="card empty">
          <div class="big">待导入</div>
          <p>${language.name}词书导入后，可在此选择单元。</p>
        </div>
      `;
      $("libraryTools").hidden = true;
      $("trainerOptions").hidden = true;
      $("setupHint").textContent = "当前语言暂无可默写单元。";
    }

    function directionConfig(language) {
      if (!language) return { supports: [], ankiDefault: "dictation", dictationLabel: "看中文 → 写英文", ankiLabel: "看外文 → 记中文" };
      const book = language.book;
      const isViewer = book?.mode === "viewer";
      const isAnkiOnly = book?.mode === "anki";
      const lang = book?.language || language.name;
      const dictationLabel = lang === "英语" ? "看中文 → 写英文" : lang === "俄语" ? "看中文 → 写俄语" : "看提示 → 写答案";
      const ankiLabel = lang === "英语" ? "看英文 → 记中文" : lang === "俄语" ? "看中文 → 记俄语" : "看正面 → 记背面";
      if (isViewer) return { supports: [], ankiDefault: "anki", dictationLabel, ankiLabel };
      if (isAnkiOnly) return { supports: ["anki"], ankiDefault: "anki", dictationLabel, ankiLabel };
      return { supports: ["dictation", "anki"], ankiDefault: "anki", dictationLabel, ankiLabel };
    }

    function syncDirectionUI(language) {
      const config = directionConfig(language);
      const tags = $("directionTags");
      if (!tags) return;
      const dictationBtn = tags.querySelector('[data-direction="dictation"]');
      const ankiBtn = tags.querySelector('[data-direction="anki"]');
      if (dictationBtn) {
        dictationBtn.hidden = !config.supports.includes("dictation");
        dictationBtn.textContent = config.dictationLabel;
      }
      if (ankiBtn) {
        ankiBtn.hidden = !config.supports.includes("anki");
        ankiBtn.textContent = config.ankiLabel;
      }
      if (!config.supports.includes(state.direction)) {
        state.direction = config.ankiDefault;
      }
      tags.querySelectorAll("[data-direction]").forEach((button) => {
        button.classList.toggle("active", button.dataset.direction === state.direction);
      });
    }

    function renderUnits() {
      const language = currentLanguage();
      const book = currentBook();
      const totalWords = book.units.reduce((sum, unit) => sum + unit.words.length, 0);
      const isViewer = book.mode === "viewer";
      const isCustom = language.id === "custom";
      const config = directionConfig(language);
      syncDirectionUI(language);
      const isAnki = state.direction === "anki" && book.mode !== "viewer";
      const unitBadge = (unit) => {
        if (isCustom) return "项";
        if (book.language === "俄语") return `L${unit.name.match(/\d+/)?.[0] || ""}`;
        return unit.name.replace("Unit ", "U");
      };

      // SRS 驱动的统计 —— 只加载一次 SRS 数据，复用给所有 unit
      var accountId = account.type === "user" ? account.id : "guest";
      var SRS = window.SRSEngine;
      var totalNew = 0, totalLearning = 0, totalReview = 0, totalDue = 0, totalRelearning = 0;
      var preloadedSRSData = SRS ? SRS.loadSRSData(accountId) : null;
      if (SRS) {
        book.units.forEach(function (unit) {
          var srsP = getSRSProgressForUnit(srsSourceForLanguage(language), book.id, unit, preloadedSRSData);
          totalNew += srsP.newCount;
          totalLearning += srsP.learningCount;
          totalReview += srsP.reviewCount;
          totalDue += srsP.dueCount;
          totalRelearning += srsP.relearningCount;
        });
      }

      $("languageCrumb").textContent = language.name;
      $("languageTitle").textContent = book.name;
      $("languageIntro").textContent = isCustom
        ? "选择一个自建牌组开始 SRS 复习，或前往创建模块上架新的背诵内容。"
        : isViewer
          ? "选择具体课程查看词表；今日复习入口会统一安排到期卡片。"
          : `选择 ${book.language === "俄语" ? "课程" : "Unit"} 开始 SRS 复习。系统会自动安排新卡和到期卡片。`;

      // 统计栏：SRS 驱动
      $("bookStats").innerHTML = `
        <div class="stat"><div class="n">${totalDue}</div><div class="l">待复习</div></div>
        <div class="stat"><div class="n">${totalNew}</div><div class="l">新卡</div></div>
        <div class="stat"><div class="n">${totalLearning + totalReview + totalRelearning}</div><div class="l">学习中</div></div>
        <div class="stat"><div class="n">${totalWords}</div><div class="l">总词条</div></div>
      `;
      $("libraryTools").hidden = isViewer;
      updateLibraryTools();
      $("trainerOptions").hidden = true;
      $("setupHint").textContent = isCustom
        ? "点击一个牌组即可开始 SRS 复习。"
        : isViewer
          ? "点击一个课程即可查看当前课程的词表。"
          : `点击一个 ${book.language === "俄语" ? "课程" : "Unit"} 即可开始 SRS 复习。`;
      $("unitList").innerHTML = book.units.length
        ? book.units
        .map((unit) => {
          // SRS 进度展示（复用 preloadedSRSData）
          var srsP = getSRSProgressForUnit(srsSourceForLanguage(language), book.id, unit, preloadedSRSData);
          var progressText;
          if (isViewer) {
            progressText = "查看本课俄语词表";
          } else if (srsP.dueCount > 0) {
            progressText = `${srsP.dueCount} 待复习 · ${srsP.newCount} 新`;
          } else if (srsP.newCount === unit.words.length) {
            progressText = "尚未学习";
          } else if (srsP.newCount > 0) {
            progressText = `${srsP.newCount} 新 · ${srsP.learningCount + srsP.reviewCount + srsP.relearningCount} 已学`;
          } else {
            progressText = `${srsP.learningCount + srsP.relearningCount} 学习中 · ${srsP.reviewCount} 已巩固`;
          }
          const customMeta = isCustom
            ? `${unit.visibility === "public" ? "公开" : "私密"} · ${escapeHTML(unit.ownerName || "用户")} · ${projectTagLabel(unit.tag)}`
            : "";
          return `
            <button class="card mod-card unit-card" data-unit="${unit.id}" style="--tone:${language.tone};--tone-soft:${language.toneSoft}" type="button">
              <div class="icon">${unitBadge(unit)}</div>
              <h3>${escapeHTML(unit.name)}</h3>
              <p>${customMeta ? `${customMeta} · ` : ""}${unit.words.length} 个词条。${progressText}</p>
              <div class="foot">
                <span class="chip tone">${unit.words.length} 词</span>
                <span class="go">${isViewer ? "查看 →" : srsP.dueCount > 0 ? "复习 →" : "学习 →"}</span>
              </div>
            </button>
          `;
        })
        .join("")
        : `
          <div class="card empty">
            <div class="big">创</div>
                    <p>${isCustom ? '还没有可见的自建牌组，请登录创建，或等待有人公开牌组。' : "当前没有可用单元。"}</p>
          </div>
        `;

      $("unitList").querySelectorAll("[data-unit]").forEach((button) => {
        button.addEventListener("click", () => {
          state.unitId = button.dataset.unit;
          const unit = selectedUnit();
          if (isViewer) renderWordViewer(unit);
          else startSRSReviewForUnit(unit);
        });
      });
    }

    function renderWordViewer(unit) {
      const book = currentBook();
      $("backToUnitsFromViewerBtn").textContent = book.name;
      $("viewerCrumb").textContent = unit.name;
      $("viewerTitle").textContent = `${book.name} · ${unit.name}`;
      $("viewerIntro").textContent = `${unit.words.length} 个词条。可先浏览词表，再回到单元列表进入 SRS 复习。`;
      $("viewerWordList").innerHTML = unit.words
        .map(
          (word) => `
            <tr>
              <td class="word-foreign">${word.word}</td>
              <td>${word.definition}</td>
            </tr>
          `,
        )
        .join("");
      setVisible("viewer");
    }

    $("orderTags").querySelectorAll("[data-order]").forEach((button) => {
      button.addEventListener("click", () => {
        state.order = button.dataset.order;
      });
    });

    $("directionTags").querySelectorAll("[data-direction]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = button.dataset.direction;
        if (state.direction === next) return;
        state.direction = next;
        $("directionTags").querySelectorAll("[data-direction]").forEach((item) => item.classList.toggle("active", item.dataset.direction === next));
        renderUnits();
      });
    });

    function showLanguages() {
      state.languageId = null;
      state.unitId = null;
      renderLanguages();
      setVisible("languages");
    }

    function showUnits() {
      if (currentBook()) renderUnits();
      else renderUnavailable();
      state.collectionType = null;
      setVisible("units");
    }

    function renderCollection(type) {
      state.collectionType = type;
      const isFavorites = type === "favorites";
      const words = isFavorites ? getFavoriteWords() : getWrongWords();
      const title = isFavorites ? "收藏单词" : "错题集";
      $("collectionCrumb").textContent = title;
      $("collectionTitle").textContent = title;
      $("collectionIntro").textContent = isFavorites
        ? `${words.length} 个收藏词，可直接抽出来默写。`
        : `${words.length} 个错题词，答对后会自动移出错题集。`;
      $("practiceCollectionBtn").disabled = words.length === 0;
      $("collectionList").innerHTML = words.length
        ? words
            .map(
              (word) => `
                <article class="word-item">
                  <div>
                    <div class="word-line">
                      <strong>${word.word}</strong>
                      <span>${word.__unitName}</span>
                      ${word.pos ? `<span>${word.pos}</span>` : ""}
                    </div>
                    <p>${word.hint}</p>
                  </div>
                  <div class="word-actions">
                    <button class="btn sm ghost" data-practice-word="${word.__id}" type="button">默写</button>
                    ${
                      isFavorites
                        ? `<button class="btn sm ghost" data-toggle-favorite="${word.__id}" type="button">取消收藏</button>`
                        : `<button class="btn sm ghost" data-remove-wrong="${word.__id}" type="button">移出错题</button>`
                    }
                  </div>
                </article>
              `,
            )
            .join("")
        : `
          <div class="card empty collection-empty">
            <div class="big">${isFavorites ? "☆" : "!"}</div>
            <p>${isFavorites ? "还没有收藏单词。" : "错题集现在是空的。"}</p>
          </div>
        `;

      $("collectionList").querySelectorAll("[data-practice-word]").forEach((button) => {
        button.addEventListener("click", () => {
          const word = wordIndex.get(button.dataset.practiceWord);
          if (word) start([word], { label: `${title} · ${word.word}` });
        });
      });

      $("collectionList").querySelectorAll("[data-toggle-favorite]").forEach((button) => {
        button.addEventListener("click", () => {
          const word = wordIndex.get(button.dataset.toggleFavorite);
          if (word) toggleFavorite(word);
        });
      });

      $("collectionList").querySelectorAll("[data-remove-wrong]").forEach((button) => {
        button.addEventListener("click", () => {
          const word = wordIndex.get(button.dataset.removeWrong);
          if (word) removeWrong(word);
        });
      });
    }

    function showCollection(type) {
      renderCollection(type);
      setVisible("collection");
    }

    function start(words, options = {}) {
      const book = currentBook();
      const unit = selectedUnit();
      state.queue = state.order === "shuffle" ? shuffle(words) : words.slice();
      state.index = 0;
      state.correct = 0;
      state.answered = false;
      state.wrongItems = [];
      state.skipped = 0;
      state.practiceWords = words.slice();
      state.practiceLabel = options.label || `${book.name} · ${unit.name}`;

      if (!state.queue.length) return;

      $("unitName").textContent = state.practiceLabel;
      setVisible("trainer");
      showCard();
    }

    function showCard() {
      const current = state.queue[state.index];
      state.answered = false;
      $("feedback").innerHTML = "";
      $("promptText").textContent = current.hint;
      $("promptMeta").textContent = current.pos ? `词性：${current.pos}` : "输入对应英文";
      $("reveal").hidden = true;
      $("answerText").textContent = "";
      $("answerExtra").textContent = "";
      $("answerInput").value = "";
      $("answerInput").disabled = false;
      $("submitBtn").textContent = "提交";
      $("submitBtn").hidden = false;
      $("revealBtn").hidden = false;
      $("skipBtn").hidden = false;
      $("counter").textContent = `${state.index + 1} / ${state.queue.length}`;
      $("pbar").style.width = `${(state.index / state.queue.length) * 100}%`;
      updateFavoriteButton();
      $("answerInput").focus();
    }

    function reveal(isCorrect) {
      const current = state.queue[state.index];
      state.answered = true;
      recordAttempt(current, isCorrect ? "correct" : "wrong");
      $("answerText").textContent = current.word;
      $("answerExtra").textContent = current.definition;
      $("reveal").hidden = false;
      $("answerInput").disabled = true;
      $("revealBtn").hidden = true;
      $("skipBtn").hidden = true;

      if (isCorrect) {
        state.correct += 1;
        $("feedback").innerHTML = '<div class="feedback ok">正确！</div>';
      } else {
        state.wrongItems.push(current);
        $("feedback").innerHTML = '<div class="feedback err">再看看正确答案。</div>';
      }

      $("submitBtn").textContent = state.index === state.queue.length - 1 ? "完成" : "下一个 →";
      $("submitBtn").focus();
    }

    function finish() {
      const rate = Math.round((state.correct / state.queue.length) * 100);
      $("scoreBig").textContent = `${state.correct} / ${state.queue.length}`;
      $("scoreText").textContent = `正确率 ${rate}% · ${
        state.wrongItems.length
          ? `${state.wrongItems.length} 个词需要巩固${state.skipped ? `，其中跳过 ${state.skipped} 个` : ""}`
          : "全部答对"
      }`;
      $("wrongOnlyBtn").hidden = state.wrongItems.length === 0;
      updateLibraryTools();
      setVisible("result");
    }

    function next() {
      state.index += 1;
      if (state.index >= state.queue.length) finish();
      else showCard();
    }

    function skipCurrent() {
      if (state.answered) return;
      const current = state.queue[state.index];
      state.wrongItems.push(current);
      state.skipped += 1;
      recordAttempt(current, "skipped");
      next();
    }

    $("answerForm").addEventListener("submit", (event) => {
      event.preventDefault();
      if (state.answered) {
        next();
        return;
      }
      const value = $("answerInput").value;
      if (!value.trim()) return;
      reveal(answerMatches(value, state.queue[state.index].word));
    });

    $("revealBtn").addEventListener("click", () => reveal(false));
    $("skipBtn").addEventListener("click", skipCurrent);
    $("favoriteToggleBtn").addEventListener("click", () => toggleFavorite(state.queue[state.index]));
    $("againBtn").addEventListener("click", () => start(state.practiceWords, { label: state.practiceLabel }));
    $("wrongOnlyBtn").addEventListener("click", () => start(state.wrongItems, { label: "本轮错词巩固" }));
    $("changeUnitBtn").addEventListener("click", showUnits);
    $("changeLanguageBtn").addEventListener("click", showLanguages);
    $("quitBtn").addEventListener("click", showUnits);
    $("backToLanguagesBtn").addEventListener("click", showLanguages);
    $("backToUnitsFromViewerBtn").addEventListener("click", showUnits);
    $("backToUnitsFromCollectionBtn").addEventListener("click", showUnits);
    $("openFavoritesBtn").addEventListener("click", () => showCollection("favorites"));
    $("openWrongsBtn").addEventListener("click", () => showCollection("wrongs"));
    $("practiceCollectionBtn").addEventListener("click", () => {
      const words = state.collectionType === "favorites" ? getFavoriteWords() : getWrongWords();
      const label = state.collectionType === "favorites" ? "收藏单词默写" : "错题集巩固";
      const cb = currentBook();
      if (cb && cb.mode === "anki") startAnki(words, { label });
      else start(words, { label });
    });

    /* ===== Anki 卡牌训练 ===== */
    function startAnki(words, options = {}) {
      const book = currentBook();
      const unit = selectedUnit();
      const language = currentLanguage();
      state.ankiQueue = state.order === "shuffle" ? shuffle(words) : words.slice();
      state.ankiIndex = 0;
      state.ankiFlipped = false;
      state.ankiRatings = { again: 0, hard: 0, good: 0, easy: 0 };
      state.ankiRequeued = 0;
      state.ankiPracticeWords = words.slice();
      state.ankiLabel = options.label || `${book.name} · ${unit.name}`;

      if (!state.ankiQueue.length) return;

      const tone = language ? language.tone : "#7a4f9f";
      const toneSoft = language ? language.toneSoft : "#eee7f5";
      const chip = $("ankiUnitName");
      chip.textContent = state.ankiLabel;
      chip.style.setProperty("--tone", tone);
      chip.style.setProperty("--tone-soft", toneSoft);
      const pbar = $("ankiPbar").parentElement;
      pbar.style.setProperty("--tone", tone);
      setVisible("ankiTrainer");
      showAnkiCard();
    }

    function showAnkiCard() {
      const current = state.ankiQueue[state.ankiIndex];
      state.ankiFlipped = false;
      const language = currentLanguage();
      const book = currentBook();
      const isCustom = language?.id === "custom";
      // 俄语 (book.mode === "anki") 走「中文释义 → 俄语单词」的传统方向；
      // 其它语言切到 Anki 方向时，统一走「单词 → 纯中文 hint」的方向
      const isLangAnki = !isCustom && book?.mode === "anki";
      const langName = language?.book?.language || language?.name || "";
      const frontText = isCustom
        ? (current.hint || current.definition)
        : isLangAnki
          ? current.definition
          : current.word;
      const backText = isCustom
        ? current.word
        : isLangAnki
          ? current.word
          : (current.hint || current.definition || "");
      $("ankiFrontText").textContent = frontText;
      $("ankiBackText").textContent = backText;
      // Anki 卡牌（看单词→记中文）方向时，如果 definition 比 hint 多信息（英文释义），背面以"中文 hint + 英文释义"分段展示
      const ankiBackExtra = $("ankiBackExtra");
      if (ankiBackExtra) {
        const showExtra = !isCustom && !isLangAnki && current.definition && current.definition !== backText;
        if (showExtra) {
          ankiBackExtra.textContent = current.definition;
          ankiBackExtra.hidden = false;
        } else {
          ankiBackExtra.textContent = "";
          ankiBackExtra.hidden = true;
        }
      }
      $("ankiFrontLabel").textContent = isCustom ? "正面" : (isLangAnki ? "中文释义" : `${langName}单词`);
      $("ankiBackLabel").textContent = isCustom ? "背面" : (isLangAnki ? `${langName}单词` : "中文释义");
      if ($("ankiFrontHint")) {
        $("ankiFrontHint").textContent = isCustom
          ? "在脑中回忆背面内容，然后点击查看"
          : isLangAnki
            ? `在脑中回忆${langName}单词，然后点击查看`
            : "在脑中回忆中文含义，然后点击查看";
      }
      // 导航切换卡片时禁用过渡动画，防止看到新卡片的背面（答案面）一闪而过
      const card = $("ankiCard");
      card.style.transition = "none";
      card.classList.remove("flipped");
      // 强制回流使 transition:none 立即生效
      void card.offsetHeight;
      card.style.transition = "";
      $("ankiPreFlip").hidden = false;
      $("ankiRatings").hidden = true;
      $("ankiCounter").textContent = `${state.ankiIndex + 1} / ${state.ankiQueue.length}`;
      $("ankiPbar").style.width = `${(state.ankiIndex / state.ankiQueue.length) * 100}%`;
      updateAnkiFavoriteButton();
      updateAnkiNav();
    }

    function updateAnkiNav() {
      const prev = $("ankiPrevBtn");
      const next = $("ankiNextBtn");
      const hint = $("ankiNavHint");
      if (!prev || !next) return;
      const atFirst = state.ankiIndex <= 0;
      const atLast = state.ankiIndex >= state.ankiQueue.length - 1;
      prev.disabled = atFirst;
      next.disabled = atLast;
      if (hint) {
        hint.textContent = `${state.ankiIndex + 1} / ${state.ankiQueue.length}`;
      }
    }

    function gotoAnki(delta) {
      const target = state.ankiIndex + delta;
      if (target < 0 || target >= state.ankiQueue.length) return;
      state.ankiIndex = target;
      // 重置翻面状态、评分累计不变（浏览不影响分数）
      showAnkiCard();
    }

    function flipAnkiCard() {
      if (state.ankiFlipped) return;
      state.ankiFlipped = true;
      $("ankiCard").classList.add("flipped");
      $("ankiPreFlip").hidden = true;
      $("ankiRatings").hidden = false;
      updateAnkiNav();
    }

    function rateAnkiCard(rating) {
      const current = state.ankiQueue[state.ankiIndex];
      if (rating === "again") {
        state.ankiRatings.again += 1;
        showAnkiCard();
        return;
      }
      recordRating(current, rating);
      state.ankiRatings[rating] += 1;

      state.ankiIndex += 1;
      if (state.ankiIndex >= state.ankiQueue.length) finishAnki();
      else showAnkiCard();
    }

    function skipAnkiCard() {
      const current = state.ankiQueue[state.ankiIndex];
      if (current) recordRating(current, "hard");
      state.ankiRatings.hard += 1;
      state.ankiIndex += 1;
      if (state.ankiIndex >= state.ankiQueue.length) finishAnki();
      else showAnkiCard();
    }

    function finishAnki() {
      const total = state.ankiPracticeWords.length;
      const r = state.ankiRatings;
      const rated = r.hard + r.good + r.easy;
      $("ankiScoreBig").textContent = `${rated} 次难度评分`;
      const parts = [];
      if (r.good + r.easy > 0) parts.push(`${r.good + r.easy} 次掌握`);
      if (r.hard > 0) parts.push(`${r.hard} 次困难`);
      if (r.again > 0) parts.push(`${r.again} 次再看`);
      $("ankiScoreText").textContent = `共 ${total} 个词条 · ${parts.join(" · ") || "已完成"}`;
      $("ankiRatingSummary").innerHTML = `
        <span class="rate-pill again">再看 ${r.again}</span>
        <span class="rate-pill hard">困难 ${r.hard}</span>
        <span class="rate-pill good">良好 ${r.good}</span>
        <span class="rate-pill easy">简单 ${r.easy}</span>
      `;
      $("ankiReviewBtn").hidden = r.hard === 0;
      updateLibraryTools();
      setVisible("ankiResult");
    }

    function updateAnkiFavoriteButton() {
      const button = $("ankiFavoriteBtn");
      const current = state.ankiQueue[state.ankiIndex];
      if (!button || !current) return;
      const active = isFavorite(current);
      button.classList.toggle("active", active);
      button.textContent = active ? "★" : "☆";
      button.setAttribute("aria-label", active ? "取消收藏当前单词" : "收藏当前单词");
      button.title = active ? "取消收藏当前单词" : "收藏当前单词";
    }

    $("ankiFlipBtn").addEventListener("click", flipAnkiCard);
    $("ankiCardStage").addEventListener("click", (event) => {
      if (event.target.closest(".prompt-actions")) return;
      if (!state.ankiFlipped) flipAnkiCard();
    });
    $("ankiSkipBtn").addEventListener("click", skipAnkiCard);
    $("ankiQuitBtn").addEventListener("click", showUnits);
    $("ankiPrevBtn").addEventListener("click", () => gotoAnki(-1));
    $("ankiNextBtn").addEventListener("click", () => gotoAnki(1));
    $("ankiFavoriteBtn").addEventListener("click", () => {
      toggleFavorite(state.ankiQueue[state.ankiIndex]);
      updateAnkiFavoriteButton();
    });
    $("ankiRatings").querySelectorAll("[data-rate]").forEach((button) => {
      button.addEventListener("click", () => rateAnkiCard(button.dataset.rate));
    });
    $("ankiAgainBtn").addEventListener("click", () => startAnki(state.ankiPracticeWords, { label: state.ankiLabel }));
    $("ankiReviewBtn").addEventListener("click", () => {
      const reviewWords = getAnkiReviewWords();
      startAnki(reviewWords.length ? reviewWords : state.ankiPracticeWords, { label: "需复习卡片" });
    });
    $("ankiChangeUnitBtn").addEventListener("click", showUnits);
    $("ankiChangeLanguageBtn").addEventListener("click", showLanguages);

    /* ===== SRS 间隔复习 ===== */

    function startSRSReviewForUnit(unit) {
      var accountId = account.type === "user" ? account.id : "guest";
      var SRS = window.SRSEngine;
      var book = currentBook() || customBook;
      var language = currentLanguage();
      if (!SRS || !unit) return;
      SRS.clearExpiredBuries(accountId);
      SRS.migrateAll(accountId);
      var source = srsSourceForLanguage(language);
      var deckId;
      if (source === "english") deckId = "english:college-english-iv";
      else if (source === "russian") deckId = "russian:russian-i";
      else if (source === "custom") deckId = "custom:" + unit.ownerId + "_" + unit.bookId;
      var allCardIds = [];
      if (source === "custom") {
        unit.words.forEach(function (word) { allCardIds.push("custom:" + unit.ownerId + "_" + unit.bookId + ":" + word.word); });
      } else {
        unit.words.forEach(function (word) { allCardIds.push(source + ":" + book.id + ":" + word.word); });
      }
      var allCardIdSet = new Set(allCardIds);
      var queue = [];
      SRS.getDueCards(accountId, deckId).forEach(function (cardState) {
        if (allCardIdSet.has(cardState.cardId)) queue.push(cardState.cardId);
      });
      SRS.getAvailableNewCards(accountId, deckId, allCardIds).forEach(function (cardId) {
        if (!queue.includes(cardId)) queue.push(cardId);
      });
      if (!queue.length) {
        alert("该单元已完成学习，当前也没有到期复习卡片。");
        return;
      }
      state.srsQueue = queue;
      state.srsIndex = 0;
      state.srsCompletedCount = 0;
      state.srsInitialTotal = queue.length;
      state.srsFlipped = false;
      state.srsRatings = { again: 0, hard: 0, good: 0, easy: 0 };
      state.srsUndoStack = [];
      state.srsStartTime = Date.now();
      state.srsCardStartTime = Date.now();
      setVisible("srsReview");
      showSRSCard();
    }

    function startSRSReview() {
      const accountId = account.type === "user" ? account.id : "guest";
      const SRS = window.SRSEngine;
      if (!SRS) return;

      SRS.clearExpiredBuries(accountId);
      SRS.migrateAll(accountId);

      const params = new URLSearchParams(location.search);
      const customQueueRaw = params.get("customSrs") === "1" ? sessionStorage.getItem("songji-srs-custom-queue") : "";
      let queue;
      if (customQueueRaw) {
        try {
          queue = JSON.parse(customQueueRaw).filter((id) => srsContentMap.has(id));
          sessionStorage.removeItem("songji-srs-custom-queue");
        } catch (error) {
          queue = [];
        }
      } else {
        const srsTag = params.get("srsTag") || "";
        queue = buildSRSQueueSummary({ tag: srsTag }).queue;
      }

      if (!queue.length) {
        // 无待复习卡片，显示提示
        renderLanguages();
        setVisible("languages");
        return;
      }

      state.srsQueue = queue;
      state.srsIndex = 0;
      state.srsCompletedCount = 0;
      state.srsInitialTotal = queue.length;
      state.srsFlipped = false;
      state.srsRatings = { again: 0, hard: 0, good: 0, easy: 0 };
      state.srsUndoStack = [];
      state.srsStartTime = Date.now();
      state.srsCardStartTime = Date.now();

      setVisible("srsReview");
      showSRSCard();
    }

    function clonePlain(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function currentSRSAccountId() {
      return account.type === "user" ? account.id : "guest";
    }

    function escapeHTML(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatSRSDate(value) {
      if (!value) return "未安排";
      return new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    function updateSRSUndoButton() {
      const btn = $("srsUndoBtn");
      if (!btn) return;
      btn.disabled = !state.srsUndoStack.length;
      btn.textContent = state.srsUndoStack.length ? "撤销上一步" : "撤销";
    }

    function pushSRSUndo(label) {
      const SRS = window.SRSEngine;
      if (!SRS) return;
      state.srsUndoStack.push({
        label,
        data: clonePlain(SRS.loadSRSData(currentSRSAccountId())),
        authStore: clonePlain(authStore),
        queue: state.srsQueue.slice(),
        index: state.srsIndex,
        completedCount: state.srsCompletedCount,
        initialTotal: state.srsInitialTotal,
        ratings: clonePlain(state.srsRatings),
        flipped: state.srsFlipped,
      });
      if (state.srsUndoStack.length > 20) state.srsUndoStack.shift();
      updateSRSUndoButton();
    }

    function undoLastSRSAction() {
      const SRS = window.SRSEngine;
      const entry = state.srsUndoStack.pop();
      if (!SRS || !entry) return;
      SRS.saveSRSData(currentSRSAccountId(), entry.data);
      authStore = entry.authStore;
      saveAuthStore();
      refreshCustomLanguage();
      buildSRSContentMap();
      state.srsQueue = entry.queue;
      state.srsIndex = Math.min(entry.index, Math.max(0, state.srsQueue.length - 1));
      state.srsCompletedCount = entry.completedCount;
      state.srsInitialTotal = entry.initialTotal || state.srsQueue.length;
      state.srsRatings = entry.ratings;
      state.srsFlipped = false;
      updateSRSUndoButton();
      closeSRSPanel();
      setVisible("srsReview");
      if (state.srsQueue.length) showSRSCard();
      else finishSRSReview();
    }

    function setSRSMoreOpen(open) {
      const panel = $("srsMorePanel");
      const btn = $("srsMoreBtn");
      if (!panel || !btn) return;
      panel.hidden = !open;
      btn.classList.toggle("active", open);
    }

    function toggleSRSMore() {
      setSRSMoreOpen($("srsMorePanel").hidden);
    }

    function openSRSPanel(title, html) {
      $("srsPanelTitle").textContent = title;
      $("srsPanelBody").innerHTML = html;
      $("srsPanelModal").hidden = false;
    }

    function closeSRSPanel() {
      const modal = $("srsPanelModal");
      if (modal) modal.hidden = true;
    }

    function showSRSCard() {
      const cardId = state.srsQueue[state.srsIndex];
      const content = srsContentMap.get(cardId);
      state.srsFlipped = false;
      state.srsCardStartTime = Date.now();

      if (!content) {
        // 内容未找到，跳过此卡
        state.srsIndex++;
        if (state.srsIndex >= state.srsQueue.length) finishSRSReview();
        else showSRSCard();
        return;
      }

      // 设置牌组颜色
      const chip = $("srsDeckName");
      chip.textContent = content.sourceName;
      chip.style.setProperty("--tone", content.tone);
      chip.style.setProperty("--tone-soft", content.toneSoft);
      const pbar = $("srsPbar").parentElement;
      pbar.style.setProperty("--tone", content.tone);

      // 禁用翻转动画，防止闪现背面
      const card = $("srsCard");
      card.style.transition = "none";
      card.classList.remove("flipped");
      void card.offsetHeight; // 强制回流
      card.style.transition = "";

      $("srsFrontLabel").textContent = content.frontLabel;
      $("srsFrontText").innerHTML = richHTML(content.front);
      $("srsFrontHint").textContent = content.frontHint;
      $("srsBackLabel").textContent = content.backLabel;
      $("srsBackText").innerHTML = richHTML(content.back);
      const extraEl = $("srsBackExtra");
      if (content.extra) {
        extraEl.innerHTML = richHTML(content.extra);
        extraEl.hidden = false;
      } else {
        extraEl.textContent = "";
        extraEl.hidden = true;
      }

      $("srsPreFlip").hidden = false;
      $("srsRatings").hidden = true;
      setSRSMoreOpen(false);
      closeSRSPanel();
      const totalInRound = state.srsInitialTotal || (state.srsCompletedCount + state.srsQueue.length);
      const currentOrdinal = Math.min(totalInRound, state.srsCompletedCount + state.srsIndex + 1);
      $("srsCounter").textContent = `${currentOrdinal} / ${totalInRound}`;
      $("srsPbar").style.width = `${totalInRound ? (state.srsCompletedCount / totalInRound) * 100 : 0}%`;

      // 收藏按钮
      updateSRSFavoriteButton(content);
      updateSRSNav();
      updateSRSUndoButton();
    }

    function updateSRSNav() {
      const prev = $("srsPrevBtn");
      const next = $("srsNextBtn");
      const hint = $("srsNavHint");
      if (!prev || !next) return;
      const atFirst = state.srsIndex <= 0;
      const atLast = state.srsIndex >= state.srsQueue.length - 1;
      prev.disabled = atFirst;
      next.disabled = atLast;
      if (hint) {
        hint.textContent = state.srsQueue.length > 1 ? "浏览未评分卡片" : "";
      }
    }

    function gotoSRS(delta) {
      const target = state.srsIndex + delta;
      if (target < 0 || target >= state.srsQueue.length) return;
      state.srsIndex = target;
      showSRSCard();
    }

    function flipSRSCard() {
      if (state.srsFlipped) return;
      state.srsFlipped = true;
      $("srsCard").classList.add("flipped");
      $("srsPreFlip").hidden = true;
      $("srsRatings").hidden = false;

      // 计算并显示各评分按钮的间隔预览
      const accountId = account.type === "user" ? account.id : "guest";
      const SRS = window.SRSEngine;
      const cardId = state.srsQueue[state.srsIndex];
      const cardState = SRS.getCardState(accountId, cardId);
      const config = SRS.resolveConfig(cardId, SRS.loadSRSData(accountId).config);
      const preview = SRS.previewIntervals(cardState, config);

      $("srsAgainInterval").textContent = "重复本卡";
      $("srsHardInterval").textContent = preview.hard.label;
      $("srsGoodInterval").textContent = preview.good.label;
      $("srsEasyInterval").textContent = preview.easy.label;
    }

    function rateSRSCard(grade) {
      const accountId = currentSRSAccountId();
      const SRS = window.SRSEngine;
      const cardId = state.srsQueue[state.srsIndex];
      pushSRSUndo(grade === "again" ? "再看" : "评分");

      // 记录复习用时
      const elapsed = Date.now() - state.srsCardStartTime;
      SRS.addReviewTime(accountId, elapsed);

      if (grade === "again") {
        SRS.repeatCard(accountId, cardId);
        state.srsRatings.again++;
        showSRSCard();
        return;
      }

      // 调用 SRS 引擎更新卡片状态
      SRS.reviewCard(accountId, cardId, grade);
      state.srsRatings[grade]++;

      // 已评分卡片移出未评分队列，避免上一张/下一张回到已调度卡片后重复评分。
      state.srsQueue.splice(state.srsIndex, 1);

      state.srsCompletedCount++;
      if (state.srsIndex >= state.srsQueue.length) state.srsIndex = Math.max(0, state.srsQueue.length - 1);
      if (!state.srsQueue.length) finishSRSReview();
      else showSRSCard();
    }

    function finishSRSReview() {
      const r = state.srsRatings;
      const total = r.hard + r.good + r.easy;
      const elapsed = Date.now() - state.srsStartTime;
      const minutes = Math.round(elapsed / 60000);

      $("srsScoreBig").textContent = `${total} 次难度评分`;
      const parts = [];
      if (r.good + r.easy > 0) parts.push(`${r.good + r.easy} 次掌握`);
      if (r.hard > 0) parts.push(`${r.hard} 次困难`);
      if (r.again > 0) parts.push(`${r.again} 次再看`);
      if (minutes > 0) parts.push(`用时 ${minutes} 分钟`);
      $("srsScoreText").textContent = parts.join(" · ") || "已完成";
      $("srsRatingSummary").innerHTML = `
        <span class="rate-pill again">再看 ${r.again}</span>
        <span class="rate-pill hard">困难 ${r.hard}</span>
        <span class="rate-pill good">良好 ${r.good}</span>
        <span class="rate-pill easy">简单 ${r.easy}</span>
      `;

      // 检查是否还有剩余待复习卡片
      const accountId = account.type === "user" ? account.id : "guest";
      const SRS = window.SRSEngine;
      const remaining = SRS ? buildSRSQueueSummary().totalCount : 0;
      $("srsContinueBtn").textContent = remaining > 0 ? `继续复习（${remaining} 张）` : "今日复习已完成";
      $("srsContinueBtn").disabled = remaining === 0;

      setVisible("srsResult");
    }

    function updateSRSFavoriteButton(content) {
      const btn = $("srsFavoriteBtn");
      if (!btn) return;
      // 收藏逻辑：对于英语/俄语词书使用现有收藏系统
      // 对于论语/自建暂不支持 SRS 收藏，按钮隐藏
      const cardId = state.srsQueue[state.srsIndex];
      const source = cardId.split(":")[0];
      if (source === "english" || source === "russian") {
        btn.hidden = false;
        const wordObj = wordIndex.get(cardId.replace("english:", "").replace("russian:", "").replace(":" + cardId.split(":").slice(2).join(":"), "::" + cardId.split(":")[2]));
        // 简化查找：通过 content 中的 word 信息
        const active = isFavoriteSRS(cardId);
        btn.classList.toggle("active", active);
        btn.innerHTML = active
          ? '<span class="srs-action-icon">★</span><span>已收藏</span>'
          : '<span class="srs-action-icon">☆</span><span>收藏</span>';
      } else {
        btn.hidden = true;
      }
    }

    function isFavoriteSRS(cardId) {
      // 映射 SRS cardId 到现有收藏系统
      const source = cardId.split(":")[0];
      if (source === "english") {
        // english:college-english-iv:word → 查找 college-english-iv::unitId::word
        const wordText = cardId.split(":")[2];
        for (const [id, word] of wordIndex) {
          if (word.word === wordText && id.startsWith("college-english-iv::")) {
            return isFavorite(word);
          }
        }
      } else if (source === "russian") {
        const wordText = cardId.split(":")[2];
        for (const [id, word] of wordIndex) {
          if (word.word === wordText && id.startsWith("russian-i::")) {
            return isFavorite(word);
          }
        }
      }
      return false;
    }

    function toggleFavoriteSRS(cardId) {
      const source = cardId.split(":")[0];
      if (source === "english") {
        const wordText = cardId.split(":")[2];
        for (const [id, word] of wordIndex) {
          if (word.word === wordText && id.startsWith("college-english-iv::")) {
            toggleFavorite(word);
            return;
          }
        }
      } else if (source === "russian") {
        const wordText = cardId.split(":")[2];
        for (const [id, word] of wordIndex) {
          if (word.word === wordText && id.startsWith("russian-i::")) {
            toggleFavorite(word);
            return;
          }
        }
      }
    }

    function advanceAfterManagingSRSCard() {
      state.srsQueue.splice(state.srsIndex, 1);
      state.srsCompletedCount++;
      if (state.srsIndex >= state.srsQueue.length) {
        if (state.srsQueue.length) state.srsIndex = state.srsQueue.length - 1;
        else finishSRSReview();
      }
      if (state.srsQueue.length) showSRSCard();
    }

    function currentSRSCardContext() {
      const cardId = state.srsQueue[state.srsIndex];
      return {
        cardId,
        content: srsContentMap.get(cardId),
        cardState: window.SRSEngine ? window.SRSEngine.getCardState(currentSRSAccountId(), cardId) : null,
      };
    }

    function showSRSInfoPanel() {
      const ctx = currentSRSCardContext();
      if (!ctx.cardId || !ctx.content || !ctx.cardState) return;
      const card = ctx.cardState;
      const flagNames = ["无", "红色", "橙色", "绿色", "蓝色"];
      openSRSPanel("卡片信息", `
        <dl class="srs-info-grid">
          <dt>卡片 ID</dt><dd>${escapeHTML(ctx.cardId)}</dd>
          <dt>来源</dt><dd>${escapeHTML(ctx.content.sourceName || "未命名牌组")}</dd>
          <dt>状态</dt><dd>${escapeHTML(card.state || "new")}</dd>
          <dt>到期时间</dt><dd>${escapeHTML(formatSRSDate(card.due))}</dd>
          <dt>间隔</dt><dd>${Number(card.interval || 0).toFixed(2)} 天</dd>
          <dt>易度</dt><dd>${Number(card.ease || 2.5).toFixed(2)}</dd>
          <dt>复习次数</dt><dd>${card.reps || 0}</dd>
          <dt>遗忘次数</dt><dd>${card.lapses || 0}</dd>
          <dt>学习步阶</dt><dd>${card.stepIdx || 0}</dd>
          <dt>标记</dt><dd>${flagNames[card.flags || 0] || "无"}</dd>
          <dt>标签</dt><dd>${escapeHTML((card.tags || []).join("，") || "无")}</dd>
          <dt>上次复习</dt><dd>${escapeHTML(formatSRSDate(card.lastReview))}</dd>
        </dl>
      `);
    }

    function parseCustomSRSId(cardId) {
      const parts = String(cardId || "").split(":");
      if (parts[0] !== "custom" || parts.length < 3) return null;
      const ownerBook = parts[1];
      const cut = ownerBook.lastIndexOf("_");
      if (cut < 0) return null;
      return {
        ownerId: ownerBook.slice(0, cut),
        bookId: ownerBook.slice(cut + 1),
        wordText: parts.slice(2).join(":"),
      };
    }

    function findCustomSRSWord(cardId) {
      const parsed = parseCustomSRSId(cardId);
      if (!parsed) return null;
      const user = authStore.users.find((item) => item.id === parsed.ownerId);
      const book = user && (user.customBooks || []).find((item) => item.id === parsed.bookId);
      const word = book && (book.words || []).find((item) => item.word === parsed.wordText);
      return word ? { parsed, user, book, word } : null;
    }

    function showSRSEditPanel() {
      const ctx = currentSRSCardContext();
      if (!ctx.cardId || !ctx.content) return;
      const custom = findCustomSRSWord(ctx.cardId);
      if (!custom) {
        openSRSPanel("编辑卡片", `
          <p class="muted">官方词书、论语内容来自内置资料，复习中保持只读。你仍然可以在这里设置到期日、重置进度、暂停、搁置或标记。</p>
          <dl class="srs-info-grid">
            <dt>正面</dt><dd>${escapeHTML(ctx.content.front)}</dd>
            <dt>背面</dt><dd>${escapeHTML(ctx.content.back)}</dd>
            <dt>补充</dt><dd>${escapeHTML(ctx.content.extra || "无")}</dd>
          </dl>
        `);
        return;
      }
      openSRSPanel("编辑自建卡", `
        <form class="srs-edit-form" id="srsEditForm">
          <label>正面<textarea id="srsEditFront" rows="3">${escapeHTML(custom.word.hint || "")}</textarea></label>
          <label>背面<textarea id="srsEditBack" rows="3">${escapeHTML(custom.word.word || "")}</textarea></label>
          <label>补充<textarea id="srsEditExtra" rows="4">${escapeHTML(custom.word.definition || "")}</textarea></label>
          <div class="srs-panel-actions">
            <button type="button" class="btn ghost" id="srsEditCancelBtn">取消</button>
            <button type="submit" class="btn primary">保存</button>
          </div>
        </form>
      `);
      $("srsEditCancelBtn").addEventListener("click", closeSRSPanel);
      $("srsEditForm").addEventListener("submit", function (event) {
        event.preventDefault();
        pushSRSUndo("编辑卡片");
        const oldCardId = ctx.cardId;
        const oldState = window.SRSEngine.getCardState(currentSRSAccountId(), oldCardId);
        custom.word.hint = $("srsEditFront").value.trim();
        custom.word.word = $("srsEditBack").value.trim() || custom.word.word;
        custom.word.definition = $("srsEditExtra").value.trim();
        saveAuthStore();
        const newCardId = `custom:${custom.parsed.ownerId}_${custom.parsed.bookId}:${custom.word.word}`;
        if (newCardId !== oldCardId) {
          state.srsQueue = state.srsQueue.map((id) => id === oldCardId ? newCardId : id);
          window.SRSEngine.setCardState(currentSRSAccountId(), newCardId, { ...oldState, cardId: newCardId });
          window.SRSEngine.deleteCardState(currentSRSAccountId(), oldCardId);
        }
        refreshCustomLanguage();
        buildSRSContentMap();
        closeSRSPanel();
        showSRSCard();
      });
    }

    function setCurrentCardDue(days) {
      const ctx = currentSRSCardContext();
      const SRS = window.SRSEngine;
      if (!ctx.cardId || !SRS) return;
      const due = new Date();
      due.setHours(9, 0, 0, 0);
      due.setDate(due.getDate() + days);
      pushSRSUndo("设置到期日");
      SRS.setDueDate(currentSRSAccountId(), ctx.cardId, due.getTime());
      closeSRSPanel();
      advanceAfterManagingSRSCard();
    }

    function showSRSDuePanel() {
      openSRSPanel("设置到期日", `
        <div class="srs-due-presets">
          <button type="button" class="btn ghost" data-srs-due-days="0">今天</button>
          <button type="button" class="btn ghost" data-srs-due-days="1">明天</button>
          <button type="button" class="btn ghost" data-srs-due-days="3">3 天后</button>
          <button type="button" class="btn ghost" data-srs-due-days="7">7 天后</button>
        </div>
        <form class="srs-edit-form" id="srsDueForm">
          <label>指定日期<input id="srsDueDateInput" type="date"></label>
          <div class="srs-panel-actions">
            <button type="button" class="btn ghost" id="srsDueCancelBtn">取消</button>
            <button type="submit" class="btn primary">设为该日</button>
          </div>
        </form>
      `);
      $("srsPanelBody").querySelectorAll("[data-srs-due-days]").forEach(function (button) {
        button.addEventListener("click", function () {
          setCurrentCardDue(Number(button.dataset.srsDueDays || 0));
        });
      });
      $("srsDueCancelBtn").addEventListener("click", closeSRSPanel);
      $("srsDueForm").addEventListener("submit", function (event) {
        event.preventDefault();
        const value = $("srsDueDateInput").value;
        if (!value) return;
        const target = new Date(`${value}T09:00:00`);
        const today = new Date();
        today.setHours(9, 0, 0, 0);
        const days = Math.max(0, Math.round((target.getTime() - today.getTime()) / 86400000));
        setCurrentCardDue(days);
      });
    }

    function showSRSShortcutPanel() {
      openSRSPanel("快捷键", `
        <dl class="shortcut-grid">
          <dt>空格</dt><dd>翻到背面</dd>
          <dt>1 / 2 / 3 / 4</dt><dd>再看 / 困难 / 良好 / 简单</dd>
          <dt>U</dt><dd>撤销上一步</dd>
          <dt>M</dt><dd>打开或收起更多菜单</dd>
          <dt>I / E / D</dt><dd>卡片信息 / 编辑 / 设置到期日</dd>
          <dt>B / S</dt><dd>搁置到明天 / 暂停卡片</dd>
          <dt>R / O / G / Y</dt><dd>红 / 橙 / 绿 / 蓝四色标记</dd>
          <dt>Esc</dt><dd>关闭弹窗</dd>
        </dl>
      `);
    }

    function resetCurrentSRSCard() {
      const ctx = currentSRSCardContext();
      const SRS = window.SRSEngine;
      if (!ctx.cardId || !SRS) return;
      pushSRSUndo("重置进度");
      SRS.resetCard(currentSRSAccountId(), ctx.cardId);
      advanceAfterManagingSRSCard();
    }

    function deleteCurrentSRSState() {
      const ctx = currentSRSCardContext();
      const SRS = window.SRSEngine;
      if (!ctx.cardId || !SRS) return;
      if (!confirm("删除这张卡的 SRS 调度记录？卡片内容不会被删除。")) return;
      pushSRSUndo("删除调度");
      SRS.deleteCardState(currentSRSAccountId(), ctx.cardId);
      advanceAfterManagingSRSCard();
    }

    function manageCurrentSRSCard(action, value) {
      const accountId = currentSRSAccountId();
      const SRS = window.SRSEngine;
      const cardId = state.srsQueue[state.srsIndex];
      if (!SRS || !cardId) return;
      pushSRSUndo(action);
      if (action === "bury") {
        SRS.buryCard(accountId, cardId);
        advanceAfterManagingSRSCard();
      } else if (action === "suspend") {
        SRS.suspendCard(accountId, cardId);
        advanceAfterManagingSRSCard();
      } else if (action === "flag") {
        SRS.setCardFlag(accountId, cardId, value);
      }
    }

    // SRS 复习事件绑定
    $("srsFlipBtn").addEventListener("click", flipSRSCard);
    $("srsCardStage").addEventListener("click", function (event) {
      if (event.target.closest(".srs-prompt-actions, button, a, input, textarea, select")) return;
      if (!state.srsFlipped) flipSRSCard();
    });
    $("srsQuitBtn").addEventListener("click", showLanguages);
    $("srsBackBtn").addEventListener("click", showLanguages);
    $("srsPrevBtn").addEventListener("click", function () { gotoSRS(-1); });
    $("srsNextBtn").addEventListener("click", function () { gotoSRS(1); });
    $("srsFavoriteBtn").addEventListener("click", function () {
      const cardId = state.srsQueue[state.srsIndex];
      toggleFavoriteSRS(cardId);
      const content = srsContentMap.get(cardId);
      updateSRSFavoriteButton(content);
    });
    $("srsUndoBtn").addEventListener("click", undoLastSRSAction);
    $("srsMoreBtn").addEventListener("click", toggleSRSMore);
    $("srsHelpBtn").addEventListener("click", showSRSShortcutPanel);
    $("srsInfoBtn").addEventListener("click", showSRSInfoPanel);
    $("srsEditBtn").addEventListener("click", showSRSEditPanel);
    $("srsDueBtn").addEventListener("click", showSRSDuePanel);
    $("srsResetBtn").addEventListener("click", resetCurrentSRSCard);
    $("srsDeleteBtn").addEventListener("click", deleteCurrentSRSState);
    $("srsPanelCloseBtn").addEventListener("click", closeSRSPanel);
    $("srsPanelModal").addEventListener("click", function (event) {
      if (event.target === $("srsPanelModal")) closeSRSPanel();
    });
    $("srsBuryBtn").addEventListener("click", function () { manageCurrentSRSCard("bury"); });
    $("srsSuspendBtn").addEventListener("click", function () { manageCurrentSRSCard("suspend"); });
    $("srsFlagRedBtn").addEventListener("click", function () { manageCurrentSRSCard("flag", 1); });
    $("srsFlagOrangeBtn").addEventListener("click", function () { manageCurrentSRSCard("flag", 2); });
    $("srsFlagGreenBtn").addEventListener("click", function () { manageCurrentSRSCard("flag", 3); });
    $("srsFlagBlueBtn").addEventListener("click", function () { manageCurrentSRSCard("flag", 4); });
    $("srsRatings").querySelectorAll("[data-srs-rate]").forEach(function (button) {
      button.addEventListener("click", function () {
        rateSRSCard(button.dataset.srsRate);
      });
    });
    $("srsContinueBtn").addEventListener("click", function () {
      startSRSReview(); // 刷新队列再开一轮
    });
    $("srsToPlazaBtn").addEventListener("click", function () {
      renderLanguages();
      setVisible("languages");
    });

    // 键盘快捷键（SRS 复习界面）
    document.addEventListener("keydown", function (event) {
      // 只在 SRS 复习视图激活时响应
      if ($("srsReview").hidden) return;
      const target = event.target;
      const editingText = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (event.key === "Escape" && !$("srsPanelModal").hidden) {
        closeSRSPanel();
        return;
      }
      if (editingText) return;
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        if (!state.srsFlipped) flipSRSCard();
      } else if (state.srsFlipped) {
        if (event.key === "1") rateSRSCard("again");
        else if (event.key === "2") rateSRSCard("hard");
        else if (event.key === "3") rateSRSCard("good");
        else if (event.key === "4") rateSRSCard("easy");
      }
    });

    renderLanguages();
    setVisible("languages");
    if (new URLSearchParams(location.search).get("startSrs") === "1") {
      startSRSReview();
      history.replaceState(null, "", location.pathname);
    }
  }

  function initCustomProjectPage() {
    const host = document.getElementById("customProjectPage");
    if (!host) return;

    const account = currentAccount();
    const $ = (id) => document.getElementById(id);
    let draftCards = [];
    let draftVisibleCount = 50;
    let draftCollapsed = false;
    const DRAFT_PAGE_SIZE = 50;
    let editingBookId = new URLSearchParams(location.search).get("edit") || null;

    // ---- 草稿持久化：防止用户离开页面丢失已添加的卡片 ----
    function draftStorageKey() {
      return `songji-create-draft-v1:${account.id}`;
    }

    function saveDraft() {
      const form = $("customCreateForm");
      const data = {
        editingBookId,
        bookName: $("customBookName").value,
        visibility: form.querySelector('input[name="visibility"]:checked')?.value || "private",
        tag: form.querySelector('input[name="projectTag"]:checked')?.value || "自建",
        draftCards,
        draftVisibleCount,
        draftCollapsed,
        composing: {
          front: $("cardFront").value,
          back: $("cardBack").value,
          extra: $("cardExtra").value,
        },
        savedAt: Date.now(),
      };
      const hasContent =
        draftCards.length > 0 ||
        data.bookName.trim() ||
        data.composing.front.trim() ||
        data.composing.back.trim() ||
        data.composing.extra.trim();
      try {
        if (hasContent) localStorage.setItem(draftStorageKey(), JSON.stringify(data));
        else localStorage.removeItem(draftStorageKey());
      } catch (e) {
        /* 存储满或禁用时静默降级 */
      }
    }

    function loadDraft() {
      try {
        const raw = localStorage.getItem(draftStorageKey());
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }

    function clearDraft() {
      try {
        localStorage.removeItem(draftStorageKey());
      } catch (e) {}
    }

    function applyDraft(d) {
      $("customBookName").value = d.bookName || "";
      setRadioValue("visibility", d.visibility || "private");
      if (d.tag) setRadioValue("projectTag", d.tag);
      draftCards = Array.isArray(d.draftCards) ? d.draftCards : [];
      draftVisibleCount = d.draftVisibleCount || DRAFT_PAGE_SIZE;
      draftCollapsed = !!d.draftCollapsed;
      if (d.composing) {
        $("cardFront").value = d.composing.front || "";
        $("cardBack").value = d.composing.back || "";
        $("cardExtra").value = d.composing.extra || "";
      }
    }
    // ---- 草稿持久化结束 ----

    function renderGate() {
      $("customGate").hidden = false;
      $("customWorkspace").hidden = true;
      $("customLoginBtn").addEventListener("click", () => openAuthDialog("login"));
      $("customRegisterBtn").addEventListener("click", () => openAuthDialog("register"));
    }

    function clozeCardsFromFields(front, back, extra = "") {
      const source = [front, back].filter(Boolean).join("\n");
      const pattern = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g;
      const groups = {};
      let match;
      while ((match = pattern.exec(source))) {
        const key = match[1];
        groups[key] = groups[key] || [];
        groups[key].push(match[2]);
      }
      const keys = Object.keys(groups).sort((a, b) => Number(a) - Number(b));
      if (!keys.length) return [];
      return keys.map((key) => {
        const hint = source.replace(pattern, function (_, group, answer, hintText) {
          return group === key ? "[" + (hintText || "...") + "]" : answer;
        });
        const word = groups[key].join(" / ");
        return {
          word: "cloze-" + key + "-" + word,
          hint,
          definition: extra.trim() || source.replace(pattern, "$2"),
          pos: "Cloze c" + key,
        };
      });
    }

    function cardFromFields(front, back, extra = "") {
      const hint = front.trim();
      const word = back.trim();
      const note = extra.trim();
      if (!hint || !word) return null;
      return {
        word,
        hint,
        definition: note || hint,
        pos: note,
      };
    }

    function cardsFromFields(front, back, extra = "") {
      const cloze = clozeCardsFromFields(front, back, extra);
      if (cloze.length) return cloze;
      const card = cardFromFields(front, back, extra);
      return card ? [card] : [];
    }

    function smartTitleFromMarkdown(markdown, fileName) {
      const heading = String(markdown || "").match(/^#\s+(.+)$/m)?.[1]?.trim();
      if (heading) return heading;
      return String(fileName || "智慧创建牌组").replace(/\.(md|markdown)$/i, "").trim() || "智慧创建牌组";
    }

    function smartTargetCount() {
      const count = Number($("smartTargetCount")?.value || 16);
      if (!Number.isFinite(count)) return 16;
      return Math.max(3, Math.min(40, Math.round(count)));
    }

    function smartExistingDeckNames() {
      const seen = new Set();
      return (account.customBooks || [])
        .map((book) => normalizeSmartText(book.name))
        .filter((name) => {
          const key = name.toLowerCase();
          if (!name || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 8);
    }

    function normalizeSmartText(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    function cleanSmartCards(cards) {
      const seen = new Set();
      const rejected = { empty: 0, duplicate: 0, short: 0 };
      const accepted = [];
      (Array.isArray(cards) ? cards : []).forEach((card) => {
        const front = normalizeSmartText(card.front);
        const back = normalizeSmartText(card.back);
        const extra = normalizeSmartText(card.extra);
        const sourceHeading = normalizeSmartText(card.sourceHeading);
        if (!front || !back) {
          rejected.empty += 1;
          return;
        }
        if (front.length < 2 && back.length < 2) {
          rejected.short += 1;
          return;
        }
        const key = `${front.toLowerCase()}::${back.toLowerCase()}`;
        if (seen.has(key)) {
          rejected.duplicate += 1;
          return;
        }
        seen.add(key);
        accepted.push({
          word: back,
          hint: front,
          definition: extra || front,
          pos: sourceHeading || "智慧创建",
        });
      });
      return { cards: accepted, rejected };
    }

    function smartRejectCount(rejected) {
      return (rejected.empty || 0) + (rejected.duplicate || 0) + (rejected.short || 0);
    }

    function smartRejectSummary(rejected) {
      const parts = [];
      if (rejected.empty) parts.push(`空卡 ${rejected.empty} 张`);
      if (rejected.duplicate) parts.push(`重复 ${rejected.duplicate} 张`);
      if (rejected.short) parts.push(`过短 ${rejected.short} 张`);
      return parts.join("、");
    }

    function renderSmartStatus(message = "", type = "ok") {
      const host = $("smartCreateStatus");
      if (!host) return;
      host.innerHTML = message ? `<div class="feedback ${type}">${escapeHTML(message)}</div>` : "";
    }

    function renderCardPreview() {
      const front = $("cardFront")?.value.trim();
      const back = $("cardBack")?.value.trim();
      const extra = $("cardExtra")?.value.trim();
      $("previewFront").innerHTML = front ? richHTML(front) : "正面提示会显示在这里";
      $("previewBack").innerHTML = back ? richHTML(back) : "背面答案";
      $("previewExtra").innerHTML = extra ? richHTML(extra) : "补充信息会显示在这里";
    }

    function renderDraftCards() {
      const total = draftCards.length;
      $("draftCardCount").textContent = `${total} 张待保存`;
      const badge = $("draftBadge");
      if (badge) badge.textContent = total;

      const collapseBtn = $("draftCollapseBtn");
      const clearBtn = $("draftClearBtn");
      if (collapseBtn) {
        collapseBtn.hidden = total === 0;
        collapseBtn.textContent = draftCollapsed ? "展开" : "收起";
      }
      if (clearBtn) clearBtn.disabled = total === 0;

      const list = $("draftCardList");
      list.classList.toggle("collapsed", draftCollapsed);

      if (total === 0) {
        list.innerHTML = `
          <div class="card empty collection-empty draft-empty">
            <div class="big">卡</div>
            <p>还没有待保存卡片。请先填写正面提示和背面答案，再添加到待保存卡片。</p>
          </div>
        `;
        return;
      }

      if (draftCollapsed) {
        list.innerHTML = "";
        return;
      }

      const visible = draftCards.slice(0, draftVisibleCount);
      const remaining = total - visible.length;

      list.innerHTML =
        visible
          .map(
            (card, index) => `
                <article class="word-item draft-card-item">
                  <div>
                    <div class="word-line">
                      <strong>${richHTML(card.word)}</strong>
                      <span class="draft-index">#${index + 1}</span>
                      ${card.pos ? `<span>${escapeHTML(card.pos)}</span>` : ""}
                    </div>
                    <p>${richHTML(card.hint)}</p>
                  </div>
                  <div class="word-actions">
                    <button class="btn sm ghost" data-remove-draft="${index}" type="button">删除</button>
                  </div>
                </article>
              `,
          )
          .join("") +
        (remaining > 0
          ? `<button class="draft-show-more" id="draftShowMoreBtn" type="button">显示更多（还有 ${remaining} 张）</button>`
          : "");

      const showMoreBtn = $("draftShowMoreBtn");
      if (showMoreBtn) {
        showMoreBtn.addEventListener("click", () => {
          draftVisibleCount += DRAFT_PAGE_SIZE;
          renderDraftCards();
        });
      }

      list.querySelectorAll("[data-remove-draft]").forEach((button) => {
        button.addEventListener("click", () => {
          const idx = Number(button.dataset.removeDraft);
          draftCards = draftCards.filter((_, index) => index !== idx);
          if (draftVisibleCount > draftCards.length) {
            draftVisibleCount = Math.max(DRAFT_PAGE_SIZE, draftCards.length);
          }
          renderDraftCards();
          saveDraft();
        });
      });
    }

    function showCreateFeedback(message, type = "ok") {
      $("customCreateFeedback").innerHTML = `<div class="feedback ${type}">${escapeHTML(message)}</div>`;
    }

    function showPostSaveActions(message) {
      $("customCreateFeedback").innerHTML = `
        <div class="feedback ok">
          <p>${escapeHTML(message)}</p>
          <div class="row create-next-actions">
            <a class="btn primary" href="dictation.html">去牌组页选择学习</a>
            <a class="btn ghost" href="browser.html">在卡片浏览器中查看</a>
            <button class="btn ghost" id="continueCreateBtn" type="button">继续添加</button>
          </div>
        </div>
      `;
      $("continueCreateBtn")?.addEventListener("click", () => {
        $("customCreateFeedback").innerHTML = "";
        $("customBookName").focus();
      });
    }

    function activeBook() {
      return (account.customBooks || []).find((book) => book.id === editingBookId) || null;
    }

    function setRadioValue(name, value) {
      host.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
        input.checked = input.value === value;
        input.closest(".tag-pick")?.classList.toggle("active", input.checked);
      });
    }

    function resetEditor() {
      editingBookId = null;
      history.replaceState(null, "", "create.html");
      $("customCreateFormTitle").textContent = "新建牌组";
      $("customSubmitBtn").textContent = "保存牌组并上架";
      $("cancelEditBtn").hidden = true;
      $("customBookName").value = "";
      draftCards = [];
      draftVisibleCount = DRAFT_PAGE_SIZE;
      draftCollapsed = false;
      setRadioValue("visibility", "private");
      setRadioValue("projectTag", "自建");
      renderDraftCards();
      renderCardPreview();
      clearDraft();
    }

    function loadBookIntoEditor(book) {
      if (!book) {
        resetEditor();
        return;
      }
      $("customCreateFormTitle").textContent = "编辑牌组";
      $("customSubmitBtn").textContent = "保存修改";
      $("cancelEditBtn").hidden = false;
      $("customBookName").value = book.name || "";
      draftCards = (book.words || []).map((word) => ({ ...word }));
      draftVisibleCount = DRAFT_PAGE_SIZE;
      draftCollapsed = false;
      setRadioValue("visibility", book.visibility || "private");
      setRadioValue("projectTag", book.tag || "自建");
      renderDraftCards();
      renderCardPreview();
      // 不在此处保存草稿：仅在用户做出修改时才持久化，避免把已保存状态误标为"未保存"
    }

    function renderBookList() {
      const books = account.customBooks || [];
      const totalWords = books.reduce((sum, book) => sum + (book.words || []).length, 0);
      const publicBooks = books.filter((book) => book.visibility === "public").length;
      $("customStats").innerHTML = `
        <div class="stat"><div class="n">${books.length}</div><div class="l">已上架牌组</div></div>
        <div class="stat"><div class="n">${totalWords}</div><div class="l">自建卡片</div></div>
        <div class="stat"><div class="n">${publicBooks}</div><div class="l">公开牌组</div></div>
      `;
      $("customBookList").innerHTML = books.length
        ? books
            .map(
              (book) => `
                <article class="word-item">
                  <div>
                    <div class="word-line">
                      <strong>${escapeHTML(book.name)}</strong>
                      <span>${(book.words || []).length} 张卡片</span>
                      <span>${projectTagLabel(book.tag)}</span>
                      <span>${book.visibility === "public" ? "公开" : "私密"}</span>
                    </div>
                    <p>${(book.words || [])
                      .slice(0, 3)
                      .map((word) => escapeHTML(word.word))
                      .join("、")}${(book.words || []).length > 3 ? "..." : ""}</p>
                  </div>
                  <div class="word-actions">
                    <button class="btn sm ghost" data-edit-book="${book.id}" type="button">编辑</button>
                    <button class="btn sm danger" data-delete-book="${book.id}" type="button">删除</button>
                    <a class="btn sm ghost" href="dictation.html">去牌组页学习</a>
                  </div>
                </article>
              `,
            )
            .join("")
        : `
          <div class="card empty collection-empty">
            <div class="big">创</div>
            <p>还没有自建牌组。</p>
          </div>
        `;

      $("customBookList").querySelectorAll("[data-edit-book]").forEach((button) => {
        button.addEventListener("click", () => {
          editingBookId = button.dataset.editBook;
          history.replaceState(null, "", `create.html?edit=${encodeURIComponent(editingBookId)}`);
          loadBookIntoEditor(activeBook());
          $("customBookName").focus();
        });
      });

      $("customBookList").querySelectorAll("[data-delete-book]").forEach((button) => {
        button.addEventListener("click", async () => {
          const book = (account.customBooks || []).find((item) => item.id === button.dataset.deleteBook);
          if (!book || !confirm(`确定删除“${book.name}”吗？这个操作不能撤销。`)) return;
          try {
            const next = await deleteCustomBook(account.id, book.id);
            account.customBooks = next.customBooks;
            if (editingBookId === book.id) resetEditor();
            renderBookList();
            showCreateFeedback("已删除牌组。");
          } catch (error) {
            showCreateFeedback(error.message || "删除失败，请稍后重试。", "err");
          }
        });
      });
    }

    function renderWorkspace() {
      $("customGate").hidden = true;
      $("customWorkspace").hidden = false;
      renderBookList();
      $("projectTagOptions").innerHTML = CUSTOM_PROJECT_TAGS.map(
        (tag) => `
          <label class="tag-pick ${tag.value === "自建" ? "active" : ""}">
            <input type="radio" name="projectTag" value="${tag.value}" ${tag.value === "自建" ? "checked" : ""} />
            ${tag.label}
          </label>
        `,
      ).join("");
      host.querySelectorAll(".visibility-options input").forEach((input) => {
        input.addEventListener("change", () => {
          input.closest(".visibility-options").querySelectorAll(".tag-pick").forEach((label) => label.classList.remove("active"));
          input.closest(".tag-pick").classList.add("active");
          saveDraft();
        });
      });
      $("cancelEditBtn").addEventListener("click", resetEditor);
      $("customBookName").addEventListener("input", saveDraft);
      ["cardFront", "cardBack", "cardExtra"].forEach((id) => {
        $(id).addEventListener("input", () => {
          renderCardPreview();
          saveDraft();
        });
      });
      function appendToField(fieldId, text) {
        const field = $(fieldId);
        const joiner = field.value && !field.value.endsWith("\n") ? "\n" : "";
        field.value += joiner + text;
        renderCardPreview();
        saveDraft();
      }
      function wireImagePicker(buttonId, inputId, fieldId) {
        $(buttonId).addEventListener("click", () => $(inputId).click());
        $(inputId).addEventListener("change", () => {
          const file = $(inputId).files && $(inputId).files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            appendToField(fieldId, `[img:${reader.result}]`);
            $(inputId).value = "";
          };
          reader.readAsDataURL(file);
        });
      }
      $("insertClozeBtn").addEventListener("click", () => appendToField("cardFront", "{{c1::答案::提示}}"));
      wireImagePicker("frontImageBtn", "frontImageInput", "cardFront");
      wireImagePicker("backImageBtn", "backImageInput", "cardBack");
      wireImagePicker("extraImageBtn", "extraImageInput", "cardExtra");
      let smartMarkdownFile = null;
      const smartCreateBtn = $("smartCreateBtn");
      function setSmartBusy(isBusy) {
        smartCreateBtn.disabled = isBusy || !isRemoteEnabled();
        smartCreateBtn.textContent = isBusy ? "正在生成..." : "生成并保存牌组";
        $("smartMarkdownPickBtn").disabled = isBusy || !isRemoteEnabled();
      }
      if (!isRemoteEnabled()) {
        smartCreateBtn.disabled = true;
        $("smartMarkdownPickBtn").disabled = true;
        renderSmartStatus("智慧创建服务未配置。请先配置 Supabase 和 smart-create-cards 后端代理。", "err");
      } else if (!loadAIConfig(account.id).apiKey) {
        renderSmartStatus('请先到“我的”页面配置模型 API Key，再使用智慧创建。', "err");
      }
      $("smartMarkdownPickBtn").addEventListener("click", () => $("smartMarkdownInput").click());
      $("smartMarkdownInput").addEventListener("change", () => {
        const file = $("smartMarkdownInput").files && $("smartMarkdownInput").files[0];
        smartMarkdownFile = file || null;
        $("smartMarkdownFileName").textContent = file ? file.name : "尚未选择文件";
        renderSmartStatus("");
      });
      smartCreateBtn.addEventListener("click", async () => {
        if (!isRemoteEnabled()) {
          renderSmartStatus("智慧创建服务未配置。", "err");
          return;
        }
        const aiConfig = loadAIConfig(account.id);
        if (!aiConfig.apiKey) {
          renderSmartStatus('请先到“我的”页面配置模型 API Key。', "err");
          return;
        }
        if (!smartMarkdownFile) {
          renderSmartStatus("请先选择一个 Markdown 文件。", "err");
          return;
        }
        if (!/\.(md|markdown)$/i.test(smartMarkdownFile.name)) {
          renderSmartStatus("请上传 .md 或 .markdown 文件。", "err");
          return;
        }
        if (smartMarkdownFile.size > 1024 * 1024) {
          renderSmartStatus("Markdown 文件不能超过 1 MB。", "err");
          return;
        }
        setSmartBusy(true);
        renderSmartStatus("正在读取资料并生成卡片，请稍候...");
        try {
          const markdown = await smartMarkdownFile.text();
          if (normalizeSmartText(markdown).length < 80) {
            renderSmartStatus("Markdown 内容太少，建议补充更完整的学习资料后再生成。", "err");
            return;
          }
          const requestedTitle = $("customBookName").value.trim() || smartTitleFromMarkdown(markdown, smartMarkdownFile.name);
          const visibility = $("customCreateForm").querySelector('input[name="visibility"]:checked')?.value || "private";
          const tag = $("customCreateForm").querySelector('input[name="projectTag"]:checked')?.value || "自建";
          const targetCount = smartTargetCount();
          $("smartTargetCount").value = targetCount;
          const result = await remoteStore().smartCreateCards({
            markdown,
            fileName: smartMarkdownFile.name,
            requestedTitle,
            tag,
            visibility,
            focus: $("smartCreateFocus")?.value || "balanced",
            targetCount,
            userGuidance: $("smartUserGuidance")?.value.trim() || "",
            existingDecks: smartExistingDeckNames(),
            apiKey: aiConfig.apiKey,
            model: aiConfig.model,
            provider: aiConfig.provider,
          });
          const cleaned = cleanSmartCards(result?.cards);
          if (!cleaned.cards.length) {
            renderSmartStatus("模型没有生成可保存的有效卡片，请换一份内容更完整的 Markdown 后重试。", "err");
            return;
          }
          const title = normalizeSmartText(result?.title) || requestedTitle;
          const next = await createCustomBook(account, title, cleaned.cards, visibility, tag);
          account.customBooks = next.customBooks;
          renderBookList();
          const rejectedCount = smartRejectCount(cleaned.rejected);
          const rejectCopy = rejectedCount ? `，已过滤 ${rejectedCount} 张（${smartRejectSummary(cleaned.rejected)}）` : "";
          const warningCopy = Array.isArray(result?.warnings) && result.warnings.length
            ? ` ${result.warnings.map((item) => String(item)).join(" ")}`
            : "";
          showPostSaveActions(`智慧创建已保存“${title}”：${cleaned.cards.length} 张卡片${rejectCopy}。${warningCopy}`.trim());
          renderSmartStatus(`已保存 ${cleaned.cards.length} 张智慧创建卡片。`);
          $("customBookName").value = "";
          $("smartUserGuidance").value = "";
          $("smartMarkdownInput").value = "";
          smartMarkdownFile = null;
          $("smartMarkdownFileName").textContent = "尚未选择文件";
          saveDraft();
        } catch (error) {
          renderSmartStatus(error.message || "智慧创建失败，请稍后重试。", "err");
        } finally {
          setSmartBusy(false);
        }
      });
      $("addDraftCardBtn").addEventListener("click", () => {
        const cards = cardsFromFields($("cardFront").value, $("cardBack").value, $("cardExtra").value);
        if (!cards.length) {
          showCreateFeedback("请填写卡片的正面提示和背面答案。", "err");
          return;
        }
        draftCards = draftCards.concat(cards);
        $("cardFront").value = "";
        $("cardBack").value = "";
        $("cardExtra").value = "";
        renderCardPreview();
        // 确保新增的卡片可见
        if (draftCollapsed) draftCollapsed = false;
        draftVisibleCount = Math.max(draftVisibleCount, draftCards.length);
        renderDraftCards();
        const list = $("draftCardList");
        list.scrollTop = list.scrollHeight;
        showCreateFeedback(`已加入 ${cards.length} 张待保存卡片。`);
        saveDraft();
      });
      $("draftCollapseBtn").addEventListener("click", () => {
        draftCollapsed = !draftCollapsed;
        renderDraftCards();
        saveDraft();
      });
      $("draftClearBtn").addEventListener("click", () => {
        if (draftCards.length === 0) return;
        if (!confirm(`确定清空全部 ${draftCards.length} 张待保存卡片吗？此操作不可撤销。`)) return;
        draftCards = [];
        draftVisibleCount = DRAFT_PAGE_SIZE;
        draftCollapsed = false;
        renderDraftCards();
        saveDraft();
        showCreateFeedback("已清空待保存卡片。");
      });
      $("customCreateForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = $("customBookName").value.trim();
        const visibility = $("customCreateForm").querySelector('input[name="visibility"]:checked')?.value || "private";
        const tag = $("customCreateForm").querySelector('input[name="projectTag"]:checked')?.value || "自建";
        if (!name || draftCards.length === 0) {
          showCreateFeedback("请填写牌组名称，并至少添加一张待保存卡片。", "err");
          return;
        }
        const payload = {
          name,
          words: draftCards.map((card) => ({ ...card })),
          visibility,
          tag,
        };
        let next;
        try {
          next = editingBookId
            ? await updateCustomBook(account.id, editingBookId, payload)
            : await createCustomBook(account, payload.name, payload.words, payload.visibility, payload.tag);
        } catch (error) {
          showCreateFeedback(error.message || "保存失败，请稍后重试。", "err");
          return;
        }
        account.customBooks = next.customBooks;
        if (editingBookId) {
          showPostSaveActions("已保存牌组修改。");
          loadBookIntoEditor(activeBook());
        } else {
          $("customBookName").value = "";
          draftCards = [];
          draftVisibleCount = DRAFT_PAGE_SIZE;
          draftCollapsed = false;
          renderDraftCards();
          showPostSaveActions("已保存牌组并上架。");
          clearDraft();
        }
        renderBookList();
      });
      // 恢复未保存草稿，或加载编辑目标
      const savedDraft = loadDraft();
      if (savedDraft && savedDraft.editingBookId === editingBookId) {
        // 同一会话：恢复草稿（新建或编辑同一牌组的中途）
        applyDraft(savedDraft);
        renderCardPreview();
        renderDraftCards();
        if (draftCards.length > 0 || (savedDraft.composing && (savedDraft.composing.front || savedDraft.composing.back))) {
          showCreateFeedback(`已恢复上次未保存的草稿（${draftCards.length} 张卡片）。`);
        }
      } else if (editingBookId) {
        // URL 指定了牌组但无匹配草稿：加载该牌组
        loadBookIntoEditor(activeBook());
      } else if (savedDraft) {
        // 无 URL 编辑参数，但存在草稿（可能来自上次的编辑会话）：恢复
        if (savedDraft.editingBookId) {
          editingBookId = savedDraft.editingBookId;
          history.replaceState(null, "", `create.html?edit=${encodeURIComponent(editingBookId)}`);
          $("customCreateFormTitle").textContent = "编辑牌组";
          $("customSubmitBtn").textContent = "保存修改";
          $("cancelEditBtn").hidden = false;
        }
        applyDraft(savedDraft);
        renderCardPreview();
        renderDraftCards();
        if (draftCards.length > 0 || (savedDraft.composing && (savedDraft.composing.front || savedDraft.composing.back))) {
          showCreateFeedback(`已恢复上次未保存的草稿（${draftCards.length} 张卡片）。`);
        }
      } else {
        renderCardPreview();
        renderDraftCards();
      }
    }

    if (account.type !== "user") renderGate();
    else renderWorkspace();
  }

  function initProfilePage() {
    const host = document.getElementById("profilePage");
    if (!host) return;

    const account = currentAccount();
    const $ = (id) => document.getElementById(id);

    function officialProject(projectId) {
      const items = {
        "official:college-english": {
          name: "大学英语",
          desc: "大学英语 IV 官方词书。",
          chip: "官方 · 外语",
          href: "dictation.html",
          icon: "英",
          tone: "#b5502f",
          toneSoft: "#f3e3dc",
        },
        "official:russian": {
          name: "俄语",
          desc: "俄语 I 官方词书。",
          chip: "官方 · 外语",
          href: "dictation.html",
          icon: "俄",
          tone: "#7a4f9f",
          toneSoft: "#eee7f5",
        },
        "official:lunyu": {
          name: "论语",
          desc: "《论语》字词与翻译。",
          chip: "官方 · 经典",
          href: "lunyu.html",
          icon: "文",
          tone: "#3d6b5e",
          toneSoft: "#e0ebe6",
        },
      };
      return items[projectId] || null;
    }

    function projectFromFavoriteId(projectId) {
      if (projectId.startsWith("official:")) return officialProject(projectId);
      const match = projectId.match(/^custom:(.+)::(.+)$/);
      if (!match) return null;
      const found = findCustomBook(match[1], match[2]);
      if (!found) return null;
      const { owner, book } = found;
      return {
        name: book.name,
        desc: `${book.visibility === "public" ? "公开" : "私密"} · ${owner.name} · ${(book.words || []).length} 张卡片。`,
        chip: `${projectTagLabel(book.tag)} · ${(book.words || []).length} 词`,
        href: "dictation.html",
        icon: "创",
        tone: "#3d6b5e",
        toneSoft: "#e0ebe6",
      };
    }

    function profileTodayQueueCount(accountId, SRS) {
      return SRS.getDueCards(accountId).length;
    }

    function renderGate() {
      $("profileGate").hidden = false;
      $("profileWorkspace").hidden = true;
      $("profileLoginBtn").addEventListener("click", () => openAuthDialog("login"));
      $("profileRegisterBtn").addEventListener("click", () => openAuthDialog("register"));
    }

    function renderStats(practiceData) {
      const books = account.customBooks || [];
      const totalCards = books.reduce((sum, book) => sum + (book.words || []).length, 0);
      const publicBooks = books.filter((book) => book.visibility === "public").length;
      const favorites = practiceData.favoriteProjects || [];
      // SRS 统计
      var accountId = account.type === "user" ? account.id : "guest";
      var SRS = window.SRSEngine;
      var srsDue = SRS ? profileTodayQueueCount(accountId, SRS) : 0;
      var srsStats = SRS ? SRS.getTodayStats(accountId) : { reviews: 0 };
      var srsStreak = SRS ? SRS.getStreak(accountId) : 0;
      $("profileStats").innerHTML = `
        <div class="stat"><div class="n">${srsDue || "—"}</div><div class="l">今日可复习</div></div>
        <div class="stat"><div class="n">${srsStats.reviews || "—"}</div><div class="l">已复习</div></div>
        <div class="stat"><div class="n">${srsStreak || "—"}</div><div class="l">连续天数</div></div>
        <div class="stat"><div class="n">${books.length}</div><div class="l">自建知识库</div></div>
        <div class="stat"><div class="n">${totalCards}</div><div class="l">自建卡片</div></div>
        <div class="stat"><div class="n">${favorites.length}</div><div class="l">收藏知识库</div></div>
      `;
    }

    function renderBooks() {
      const books = account.customBooks || [];
      $("profileBookList").innerHTML = books.length
        ? books
            .map(
              (book) => `
                <article class="word-item">
                  <div>
                    <div class="word-line">
                      <strong>${escapeHTML(book.name)}</strong>
                      <span>${(book.words || []).length} 张卡片</span>
                      <span>${projectTagLabel(book.tag)}</span>
                      <span>${book.visibility === "public" ? "公开" : "私密"}</span>
                    </div>
                    <p>${(book.words || [])
                      .slice(0, 4)
                      .map((word) => escapeHTML(word.word))
                      .join("、")}${(book.words || []).length > 4 ? "..." : ""}</p>
                  </div>
                  <div class="word-actions">
                    <a class="btn sm ghost" href="create.html?edit=${encodeURIComponent(book.id)}">编辑</a>
                    <button class="btn sm danger" data-profile-delete-book="${book.id}" type="button">删除</button>
                    <a class="btn sm ghost" href="dictation.html">练习</a>
                  </div>
                </article>
              `,
            )
            .join("")
        : `
          <div class="card empty collection-empty">
            <div class="big">创</div>
            <p>还没有创建知识库。</p>
          </div>
        `;
      $("profileBookList").querySelectorAll("[data-profile-delete-book]").forEach((button) => {
        button.addEventListener("click", async () => {
          const book = (account.customBooks || []).find((item) => item.id === button.dataset.profileDeleteBook);
          if (!book || !confirm(`确定删除“${book.name}”吗？这个操作不能撤销。`)) return;
          try {
            const next = await deleteCustomBook(account.id, book.id);
            account.customBooks = next.customBooks;
            renderAll();
          } catch (error) {
            alert(error.message || "删除失败，请稍后重试。");
          }
        });
      });
    }

    function renderFavorites(practiceData) {
      const favorites = (practiceData.favoriteProjects || []).map((id) => ({ id, project: projectFromFavoriteId(id) }));
      $("profileFavoriteList").innerHTML = favorites.length
        ? favorites
            .map(({ project }) =>
              project
                ? `
                  <a class="card mod-card project-card profile-favorite-card" href="${project.href}" style="--tone:${project.tone};--tone-soft:${project.toneSoft}">
                    <div class="icon">${project.icon}</div>
                    <h3>${escapeHTML(project.name)}</h3>
                    <p>${escapeHTML(project.desc)}</p>
                    <div class="foot">
                      <span class="chip tone">${escapeHTML(project.chip)}</span>
                      <span class="go">进入 →</span>
                    </div>
                  </a>
                `
                : `
                  <article class="card mod-card project-card profile-favorite-card missing" style="--tone:#9a9084;--tone-soft:#efeadd">
                    <div class="icon">缺</div>
                    <h3>知识库已不存在</h3>
                    <p>这个收藏指向的知识库已经被删除。</p>
                    <div class="foot"><span class="chip tone">失效收藏</span></div>
                  </article>
                `,
            )
            .join("")
        : `
          <div class="card empty">
            <div class="big">☆</div>
            <p>还没有收藏知识库。</p>
          </div>
        `;
    }

    function renderAIConfig() {
      const config = loadAIConfig(account.id);
      $("aiProvider").value = config.provider;
      $("aiApiKey").value = config.apiKey || "";
      $("aiModel").value = config.model || "gpt-4.1-mini";
      $("aiConfigState").textContent = config.apiKey ? "已配置" : "未配置";
      $("aiConfigState").className = config.apiKey ? "ok" : "";
      $("aiApiKey").placeholder = AI_PROVIDER_DEFAULTS[config.provider].placeholder;
    }

    function bindAIConfigForm() {
      $("aiProvider").addEventListener("change", () => {
        const provider = $("aiProvider").value;
        $("aiModel").value = AI_PROVIDER_DEFAULTS[provider]?.model || AI_PROVIDER_DEFAULTS.openai.model;
        $("aiApiKey").placeholder = AI_PROVIDER_DEFAULTS[provider]?.placeholder || "sk-...";
      });
      $("aiConfigForm").addEventListener("submit", (event) => {
        event.preventDefault();
        const provider = $("aiProvider").value;
        const apiKey = $("aiApiKey").value.trim();
        const model = $("aiModel").value.trim() || AI_PROVIDER_DEFAULTS[provider]?.model || AI_PROVIDER_DEFAULTS.openai.model;
        if (!apiKey) {
          $("aiConfigFeedback").innerHTML = '<div class="feedback err">请填写 API Key。</div>';
          return;
        }
        saveAIConfig(account.id, { provider, apiKey, model });
        renderAIConfig();
        $("aiConfigFeedback").innerHTML = '<div class="feedback ok">智慧创建 API 配置已保存。</div>';
      });
      $("aiServiceCheckBtn").addEventListener("click", async () => {
        const button = $("aiServiceCheckBtn");
        button.disabled = true;
        $("aiConfigFeedback").innerHTML = '<div class="feedback ok">正在检查智慧创建后端代理...</div>';
        try {
          await remoteStore().checkSmartCreateService();
          $("aiConfigFeedback").innerHTML = '<div class="feedback ok">智慧创建后端代理已部署并可访问。</div>';
        } catch (error) {
          $("aiConfigFeedback").innerHTML = `<div class="feedback err">${escapeHTML(error.message || "智慧创建后端代理不可用。")}</div>`;
        } finally {
          button.disabled = false;
        }
      });
      $("aiConfigClearBtn").addEventListener("click", () => {
        if (!confirm("确定清除当前浏览器保存的 API 配置吗？")) return;
        clearAIConfig(account.id);
        renderAIConfig();
        $("aiConfigFeedback").innerHTML = '<div class="feedback ok">已清除智慧创建 API 配置。</div>';
      });
    }

    function renderAll() {
      const practiceData = loadPracticeData(account.id);
      const avatar = avatarFor(account);
      $("profileGate").hidden = true;
      $("profileWorkspace").hidden = false;
      $("profileAvatar").src = avatar.src;
      $("profileAvatar").alt = `${account.name}的头像`;
      $("profileName").textContent = account.name;
      $("profileIntro").textContent = `已加入 ${new Date(account.createdAt || Date.now()).toLocaleDateString("zh-CN")} · 本地学习空间`;
      renderStats(practiceData);
      renderAIConfig();
      renderBooks();
      renderFavorites(practiceData);
    }

    if (account.type !== "user") {
      renderGate();
      return;
    }

    renderAll();
    bindAIConfigForm();
  }

  function initLunyuPage() {
    const host = document.getElementById("lunyuPage");
    if (!host) return;

    const book = window.LUNYU_TRANSLATIONS;
    const account = currentAccount();

    // SRS 迁移：将旧熟悉度数据转换为 SRS 状态
    var accountId = account.type === "user" ? account.id : "guest";
    if (window.SRSEngine) {
      window.SRSEngine.clearExpiredBuries(accountId);
      window.SRSEngine.migrateAll(accountId);
    }

    const STORAGE_KEY = "songji-lunyu-translation-v1";
    const gradeMeta = {
      again: { label: "再看", short: "重复本句" },
      hard: { label: "困难", short: "想了很久" },
      good: { label: "良好", short: "记起来了" },
      easy: { label: "简单", short: "秒记" },
    };
    const gradeKeys = ["again", "hard", "good", "easy"];
    const oldGradeMap = { unfamiliar: "hard", medium: "hard", familiar: "good" };
    const $ = (id) => document.getElementById(id);

    const state = {
      chapterId: book?.chapters?.[0]?.id || null,
      index: 0,
      favoritesOnly: false,
      revealed: false,
    };

    function loadStore() {
      try {
        const parsed = JSON.parse(localStorage.getItem(`${STORAGE_KEY}:${account.id}`));
        return parsed && typeof parsed === "object" ? parsed : { sentences: {} };
      } catch (error) {
        return { sentences: {} };
      }
    }

    let store = loadStore();
    store.sentences = store.sentences || {};

    // 旧数据迁移：familiar/medium/unfamiliar → good/hard/again
    Object.values(store.sentences).forEach((record) => {
      if (record.grade && oldGradeMap[record.grade]) {
        record.grade = oldGradeMap[record.grade];
      }
    });

    function saveStore() {
      try {
        localStorage.setItem(`${STORAGE_KEY}:${account.id}`, JSON.stringify(store));
      } catch (error) {
        // The page can still be read even when local progress cannot be saved.
      }
    }

    function chapterById(id) {
      if (!book?.chapters?.length) return null;
      return book.chapters.find((chapter) => chapter.id === id) || book.chapters[0];
    }

    function sentenceKey(chapter, sentence) {
      return `${chapter.id}::${sentence.id}`;
    }

    function sentenceRecord(chapter, sentence) {
      const key = sentenceKey(chapter, sentence);
      store.sentences[key] = store.sentences[key] || {};
      return store.sentences[key];
    }

    function readSentenceRecord(chapter, sentence) {
      return store.sentences[sentenceKey(chapter, sentence)] || {};
    }

    function currentChapter() {
      return chapterById(state.chapterId);
    }

    function currentSentences() {
      const chapter = currentChapter();
      if (!chapter) return [];
      if (!state.favoritesOnly) return chapter.sentences;
      return chapter.sentences.filter((sentence) => readSentenceRecord(chapter, sentence).favorite);
    }

    function allRecords() {
      if (!book?.chapters) return [];
      return book.chapters.flatMap((chapter) =>
        chapter.sentences.map((sentence) => readSentenceRecord(chapter, sentence)),
      );
    }

    function renderStats() {
      const records = allRecords();
      const favorites = records.filter((record) => record.favorite).length;
      $("lunyuFavoriteCount").textContent = `${favorites} 收藏`;
      $("lunyuFavoritesOnlyBtn").disabled = favorites === 0;
    }

    function renderChapterSelect() {
      $("lunyuChapterSelect").innerHTML = book.chapters
        .map((chapter) => `<option value="${chapter.id}">${escapeHTML(chapter.name)} · ${chapter.sentences.length} 句</option>`)
        .join("");
      $("lunyuChapterSelect").value = state.chapterId;
    }

    function reveal() {
      if (state.revealed) return;
      state.revealed = true;
      renderCurrent();
      requestAnimationFrame(() => {
        $("lunyuGradePanel").scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }

    function setGrade(grade) {
      const chapter = currentChapter();
      const sentence = currentSentences()[state.index];
      if (!chapter || !sentence) return;
      const record = sentenceRecord(chapter, sentence);
      var accountId = account.type === "user" ? account.id : "guest";
      var SRS = window.SRSEngine;
      var cardId = "lunyu:default:" + sentence.id;
      if (grade === "again") {
        record.repeatCount = (record.repeatCount || 0) + 1;
        record.updatedAt = new Date().toISOString();
        saveStore();
        if (SRS) {
          SRS.addReviewTime(accountId, 0);
          SRS.repeatCard(accountId, cardId);
        }
        state.revealed = false;
        renderCurrent();
        return;
      }
      record.grade = grade;
      record.reviewCount = (record.reviewCount || 0) + 1;
      record.updatedAt = new Date().toISOString();
      saveStore();

      // 同步更新 SRS 引擎
      if (SRS) {
        SRS.reviewCard(accountId, cardId, grade);
      }

      const sentences = currentSentences();
      if (state.index < sentences.length - 1) {
        setIndex(state.index + 1);
      } else {
        state.revealed = false;
        renderCurrent();
        flashCardState("已是本章最后一句，可翻回继续复习");
      }
    }

    let flashTimer = null;
    function flashCardState(message) {
      const el = $("lunyuCardState");
      if (!el) return;
      el.textContent = message;
      el.style.color = "var(--brand)";
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        el.textContent = "";
        el.style.color = "";
        flashTimer = null;
      }, 2500);
    }

    function toggleFavorite() {
      const chapter = currentChapter();
      const sentence = currentSentences()[state.index];
      if (!chapter || !sentence) return;
      const record = sentenceRecord(chapter, sentence);
      record.favorite = !record.favorite;
      record.updatedAt = new Date().toISOString();
      saveStore();
      if (state.favoritesOnly && !record.favorite) {
        state.index = Math.max(0, Math.min(state.index, currentSentences().length - 1));
      }
      renderCurrent();
    }

    function setIndex(nextIndex) {
      const sentences = currentSentences();
      if (!sentences.length) {
        state.index = 0;
      } else {
        state.index = Math.max(0, Math.min(nextIndex, sentences.length - 1));
      }
      state.revealed = false;
      renderCurrent();
    }

    function renderEmpty(message) {
      $("lunyuChapterLabel").textContent = currentChapter()?.name || "论语";
      $("lunyuCounter").textContent = "0 / 0";
      $("lunyuProgress").style.width = "0%";
      $("lunyuSentenceId").textContent = "暂无条目";
      $("lunyuOriginal").textContent = message;
      $("lunyuTranslation").textContent = "";
      $("lunyuRevealArea").hidden = true;
      $("lunyuRevealBtn").hidden = true;
      $("lunyuGradePanel").hidden = true;
      $("lunyuCardState").textContent = "";
      $("lunyuCard").classList.remove("revealed");
      $("lunyuFavoriteBtn").classList.remove("active");
      $("lunyuFavoriteBtn").textContent = "☆";
      $("lunyuFavoriteBtn").disabled = true;
      $("lunyuPrevBtn").disabled = true;
      $("lunyuNextBtn").disabled = true;
      $("lunyuGradePanel").querySelectorAll("[data-grade]").forEach((button) => {
        button.classList.remove("active");
      });
      renderStats();
    }

    function renderCurrent() {
      if (!book?.chapters?.length) {
        renderEmpty("尚未导入《论语》翻译数据。");
        return;
      }

      const chapter = currentChapter();
      const sentences = currentSentences();
      if (!sentences.length) {
        renderEmpty(state.favoritesOnly ? "当前篇章还没有收藏句子。" : "当前篇章没有句子。");
        return;
      }

      state.index = Math.max(0, Math.min(state.index, sentences.length - 1));
      const sentence = sentences[state.index];
      const record = readSentenceRecord(chapter, sentence);
      const activeGrade = record.grade || "";
      const isFavorite = Boolean(record.favorite);

      $("lunyuChapterLabel").textContent = state.favoritesOnly ? `${chapter.name} · 收藏` : chapter.name;
      $("lunyuCounter").textContent = `${state.index + 1} / ${sentences.length}`;
      $("lunyuProgress").style.width = `${((state.index + 1) / sentences.length) * 100}%`;
      $("lunyuSentenceId").textContent = sentence.id;
      $("lunyuOriginal").textContent = sentence.original;
      $("lunyuTranslation").textContent = sentence.translation;

      // 揭示状态控制
      $("lunyuRevealArea").hidden = !state.revealed;
      $("lunyuRevealBtn").hidden = state.revealed;
      $("lunyuGradePanel").hidden = !state.revealed;
      $("lunyuCard").classList.toggle("revealed", state.revealed);

      // 卡牌状态提示
      if (!flashTimer) {
        if (state.revealed) {
          const reviewInfo = record.reviewCount ? ` · 已复习 ${record.reviewCount} 次` : "";
          const gradeInfo = activeGrade
            ? `上次：${gradeMeta[activeGrade]?.label || ""}${reviewInfo}`
            : "请选择困难、良好或简单，自动进入下一句";
          // SRS 间隔预览
          var SRS = window.SRSEngine;
          var accountId = account.type === "user" ? account.id : "guest";
          var srsCardId = "lunyu:default:" + sentence.id;
          var srsState = SRS ? SRS.getCardState(accountId, srsCardId) : null;
          var intervalHint = "";
          if (SRS && srsState && srsState.state !== "new") {
            var srsConfig = SRS.resolveConfig(srsCardId, SRS.loadSRSData(accountId).config);
            var preview = SRS.previewIntervals(srsState, srsConfig);
            intervalHint = ` · 下次: ${preview.good.label}`;
          }
          $("lunyuCardState").textContent = gradeInfo + intervalHint;
          $("lunyuCardState").style.color = "";
        } else {
          $("lunyuCardState").textContent = "点击下方按钮或按空格键查看翻译";
          $("lunyuCardState").style.color = "";
        }
      }

      $("lunyuFavoriteBtn").disabled = false;
      $("lunyuFavoriteBtn").classList.toggle("active", isFavorite);
      $("lunyuFavoriteBtn").textContent = isFavorite ? "★" : "☆";
      $("lunyuFavoriteBtn").setAttribute("aria-label", isFavorite ? "取消收藏当前句子" : "收藏当前句子");
      $("lunyuFavoriteBtn").title = isFavorite ? "取消收藏当前句子" : "收藏当前句子";

      $("lunyuPrevBtn").disabled = state.index === 0;
      $("lunyuNextBtn").disabled = state.index === sentences.length - 1;
      $("lunyuFavoritesOnlyBtn").hidden = state.favoritesOnly;
      $("lunyuAllBtn").hidden = !state.favoritesOnly;

      $("lunyuGradePanel").querySelectorAll("[data-grade]").forEach((button) => {
        button.classList.toggle("active", button.dataset.grade === activeGrade);
      });
      renderStats();
    }

    if (!book?.chapters?.length) {
      renderEmpty("尚未导入《论语》翻译数据。");
      return;
    }

    renderChapterSelect();
    $("lunyuChapterSelect").addEventListener("change", (event) => {
      state.chapterId = event.target.value;
      state.index = 0;
      state.favoritesOnly = false;
      state.revealed = false;
      renderCurrent();
    });
    $("lunyuRevealBtn").addEventListener("click", reveal);
    $("lunyuPrevBtn").addEventListener("click", () => setIndex(state.index - 1));
    $("lunyuNextBtn").addEventListener("click", () => setIndex(state.index + 1));
    $("lunyuFavoriteBtn").addEventListener("click", toggleFavorite);
    $("lunyuFavoritesOnlyBtn").addEventListener("click", () => {
      state.favoritesOnly = true;
      state.index = 0;
      state.revealed = false;
      renderCurrent();
    });
    $("lunyuAllBtn").addEventListener("click", () => {
      state.favoritesOnly = false;
      state.index = 0;
      state.revealed = false;
      renderCurrent();
    });
    $("lunyuGradePanel").querySelectorAll("[data-grade]").forEach((button) => {
      button.addEventListener("click", () => setGrade(button.dataset.grade));
    });

    // 键盘快捷键：空格翻面、1234 评分、← →/j k 翻页
    function handleKeydown(event) {
      const tag = event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!currentSentences().length) return;

      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        if (!state.revealed) reveal();
        return;
      }
      if (!state.revealed) {
        if (event.key === "ArrowRight" || event.key === "k") setIndex(state.index + 1);
        else if (event.key === "ArrowLeft" || event.key === "j") setIndex(state.index - 1);
        return;
      }
      const gradeMap = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
      if (gradeMap[event.key]) {
        setGrade(gradeMap[event.key]);
      } else if (event.key === "ArrowRight" || event.key === "k") {
        setIndex(state.index + 1);
      } else if (event.key === "ArrowLeft" || event.key === "j") {
        setIndex(state.index - 1);
      }
    }
    document.addEventListener("keydown", handleKeydown);

    renderCurrent();
  }

  function buildCardContentCatalog(account) {
    const cards = new Map();
    const decks = new Map();

    function addDeck(deckId, name) {
      if (!decks.has(deckId)) decks.set(deckId, name);
    }

    function addCard(cardId, deckId, deckName, front, back, extra) {
      addDeck(deckId, deckName);
      cards.set(cardId, {
        cardId,
        deckId,
        deckName,
        front: front || cardId,
        back: back || "",
        extra: extra || "",
      });
    }

    getVisibleSRSDeckSources(account).forEach((ds) => {
      if (ds.source === "english" && ds.book) {
        ds.book.units.forEach((unit) => {
          unit.words.forEach((word) => {
            addCard(ds.deckId + ":" + word.word, ds.deckId, ds.deckName, word.word, word.hint || word.definition, word.definition);
          });
        });
      } else if (ds.source === "russian" && ds.book) {
        ds.book.units.forEach((unit) => {
          unit.words.forEach((word) => {
            addCard(ds.deckId + ":" + word.word, ds.deckId, ds.deckName, word.definition || word.hint, word.word, "");
          });
        });
      } else if (ds.source === "custom") {
        ds.words.forEach((word) => {
          addCard(ds.deckId + ":" + word.word, ds.deckId, ds.deckName, word.hint || word.definition, word.word, word.definition);
        });
      } else if (ds.source === "lunyu" && ds.book) {
        ds.book.chapters.forEach((chapter) => {
          chapter.sentences.forEach((sentence) => {
            addCard(ds.deckId + ":" + sentence.id, ds.deckId, "论语 · " + chapter.name, sentence.original, sentence.translation, "");
          });
        });
      }
    });

    return { cards, decks };
  }

  function initCardBrowserPage() {
    const host = document.getElementById("cardBrowserPage");
    if (!host || !window.SRSEngine) return;

    const SRS = window.SRSEngine;
    const account = currentAccount();
    const accountId = account.type === "user" ? account.id : "guest";
    const $ = (id) => document.getElementById(id);
    SRS.clearExpiredBuries(accountId);
    SRS.migrateAll(accountId);

    const flagLabels = ["无", "红", "橙", "绿", "蓝"];
    const flagColors = ["#d9d1c8", "#b94b3f", "#c9822b", "#3d6b5e", "#5a7a9f"];
    const stateLabels = {
      new: "新卡",
      learning: "学习中",
      review: "复习",
      relearning: "重学",
      suspended: "暂停",
      buried: "搁置",
    };

    function dateLabel(value) {
      if (!value) return "现在";
      const delta = value - Date.now();
      if (delta <= 0) return "已到期";
      return SRS.formatInterval(delta, "review");
    }

    function readRows() {
      const catalog = buildCardContentCatalog(account);
      const data = SRS.loadSRSData(accountId);
      Object.keys(data.cardStates).forEach((cardId) => {
        if (!catalog.cards.has(cardId)) {
          const deckId = SRS.cardIdToDeckId(cardId);
          catalog.cards.set(cardId, {
            cardId,
            deckId,
            deckName: catalog.decks.get(deckId) || deckId,
            front: cardId,
            back: "",
            extra: "",
          });
          if (!catalog.decks.has(deckId)) catalog.decks.set(deckId, deckId);
        }
      });
      return Array.from(catalog.cards.values()).map((content) => {
        const card = data.cardStates[content.cardId] || SRS.createNewCard(content.cardId);
        return { ...content, card };
      });
    }

    function effectiveState(card) {
      if (card.suspended) return "suspended";
      if (card.buried) return "buried";
      return card.state || "new";
    }

    function filteredRows() {
      const query = $("browserSearch").value.trim().toLowerCase();
      const deck = $("browserDeck").value;
      const state = $("browserState").value;
      const flag = $("browserFlag").value;
      const tag = $("browserTag").value.trim().toLowerCase();
      return readRows().filter((row) => {
        const haystack = [row.cardId, row.front, row.back, row.extra, (row.card.tags || []).join(" ")].join(" ").toLowerCase();
        if (query && !haystack.includes(query)) return false;
        if (deck !== "all" && row.deckId !== deck) return false;
        if (state !== "all" && effectiveState(row.card) !== state) return false;
        if (flag !== "all" && String(row.card.flags || 0) !== flag) return false;
        if (tag && !(row.card.tags || []).some((item) => item.toLowerCase().includes(tag))) return false;
        return true;
      });
    }

    function renderDeckFilter() {
      const catalog = buildCardContentCatalog(account);
      $("browserDeck").innerHTML = '<option value="all">全部</option>' + Array.from(catalog.decks.entries())
        .map(([id, name]) => `<option value="${escapeHTML(id)}">${escapeHTML(name)}</option>`)
        .join("");
    }

    function renderStats(rows) {
      const counts = rows.reduce((acc, row) => {
        acc.total++;
        acc[effectiveState(row.card)] = (acc[effectiveState(row.card)] || 0) + 1;
        return acc;
      }, { total: 0 });
      $("browserStats").innerHTML = `
        <div class="stat"><div class="n">${counts.total}</div><div class="l">当前卡片</div></div>
        <div class="stat"><div class="n">${counts.new || 0}</div><div class="l">新卡</div></div>
        <div class="stat"><div class="n">${(counts.learning || 0) + (counts.relearning || 0)}</div><div class="l">学习中</div></div>
        <div class="stat"><div class="n">${counts.review || 0}</div><div class="l">复习卡</div></div>
      `;
    }

    function renderRows() {
      const rows = filteredRows();
      renderStats(rows);
      $("browserList").innerHTML = rows.length ? rows.map((row) => {
        const card = row.card;
        const state = effectiveState(card);
        const flag = card.flags || 0;
        const tags = (card.tags || []).join(", ");
        return `
          <article class="browser-card" data-card-id="${escapeHTML(row.cardId)}">
            <div>
              <div class="browser-meta">
                <span class="chip tone">${escapeHTML(row.deckName)}</span>
                <span class="chip">${stateLabels[state] || state}</span>
                <span class="chip" style="color:${flagColors[flag] || flagColors[0]}">标记：${flagLabels[flag] || "无"}</span>
                <span class="chip">间隔：${card.interval || 0} 天</span>
                <span class="chip">到期：${dateLabel(card.due)}</span>
              </div>
              <h3>${richHTML(row.front)}</h3>
              <p>${richHTML(row.back)}</p>
              ${row.extra ? `<p class="hint-text">${richHTML(row.extra)}</p>` : ""}
            </div>
            <div class="browser-actions">
              <button class="btn ghost" data-action="bury" type="button">搁置</button>
              <button class="btn ghost" data-action="${card.suspended ? "unsuspend" : "suspend"}" type="button">${card.suspended ? "恢复" : "暂停"}</button>
              <button class="btn ghost" data-action="reset" type="button">重置</button>
              <select class="input" data-action="flag">
                ${flagLabels.map((label, index) => `<option value="${index}" ${flag === index ? "selected" : ""}>${label}</option>`).join("")}
              </select>
              <button class="btn ghost" data-action="move-up" type="button">提前</button>
              <button class="btn ghost" data-action="move-down" type="button">延后</button>
              <input class="input browser-tags" data-action="tags" value="${escapeHTML(tags)}" placeholder="标签，用逗号分隔" />
            </div>
          </article>
        `;
      }).join("") : '<div class="card empty"><div class="big">卡</div><p>没有符合条件的卡片。</p></div>';
    }

    function siblingNewOrders(cardId) {
      const deckId = SRS.cardIdToDeckId(cardId);
      return readRows()
        .filter((row) => row.deckId === deckId && (row.card.state || "new") === "new")
        .map((row, index) => row.card.newOrder || index);
    }

    function applyAction(cardId, action, value) {
      if (action === "bury") SRS.buryCard(accountId, cardId);
      else if (action === "suspend") SRS.suspendCard(accountId, cardId);
      else if (action === "unsuspend") SRS.unsuspendCard(accountId, cardId);
      else if (action === "reset") SRS.resetCard(accountId, cardId);
      else if (action === "flag") SRS.setCardFlag(accountId, cardId, Number(value) || 0);
      else if (action === "tags") SRS.setCardTags(accountId, cardId, value);
      else if (action === "move-up") SRS.setNewCardOrder(accountId, cardId, Math.min(...siblingNewOrders(cardId), 0) - 1);
      else if (action === "move-down") SRS.setNewCardOrder(accountId, cardId, Math.max(...siblingNewOrders(cardId), 0) + 1);
      renderRows();
    }

    ["browserSearch", "browserDeck", "browserState", "browserFlag", "browserTag"].forEach((id) => {
      $(id).addEventListener("input", renderRows);
      $(id).addEventListener("change", renderRows);
    });
    $("browserReviewTagBtn").addEventListener("click", () => {
      const tag = $("browserTag").value.trim();
      if (!tag) return;
      location.href = "dictation.html?startSrs=1&srsTag=" + encodeURIComponent(tag);
    });
    $("browserReviewFilteredBtn").addEventListener("click", () => {
      const ids = filteredRows().map((row) => row.cardId);
      if (!ids.length) return;
      sessionStorage.setItem("songji-srs-custom-queue", JSON.stringify(ids));
      location.href = "dictation.html?startSrs=1&customSrs=1";
    });
    $("browserExportBtn").addEventListener("click", () => {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        auth: loadAuthStore(),
        srs: SRS.loadSRSData(accountId),
        srsStats: SRS.loadStatsData(accountId) || {},
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `songji-backup-${accountId}-${SRS.todayStr()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });
    $("browserImportBtn").addEventListener("click", () => $("browserImportInput").click());
    $("browserImportInput").addEventListener("change", () => {
      const file = $("browserImportInput").files && $("browserImportInput").files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const payload = JSON.parse(reader.result);
          if (!confirm("导入备份会覆盖当前浏览器中的本地资料和当前资料空间的复习进度。确定继续吗？")) {
            $("browserImportInput").value = "";
            return;
          }
          if (payload.auth && payload.auth.users) {
            authStore = payload.auth;
            saveAuthStore();
          }
          if (payload.srs) SRS.saveSRSData(accountId, payload.srs);
          if (payload.srsStats) SRS.saveStatsData(accountId, payload.srsStats);
          $("browserImportInput").value = "";
          renderDeckFilter();
          renderRows();
        } catch (error) {
          alert("备份文件无法读取。");
        }
      };
      reader.readAsText(file);
    });
    $("browserList").addEventListener("click", (event) => {
      const control = event.target.closest("[data-action]");
      if (!control || control.matches("select,input")) return;
      const card = event.target.closest("[data-card-id]");
      if (card) applyAction(card.dataset.cardId, control.dataset.action);
    });
    $("browserList").addEventListener("change", (event) => {
      const control = event.target.closest("[data-action]");
      const card = event.target.closest("[data-card-id]");
      if (card && control) applyAction(card.dataset.cardId, control.dataset.action, control.value);
    });

    renderDeckFilter();
    renderRows();
  }

  function initStatsPage() {
    const host = document.getElementById("srsStatsPage");
    if (!host || !window.SRSEngine) return;

    const SRS = window.SRSEngine;
    const account = currentAccount();
    const accountId = account.type === "user" ? account.id : "guest";
    SRS.clearExpiredBuries(accountId);
    SRS.migrateAll(accountId);

    const palette = {
      due: "#b5502f",
      new: "#3d6b5e",
      done: "#5a7a9f",
      time: "#8a6f2a",
      learning: "#5a7a9f",
      young: "#b5502f",
      mature: "#3d6b5e",
      suspended: "#8b6f9f",
      empty: "#e8e1da",
    };

    function deckSources() {
      return getVisibleSRSDeckSources(account);
    }

    function cardIdsForSource(ds) {
      return getSRSCardIdsForSource(ds);
    }

    function remainingNewCards() {
      let total = 0;
      deckSources().forEach((ds) => {
        const ids = SRS.getAvailableNewCards(accountId, ds.deckId, cardIdsForSource(ds));
        total += ids.length;
      });
      return total;
    }

    function sourceDeckIds() {
      return new Set(deckSources().map((ds) => ds.deckId));
    }

    function actualStudyCards() {
      const data = SRS.loadSRSData(accountId);
      const deckIds = sourceDeckIds();
      return Object.keys(data.cardStates)
        .filter((cardId) => deckIds.has(SRS.cardIdToDeckId(cardId)))
        .map((cardId) => data.cardStates[cardId])
        .filter(Boolean);
    }

    function renderOverview() {
      const dueCount = SRS.getDueCards(accountId).length;
      const newCount = remainingNewCards();
      const stats = SRS.getTodayStats(accountId);
      const minutes = Math.round((stats.timeMs || 0) / 60000);
      document.getElementById("statsOverview").innerHTML = `
        <div class="stat"><div class="n">${dueCount}</div><div class="l">待复习</div></div>
        <div class="stat"><div class="n">${newCount}</div><div class="l">未学卡片</div></div>
        <div class="stat"><div class="n">${stats.reviews}</div><div class="l">难度评分</div></div>
        <div class="stat"><div class="n">${minutes}</div><div class="l">今日用时</div></div>
      `;
    }

    function renderBarChart(targetId, forecast) {
      const target = document.getElementById(targetId);
      const max = Math.max(1, ...forecast.map((item) => item.count));
      if (!forecast.some((item) => item.count > 0)) {
        target.innerHTML = '<div class="chart-empty">暂无即将到期的卡片</div>';
        return;
      }
      const width = 640;
      const height = 220;
      const pad = 28;
      const gap = forecast.length > 10 ? 3 : 10;
      const barW = (width - pad * 2 - gap * (forecast.length - 1)) / forecast.length;
      const bars = forecast.map((item, index) => {
        const h = Math.max(2, Math.round((height - 60) * item.count / max));
        const x = pad + index * (barW + gap);
        const y = height - 32 - h;
        const label = item.date.slice(5).replace("-", "/");
        const showLabel = forecast.length <= 7 || index % 5 === 0;
        return `
          <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${palette.due}"></rect>
          <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="11" fill="#6f6259">${item.count}</text>
          ${showLabel ? `<text x="${x + barW / 2}" y="${height - 10}" text-anchor="middle" font-size="10" fill="#9b8f85">${label}</text>` : ""}
        `;
      }).join("");
      target.innerHTML = `
        <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="复习预测柱状图">
          <line x1="${pad}" y1="${height - 32}" x2="${width - pad}" y2="${height - 32}" stroke="#e4ddd5"></line>
          ${bars}
        </svg>
      `;
    }

    function stateDistribution() {
      const counts = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
      actualStudyCards().forEach((card) => {
        if (card.suspended) {
          counts.suspended++;
        } else if (!card.state || card.state === "new") {
          counts.new++;
        } else if (card.state === "learning" || card.state === "relearning") {
          counts.learning++;
        } else if (card.state === "review" && card.interval >= 21) {
          counts.mature++;
        } else if (card.state === "review") {
          counts.young++;
        }
      });
      return [
        { key: "new", label: "新卡", count: counts.new, color: palette.new },
        { key: "learning", label: "学习中", count: counts.learning, color: palette.learning },
        { key: "young", label: "年幼", count: counts.young, color: palette.due },
        { key: "mature", label: "成熟", count: counts.mature, color: palette.mature },
        { key: "suspended", label: "暂停", count: counts.suspended, color: palette.suspended },
      ];
    }

    function pieSlice(cx, cy, r, start, end, color) {
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const large = end - start > Math.PI ? 1 : 0;
      return `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}"></path>`;
    }

    function renderDistribution() {
      const items = stateDistribution();
      const total = items.reduce((sum, item) => sum + item.count, 0);
      let angle = -Math.PI / 2;
      const slices = total
        ? items.map((item) => {
            const next = angle + (Math.PI * 2 * item.count / total);
            const slice = item.count ? pieSlice(100, 100, 82, angle, next, item.color) : "";
            angle = next;
            return slice;
          }).join("")
        : `<circle cx="100" cy="100" r="82" fill="${palette.empty}"></circle>`;
      document.getElementById("statePie").innerHTML = `
        <svg class="pie-svg" viewBox="0 0 200 200" role="img" aria-label="卡片状态分布饼图">
          ${slices}
          <circle cx="100" cy="100" r="46" fill="#fffaf5"></circle>
          <text x="100" y="96" text-anchor="middle" font-size="26" font-weight="700" fill="#2f2924">${total}</text>
          <text x="100" y="118" text-anchor="middle" font-size="12" fill="#8f8378">总卡片</text>
        </svg>
      `;
      document.getElementById("stateLegend").innerHTML = items.map((item) => `
        <div class="legend-item">
          <span class="legend-dot" style="background:${item.color}"></span>
          <span>${item.label}</span>
          <strong>${item.count}</strong>
        </div>
      `).join("");
    }

    function renderRetention() {
      const stats = SRS.getTodayStats(accountId);
      const rate = stats.masteryRate || 0;
      const circumference = 2 * Math.PI * 70;
      const offset = circumference * (1 - rate / 100);
      const minutes = Math.round((stats.timeMs || 0) / 60000);
      document.getElementById("retentionPanel").innerHTML = `
        <div class="retention-meter">
          <svg class="retention-ring" viewBox="0 0 180 180" role="img" aria-label="今日掌握率">
            <circle cx="90" cy="90" r="70" fill="none" stroke="#e8e1da" stroke-width="16"></circle>
            <circle cx="90" cy="90" r="70" fill="none" stroke="${palette.mature}" stroke-width="16"
              stroke-linecap="round" stroke-dasharray="${circumference.toFixed(2)}"
              stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 90 90)"></circle>
            <text x="90" y="86" text-anchor="middle" font-size="32" font-weight="700" fill="#2f2924">${rate}%</text>
            <text x="90" y="110" text-anchor="middle" font-size="12" fill="#8f8378">掌握率</text>
          </svg>
          <div class="retention-copy">
            <div class="mini-stat"><strong>${stats.hard}</strong><span>困难</span></div>
            <div class="mini-stat"><strong>${stats.good}</strong><span>良好</span></div>
            <div class="mini-stat"><strong>${stats.easy}</strong><span>简单</span></div>
            <div class="mini-stat"><strong>${stats.repeats}</strong><span>再看</span></div>
            <div class="mini-stat"><strong>${stats.newCards}</strong><span>已学新卡</span></div>
            <div class="mini-stat"><strong>${minutes}</strong><span>复习分钟</span></div>
          </div>
        </div>
      `;
    }

    renderOverview();
    renderBarChart("forecast7", SRS.getForecast(accountId, 7));
    renderBarChart("forecast30", SRS.getForecast(accountId, 30));
    renderDistribution();
    renderRetention();
  }

  /* ===== 首页 SRS 统计更新 ===== */
  function initHomePage() {
    const statsHost = document.querySelector("section.stats");
    if (!statsHost || !window.SRSEngine) return;
    const accountId = currentAccount().type === "user" ? currentAccount().id : "guest";
    const SRS = window.SRSEngine;
    SRS.clearExpiredBuries(accountId);
    SRS.migrateAll(accountId);

    function homeDeckSources() {
      return getVisibleSRSDeckSources(currentAccount());
    }

    function homeCardIds(ds) {
      return getSRSCardIdsForSource(ds);
    }

    const queue = SRS.getDueCards(accountId).map(function (card) { return card.cardId; });
    const dueOnlyCount = queue.length;
    const queued = new Set(queue);
    const seenNew = new Set();
    let newCount = 0;
    homeDeckSources().forEach(function (ds) {
      const newIds = SRS.getAvailableNewCards(
        accountId,
        ds.deckId,
        homeCardIds(ds)
      );
      newIds.forEach(function (id) {
        if (!queued.has(id) && !seenNew.has(id)) {
          seenNew.add(id);
          newCount++;
        }
      });
    });
    const dueCount = dueOnlyCount;
    const todayStats = SRS.getTodayStats(accountId);
    const streak = SRS.getStreak(accountId);

    // 更新首页统计数字
    const statEls = statsHost.querySelectorAll(".stat");
    const homeSrsBtn = document.getElementById("homeSrsBtn");
    if (homeSrsBtn) {
      homeSrsBtn.querySelector(".n").textContent = dueCount > 0 ? dueCount : "0";
      homeSrsBtn.disabled = dueCount === 0;
      homeSrsBtn.querySelector(".l").textContent = dueOnlyCount > 0 ? "今日待复习" : newCount > 0 ? "选择单元学习新卡" : "今日待复习";
      homeSrsBtn.addEventListener("click", function () {
        location.href = "dictation.html?startSrs=1";
      });
    }
    // 其余统计
    if (statEls.length >= 4) {
      for (var i = 1; i < statEls.length; i++) {
        var nEl = statEls[i].querySelector(".n");
        if (!nEl) continue;
        if (i === 1) nEl.textContent = todayStats.reviews || "0";
        else if (i === 2) nEl.textContent = streak || "0";
        else if (i === 3) nEl.textContent = todayStats.masteryRate ? todayStats.masteryRate + "%" : "—";
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    let userInteracted = false;
    ["pointerdown", "keydown"].forEach((eventName) => {
      document.addEventListener(
        eventName,
        () => {
          userInteracted = true;
        },
        { once: true, capture: true },
      );
    });

    renderTopbar();
    bindTagRows();
    initHomePage();
    initForeignDictation();
    initCustomProjectPage();
    initProfilePage();
    initLunyuPage();
    initStatsPage();
    initCardBrowserPage();
    hydrateRemoteAuthStore().then((sessionChanged) => {
      if (sessionChanged && !userInteracted) location.reload();
      else if (sessionChanged) renderTopbar();
    });
  });
})();

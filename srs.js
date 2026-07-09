(function () {
  'use strict';

  /* ========== 常量 ========== */
  var DAY_MS = 86400000;  // 24 * 60 * 60 * 1000
  var MIN_MS = 60000;     // 60 * 1000
  var SRS_KEY_PREFIX = 'songji-srs-v1:';
  var STATS_KEY_SUFFIX = ':stats';
  var MIGRATION_FLAG_KEY = 'songji-srs-migrated-v1';

  /* ========== 默认配置 ========== */
  var DEFAULT_CONFIG = {
    // 学习步阶（分钟）：新卡依次通过 1min → 10min，答对即毕业为 review
    learningSteps: [1, 10],
    // 遗忘重学步阶（分钟）：保留给旧数据和手动重学；当前学习按钮不再把"再看"当熟悉等级
    relearningSteps: [10],
    // Good 毕业间隔（天）
    graduatingIntervalGood: 1,
    // Easy 毕业间隔（天）
    graduatingIntervalEasy: 4,
    // Easy 间隔乘数
    easyBonus: 1.3,
    // Hard 间隔乘数
    hardMultiplier: 1.2,
    // 遗忘后的间隔乘数（Anki 默认 0，即重置到 1 天）
    lapseIntervalMultiplier: 0,
    // 易度因子惩罚（遗忘）
    lapseEasePenalty: 0.2,
    // 易度因子惩罚（困难）
    hardEasePenalty: 0.15,
    // 易度因子奖励（简单）
    easyEaseBonus: 0.15,
    // 最小易度因子
    minimumEase: 1.3,
    // 最大易度因子
    maximumEase: 3.0,
    // 用户主动学习不设每日新卡上限；保留字段用于兼容旧配置导入
    newCardsPerDay: Number.MAX_SAFE_INTEGER,
    // 每日复习上限
    maximumReviewsPerDay: 200,
    // 全局间隔修正系数
    intervalModifier: 1.0,
    // 新卡出牌顺序：'sequence' 按添加顺序，'random' 随机
    newCardOrder: 'sequence'
  };

  /* ========== 卡片工厂 ========== */

  /**
   * 创建一张新卡的 SRS 状态对象
   * @param {string} cardId - 统一卡片 ID，格式 "source:deckId:cardIndex"
   * @returns {object} SRS 状态
   */
  function createNewCard(cardId) {
    return {
      cardId: cardId,
      state: 'new',       // 'new' | 'learning' | 'review' | 'relearning'
      due: 0,             // new 卡始终到期（due=0 表示立即可复习）
      interval: 0,        // 间隔天数（learning 时为 0）
      ease: 2.5,          // 初始易度因子（与 Anki 一致）
      reps: 0,            // 总复习次数
      lapses: 0,          // 遗忘次数（兼容旧 Again 调度数据）
      stepIdx: 0,         // 当前学习步阶索引
      lastReview: 0,      // 上次复习时间戳 (ms)
      flags: 0,           // 0=无, 1=红, 2=橙, 3=绿, 4=蓝
      suspended: false,   // 是否暂停
      buried: false,      // 是否搁置（仅当天）
      buriedUntil: 0,     // 搁置到期时间戳
      tags: [],           // 标签列表
      newOrder: 0         // 新卡排序权重（越小越靠前）
    };
  }

  /* ========== SM-2 间隔重复算法 ========== */

  /**
   * 核心调度函数：根据卡片当前状态和评分，计算下一次复习安排
   * 纯函数，不修改原对象，返回新的状态对象
   *
   * @param {object} card - 卡片 SRS 状态（将被浅拷贝）
   * @param {string} grade - 评分: 'hard' | 'good' | 'easy'；'again' 仅为旧数据兼容
   * @param {object} [config] - 配置（缺省用 DEFAULT_CONFIG）
   * @returns {object} 更新后的卡片状态
   */
  function schedule(card, grade, config) {
    if (!config) config = DEFAULT_CONFIG;
    var now = Date.now();
    var c = shallowClone(card);
    c.lastReview = now;
    c.reps++;

    var steps, stepMin;

    switch (c.state) {

      /* --- 新卡 --- */
      case 'new':
        steps = config.learningSteps;
        if (grade === 'again') {
          c.state = 'learning';
          c.stepIdx = 0;
          c.due = now + steps[0] * MIN_MS;
        } else if (grade === 'hard') {
          c.state = 'learning';
          c.stepIdx = 0;
          // Hard 在第一步停留，间隔为第一步的 1.5 倍
          stepMin = Math.round(steps[0] * 1.5);
          c.due = now + stepMin * MIN_MS;
        } else if (grade === 'good') {
          if (steps.length > 1) {
            c.state = 'learning';
            c.stepIdx = 1;
            c.due = now + steps[1] * MIN_MS;
          } else {
            // 只有一步，直接毕业
            graduate(c, config.graduatingIntervalGood, now, config);
          }
        } else if (grade === 'easy') {
          graduate(c, config.graduatingIntervalEasy, now, config);
          c.ease = clampEase(c.ease + config.easyEaseBonus, config);
        }
        break;

      /* --- 学习步阶中 --- */
      case 'learning':
        steps = config.learningSteps;
        if (grade === 'again') {
          c.stepIdx = 0;
          c.due = now + steps[0] * MIN_MS;
        } else if (grade === 'hard') {
          // Hard：停留在当前步阶，重复
          c.due = now + steps[c.stepIdx] * MIN_MS;
        } else if (grade === 'good') {
          c.stepIdx++;
          if (c.stepIdx >= steps.length) {
            graduate(c, config.graduatingIntervalGood, now, config);
          } else {
            c.due = now + steps[c.stepIdx] * MIN_MS;
          }
        } else if (grade === 'easy') {
          graduate(c, config.graduatingIntervalEasy, now, config);
          c.ease = clampEase(c.ease + config.easyEaseBonus, config);
        }
        break;

      /* --- 复习（间隔模式） --- */
      case 'review':
        if (grade === 'again') {
          c.lapses++;
          c.ease = clampEase(c.ease - config.lapseEasePenalty, config);
          c.state = 'relearning';
          c.stepIdx = 0;
          c.due = now + config.relearningSteps[0] * MIN_MS;
        } else if (grade === 'hard') {
          c.interval = applyInterval(
            Math.max(Math.round(c.interval * config.hardMultiplier), 1),
            config
          );
          c.ease = clampEase(c.ease - config.hardEasePenalty, config);
          c.due = now + c.interval * DAY_MS;
        } else if (grade === 'good') {
          c.interval = applyInterval(
            Math.max(Math.round(c.interval * c.ease), 1),
            config
          );
          c.due = now + c.interval * DAY_MS;
        } else if (grade === 'easy') {
          c.interval = applyInterval(
            Math.max(Math.round(c.interval * c.ease * config.easyBonus), 1),
            config
          );
          c.ease = clampEase(c.ease + config.easyEaseBonus, config);
          c.due = now + c.interval * DAY_MS;
        }
        break;

      /* --- 遗忘重学 --- */
      case 'relearning':
        steps = config.relearningSteps;
        if (grade === 'again') {
          c.stepIdx = 0;
          c.due = now + steps[0] * MIN_MS;
        } else if (grade === 'hard') {
          c.due = now + steps[c.stepIdx] * MIN_MS;
        } else if (grade === 'good') {
          c.stepIdx++;
          if (c.stepIdx >= steps.length) {
            // 重学毕业：间隔为 max(1, 旧间隔 × lapseIntervalMultiplier)
            var lapseInt = Math.max(1, Math.round(card.interval * config.lapseIntervalMultiplier));
            c.interval = applyInterval(lapseInt, config);
            c.state = 'review';
            c.due = now + c.interval * DAY_MS;
          } else {
            c.due = now + steps[c.stepIdx] * MIN_MS;
          }
        } else if (grade === 'easy') {
          // 直接毕业，间隔更高
          c.interval = applyInterval(
            Math.max(Math.round(card.interval * c.ease * config.easyBonus), 2),
            config
          );
          c.state = 'review';
          c.due = now + c.interval * DAY_MS;
          c.ease = clampEase(c.ease + config.easyEaseBonus, config);
        }
        break;
    }

    return c;
  }

  /* --- 辅助：毕业 --- */
  function graduate(c, intervalDays, now, config) {
    c.state = 'review';
    c.interval = applyInterval(intervalDays, config);
    c.due = now + c.interval * DAY_MS;
    c.stepIdx = 0;
  }

  /* --- 辅助：间隔修正 --- */
  function applyInterval(rawDays, config) {
    return Math.max(1, Math.round(rawDays * config.intervalModifier));
  }

  /* --- 辅助：易度因子范围限制 --- */
  function clampEase(ease, config) {
    return Math.max(config.minimumEase, Math.min(config.maximumEase, ease));
  }

  /* --- 辅助：浅拷贝 --- */
  function shallowClone(obj) {
    var out = {};
    for (var k in obj) {
      if (obj.hasOwnProperty(k)) out[k] = obj[k];
    }
    return out;
  }

  /* ========== 间隔预览 ========== */

  /**
   * 预览四个评分按钮的调度结果，用于 UI 显示
   * @param {object} card - 当前卡片状态
   * @param {object} [config] - 配置
   * @returns {object} { again: {label, interval, state}, hard: ..., good: ..., easy: ... }
   */
  function previewIntervals(card, config) {
    if (!config) config = DEFAULT_CONFIG;
    var grades = ['again', 'hard', 'good', 'easy'];
    var preview = {};
    var now = Date.now();

    for (var i = 0; i < grades.length; i++) {
      var grade = grades[i];
      var simulated = schedule(shallowClone(card), grade, config);
      var msFromNow = simulated.due - now;
      preview[grade] = {
        label: formatInterval(msFromNow, simulated.state),
        interval: simulated.interval,
        state: simulated.state,
        ease: simulated.ease
      };
    }

    return preview;
  }

  /* ========== 间隔格式化 ========== */

  /**
   * 将毫秒间隔转为人类可读文本
   * @param {number} msFromNow - 距下次复习的毫秒数
   * @param {string} state - 目标状态（learning 用分钟，review 用天数）
   * @returns {string} 如 "10 分钟"、"1 天"、"3 月"
   */
  function formatInterval(msFromNow, state) {
    if (msFromNow <= 0) return '现在';

    if (state === 'learning' || state === 'relearning') {
      var minutes = Math.round(msFromNow / MIN_MS);
      if (minutes < 60) return minutes + ' 分钟';
      var hours = Math.round(minutes / 60);
      return hours + ' 小时';
    }

    var days = Math.round(msFromNow / DAY_MS);
    if (days < 1) return '<1 天';
    if (days <= 31) return days + ' 天';
    if (days <= 365) return Math.round(days / 30) + ' 月';
    return Math.round(days / 365) + ' 年';
  }

  /* ========== 内存缓存 ========== */

  var _srsCache = {};      // accountId → parsed SRS data
  var _srsStatsCache = {}; // accountId → parsed stats data
  var _srsCacheDirty = {}; // accountId → true if saveSRSData was called (cache stale)

  /** 清除指定账户的 SRS 内存缓存（saveSRSData 后自动调用） */
  function invalidateSRSCache(accountId) {
    delete _srsCache[accountId];
    delete _srsStatsCache[accountId];
    _srsCacheDirty[accountId] = true;
  }

  /* ========== 存储层 ========== */

  /**
   * 加载某账户的全部 SRS 数据（带内存缓存，减少 localStorage 读取）
   * @param {string} accountId - 账户 ID
   * @returns {object} { cardStates, config, stats, deckNewToday }
   */
  function loadSRSData(accountId) {
    // 缓存命中且未过期时直接返回
    if (_srsCache[accountId] && !_srsCacheDirty[accountId]) {
      return _srsCache[accountId];
    }

    try {
      var raw = localStorage.getItem(SRS_KEY_PREFIX + accountId);
      if (!raw) {
        var empty = createEmptySRSData();
        empty.stats = loadStatsData(accountId) || {};
        _srsCache[accountId] = empty;
        _srsCacheDirty[accountId] = false;
        return empty;
      }
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        var empty = createEmptySRSData();
        _srsCache[accountId] = empty;
        _srsCacheDirty[accountId] = false;
        return empty;
      }
      // 确保结构完整
      parsed.cardStates = parsed.cardStates || {};
      parsed.config = parsed.config || { global: DEFAULT_CONFIG, decks: {} };
      parsed.stats = loadStatsData(accountId) || parsed.stats || {};
      parsed.deckNewToday = parsed.deckNewToday || {};
      _srsCache[accountId] = parsed;
      _srsCacheDirty[accountId] = false;
      return parsed;
    } catch (e) {
      var empty = createEmptySRSData();
      _srsCache[accountId] = empty;
      _srsCacheDirty[accountId] = false;
      return empty;
    }
  }

  function createEmptySRSData() {
    return {
      cardStates: {},
      config: { global: DEFAULT_CONFIG, decks: {} },
      stats: {},
      deckNewToday: {}
    };
  }

  function createEmptyDayStats() {
    return { reviews: 0, correct: 0, newCards: 0, timeMs: 0, repeats: 0, hard: 0, good: 0, easy: 0 };
  }

  function normalizeDayStats(stats) {
    if (!stats || typeof stats !== 'object') return createEmptyDayStats();
    if (typeof stats.reviews !== 'number') stats.reviews = 0;
    if (typeof stats.correct !== 'number') stats.correct = 0;
    if (typeof stats.newCards !== 'number') stats.newCards = 0;
    if (typeof stats.timeMs !== 'number') stats.timeMs = 0;
    if (typeof stats.repeats !== 'number') stats.repeats = 0;
    if (typeof stats.hard !== 'number') stats.hard = 0;
    if (typeof stats.good !== 'number') stats.good = 0;
    if (typeof stats.easy !== 'number') stats.easy = 0;
    return stats;
  }

  /**
   * 保存某账户的全部 SRS 数据
   * @param {string} accountId
   * @param {object} data - loadSRSData 返回的结构
   */
  function saveSRSData(accountId, data) {
    try {
      localStorage.setItem(SRS_KEY_PREFIX + accountId, JSON.stringify(data));
      saveStatsData(accountId, data.stats || {});
      // 更新缓存而非失效：保存后缓存中的数据就是最新的
      _srsCache[accountId] = data;
      _srsCacheDirty[accountId] = false;
    } catch (e) {
      // 存储满时静默失败，页面仍可运行
      // 失败时标记缓存脏，下次读取会从 localStorage 重新加载
      invalidateSRSCache(accountId);
    }
  }

  /**
   * 加载独立统计数据（songji-srs-v1:{accountId}:stats）
   * @param {string} accountId
   * @returns {object|null}
   */
  function loadStatsData(accountId) {
    // 缓存命中且未过期时直接返回
    if (_srsStatsCache[accountId] && !_srsCacheDirty[accountId]) {
      return _srsStatsCache[accountId];
    }

    try {
      var raw = localStorage.getItem(SRS_KEY_PREFIX + accountId + STATS_KEY_SUFFIX);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var result = parsed && typeof parsed === 'object' ? parsed : null;
      _srsStatsCache[accountId] = result;
      return result;
    } catch (e) {
      return null;
    }
  }

  function saveStatsData(accountId, stats) {
    try {
      localStorage.setItem(SRS_KEY_PREFIX + accountId + STATS_KEY_SUFFIX, JSON.stringify(stats || {}));
      _srsStatsCache[accountId] = stats || {};
    } catch (e) {
      // 统计写入失败时不影响复习主流程
    }
  }

  /* ========== 卡片状态读写 ========== */

  /**
   * 获取一张卡的 SRS 状态，不存在则自动创建 new 卡
   * @param {string} accountId
   * @param {string} cardId
   * @returns {object} 卡片状态
   */
  function getCardState(accountId, cardId) {
    var data = loadSRSData(accountId);
    if (data.cardStates[cardId]) return data.cardStates[cardId];
    return createNewCard(cardId);
  }

  /**
   * 直接写入一张卡片的 SRS 状态
   * @param {string} accountId
   * @param {string} cardId
   * @param {object} cardState
   */
  function setCardState(accountId, cardId, cardState) {
    var data = loadSRSData(accountId);
    data.cardStates[cardId] = cardState || createNewCard(cardId);
    saveSRSData(accountId, data);
  }

  /**
   * 复习后更新卡片状态（核心调用）
   * @param {string} accountId
   * @param {string} cardId
   * @param {string} grade - 'hard' | 'good' | 'easy'；'again' 仅为旧数据兼容
   * @param {object} [deckConfig] - 牌组级配置覆盖
   * @returns {object} 更新后的卡片状态
   */
  function reviewCard(accountId, cardId, grade, deckConfig) {
    if (grade === 'again') {
      return repeatCard(accountId, cardId);
    }
    var data = loadSRSData(accountId);
    var card = data.cardStates[cardId] || createNewCard(cardId);
    var config = resolveConfig(cardId, data.config, deckConfig);

    // 判断是否为"新卡首次见到"，用于统计今日新卡数
    var wasNew = card.state === 'new';

    var updated = schedule(card, grade, config);
    data.cardStates[cardId] = updated;

    // 统计
    var today = todayStr();
    if (!data.stats[today]) {
      data.stats[today] = createEmptyDayStats();
    }
    normalizeDayStats(data.stats[today]);
    data.stats[today].reviews++;
    if (grade === 'good' || grade === 'easy') data.stats[today].correct++;
    if (grade === 'hard') data.stats[today].hard++;
    if (grade === 'good') data.stats[today].good++;
    if (grade === 'easy') data.stats[today].easy++;
    if (wasNew) {
      data.stats[today].newCards++;
      // 按牌组记录今日新卡数
      var deckId = cardIdToDeckId(cardId);
      if (!data.deckNewToday[deckId]) data.deckNewToday[deckId] = 0;
      data.deckNewToday[deckId]++;
    }

    // 清除搁置（复习后自动解除）
    if (updated.buried) {
      updated.buried = false;
      updated.buriedUntil = 0;
    }

    saveSRSData(accountId, data);
    return updated;
  }

  /**
   * "再看"只代表会话内重复当前卡，不改变熟悉度、不推进调度、不计入评分。
   * @param {string} accountId
   * @param {string} cardId
   * @returns {object}
   */
  function repeatCard(accountId, cardId) {
    var data = loadSRSData(accountId);
    var card = data.cardStates[cardId] || createNewCard(cardId);
    var today = todayStr();
    if (!data.stats[today]) data.stats[today] = createEmptyDayStats();
    normalizeDayStats(data.stats[today]);
    data.stats[today].repeats++;
    data.cardStates[cardId] = card;
    saveSRSData(accountId, data);
    return card;
  }

  /* ========== 配置管理 ========== */

  /**
   * 解析某卡片的生效配置：牌组配置 → 全局配置 → DEFAULT_CONFIG
   * @param {string} cardId
   * @param {object} storedConfig - { global, decks }
   * @param {object} [override] - 运行时覆盖
   * @returns {object} 合并后的配置
   */
  function resolveConfig(cardId, storedConfig, override) {
    var deckId = cardIdToDeckId(cardId);
    var base = storedConfig && storedConfig.global ? storedConfig.global : DEFAULT_CONFIG;
    var deckConf = storedConfig && storedConfig.decks && storedConfig.decks[deckId];
    var result = mergeConfig(base, deckConf || {});
    if (override) result = mergeConfig(result, override);
    return result;
  }

  /**
   * 获取全局配置
   * @param {string} accountId
   * @returns {object}
   */
  function getGlobalConfig(accountId) {
    var data = loadSRSData(accountId);
    return data.config.global || DEFAULT_CONFIG;
  }

  /**
   * 设置全局配置（浅合并）
   * @param {string} accountId
   * @param {object} overrides
   */
  function setGlobalConfig(accountId, overrides) {
    var data = loadSRSData(accountId);
    data.config.global = mergeConfig(data.config.global || DEFAULT_CONFIG, overrides);
    saveSRSData(accountId, data);
  }

  /**
   * 获取牌组级配置
   * @param {string} accountId
   * @param {string} deckId
   * @returns {object|null}
   */
  function getDeckConfig(accountId, deckId) {
    var data = loadSRSData(accountId);
    return data.config.decks && data.config.decks[deckId] || null;
  }

  /**
   * 设置牌组级配置
   * @param {string} accountId
   * @param {string} deckId
   * @param {object} overrides
   */
  function setDeckConfig(accountId, deckId, overrides) {
    var data = loadSRSData(accountId);
    if (!data.config.decks) data.config.decks = {};
    data.config.decks[deckId] = mergeConfig(data.config.decks[deckId] || {}, overrides);
    saveSRSData(accountId, data);
  }

  /* --- 辅助：配置合并（只覆盖提供的字段） --- */
  function mergeConfig(base, overrides) {
    var out = {};
    for (var k in DEFAULT_CONFIG) {
      out[k] = (overrides && overrides.hasOwnProperty(k)) ? overrides[k] :
                (base && base.hasOwnProperty(k)) ? base[k] : DEFAULT_CONFIG[k];
    }
    return out;
  }

  /* ========== 队列辅助 ========== */

  /**
   * 获取到期复习卡列表（learning + relearning + review）
   * 不含新卡（新卡由学习入口主动加入）
   *
   * @param {string} accountId
   * @param {string} [deckId] - 留空则返回所有牌组
   * @returns {Array} 到期卡片列表，按优先级排序
   */
  function getDueCards(accountId, deckId) {
    var data = loadSRSData(accountId);
    var now = Date.now();
    var cards = [];

    for (var id in data.cardStates) {
      var c = data.cardStates[id];
      if (c.suspended || c.buried) continue;
      if (deckId && cardIdToDeckId(id) !== deckId) continue;
      if (c.state === 'new') continue;
      if (c.due <= now) cards.push(c);
    }

    // 排序：learning/relearning 优先，然后按到期时间升序
    cards.sort(function (a, b) {
      var aLearning = (a.state === 'learning' || a.state === 'relearning') ? 0 : 1;
      var bLearning = (b.state === 'learning' || b.state === 'relearning') ? 0 : 1;
      if (aLearning !== bLearning) return aLearning - bLearning;
      return a.due - b.due;
    });

    return cards;
  }

  /**
   * 计算某牌组还能引入多少新卡。
   * 当前产品逻辑不限制主动学习，因此返回无限名额；函数保留用于兼容旧调用。
   * @param {string} accountId
   * @param {string} deckId
   * @param {number} [reservedGlobal=0] - 兼容旧调用，当前不参与限制
   * @param {number} [reservedDeck=0] - 兼容旧调用，当前不参与限制
   * @returns {number} 剩余新卡名额
   */
  function getNewCardSlots(accountId, deckId, reservedGlobal, reservedDeck) {
    return Number.MAX_SAFE_INTEGER;
  }

  /**
   * 获取某牌组中尚未开始学习的卡片 ID 列表
   * 用于 UI 确定哪些卡片可以作为"新卡"加入今日队列
   *
   * @param {string} accountId
   * @param {string} deckId
   * @param {Array} allCardIds - 该牌组所有卡片 ID（由牌组数据提供）
   * @param {number} [reservedGlobal=0] - 兼容旧调用，当前不参与限制
   * @param {number} [reservedDeck=0] - 兼容旧调用，当前不参与限制
   * @returns {Array} 尚未学习的新卡 ID
   */
  function getAvailableNewCards(accountId, deckId, allCardIds, reservedGlobal, reservedDeck) {
    var data = loadSRSData(accountId);
    var config = resolveConfig(deckId + ':0', data.config);
    var newCards = [];

    for (var i = 0; i < allCardIds.length; i++) {
      var cardId = allCardIds[i];
      var state = data.cardStates[cardId];
      if (!state || (state.state === 'new' && !state.suspended && !state.buried)) {
        newCards.push({ id: cardId, order: state && state.newOrder || 0, original: i });
      }
    }

    newCards.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return a.original - b.original;
    });
    newCards = newCards.map(function (item) { return item.id; });

    // 随机顺序
    if (config.newCardOrder === 'random') {
      shuffleArray(newCards);
    }

    return newCards;
  }

  /**
   * 搁置卡片（当天不再出现，明天恢复）
   * @param {string} accountId
   * @param {string} cardId
   */
  function buryCard(accountId, cardId) {
    var data = loadSRSData(accountId);
    var c = data.cardStates[cardId];
    if (!c) {
      c = createNewCard(cardId);
      data.cardStates[cardId] = c;
    }
    c.buried = true;
    c.buriedUntil = tomorrowStart();
    saveSRSData(accountId, data);
  }

  /**
   * 暂停卡片（无限期隐藏，需手动恢复）
   * @param {string} accountId
   * @param {string} cardId
   */
  function suspendCard(accountId, cardId) {
    var data = loadSRSData(accountId);
    var c = data.cardStates[cardId];
    if (!c) {
      c = createNewCard(cardId);
      data.cardStates[cardId] = c;
    }
    c.suspended = true;
    saveSRSData(accountId, data);
  }

  /**
   * 恢复暂停的卡片
   * @param {string} accountId
   * @param {string} cardId
   */
  function unsuspendCard(accountId, cardId) {
    var data = loadSRSData(accountId);
    var c = data.cardStates[cardId];
    if (!c) return;
    c.suspended = false;
    saveSRSData(accountId, data);
  }

  /**
   * 设置卡片标记（0=无, 1=红, 2=橙, 3=绿, 4=蓝）
   * @param {string} accountId
   * @param {string} cardId
   * @param {number} flag - 0~4
   */
  function setCardFlag(accountId, cardId, flag) {
    var data = loadSRSData(accountId);
    var c = data.cardStates[cardId];
    if (!c) {
      c = createNewCard(cardId);
      data.cardStates[cardId] = c;
    }
    c.flags = flag;
    saveSRSData(accountId, data);
  }

  /**
   * 设置卡片标签
   * @param {string} accountId
   * @param {string} cardId
   * @param {Array|string} tags
   */
  function setCardTags(accountId, cardId, tags) {
    var data = loadSRSData(accountId);
    var c = data.cardStates[cardId];
    if (!c) {
      c = createNewCard(cardId);
      data.cardStates[cardId] = c;
    }
    if (typeof tags === 'string') {
      tags = tags.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean);
    }
    c.tags = Array.isArray(tags) ? tags : [];
    saveSRSData(accountId, data);
  }

  /**
   * 设置新卡排序权重
   * @param {string} accountId
   * @param {string} cardId
   * @param {number} order
   */
  function setNewCardOrder(accountId, cardId, order) {
    var data = loadSRSData(accountId);
    var c = data.cardStates[cardId];
    if (!c) {
      c = createNewCard(cardId);
      data.cardStates[cardId] = c;
    }
    c.newOrder = Number(order) || 0;
    saveSRSData(accountId, data);
  }

  /**
   * 重置卡片进度（恢复为 new 状态）
   * @param {string} accountId
   * @param {string} cardId
   */
  function resetCard(accountId, cardId) {
    var data = loadSRSData(accountId);
    data.cardStates[cardId] = createNewCard(cardId);
    saveSRSData(accountId, data);
  }

  /**
   * 设置卡片到期时间
   * @param {string} accountId
   * @param {string} cardId
   * @param {number} dueTime - 时间戳(ms)
   */
  function setDueDate(accountId, cardId, dueTime) {
    var data = loadSRSData(accountId);
    var c = data.cardStates[cardId];
    if (!c) {
      c = createNewCard(cardId);
      data.cardStates[cardId] = c;
    }
    c.due = dueTime;
    c.state = 'review';
    c.stepIdx = 0;
    if (!c.interval || c.interval < 1) {
      c.interval = Math.max(1, Math.round((dueTime - Date.now()) / DAY_MS));
    }
    saveSRSData(accountId, data);
  }

  /**
   * 删除一张卡片的 SRS 状态
   * @param {string} accountId
   * @param {string} cardId
   */
  function deleteCardState(accountId, cardId) {
    var data = loadSRSData(accountId);
    delete data.cardStates[cardId];
    saveSRSData(accountId, data);
  }

  /* ========== 统计 ========== */

  /**
   * 获取今日统计
   * @param {string} accountId
   * @returns {object} { reviews, correct, newCards, timeMs, retentionRate }
   */
  function getTodayStats(accountId) {
    var data = loadSRSData(accountId);
    var today = todayStr();
    var s = normalizeDayStats(data.stats[today] || createEmptyDayStats());
    return {
      reviews: s.reviews,
      correct: s.correct,
      newCards: s.newCards,
      timeMs: s.timeMs,
      repeats: s.repeats,
      hard: s.hard,
      good: s.good,
      easy: s.easy,
      retentionRate: s.reviews > 0 ? Math.round(s.correct / s.reviews * 100) : 0,
      masteryRate: s.reviews > 0 ? Math.round((s.good + s.easy) / s.reviews * 100) : 0
    };
  }

  /**
   * 获取某牌组的卡片状态分布
   * @param {string} accountId
   * @param {string} deckId
   * @returns {object} { new, learning, review, relearning, suspended, buried, mature, young }
   */
  function getDeckStateCounts(accountId, deckId) {
    var data = loadSRSData(accountId);
    var counts = {
      new: 0, learning: 0, review: 0, relearning: 0,
      suspended: 0, buried: 0, mature: 0, young: 0
    };

    for (var id in data.cardStates) {
      if (deckId && cardIdToDeckId(id) !== deckId) continue;
      var c = data.cardStates[id];
      if (c.suspended) { counts.suspended++; continue; }
      if (c.buried) { counts.buried++; continue; }
      counts[c.state]++;
      if (c.state === 'review') {
        if (c.interval >= 21) counts.mature++;
        else counts.young++;
      }
    }

    return counts;
  }

  /**
   * 获取未来 N 天的复习预测（每日到期卡片数）
   * @param {string} accountId
   * @param {number} [days=30] - 预测天数
   * @returns {Array} [{ date, count }]
   */
  function getForecast(accountId, days) {
    if (!days) days = 30;
    var data = loadSRSData(accountId);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var start = today.getTime();
    var forecast = [];

    for (var d = 0; d < days; d++) {
      var dayStart = start + d * DAY_MS;
      var dayEnd = dayStart + DAY_MS;
      var date = localDateKey(new Date(dayStart));
      var count = 0;

      for (var id in data.cardStates) {
        var c = data.cardStates[id];
        if (c.suspended || c.state === 'new') continue;
        if (c.due >= dayStart && c.due < dayEnd) count++;
      }

      forecast.push({ date: date, count: count });
    }

    return forecast;
  }

  /**
   * 计算连续打卡天数
   * @param {string} accountId
   * @returns {number}
   */
  function getStreak(accountId) {
    var data = loadSRSData(accountId);
    var streak = 0;
    var d = new Date();

    while (true) {
      var key = localDateKey(d);
      if (data.stats[key] && data.stats[key].reviews > 0) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * 更新今日复习用时
   * @param {string} accountId
   * @param {number} ms - 本次复习用时（毫秒）
   */
  function addReviewTime(accountId, ms) {
    var data = loadSRSData(accountId);
    var today = todayStr();
    if (!data.stats[today]) {
      data.stats[today] = createEmptyDayStats();
    }
    normalizeDayStats(data.stats[today]);
    data.stats[today].timeMs += ms;
    saveSRSData(accountId, data);
  }

  /* ========== 清理搁置 ========== */

  /**
   * 清理已过期的搁置卡片（每天开始时调用）
   * @param {string} accountId
   */
  function clearExpiredBuries(accountId) {
    var data = loadSRSData(accountId);
    var now = Date.now();

    for (var id in data.cardStates) {
      var c = data.cardStates[id];
      if (c.buried && c.buriedUntil && c.buriedUntil <= now) {
        c.buried = false;
        c.buriedUntil = 0;
      }
    }

    // deckNewToday 仅作为历史统计兼容字段保留；主动学习不再受每日新卡数限制。
    var today = todayStr();
    var lastReset = data._lastNewReset || '';
    if (lastReset !== today) {
      data.deckNewToday = {};
      data._lastNewReset = today;
    }

    saveSRSData(accountId, data);
  }

  /* ========== 旧数据迁移 ========== */

  /**
   * 将现有的英语/俄语词书进度数据迁移为 SRS 格式
   * 只迁移一次，通过 songji-srs-migrated-v1 标记防止重复
   *
   * @param {string} accountId
   * @returns {boolean} 是否执行了迁移
   */
  function migrateDictationData(accountId) {
    var flagKey = MIGRATION_FLAG_KEY + ':' + accountId;
    if (localStorage.getItem(flagKey)) return false;

    var practiceKey = 'songji-foreign-dictation-v1:' + accountId;
    try {
      var oldData = JSON.parse(localStorage.getItem(practiceKey));
      if (!oldData || typeof oldData !== 'object') { oldData = {}; }
    } catch (e) {
      oldData = {};
    }

    var srsData = loadSRSData(accountId);

    // 迁移英语词书进度
    var engProgress = oldData.progress || {};
    var engWrong = oldData.wrongWords || {};
    var engFav = oldData.favorites || [];

    // 已答对的词 → review 状态，间隔根据答对次数估算
    for (var word in engProgress) {
      var cardId = 'english:college-english-iv:' + word;
      var correctCount = engProgress[word];
      var s = createNewCard(cardId);

      if (engWrong[word]) {
        // 有错题记录 → relearning 状态
        s.state = 'relearning';
        s.lapses = 1;
        s.stepIdx = 0;
        s.due = Date.now();
        s.ease = 2.3;
      } else if (correctCount > 0) {
        // 答对多次 → review，间隔随答对次数增长
        s.state = 'review';
        s.reps = correctCount;
        s.interval = Math.min(Math.round(Math.pow(1.7, correctCount)), 365);
        s.due = Date.now() + s.interval * DAY_MS;
        s.ease = 2.5;
      }

      srsData.cardStates[cardId] = s;
    }

    // 迁移收藏词 → flags=3（绿色标记）
    for (var i = 0; i < engFav.length; i++) {
      var favId = 'english:college-english-iv:' + engFav[i];
      if (srsData.cardStates[favId]) {
        srsData.cardStates[favId].flags = 3;
      } else {
        var favCard = createNewCard(favId);
        favCard.flags = 3;
        srsData.cardStates[favId] = favCard;
      }
    }

    saveSRSData(accountId, srsData);
    localStorage.setItem(flagKey, '1');
    return true;
  }

  /**
   * 将论语翻译记忆数据迁移为 SRS 格式
   * @param {string} accountId
   * @returns {boolean}
   */
  function migrateLunyuData(accountId) {
    var flagKey = MIGRATION_FLAG_KEY + ':lunyu:' + accountId;
    if (localStorage.getItem(flagKey)) return false;

    var lunyuKey = 'songji-lunyu-translation-v1:' + accountId;
    try {
      var oldData = JSON.parse(localStorage.getItem(lunyuKey));
      if (!oldData || typeof oldData !== 'object') { oldData = {}; }
    } catch (e) {
      oldData = {};
    }

    var srsData = loadSRSData(accountId);
    var sentences = oldData.sentences || {};

    for (var key in sentences) {
      var cardId = 'lunyu:default:' + key;
      var record = sentences[key];
      var s = createNewCard(cardId);

      // 旧 grade 映射到 SRS 状态
      if (record.grade === 'easy') {
        s.state = 'review';
        s.interval = 21; // 简单 → 较长间隔
        s.due = Date.now() + s.interval * DAY_MS;
        s.ease = 2.65;
        s.reps = 3;
      } else if (record.grade === 'good') {
        s.state = 'review';
        s.interval = 4;
        s.due = Date.now() + s.interval * DAY_MS;
        s.ease = 2.5;
        s.reps = 2;
      } else if (record.grade === 'hard') {
        s.state = 'learning';
        s.stepIdx = 0;
        s.due = Date.now();
        s.ease = 2.35;
        s.reps = 1;
      } else if (record.grade === 'again') {
        s.state = 'relearning';
        s.lapses = 1;
        s.stepIdx = 0;
        s.due = Date.now();
        s.ease = 2.3;
      }

      // 收藏 → flags=3
      if (record.favorite) s.flags = 3;

      srsData.cardStates[cardId] = s;
    }

    saveSRSData(accountId, srsData);
    localStorage.setItem(flagKey, '1');
    return true;
  }

  /**
   * 执行全部迁移（英语词书 + 论语）
   * @param {string} accountId
   */
  function migrateAll(accountId) {
    migrateDictationData(accountId);
    migrateLunyuData(accountId);
  }

  /* ========== 辅助函数 ========== */

  /** 从 cardId 提取 deckId："english:college-english-iv:word" → "english:college-english-iv" */
  function cardIdToDeckId(cardId) {
    var parts = cardId.split(':');
    if (parts.length >= 2) return parts[0] + ':' + parts[1];
    return cardId;
  }

  /** 今日日期字符串 YYYY-MM-DD */
  function todayStr() {
    return localDateKey(new Date());
  }

  /** 本地日期键 YYYY-MM-DD，避免 UTC 跨天导致今日统计错位 */
  function localDateKey(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  /** 明天 0 点的时间戳 */
  function tomorrowStart() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** Fisher-Yates 洗牌 */
  function shuffleArray(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  /* ========== 公共 API ========== */
  window.SRSEngine = {
    // 常量 & 默认配置
    DAY_MS: DAY_MS,
    MIN_MS: MIN_MS,
    DEFAULT_CONFIG: DEFAULT_CONFIG,

    // 卡片工厂
    createNewCard: createNewCard,

    // 核心调度
    schedule: schedule,
    previewIntervals: previewIntervals,

    // 格式化
    formatInterval: formatInterval,

    // 存储层
    loadSRSData: loadSRSData,
    saveSRSData: saveSRSData,
    loadStatsData: loadStatsData,
    saveStatsData: saveStatsData,
    createEmptySRSData: createEmptySRSData,

    // 卡片读写
    getCardState: getCardState,
    setCardState: setCardState,
    reviewCard: reviewCard,
    repeatCard: repeatCard,

    // 配置管理
    getGlobalConfig: getGlobalConfig,
    setGlobalConfig: setGlobalConfig,
    getDeckConfig: getDeckConfig,
    setDeckConfig: setDeckConfig,
    resolveConfig: resolveConfig,

    // 队列辅助
    getDueCards: getDueCards,
    getNewCardSlots: getNewCardSlots,
    getAvailableNewCards: getAvailableNewCards,

    // 卡片操作
    buryCard: buryCard,
    suspendCard: suspendCard,
    unsuspendCard: unsuspendCard,
    setCardFlag: setCardFlag,
    setCardTags: setCardTags,
    setNewCardOrder: setNewCardOrder,
    resetCard: resetCard,
    setDueDate: setDueDate,
    deleteCardState: deleteCardState,

    // 统计
    getTodayStats: getTodayStats,
    getDeckStateCounts: getDeckStateCounts,
    getForecast: getForecast,
    getStreak: getStreak,
    addReviewTime: addReviewTime,

    // 清理
    clearExpiredBuries: clearExpiredBuries,
    invalidateSRSCache: invalidateSRSCache,

    // 迁移
    migrateDictationData: migrateDictationData,
    migrateLunyuData: migrateLunyuData,
    migrateAll: migrateAll,

    // 辅助
    cardIdToDeckId: cardIdToDeckId,
    todayStr: todayStr
  };
})();

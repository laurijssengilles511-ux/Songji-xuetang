const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type SmartCard = {
  front: string;
  back: string;
  extra?: string;
  sourceHeading?: string;
};

type SmartCreateResult = {
  title: string;
  cards: SmartCard[];
  warnings?: string[];
};

type SmartCreateOptions = {
  fileName: string;
  requestedTitle: string;
  tag: string;
  visibility: string;
  focus: string;
  targetCount: number;
  userGuidance: string;
  existingDecks: string[];
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function extractOutputText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text;
  const parts: string[] = [];
  (data?.output || []).forEach((item: any) => {
    (item?.content || []).forEach((content: any) => {
      if (typeof content?.text === "string") parts.push(content.text);
      if (typeof content?.output_text === "string") parts.push(content.output_text);
    });
  });
  return parts.join("\n").trim();
}

function extractChatText(data: any): string {
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

function extractAnthropicText(data: any): string {
  return (data?.content || [])
    .map((item: any) => (item?.type === "text" ? item.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start !== -1 && end !== -1 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function safeParseResult(text: string): SmartCreateResult {
  const parsed = JSON.parse(extractJsonText(text));
  return {
    title: typeof parsed.title === "string" ? parsed.title : "",
    cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
  };
}

function normalizeText(value: unknown, maxLength = 500): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeList(value: unknown, maxItems = 8): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  value.forEach((item) => {
    const text = normalizeText(item, 80);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    items.push(text);
  });
  return items.slice(0, maxItems);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function focusLabel(value: string): string {
  const labels: Record<string, string> = {
    balanced: "均衡覆盖核心知识点",
    exam: "偏考试复习，突出高频考点、定义辨析和易错点",
    concept: "偏概念理解，突出定义、原理、因果链和对比关系",
    cloze: "偏主动回忆，问题更短，答案更聚焦",
  };
  return labels[value] || labels.balanced;
}

function buildSystemPrompt(options: SmartCreateOptions) {
  const cardCountHint = `目标卡片数量：围绕 ${options.targetCount} 张生成；材料不足时宁少勿水，材料充分时允许上下浮动 30%。`;
  return [
    "你是诵记学堂的智慧创建助手，负责把学生的 Markdown 学习资料转成高质量间隔复习卡片。",
    "你必须只依据用户提供的材料生成卡片；不能编造材料外事实，不能把不确定内容写成确定答案。",
    "只输出符合 JSON Schema 的 JSON，不要输出 Markdown、解释或额外文本。",
    "",
    "输出字段：",
    "- title：简短、可识别的牌组名；优先尊重用户期望牌组名。",
    "- cards[].front：清晰问题或主动回忆提示，避免“请解释本章内容”这类空泛问题。",
    "- cards[].back：可独立判分的准确答案，优先 1-3 句话。",
    "- cards[].extra：补充解释、记忆提示、易错提醒或与相近概念的区别；没有则填空字符串。",
    "- cards[].sourceHeading：来源章节或最接近的小标题；没有标题则填文件名。",
    "- warnings：记录材料过短、结构混乱、已跳过不可制卡内容等提示。",
    "",
    "生成策略：",
    `- ${focusLabel(options.focus)}。`,
    `- ${cardCountHint}`,
    "- 优先覆盖核心概念、定义、原理、对比关系、步骤、因果链、例外条件、易错点和考试高频表述。",
    "- 每张卡只考一个知识点；复杂知识拆成多张卡。",
    "- 避免目录项、页码、引用格式、纯过渡句、无法由材料回答的问题和正反面几乎相同的卡。",
    "- 相似卡片要合并或改写成不同考点，不要重复问同一件事。",
    "- 如果材料是课堂笔记，优先保留老师强调、列表、加粗、标题层级和例子中的考点。",
  ].join("\n");
}

function buildUserPrompt(options: SmartCreateOptions, markdown: string) {
  const decks = options.existingDecks.length ? options.existingDecks.join("、") : "无";
  return [
    `文件名：${options.fileName}`,
    `用户期望牌组名：${options.requestedTitle || "未提供"}`,
    `标签：${options.tag}`,
    `可见范围：${options.visibility}`,
    `生成侧重点：${focusLabel(options.focus)}`,
    `目标数量：${options.targetCount}`,
    `已有自建牌组：${decks}`,
    `用户补充要求：${options.userGuidance || "无"}`,
    "",
    "请先在内部判断材料结构、标题层级和高价值考点，再生成最终 JSON。",
    "如果用户补充要求与材料冲突，以材料事实为准，并在 warnings 中说明。",
    "请生成 JSON：",
    '{ "title": "牌组名", "cards": [{ "front": "问题", "back": "答案", "extra": "补充", "sourceHeading": "章节" }], "warnings": [] }',
    "",
    "Markdown 内容：",
    markdown,
  ].join("\n");
}

function cleanResult(result: SmartCreateResult, options: SmartCreateOptions): SmartCreateResult {
  const seen = new Set<string>();
  const rejected = { empty: 0, duplicate: 0, weak: 0, sameSide: 0 };
  const cards: SmartCard[] = [];

  result.cards.forEach((card) => {
    const front = normalizeText(card?.front, 260);
    const back = normalizeText(card?.back, 500);
    const extra = normalizeText(card?.extra, 420);
    const sourceHeading = normalizeText(card?.sourceHeading, 120) || options.fileName;
    if (!front || !back) {
      rejected.empty += 1;
      return;
    }
    if (front.length < 4 || back.length < 2) {
      rejected.weak += 1;
      return;
    }
    if (front.toLowerCase() === back.toLowerCase()) {
      rejected.sameSide += 1;
      return;
    }
    const key = `${front.toLowerCase()}::${back.toLowerCase()}`;
    if (seen.has(key)) {
      rejected.duplicate += 1;
      return;
    }
    seen.add(key);
    cards.push({ front, back, extra, sourceHeading });
  });

  const warnings = [
    ...(result.warnings || []).map((warning) => normalizeText(warning, 160)).filter(Boolean),
  ];
  if (rejected.empty) warnings.push(`已过滤 ${rejected.empty} 张缺少正面或背面的卡片。`);
  if (rejected.weak) warnings.push(`已过滤 ${rejected.weak} 张信息量过低的卡片。`);
  if (rejected.sameSide) warnings.push(`已过滤 ${rejected.sameSide} 张正反面重复的卡片。`);
  if (rejected.duplicate) warnings.push(`已过滤 ${rejected.duplicate} 张重复卡片。`);
  if (cards.length < Math.max(3, Math.floor(options.targetCount * 0.45))) {
    warnings.push("可用卡片数量偏少，建议补充更完整的笔记或降低目标数量。");
  }

  return {
    title: normalizeText(result.title, 80) || options.requestedTitle || options.fileName.replace(/\.(md|markdown)$/i, ""),
    cards,
    warnings: Array.from(new Set(warnings)).slice(0, 6),
  };
}

async function callOpenAI(args: { apiKey: string; model: string; systemPrompt: string; userPrompt: string }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      input: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "smart_create_cards",
          strict: true,
          schema: smartCreateSchema(),
        },
      },
      temperature: 0.2,
      max_output_tokens: 5000,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${await response.text()}`);
  return extractOutputText(await response.json());
}

async function callDeepSeek(args: { apiKey: string; model: string; systemPrompt: string; userPrompt: string }) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 5000,
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek request failed: ${await response.text()}`);
  return extractChatText(await response.json());
}

async function callAnthropic(args: { apiKey: string; model: string; systemPrompt: string; userPrompt: string }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      system: args.systemPrompt,
      messages: [{ role: "user", content: args.userPrompt }],
      temperature: 0.2,
      max_tokens: 5000,
    }),
  });
  if (!response.ok) throw new Error(`Anthropic request failed: ${await response.text()}`);
  return extractAnthropicText(await response.json());
}

function smartCreateSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "cards", "warnings"],
    properties: {
      title: { type: "string" },
      warnings: {
        type: "array",
        items: { type: "string" },
      },
      cards: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["front", "back", "extra", "sourceHeading"],
          properties: {
            front: { type: "string" },
            back: { type: "string" },
            extra: { type: "string" },
            sourceHeading: { type: "string" },
          },
        },
      },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    return jsonResponse({
      ok: true,
      service: "smart-create-cards",
      providers: ["openai", "deepseek", "anthropic"],
    });
  }
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let payload: any;
  try {
    payload = await req.json();
  } catch (_error) {
    return jsonResponse({ error: "Invalid JSON request body" }, 400);
  }

  const markdown = String(payload?.markdown || "").trim();
  const options: SmartCreateOptions = {
    fileName: normalizeText(payload?.fileName || "study-notes.md", 120),
    requestedTitle: normalizeText(payload?.requestedTitle, 80),
    tag: normalizeText(payload?.tag || "自建", 24),
    visibility: normalizeText(payload?.visibility || "private", 16),
    focus: normalizeText(payload?.focus || "balanced", 24),
    targetCount: clampNumber(payload?.targetCount, 16, 3, 40),
    userGuidance: normalizeText(payload?.userGuidance, 500),
    existingDecks: normalizeList(payload?.existingDecks, 8),
  };
  const provider = String(payload?.provider || "openai").trim();
  const envKeys: Record<string, string> = {
    openai: Deno.env.get("OPENAI_API_KEY") || "",
    deepseek: Deno.env.get("DEEPSEEK_API_KEY") || "",
    anthropic: Deno.env.get("ANTHROPIC_API_KEY") || "",
  };
  const apiKey = String(payload?.apiKey || envKeys[provider] || "").trim();
  const defaultModels: Record<string, string> = {
    openai: "gpt-4.1-mini",
    deepseek: "deepseek-v4-flash",
    anthropic: "claude-sonnet-4-5",
  };
  const requestedModel = String(payload?.model || defaultModels[provider] || defaultModels.openai).trim();

  if (!markdown) return jsonResponse({ error: "Markdown content is required" }, 400);
  if (markdown.length > 60000) return jsonResponse({ error: "Markdown content is too large" }, 413);
  if (!["openai", "deepseek", "anthropic"].includes(provider)) {
    return jsonResponse({ error: "Unsupported model provider" }, 400);
  }
  if (!apiKey) return jsonResponse({ error: "Model provider API Key is required" }, 400);

  const model = requestedModel || "gpt-4.1-mini";
  const systemPrompt = buildSystemPrompt(options);
  const userPrompt = buildUserPrompt(options, markdown);

  try {
    const outputText = provider === "deepseek"
      ? await callDeepSeek({ apiKey, model, systemPrompt, userPrompt })
      : provider === "anthropic"
        ? await callAnthropic({ apiKey, model, systemPrompt, userPrompt })
        : await callOpenAI({ apiKey, model, systemPrompt, userPrompt });
    if (!outputText) return jsonResponse({ error: "Model returned empty output" }, 502);

    try {
      const result = cleanResult(safeParseResult(outputText), options);
      if (!result.cards.length) return jsonResponse({ error: "Model returned no valid cards" }, 502);
      return jsonResponse(result);
    } catch (_error) {
      return jsonResponse({ error: "Model returned invalid JSON" }, 502);
    }
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Smart create failed" }, 500);
  }
});

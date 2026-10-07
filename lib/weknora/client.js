// src/weknora/client.ts
import { createHash } from "node:crypto";
import { z } from "zod";
var MANUAL_DRAFT = "draft";
var MANUAL_PUBLISH = "publish";
var LOW_COST_PROCESS_CONFIG = {
  summary_enabled: false,
  enable_multimodel: false,
  vlm_config: { enabled: false },
  asr_config: { enabled: false },
  question_generation_config: { enabled: false },
  graph_enabled: false,
  extract_config: { enabled: false }
};
var WeKnoraError = class extends Error {
  constructor(code, status = 0, remoteCode = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.remoteCode = remoteCode;
  }
  code;
  status;
  remoteCode;
};
var ERROR_CODES = /* @__PURE__ */ new Set([
  "UNAUTHORIZED",
  "KB_DENIED",
  "NOT_FOUND",
  "BAD_REQUEST",
  "CONFLICT",
  "RATE_LIMITED",
  "UPSTREAM",
  "DEADLINE",
  "CANCELLED",
  "MALFORMED",
  "NETWORK",
  "CONFIG",
  "LIMIT"
]);
function isWeKnoraError(error) {
  if (error instanceof WeKnoraError) return true;
  if (typeof error !== "object" || error === null) return false;
  const code = error.code;
  const status = error.status;
  return typeof code === "string" && ERROR_CODES.has(code) && typeof status === "number";
}
function weknoraCode(error) {
  return isWeKnoraError(error) ? error.code : null;
}
var MANUAL_CONTENT_MAX = 2e5;
var CUSTOM_METADATA_MAX_KEYS = 20;
var CUSTOM_METADATA_KEY_MAX = 64;
var CUSTOM_METADATA_VALUE_MAX = 1e3;
var envelope = z.object({ success: z.boolean().optional(), code: z.union([z.number(), z.string()]).optional(), msg: z.string().optional(), data: z.unknown().optional() });
var errorEnvelope = z.object({
  error: z.union([z.string(), z.object({ code: z.union([z.number(), z.string()]).optional(), message: z.string().optional() }).partial()]).optional(),
  // 平台 key 缺少工作空间时把业务码放在顶层，且是字符串。
  code: z.union([z.number(), z.string()]).optional(),
  message: z.string().optional()
}).partial();
var kbSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  embedding_model_id: z.string().optional(),
  tenant_id: z.number().optional()
}).passthrough();
var hitSchema = z.object({
  id: z.string(),
  content: z.string().optional(),
  knowledge_id: z.string().optional(),
  chunk_index: z.number().optional(),
  knowledge_title: z.string().optional(),
  score: z.number().optional(),
  match_type: z.number().optional(),
  start_at: z.number().optional(),
  end_at: z.number().optional(),
  knowledge_base_id: z.string().optional(),
  knowledge_custom_metadata: z.string().optional()
}).passthrough();
var chunkSchema = z.object({
  id: z.string(),
  chunk_index: z.number().optional(),
  content: z.string().optional(),
  index_status: z.string().optional(),
  content_revision: z.number().optional(),
  is_enabled: z.boolean().optional()
}).passthrough();
var knowledgeSchema = z.object({
  id: z.string(),
  knowledge_base_id: z.string().optional(),
  title: z.string().optional(),
  parse_status: z.string().optional(),
  metadata: z.unknown().optional(),
  custom_metadata: z.unknown().optional()
}).passthrough();
function bodyHash(text) {
  return createHash("sha256").update(text).digest("hex");
}
function manualMetadata(metadata) {
  if (typeof metadata !== "object" || metadata === null) return null;
  const manual = Reflect.get(metadata, "manual");
  if (typeof manual !== "object" || manual === null) return null;
  const content = Reflect.get(manual, "content");
  if (typeof content !== "string") return null;
  const status = Reflect.get(manual, "status");
  const version = Reflect.get(manual, "version");
  return { content, status: typeof status === "string" ? status : "", version: typeof version === "number" ? version : 0 };
}
var WeKnoraClient = class {
  constructor(options) {
    this.options = options;
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.fetcher = options.fetchImpl ?? globalThis.fetch;
  }
  options;
  base;
  fetcher;
  /** 请求头只在此处组装；日志与管理页不记录其内容。 */
  headers() {
    const headers = { "Content-Type": "application/json", Accept: "application/json", "X-API-Key": this.options.apiKey };
    if (this.options.tenantId) headers["X-Tenant-ID"] = this.options.tenantId;
    return headers;
  }
  url({ path, query }) {
    const target = new URL(this.base + path);
    for (const [key, value] of Object.entries(query ?? {})) if (value !== void 0) target.searchParams.set(key, String(value));
    return target.toString();
  }
  /**
   * 状态码到固定错误代码的映射；401/403 不重试也不当作成功。
   * 错误信封的 `code` 是业务错误码整数，另有两种非标准形状需要容忍。
   */
  classify(status, body) {
    const parsed = errorEnvelope.safeParse(body).data;
    const error = parsed?.error;
    const remoteCode = typeof error === "string" ? "" : String(error?.code ?? parsed?.code ?? "");
    if (status === 401) return new WeKnoraError("UNAUTHORIZED", status, remoteCode);
    if (status === 403) return new WeKnoraError("KB_DENIED", status, remoteCode);
    if (status === 409) return new WeKnoraError("CONFIG", status, remoteCode || "TENANT_REQUIRED");
    if (status === 404) return new WeKnoraError("NOT_FOUND", status, remoteCode);
    if (status === 429) return new WeKnoraError("RATE_LIMITED", status, remoteCode);
    if (status === 400 || status === 422) return new WeKnoraError("BAD_REQUEST", status, remoteCode);
    return new WeKnoraError("UPSTREAM", status, remoteCode);
  }
  async once(options, signal, whole = false) {
    let response;
    try {
      response = await this.fetcher(this.url(options), {
        method: options.method,
        headers: this.headers(),
        body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
        signal
      });
    } catch {
      if (signal.aborted) throw new WeKnoraError("DEADLINE");
      throw new WeKnoraError("NETWORK");
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) throw this.classify(response.status, payload);
    const parsed = envelope.safeParse(payload);
    if (!parsed.success) throw new WeKnoraError("MALFORMED", response.status);
    const accepted = parsed.data.success === true || parsed.data.code === 0;
    if (!accepted) throw new WeKnoraError("MALFORMED", response.status);
    return whole ? payload : parsed.data.data;
  }
  /** 读操作可重试；写操作与不确定结果一律单次发出，由上层对账。 */
  async request(options) {
    const deadline = this.options.deadlineMs ?? 1500;
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), deadline);
    const attempts = options.idempotent ? Math.max(1, Math.min(this.options.retries ?? 1, 3)) : 1;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.once(options, signal, options.whole);
        } catch (error) {
          const code = weknoraCode(error);
          const retryable = code === "UPSTREAM" || code === "RATE_LIMITED" || code === "NETWORK";
          if (!retryable || attempt + 1 >= attempts || signal.aborted) throw error;
          await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
          if (signal.aborted) throw new WeKnoraError("DEADLINE");
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
  /**
   * 连接与能力探针。`/health` 不在 `/api/v1` 下且无鉴权；版本与能力走系统接口。
   * 系统接口要求 `manage_vector_stores` 或 full-access，因此失败只降级为“未知”，
   * 不阻断以知识库列表为准的可用性判断。
   */
  async probe(signal) {
    const knowledgeBases = await this.listKnowledgeBases(signal);
    let version = null;
    try {
      version = await this.systemInfo(signal);
    } catch {
      version = null;
    }
    return { ok: true, knowledgeBases, version };
  }
  /** 系统信息使用第二套信封；`version` 可能是编译期默认值 "unknown"。 */
  async systemInfo(signal) {
    const data = await this.request({ method: "GET", path: "/system/info", idempotent: true, signal });
    const text = (key) => typeof data?.[key] === "string" ? String(data[key]) : "";
    return { version: text("version"), edition: text("edition"), commitId: text("commit_id"), keywordIndexEngine: text("keyword_index_engine"), vectorStoreEngine: text("vector_store_engine") };
  }
  async listKnowledgeBases(signal) {
    const data = await this.request({ method: "GET", path: "/knowledge-bases", idempotent: true, signal });
    if (!Array.isArray(data)) throw new WeKnoraError("MALFORMED");
    return data.map((row) => {
      const value = kbSchema.parse(row);
      return { id: value.id, name: value.name ?? "", type: value.type ?? "document", embeddingModelId: value.embedding_model_id ?? "", tenantId: value.tenant_id ?? 0 };
    });
  }
  /** 单库有界召回。不同库的原始分数不直接比较，融合由 Host 完成。 */
  async hybridSearch(kbId, params, signal) {
    const body = {
      query_text: params.queryText,
      match_count: params.matchCount,
      vector_threshold: params.vectorThreshold,
      keyword_threshold: params.keywordThreshold,
      skip_context_enrichment: params.skipContextEnrichment
    };
    const data = await this.request({ method: "POST", path: `/knowledge-bases/${encodeURIComponent(kbId)}/hybrid-search`, body, idempotent: true, signal });
    if (!Array.isArray(data)) throw new WeKnoraError("MALFORMED");
    return data.map((row) => {
      const value = hitSchema.parse(row);
      const content = value.content ?? "";
      return {
        chunkId: value.id,
        knowledgeId: value.knowledge_id ?? "",
        kbId: value.knowledge_base_id || kbId,
        title: value.knowledge_title ?? "",
        content,
        chunkIndex: value.chunk_index ?? 0,
        score: value.score ?? 0,
        matchType: value.match_type ?? -1,
        bodyHash: bodyHash(content),
        startAt: value.start_at ?? 0,
        endAt: value.end_at ?? 0,
        customMetadata: value.knowledge_custom_metadata ?? ""
      };
    });
  }
  /** 文档状态与手工正文；用于父库校验和发布版本核对。 */
  async getKnowledge(knowledgeId, signal) {
    const data = await this.request({ method: "GET", path: `/knowledge/${encodeURIComponent(knowledgeId)}`, idempotent: true, signal });
    return this.toDetail(knowledgeSchema.parse(data));
  }
  /**
   * 列出知识库中的文档。用于创建响应丢失后按稳定标记对账：
   * 只能按标记与正文精确确认唯一匹配，禁止盲目重发创建。
   */
  async listKnowledge(kbId, page, pageSize, signal) {
    const bounded = Math.max(1, Math.min(100, pageSize));
    const payload = await this.request({
      method: "GET",
      path: `/knowledge-bases/${encodeURIComponent(kbId)}/knowledge`,
      query: { page: Math.max(1, page), page_size: bounded },
      idempotent: true,
      whole: true,
      signal
    });
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];
    const total = Array.isArray(payload) ? rows.length : payload.total ?? rows.length;
    return { total, items: rows.map((row) => this.toDetail(knowledgeSchema.parse(row))) };
  }
  toDetail(value) {
    const manual = manualMetadata(value.metadata);
    return {
      id: value.id,
      kbId: value.knowledge_base_id ?? "",
      title: value.title ?? "",
      parseStatus: value.parse_status ?? "",
      customMetadata: typeof value.custom_metadata === "object" && value.custom_metadata !== null ? value.custom_metadata : {},
      metadata: typeof value.metadata === "object" && value.metadata !== null ? value.metadata : {},
      manualContent: manual?.content ?? null,
      manualStatus: manual?.status ?? "",
      manualVersion: manual?.version ?? 0,
      bodyHash: manual ? bodyHash(manual.content) : null
    };
  }
  /**
   * 按 chunk_index 原序分页读取分块。页大小上限 100（handler 自行钳制）。
   * 返回的块可能包含 `is_enabled=false`，调用方需自行判断。
   */
  async listChunks(knowledgeId, page, pageSize, signal) {
    const bounded = Math.max(1, Math.min(100, pageSize));
    const payload = await this.request({
      method: "GET",
      path: `/chunks/${encodeURIComponent(knowledgeId)}`,
      query: { page: Math.max(1, page), page_size: bounded },
      idempotent: true,
      whole: true,
      signal
    });
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];
    const meta = Array.isArray(payload) ? { total: rows.length, page, pageSize: bounded } : { total: payload.total ?? rows.length, page: payload.page ?? page, pageSize: payload.page_size ?? bounded };
    return {
      total: typeof meta.total === "number" ? meta.total : rows.length,
      page: typeof meta.page === "number" ? meta.page : page,
      pageSize: meta.pageSize,
      chunks: rows.map((row) => {
        const value = chunkSchema.parse(row);
        return { id: value.id, chunkIndex: value.chunk_index ?? 0, content: value.content ?? "", indexStatus: value.index_status ?? "", contentRevision: value.content_revision ?? 0, isEnabled: value.is_enabled !== false };
      })
    };
  }
  /**
   * 创建草稿文档。每次创建产生新 ID，响应丢失必须走对账而不是重发。
   * 服务端只在 status=publish 时应用 process_config；草稿路径显式传 draft。
   */
  async createManual(kbId, input, signal) {
    this.assertManualContent(input.content);
    const status = input.status ?? MANUAL_DRAFT;
    const data = await this.request({
      method: "POST",
      path: `/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/manual`,
      idempotent: false,
      signal,
      body: { title: input.title, content: input.content, status, ...status === MANUAL_PUBLISH && input.processConfig !== void 0 ? { process_config: input.processConfig } : {} }
    });
    return this.toDetail(knowledgeSchema.parse(data));
  }
  /**
   * 写文档自定义元数据。服务端是整体替换：未出现的旧键会被删除，
   * 因此调用方必须先读取现有值并合并保留非插件字段。校验失败返回 500 而非 400。
   */
  async updateMetadata(knowledgeId, customMetadata, signal) {
    const entries = Object.entries(customMetadata);
    if (entries.length > CUSTOM_METADATA_MAX_KEYS) throw new WeKnoraError("LIMIT");
    for (const [key, value] of entries) {
      if (!key.trim() || key.trim().length > CUSTOM_METADATA_KEY_MAX) throw new WeKnoraError("LIMIT");
      if (value !== null && typeof value === "object") throw new WeKnoraError("LIMIT");
      if (String(value).length > CUSTOM_METADATA_VALUE_MAX) throw new WeKnoraError("LIMIT");
    }
    const data = await this.request({
      method: "PUT",
      path: `/knowledge/${encodeURIComponent(knowledgeId)}`,
      idempotent: false,
      signal,
      body: { custom_metadata: customMetadata }
    });
    return this.toDetail(knowledgeSchema.parse(data));
  }
  /**
   * 发布或改正文。必须携带完整非空正文与显式 status=publish；
   * 省略 status 会被服务端当作 draft，把已发布文档打回草稿。
   */
  async publishManual(knowledgeId, body, processConfig = LOW_COST_PROCESS_CONFIG, signal) {
    this.assertManualContent(body);
    const data = await this.request({
      method: "PUT",
      path: `/knowledge/manual/${encodeURIComponent(knowledgeId)}`,
      idempotent: false,
      signal,
      body: { content: body, status: MANUAL_PUBLISH, process_config: processConfig }
    });
    return this.toDetail(knowledgeSchema.parse(data));
  }
  /** 本地先拒绝超限正文；服务端上限为 200000 字符。 */
  assertManualContent(content) {
    if (!content.trim().length) throw new WeKnoraError("LIMIT");
    if ([...content].length > MANUAL_CONTENT_MAX) throw new WeKnoraError("LIMIT");
  }
  /** 删除。200 仅表示入队；完成需由调用方以 GET 404 确认。 */
  async deleteKnowledge(knowledgeId, signal) {
    await this.request({ method: "DELETE", path: `/knowledge/${encodeURIComponent(knowledgeId)}`, idempotent: false, signal });
  }
};
export {
  CUSTOM_METADATA_KEY_MAX,
  CUSTOM_METADATA_MAX_KEYS,
  CUSTOM_METADATA_VALUE_MAX,
  LOW_COST_PROCESS_CONFIG,
  MANUAL_CONTENT_MAX,
  MANUAL_DRAFT,
  MANUAL_PUBLISH,
  WeKnoraClient,
  WeKnoraError,
  bodyHash,
  isWeKnoraError,
  manualMetadata,
  weknoraCode
};
//# sourceMappingURL=client.js.map

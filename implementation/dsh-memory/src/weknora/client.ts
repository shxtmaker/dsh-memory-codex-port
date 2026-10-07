/**
 * WeKnora v0.8.2 稳定版 REST adapter。
 *
 * 依据固定提交 3e8b0bf 的源码：检索走底层 hybrid-search，不调用 ask。
 * 不继承官方 private fetchJson，也不直接触达 WeKnora 内部数据库。
 * 契约细节见 docs/weknora-v0.8.2-contract.md。
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'

/** 稳定版手工文档状态；省略时服务端按 draft 处理。 */
export const MANUAL_DRAFT = 'draft'
export const MANUAL_PUBLISH = 'publish'

/** 关闭辅助生成的低成本处理覆盖；创建草稿时不会被保存，发布 PUT 必须再次携带。 */
export const LOW_COST_PROCESS_CONFIG = {
  summary_enabled: false,
  enable_multimodel: false,
  vlm_config: { enabled: false },
  asr_config: { enabled: false },
  question_generation_config: { enabled: false },
  graph_enabled: false,
  extract_config: { enabled: false },
} as const

/** 已知文档解析状态；draft 是手工草稿的实际取值，不在服务端常量表中。 */
export type ParseStatus = 'pending' | 'processing' | 'finalizing' | 'completed' | 'failed' | 'deleting' | 'cancelled' | 'draft' | string

export interface KnowledgeBaseSummary { id: string; name: string; type: string; embeddingModelId: string; tenantId: number }

export interface HybridSearchParams {
  queryText: string
  matchCount: number
  vectorThreshold: number
  keywordThreshold: number
  skipContextEnrichment: boolean
}

/** match_type 是整数枚举：0 embedding、1 keywords、2 near_by、3 history、4 parent、5 relation、6 graph、7 web、9 analysis。 */
export type MatchType = number

export interface SearchHit {
  chunkId: string; knowledgeId: string; kbId: string; title: string; content: string
  chunkIndex: number; score: number; matchType: MatchType; bodyHash: string
  startAt: number; endAt: number; customMetadata: string
}

export interface KnowledgeDetail {
  id: string; kbId: string; title: string; parseStatus: ParseStatus
  customMetadata: Record<string, unknown>
  metadata: Record<string, unknown>
  manualContent: string | null; manualStatus: string; manualVersion: number
  bodyHash: string | null
}

export interface ChunkPage { total: number; page: number; pageSize: number; chunks: { id: string; chunkIndex: number; content: string; indexStatus: string; contentRevision: number; isEnabled: boolean }[] }

export interface SystemInfo { version: string; edition: string; commitId: string; keywordIndexEngine: string; vectorStoreEngine: string }

/** 适配器错误以固定代码表达；正文与请求头不进入错误信息。 */
export type WeKnoraErrorCode =
  | 'UNAUTHORIZED' | 'KB_DENIED' | 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'RATE_LIMITED'
  | 'UPSTREAM' | 'DEADLINE' | 'CANCELLED' | 'MALFORMED' | 'NETWORK' | 'CONFIG' | 'LIMIT'

export class WeKnoraError extends Error {
  constructor(readonly code: WeKnoraErrorCode, readonly status = 0, readonly remoteCode = '') { super(code) }
}

const ERROR_CODES = new Set<string>([
  'UNAUTHORIZED', 'KB_DENIED', 'NOT_FOUND', 'BAD_REQUEST', 'CONFLICT', 'RATE_LIMITED',
  'UPSTREAM', 'DEADLINE', 'CANCELLED', 'MALFORMED', 'NETWORK', 'CONFIG', 'LIMIT',
])

/**
 * 结构化的错误判定。
 *
 * 每个入口由 esbuild 独立打包，`client.ts` 会被内联进 index/evidence/sync-outbox，
 * 因此 `instanceof WeKnoraError` 跨模块恒为 false。这里按固定代码集合判定，
 * 保证适配器错误在任何模块组合下都能被正确识别。
 */
export function isWeKnoraError(error: unknown): error is WeKnoraError {
  if (error instanceof WeKnoraError) return true
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  const status = (error as { status?: unknown }).status
  return typeof code === 'string' && ERROR_CODES.has(code) && typeof status === 'number'
}

/** 取固定错误代码；非适配器错误返回 null。 */
export function weknoraCode(error: unknown): WeKnoraErrorCode | null {
  return isWeKnoraError(error) ? error.code : null
}

/** 手工正文上限为 200000 个字符（rune）；本地先拒绝，避免无谓往返。 */
export const MANUAL_CONTENT_MAX = 200000
/** custom_metadata 上限：20 个键、键名 ≤64、值 ≤1000。 */
export const CUSTOM_METADATA_MAX_KEYS = 20
export const CUSTOM_METADATA_KEY_MAX = 64
export const CUSTOM_METADATA_VALUE_MAX = 1000

/**
 * 同一服务存在三种响应形状，必须分别容忍：
 *   1. 知识库/知识/分块接口：`{"success": true, "data": ...}`
 *   2. 系统接口：`{"code": 0, "msg": "success", "data": ...}`
 *   3. 错误：`{"success": false, "error": {"code": <数字>, "message": ...}}`
 * 另有网关拒绝的裸 `{"error": "..."}` 与平台 key 的 `{"error": ..., "code": "TENANT_REQUIRED"}`。
 */
const envelope = z.object({ success: z.boolean().optional(), code: z.union([z.number(), z.string()]).optional(), msg: z.string().optional(), data: z.unknown().optional() })
const errorEnvelope = z.object({
  error: z.union([z.string(), z.object({ code: z.union([z.number(), z.string()]).optional(), message: z.string().optional() }).partial()]).optional(),
  // 平台 key 缺少工作空间时把业务码放在顶层，且是字符串。
  code: z.union([z.number(), z.string()]).optional(),
  message: z.string().optional(),
}).partial()

const kbSchema = z.object({
  id: z.string(), name: z.string().optional(), type: z.string().optional(),
  embedding_model_id: z.string().optional(), tenant_id: z.number().optional(),
}).passthrough()

const hitSchema = z.object({
  id: z.string(), content: z.string().optional(), knowledge_id: z.string().optional(),
  chunk_index: z.number().optional(), knowledge_title: z.string().optional(),
  score: z.number().optional(), match_type: z.number().optional(),
  start_at: z.number().optional(), end_at: z.number().optional(),
  knowledge_base_id: z.string().optional(), knowledge_custom_metadata: z.string().optional(),
}).passthrough()

const chunkSchema = z.object({
  id: z.string(), chunk_index: z.number().optional(), content: z.string().optional(), index_status: z.string().optional(),
  content_revision: z.number().optional(), is_enabled: z.boolean().optional(),
}).passthrough()

const knowledgeSchema = z.object({
  id: z.string(), knowledge_base_id: z.string().optional(), title: z.string().optional(),
  parse_status: z.string().optional(), metadata: z.unknown().optional(), custom_metadata: z.unknown().optional(),
}).passthrough()

/** 正文哈希用于证明检索片段与已发布批准快照一致。 */
export function bodyHash(text: string): string { return createHash('sha256').update(text).digest('hex') }

/** 从 manual metadata 中读取正文与版本；非手工文档返回 null。 */
export function manualMetadata(metadata: unknown): { content: string; status: string; version: number } | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const manual = Reflect.get(metadata, 'manual')
  if (typeof manual !== 'object' || manual === null) return null
  const content = Reflect.get(manual, 'content')
  if (typeof content !== 'string') return null
  const status = Reflect.get(manual, 'status')
  const version = Reflect.get(manual, 'version')
  return { content, status: typeof status === 'string' ? status : '', version: typeof version === 'number' ? version : 0 }
}

export interface ClientOptions {
  baseUrl: string
  apiKey: string
  tenantId?: string
  /** 单次请求总截止，覆盖连接、响应读取与解析。 */
  deadlineMs?: number
  /** 允许在截止内重试的幂等读操作次数。 */
  retries?: number
  /** 便于测试注入；默认使用全局 fetch。 */
  fetchImpl?: typeof fetch
}

interface RequestOptions { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; query?: Record<string, string | number | undefined>; body?: unknown; signal?: AbortSignal }

/**
 * 版本化的最小 REST 客户端。所有请求在 `deadlineMs` 内完成或按 DEADLINE 失败；
 * 已到达的取消不会发出新请求。读操作在 429/5xx 与网络错误上按小退避重试。
 */
export class WeKnoraClient {
  private readonly base: string
  private readonly fetcher: typeof fetch
  constructor(private readonly options: ClientOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '')
    this.fetcher = options.fetchImpl ?? globalThis.fetch
  }
  /** 请求头只在此处组装；日志与管理页不记录其内容。 */
  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': this.options.apiKey }
    if (this.options.tenantId) headers['X-Tenant-ID'] = this.options.tenantId
    return headers
  }
  private url({ path, query }: RequestOptions): string {
    const target = new URL(this.base + path)
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) target.searchParams.set(key, String(value))
    return target.toString()
  }
  /**
   * 状态码到固定错误代码的映射；401/403 不重试也不当作成功。
   * 错误信封的 `code` 是业务错误码整数，另有两种非标准形状需要容忍。
   */
  private classify(status: number, body: unknown): WeKnoraError {
    const parsed = errorEnvelope.safeParse(body).data
    const error = parsed?.error
    const remoteCode = typeof error === 'string' ? '' : String(error?.code ?? parsed?.code ?? '')
    if (status === 401) return new WeKnoraError('UNAUTHORIZED', status, remoteCode)
    // 平台 key 缺少工作空间时是 409 + 字符串码 TENANT_REQUIRED。
    if (status === 403) return new WeKnoraError('KB_DENIED', status, remoteCode)
    if (status === 409) return new WeKnoraError('CONFIG', status, remoteCode || 'TENANT_REQUIRED')
    if (status === 404) return new WeKnoraError('NOT_FOUND', status, remoteCode)
    if (status === 429) return new WeKnoraError('RATE_LIMITED', status, remoteCode)
    if (status === 400 || status === 422) return new WeKnoraError('BAD_REQUEST', status, remoteCode)
    return new WeKnoraError('UPSTREAM', status, remoteCode)
  }
  private async once<T>(options: RequestOptions, signal: AbortSignal, whole = false): Promise<T> {
    let response: Response
    try {
      response = await this.fetcher(this.url(options), {
        method: options.method,
        headers: this.headers(),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal,
      })
    } catch {
      // 取消与超时都表现为 abort；两者对外都是逾期，不区分供应商错误。
      if (signal.aborted) throw new WeKnoraError('DEADLINE')
      throw new WeKnoraError('NETWORK')
    }
    let payload: unknown = null
    try { payload = await response.json() } catch { payload = null }
    if (!response.ok) throw this.classify(response.status, payload)
    const parsed = envelope.safeParse(payload)
    if (!parsed.success) throw new WeKnoraError('MALFORMED', response.status)
    // 知识库/知识/分块接口用 success=true；系统接口用 code=0。
    const accepted = parsed.data.success === true || parsed.data.code === 0
    if (!accepted) throw new WeKnoraError('MALFORMED', response.status)
    // 分页接口把 total/page/page_size 与 data 并列，需保留整个信封。
    return (whole ? payload : parsed.data.data) as T
  }
  /** 读操作可重试；写操作与不确定结果一律单次发出，由上层对账。 */
  private async request<T>(options: RequestOptions & { idempotent: boolean; whole?: boolean }): Promise<T> {
    const deadline = this.options.deadlineMs ?? 1500
    const controller = new AbortController()
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    const timer = setTimeout(() => controller.abort(), deadline)
    const attempts = options.idempotent ? Math.max(1, Math.min(this.options.retries ?? 1, 3)) : 1
    try {
      for (let attempt = 0; ; attempt++) {
        try { return await this.once<T>(options, signal, options.whole) }
        catch (error) {
          const code = weknoraCode(error)
          const retryable = code === 'UPSTREAM' || code === 'RATE_LIMITED' || code === 'NETWORK'
          if (!retryable || attempt + 1 >= attempts || signal.aborted) throw error
          await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)))
          if (signal.aborted) throw new WeKnoraError('DEADLINE')
        }
      }
    } finally { clearTimeout(timer) }
  }
  /**
   * 连接与能力探针。`/health` 不在 `/api/v1` 下且无鉴权；版本与能力走系统接口。
   * 系统接口要求 `manage_vector_stores` 或 full-access，因此失败只降级为“未知”，
   * 不阻断以知识库列表为准的可用性判断。
   */
  async probe(signal?: AbortSignal): Promise<{ ok: true; knowledgeBases: KnowledgeBaseSummary[]; version: SystemInfo | null }> {
    const knowledgeBases = await this.listKnowledgeBases(signal)
    let version: SystemInfo | null = null
    try { version = await this.systemInfo(signal) } catch { version = null }
    return { ok: true, knowledgeBases, version }
  }
  /** 系统信息使用第二套信封；`version` 可能是编译期默认值 "unknown"。 */
  async systemInfo(signal?: AbortSignal): Promise<SystemInfo> {
    const data = await this.request<Record<string, unknown>>({ method: 'GET', path: '/system/info', idempotent: true, signal })
    const text = (key: string): string => typeof data?.[key] === 'string' ? String(data[key]) : ''
    return { version: text('version'), edition: text('edition'), commitId: text('commit_id'), keywordIndexEngine: text('keyword_index_engine'), vectorStoreEngine: text('vector_store_engine') }
  }
  async listKnowledgeBases(signal?: AbortSignal): Promise<KnowledgeBaseSummary[]> {
    const data = await this.request<unknown[]>({ method: 'GET', path: '/knowledge-bases', idempotent: true, signal })
    if (!Array.isArray(data)) throw new WeKnoraError('MALFORMED')
    return data.map(row => {
      const value = kbSchema.parse(row)
      return { id: value.id, name: value.name ?? '', type: value.type ?? 'document', embeddingModelId: value.embedding_model_id ?? '', tenantId: value.tenant_id ?? 0 }
    })
  }
  /** 单库有界召回。不同库的原始分数不直接比较，融合由 Host 完成。 */
  async hybridSearch(kbId: string, params: HybridSearchParams, signal?: AbortSignal): Promise<SearchHit[]> {
    // 阈值没有服务端默认值：省略等于关闭该通道的相关性过滤，因此始终显式传递。
    const body = {
      query_text: params.queryText,
      match_count: params.matchCount,
      vector_threshold: params.vectorThreshold,
      keyword_threshold: params.keywordThreshold,
      skip_context_enrichment: params.skipContextEnrichment,
    }
    const data = await this.request<unknown[]>({ method: 'POST', path: `/knowledge-bases/${encodeURIComponent(kbId)}/hybrid-search`, body, idempotent: true, signal })
    if (!Array.isArray(data)) throw new WeKnoraError('MALFORMED')
    return data.map(row => {
      const value = hitSchema.parse(row)
      const content = value.content ?? ''
      return {
        chunkId: value.id, knowledgeId: value.knowledge_id ?? '', kbId: value.knowledge_base_id || kbId,
        title: value.knowledge_title ?? '', content, chunkIndex: value.chunk_index ?? 0,
        score: value.score ?? 0, matchType: value.match_type ?? -1, bodyHash: bodyHash(content),
        startAt: value.start_at ?? 0, endAt: value.end_at ?? 0, customMetadata: value.knowledge_custom_metadata ?? '',
      }
    })
  }
  /** 文档状态与手工正文；用于父库校验和发布版本核对。 */
  async getKnowledge(knowledgeId: string, signal?: AbortSignal): Promise<KnowledgeDetail> {
    const data = await this.request<unknown>({ method: 'GET', path: `/knowledge/${encodeURIComponent(knowledgeId)}`, idempotent: true, signal })
    return this.toDetail(knowledgeSchema.parse(data))
  }
  /**
   * 列出知识库中的文档。用于创建响应丢失后按稳定标记对账：
   * 只能按标记与正文精确确认唯一匹配，禁止盲目重发创建。
   */
  async listKnowledge(kbId: string, page: number, pageSize: number, signal?: AbortSignal): Promise<{ total: number; items: KnowledgeDetail[] }> {
    const bounded = Math.max(1, Math.min(100, pageSize))
    const payload = await this.request<{ data?: unknown; total?: number } | unknown[]>({
      method: 'GET', path: `/knowledge-bases/${encodeURIComponent(kbId)}/knowledge`, query: { page: Math.max(1, page), page_size: bounded }, idempotent: true, whole: true, signal,
    })
    const rows = Array.isArray(payload) ? payload : Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : []
    const total = Array.isArray(payload) ? rows.length : (payload.total ?? rows.length)
    return { total, items: rows.map(row => this.toDetail(knowledgeSchema.parse(row))) }
  }
  private toDetail(value: z.infer<typeof knowledgeSchema>): KnowledgeDetail {
    const manual = manualMetadata(value.metadata)
    return {
      id: value.id, kbId: value.knowledge_base_id ?? '', title: value.title ?? '',
      parseStatus: value.parse_status ?? '',
      customMetadata: typeof value.custom_metadata === 'object' && value.custom_metadata !== null ? value.custom_metadata as Record<string, unknown> : {},
      metadata: typeof value.metadata === 'object' && value.metadata !== null ? value.metadata as Record<string, unknown> : {},
      manualContent: manual?.content ?? null, manualStatus: manual?.status ?? '', manualVersion: manual?.version ?? 0,
      bodyHash: manual ? bodyHash(manual.content) : null,
    }
  }
  /**
   * 按 chunk_index 原序分页读取分块。页大小上限 100（handler 自行钳制）。
   * 返回的块可能包含 `is_enabled=false`，调用方需自行判断。
   */
  async listChunks(knowledgeId: string, page: number, pageSize: number, signal?: AbortSignal): Promise<ChunkPage> {
    const bounded = Math.max(1, Math.min(100, pageSize))
    const payload = await this.request<{ data?: unknown; total?: number; page?: number; page_size?: number } | unknown[]>({
      method: 'GET', path: `/chunks/${encodeURIComponent(knowledgeId)}`, query: { page: Math.max(1, page), page_size: bounded }, idempotent: true, whole: true, signal,
    })
    // 分页字段与 data 同级；此处兼容数组形态与信封形态。
    const rows = Array.isArray(payload) ? payload : Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : []
    const meta = Array.isArray(payload)
      ? { total: rows.length, page, pageSize: bounded }
      : { total: payload.total ?? rows.length, page: payload.page ?? page, pageSize: payload.page_size ?? bounded }
    return {
      total: typeof meta.total === 'number' ? meta.total : rows.length,
      page: typeof meta.page === 'number' ? meta.page : page,
      pageSize: meta.pageSize,
      chunks: rows.map(row => {
        const value = chunkSchema.parse(row)
        return { id: value.id, chunkIndex: value.chunk_index ?? 0, content: value.content ?? '', indexStatus: value.index_status ?? '', contentRevision: value.content_revision ?? 0, isEnabled: value.is_enabled !== false }
      }),
    }
  }
  /**
   * 创建草稿文档。每次创建产生新 ID，响应丢失必须走对账而不是重发。
   * 服务端只在 status=publish 时应用 process_config；草稿路径显式传 draft。
   */
  async createManual(kbId: string, input: { title: string; content: string; status?: string; processConfig?: unknown }, signal?: AbortSignal): Promise<KnowledgeDetail> {
    this.assertManualContent(input.content)
    const status = input.status ?? MANUAL_DRAFT
    const data = await this.request<unknown>({
      method: 'POST', path: `/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/manual`, idempotent: false, signal,
      body: { title: input.title, content: input.content, status, ...(status === MANUAL_PUBLISH && input.processConfig !== undefined ? { process_config: input.processConfig } : {}) },
    })
    return this.toDetail(knowledgeSchema.parse(data))
  }
  /**
   * 写文档自定义元数据。服务端是整体替换：未出现的旧键会被删除，
   * 因此调用方必须先读取现有值并合并保留非插件字段。校验失败返回 500 而非 400。
   */
  async updateMetadata(knowledgeId: string, customMetadata: Record<string, unknown>, signal?: AbortSignal): Promise<KnowledgeDetail> {
    const entries = Object.entries(customMetadata)
    if (entries.length > CUSTOM_METADATA_MAX_KEYS) throw new WeKnoraError('LIMIT')
    for (const [key, value] of entries) {
      if (!key.trim() || key.trim().length > CUSTOM_METADATA_KEY_MAX) throw new WeKnoraError('LIMIT')
      // 只允许扁平标量；嵌套对象或数组会被服务端拒绝。
      if (value !== null && typeof value === 'object') throw new WeKnoraError('LIMIT')
      if (String(value).length > CUSTOM_METADATA_VALUE_MAX) throw new WeKnoraError('LIMIT')
    }
    const data = await this.request<unknown>({
      method: 'PUT', path: `/knowledge/${encodeURIComponent(knowledgeId)}`, idempotent: false, signal,
      body: { custom_metadata: customMetadata },
    })
    return this.toDetail(knowledgeSchema.parse(data))
  }
  /**
   * 发布或改正文。必须携带完整非空正文与显式 status=publish；
   * 省略 status 会被服务端当作 draft，把已发布文档打回草稿。
   */
  async publishManual(knowledgeId: string, body: string, processConfig: unknown = LOW_COST_PROCESS_CONFIG, signal?: AbortSignal): Promise<KnowledgeDetail> {
    this.assertManualContent(body)
    const data = await this.request<unknown>({
      method: 'PUT', path: `/knowledge/manual/${encodeURIComponent(knowledgeId)}`, idempotent: false, signal,
      body: { content: body, status: MANUAL_PUBLISH, process_config: processConfig },
    })
    return this.toDetail(knowledgeSchema.parse(data))
  }
  /** 本地先拒绝超限正文；服务端上限为 200000 字符。 */
  private assertManualContent(content: string): void {
    if (!content.trim().length) throw new WeKnoraError('LIMIT')
    if ([...content].length > MANUAL_CONTENT_MAX) throw new WeKnoraError('LIMIT')
  }
  /** 删除。200 仅表示入队；完成需由调用方以 GET 404 确认。 */
  async deleteKnowledge(knowledgeId: string, signal?: AbortSignal): Promise<void> {
    await this.request<unknown>({ method: 'DELETE', path: `/knowledge/${encodeURIComponent(knowledgeId)}`, idempotent: false, signal })
  }
}

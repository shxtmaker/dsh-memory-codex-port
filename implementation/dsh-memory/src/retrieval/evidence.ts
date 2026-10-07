/**
 * 知识检索的证据生命周期：预留 → 结算 → 退役，以及失效与重启对账。
 *
 * 计量口径与方案第 4.2 节一致：
 *   本地直接证据 1024 UTF-8 字节（沿用既有 budget_ledger，整会话累计）
 *   远端活动槽位 3072 UTF-8 字节，每会话同时只有一份
 *   退役后短引用合计最多 256 UTF-8 字节
 * 本地账本与远端槽位互不占用；两者合计不超过 4096。
 *
 * 本模块不直接触达 SQLite 或 HTTP：存储与传输通过注入的端口提供，便于隔离测试。
 */
import { WeKnoraClient, WeKnoraError, isWeKnoraError, bodyHash } from '../weknora/client.ts'
import { rankAcross, renderEvidence, clipPage, TurnCounter, formatSearchResult, formatReadResult, type RankedHit } from './router.ts'
import type { ExternalEvidence, KnowledgeOutcome, RemoteRef, WeKnoraConnection, ConnectionSettings, ProjectBinding } from '../contracts.ts'

/** 远端槽位在一次用户轮内允许的工具调用次数上限。 */
export interface KnowledgeLimits {
  matchCount: number
  vectorThreshold: number
  keywordThreshold: number
  requestDeadlineMs: number
  remoteEvidenceBytes: number
  retiredReferenceBytes: number
  maxKnowledgeCallsPerTurn: number
}

export interface ResolvedConnection { connection: WeKnoraConnection & ConnectionSettings; apiKey: string }

/** 存储、凭据与网络的最小端口；生产实现由 index.ts 提供。 */
export interface KnowledgePort {
  /** 读取连接设置与解析后的读取凭据；连接不由调用方缓存。 */
  readAccess(connectionId: string): Promise<ResolvedConnection>
  /** 解析发布凭据；未配置时抛错。 */
  publishAccess(connectionId: string): Promise<ResolvedConnection>
  binding(projectId: string): Promise<ProjectBinding>
  reserveSlot(sessionId: string, userTurn: number, toolCallId: string, createdSeq: number, connectionId: string, kbIds: string[], toolName: 'search' | 'read', bindingRevision: number): Promise<ExternalEvidence>
  slotCheck(slotId: string, projectId: string): Promise<{ ok: boolean; code: string }>
  activateSlot(slotId: string, resultSeq: number, contentBytes: number, refs: RemoteRef[]): Promise<{ slot: ExternalEvidence; replaced: string }>
  releaseSlot(slotId: string, reason: string): Promise<void>
  retireSlot(slotId: string, content: string, limit: number): Promise<void>
  activeSlot(sessionId: string): Promise<ExternalEvidence | null>
  markSlotBuild(slotId: string, patch: Record<string, unknown>): Promise<void>
  slot(slotId: string): Promise<ExternalEvidence | null>
}

export interface SearchInput { sessionId: string; projectId: string; userTurn: number; toolCallId: string; createdSeq: number; query: string; caller: AbortSignal }
export interface ReadInput { sessionId: string; projectId: string; userTurn: number; toolCallId: string; createdSeq: number; knowledgeId: string; cursor: number; caller: AbortSignal }
export interface KnowledgeReply { text: string; outcome: KnowledgeOutcome; slotId: string; refs: RemoteRef[] }

/** 未配置连接、凭据缺失、越权与超时都映射到固定的可诊断代码。 */
function fromError(error: unknown, signal: AbortSignal): KnowledgeOutcome {
  if (signal.aborted) return { ok: false, code: 'CANCELLED', status: 0, message: '请求已取消。' }
  if (isWeKnoraError(error)) {
    const map: Record<string, KnowledgeOutcome['code']> = {
      UNAUTHORIZED: 'UNAUTHORIZED', KB_DENIED: 'KB_DENIED', NOT_FOUND: 'NOT_FOUND', BAD_REQUEST: 'UPSTREAM',
      CONFLICT: 'UPSTREAM', RATE_LIMITED: 'UPSTREAM', UPSTREAM: 'UPSTREAM', DEADLINE: 'DEADLINE',
      CANCELLED: 'CANCELLED', MALFORMED: 'UPSTREAM', NETWORK: 'UPSTREAM', CONFIG: 'NOT_CONFIGURED', LIMIT: 'TOO_LARGE',
    }
    return { ok: false, code: map[error.code] ?? 'UPSTREAM', status: error.status, message: `知识库返回 ${error.code}（HTTP ${error.status}）。` }
  }
  const code = error instanceof Error ? error.message : 'UPSTREAM'
  if (code === 'BINDING_MISSING') return { ok: false, code: 'NO_BINDING', status: 0, message: '该项目未配置知识库。' }
  if (code === 'NOT_CONFIGURED') return { ok: false, code: 'NOT_CONFIGURED', status: 0, message: '连接未配置或凭据不可用。' }
  if (code === 'READ_DISABLED') return READ_DISABLED
  if (code === 'TURN_LIMIT') return { ok: false, code: 'TURN_LIMIT', status: 0, message: '本用户轮知识工具调用次数已达上限。' }
  if (code === 'SLOT_BUSY' || code === 'SLOT_OCCUPIED') return { ok: false, code: 'SLOT_BUSY', status: 0, message: '同轮已有远端结果，正在替换。' }
  if (code === 'SOURCE_RETIRED') return { ok: false, code: 'SOURCE_RETIRED', status: 0, message: '该结果已退役。' }
  return { ok: false, code: 'UPSTREAM', status: 0, message: '知识检索失败。' }
}

const READ_DISABLED: KnowledgeOutcome = { ok: false, code: 'READ_DISABLED', status: 0, message: '知识检索未开启。' }

/**
 * 一次知识工具调用的完整执行器。
 *
 * 每次调用都在单一总截止内完成 HTTP、校验、格式化与提交前检查；
 * 取消与逾期只释放资源，不产生迟到的补注入。
 */
export class KnowledgeService {
  private readonly counters = new Map<string, TurnCounter>()
  constructor(private readonly port: KnowledgePort, private readonly client: (access: ResolvedConnection, deadlineMs: number) => WeKnoraClient) {}

  /** 每用户轮的调用计数；超限即在 HTTP 之前拒绝。 */
  private counter(sessionId: string): TurnCounter {
    let counter = this.counters.get(sessionId)
    if (!counter) { counter = new TurnCounter(Number.MAX_SAFE_INTEGER); this.counters.set(sessionId, counter) }
    return counter
  }
  /** 会话关闭或重启时清理计数。 */
  forget(sessionId: string): void { this.counters.delete(sessionId) }

  private async within<T>(caller: AbortSignal, deadlineMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const signal = AbortSignal.any([caller, controller.signal])
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new WeKnoraError('DEADLINE')) }, deadlineMs) })
    try { return await Promise.race([work(signal), timeout]) } finally { if (timer) clearTimeout(timer) }
  }

  private async prepare(input: { sessionId: string; projectId: string; userTurn: number; connectionId: string; bindingRevision: number; kbIds: string[]; toolName: 'search' | 'read' }, limits: KnowledgeLimits): Promise<ResolvedConnection> {
    const counter = this.counter(input.sessionId)
    if (!counter.use(input.userTurn, limits.maxKnowledgeCallsPerTurn)) throw new Error('TURN_LIMIT')
    const access = await this.port.readAccess(input.connectionId)
    if (!access.connection.readEnabled) throw new Error('READ_DISABLED')
    return access
  }

  /**
   * 同轮替换的第一半：把当前活动槽位退役为短引用。
   * 单槽位约束在存储层，因此新结果提交前必须先撤下旧正文；
   * 旧正文未成功退役时不继续预留，避免出现两份模型可见正文。
   */
  private async clearActive(sessionId: string, limit: number): Promise<string> {
    const active = await this.port.activeSlot(sessionId)
    if (!active) return ''
    await this.port.retireSlot(active.slotId, `[已替换] ${active.remoteRefs.map(ref => `${ref.knowledgeId.slice(0, 8)}#${ref.chunkId.slice(0, 8)}`).join(' ')}`, limit)
    return active.slotId
  }

  /**
   * 检索：每库最多一次有界召回，按库内排名轮转融合后裁剪为有界证据。
   * 提交前先撤下旧槽位正文；旧正文未成功退役就不发布新结果。
   */
  async search(input: SearchInput, limits: KnowledgeLimits): Promise<KnowledgeReply> {
    let slot: ExternalEvidence | null = null
    try {
      const binding = await this.port.binding(input.projectId)
      const kbIds = binding.readKbIds.slice(0, 2)
      const access = await this.prepare({ ...input, connectionId: binding.connectionId, bindingRevision: binding.bindingRevision, kbIds, toolName: 'search' }, limits)
      // 旧正文先退役，再预留新槽位。
      await this.clearActive(input.sessionId, limits.retiredReferenceBytes)
      slot = await this.port.reserveSlot(input.sessionId, input.userTurn, input.toolCallId, input.createdSeq, binding.connectionId, kbIds, 'search', binding.bindingRevision)
      const client = this.client(access, limits.requestDeadlineMs)
      const fetchedAt = Date.now()
      const perBase: RankedHit[][] = []
      const failures: KnowledgeOutcome[] = []
      for (const kbId of kbIds) {
        try {
          const hits = await this.within(input.caller, limits.requestDeadlineMs, signal => client.hybridSearch(kbId, {
            queryText: input.query, matchCount: limits.matchCount,
            vectorThreshold: limits.vectorThreshold, keywordThreshold: limits.keywordThreshold, skipContextEnrichment: true,
          }, signal))
          perBase.push(hits.map((hit, index) => ({ kbId: hit.kbId || kbId, kbRank: index, knowledgeId: hit.knowledgeId, chunkId: hit.chunkId, title: hit.title, content: hit.content, score: hit.score, bodyHash: hit.bodyHash, fetchedAt, matchType: hit.matchType })))
        } catch (error) { failures.push(fromError(error, input.caller)) }
      }
      // 全部库都失败时才整体失败；部分失败仍返回可用证据，但必须写明降级。
      if (!perBase.length && failures.length) {
        await this.port.releaseSlot(slot.slotId, failures[0].code)
        return { text: formatSearchResult([], failures[0].code, failures[0].message), outcome: failures[0], slotId: '', refs: [] }
      }
      // 保留一条引用配额，避免同一文档占满全部三条。
      const ranked = rankAcross(perBase, limits.matchCount)
      const evidence = renderEvidence(ranked, { activeBytes: 0, retiredBytes: 0, limitBytes: limits.remoteEvidenceBytes, retiredLimitBytes: limits.retiredReferenceBytes })
      if (evidence.code !== 'OK') {
        await this.port.releaseSlot(slot.slotId, 'TOO_LARGE')
        const outcome: KnowledgeOutcome = { ok: false, code: 'TOO_LARGE', status: 0, message: '本次检索结果超出槽位字节上限，未提交。' }
        return { text: formatSearchResult([], outcome.code, outcome.message), outcome, slotId: '', refs: [] }
      }
      const check = await this.port.slotCheck(slot.slotId, input.projectId)
      if (!check.ok) {
        await this.port.releaseSlot(slot.slotId, check.code)
        const outcome: KnowledgeOutcome = { ok: false, code: check.code as KnowledgeOutcome['code'], status: 0, message: '提交前校验未通过，结果未注入。' }
        return { text: formatSearchResult([], outcome.code, outcome.message), outcome, slotId: '', refs: [] }
      }
      const activated = await this.port.activateSlot(slot.slotId, input.createdSeq, evidence.bytes, evidence.used)
      await this.port.markSlotBuild(activated.slot.slotId, {
        nextCursor: 0,
        partial: failures.length ? `部分库不可用：${failures.map(item => item.code).join(',')}` : '',
        build: { matchCount: limits.matchCount, vectorThreshold: limits.vectorThreshold, keywordThreshold: limits.keywordThreshold },
      })
      const outcome: KnowledgeOutcome = failures.length
        ? { ok: true, code: 'OK', status: 0, message: `部分库不可用：${failures.map(item => item.code).join(',')}；以下为按时返回的合规结果。` }
        : { ok: true, code: 'OK', status: 0, message: '' }
      // 证据正文由唯一渲染器产出；降级说明附在其后，不额外包装一次。
      const text = outcome.message ? `${evidence.text}\n\n[降级] ${outcome.message}` : evidence.text
      return { text, outcome, slotId: activated.slot.slotId, refs: evidence.used }
    } catch (error) {
      if (slot) await this.port.releaseSlot(slot.slotId, 'FAILED').catch(() => {})
      const outcome = fromError(error, input.caller)
      if (outcome.code === 'NO_BINDING' || outcome.code === 'NOT_CONFIGURED') {
        return { text: formatSearchResult([], outcome.code, outcome.message), outcome, slotId: '', refs: [] }
      }
      if (outcome.code === 'CANCELLED' || outcome.code === 'DEADLINE') {
        // 仅返回按时完成的合规结果；逾期一律不注入。
        return { text: '', outcome, slotId: '', refs: [] }
      }
      return { text: formatSearchResult([], outcome.code, outcome.message), outcome, slotId: '', refs: [] }
    }
  }

  /**
   * 按需读取文档分页。新页提交前撤下旧远端正文；旧正文未撤下就不发布新页。
   * 必须给出 knowledgeId，不能沿用上一轮的槽位目标。
   */
  async read(input: ReadInput, limits: KnowledgeLimits): Promise<KnowledgeReply> {
    let slot: ExternalEvidence | null = null
    try {
      const binding = await this.port.binding(input.projectId)
      const kbIds = binding.readKbIds.slice(0, 2)
      const access = await this.prepare({ ...input, connectionId: binding.connectionId, bindingRevision: binding.bindingRevision, kbIds, toolName: 'read' }, limits)
      // 新页提交前撤下旧远端正文。
      await this.clearActive(input.sessionId, limits.retiredReferenceBytes)
      slot = await this.port.reserveSlot(input.sessionId, input.userTurn, input.toolCallId, input.createdSeq, binding.connectionId, kbIds, 'read', binding.bindingRevision)
      const client = this.client(access, limits.requestDeadlineMs)
      const detail = await this.within(input.caller, limits.requestDeadlineMs, signal => client.getKnowledge(input.knowledgeId, signal))
      // 父库必须在当前绑定范围内；不信任客户端提供的库归属。
      if (!kbIds.includes(detail.kbId)) {
        await this.port.releaseSlot(slot.slotId, 'KB_DENIED')
        const outcome: KnowledgeOutcome = { ok: false, code: 'KB_DENIED', status: 0, message: '该文档不属于本项目绑定的知识库。' }
        return { text: formatSearchResult([], outcome.code, outcome.message), outcome, slotId: '', refs: [] }
      }
      const page = await this.within(input.caller, limits.requestDeadlineMs, signal => client.listChunks(input.knowledgeId, Math.max(1, input.cursor), 20, signal))
      const enabled = page.chunks.filter(chunk => chunk.isEnabled)
      const clipped = clipPage(enabled, limits.remoteEvidenceBytes)
      if (!clipped.blocks.length) {
        await this.port.releaseSlot(slot.slotId, 'TOO_LARGE')
        const outcome: KnowledgeOutcome = { ok: false, code: 'TOO_LARGE', status: 0, message: '本页正文超出槽位字节上限，未提交。' }
        return { text: formatSearchResult([], outcome.code, outcome.message), outcome, slotId: '', refs: [] }
      }
      const refs: RemoteRef[] = clipped.blocks.map((block, index) => {
        const chunk = enabled[index]
        return { kbId: detail.kbId, knowledgeId: input.knowledgeId, chunkId: chunk?.id ?? '', rank: index, score: 0, bodyHash: bodyHash(block), title: detail.title, fetchedAt: Date.now() }
      })
      const check = await this.port.slotCheck(slot.slotId, input.projectId)
      if (!check.ok) {
        await this.port.releaseSlot(slot.slotId, check.code)
        const outcome: KnowledgeOutcome = { ok: false, code: check.code as KnowledgeOutcome['code'], status: 0, message: '提交前校验未通过，本页未注入。' }
        return { text: formatSearchResult([], outcome.code, outcome.message), outcome, slotId: '', refs: [] }
      }
      const activated = await this.port.activateSlot(slot.slotId, input.createdSeq, clipped.bytes, refs)
      await this.port.markSlotBuild(activated.slot.slotId, { nextCursor: clipped.nextCursor, knowledgeId: input.knowledgeId, page: page.page })
      const outcome: KnowledgeOutcome = { ok: true, code: 'OK', status: 0, message: '' }
      return { text: formatReadResult({ knowledgeId: input.knowledgeId, title: detail.title, page: page.page, blocks: clipped.blocks, total: page.total, code: 'OK', message: '' }), outcome, slotId: activated.slot.slotId, refs }
    } catch (error) {
      if (slot) await this.port.releaseSlot(slot.slotId, 'FAILED').catch(() => {})
      const outcome = fromError(error, input.caller)
      if (outcome.code === 'CANCELLED' || outcome.code === 'DEADLINE') return { text: '', outcome, slotId: '', refs: [] }
      return { text: formatReadResult({ knowledgeId: input.knowledgeId, title: '', page: input.cursor, blocks: [], total: 0, code: outcome.code, message: outcome.message }), outcome, slotId: '', refs: [] }
    }
  }

  /**
   * 下一用户轮入口：把上一轮的远端活动结果退役为短引用。
   * 只在用户轮边界执行，不在每个 agent step 清理。
   */
  async retireOnNewTurn(sessionId: string, limit: number): Promise<{ retired: string[] }> {
    const active = await this.port.activeSlot(sessionId)
    if (!active) return { retired: [] }
    // 正文已从模型可见面移除，槽位只保留身份与配对所需的短引用。
    await this.port.retireSlot(active.slotId, `[${active.toolName}] ${active.remoteRefs.map(ref => `${ref.knowledgeId.slice(0, 8)}#${ref.chunkId.slice(0, 8)}`).join(' ')}`, limit)
    return { retired: [active.slotId] }
  }

  /**
   * 即时失效：关闭检索、解绑、凭据或 tenant 变化、来源撤回、远端墓碑生效。
   * 在下一次模型请求之前撤下相关正文与短引用。
   */
  async invalidate(sessionId: string, reason: string, limit: number): Promise<{ retired: string[] }> {
    const active = await this.port.activeSlot(sessionId)
    if (!active) return { retired: [] }
    await this.port.retireSlot(active.slotId, `[已失效：${reason}]`, limit)
    return { retired: [active.slotId] }
  }
}

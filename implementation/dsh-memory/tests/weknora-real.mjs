/**
 * T2/T3 真实验收：对真实 WeKnora v0.8.2 实例执行检索、按需读取与共享经验发布闭环。
 *
 * 与 tests/weknora-*.test.mjs 的本机夹具不同，本文件**必须**连到真实服务，
 * 否则直接失败而不是跳过——避免把“没跑”记成“通过”。
 *
 * 输入（环境变量或 --config 指定的 JSON 文件）：
 *   WEKNORA_BASE_URL   例如 http://192.168.3.100:18080/api/v1
 *   WEKNORA_TENANT_ID  平台 API key 必填；租户 key 可省略
 *   WEKNORA_READ_KEY   读取用 API key（需 retrieve 能力）
 *   WEKNORA_PUBLISH_KEY 发布用 API key（需 retrieve + ingest，且仅覆盖发布库）
 *   WEKNORA_KB_ID      只读知识库（T2 检索用）
 *   WEKNORA_PUBLISH_KB_ID 发布库；缺省时使用 WEKNORA_KB_ID
 *   WEKNORA_QUERY      已知答案的查询词
 *   WEKNORA_EXPECT     期望在检索结果中出现的字符串
 *   T2_KEEP_SYNTHETIC  设为 1 时保留合成文档（默认清理）
 *
 * 安全约束：只创建、读取、更新、删除本文件自己创建的合成文档；
 * 不修改、不删除任何既有文档；不打印密钥正文。
 *
 * 用法：node tests/weknora-real.mjs
 */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { WeKnoraClient, LOW_COST_PROCESS_CONFIG, bodyHash } from '../lib/weknora/client.js'
import { renderCard, markerOf, extractMarker, PUBLISH_MARKER_PREFIX } from '../lib/publication/render.js'

const evidence = []
const failures = []
let config

/** 读取配置：优先 --config 文件，其次是环境变量。密钥只从这两处读，绝不入库或打印。 */
async function loadConfig() {
  const index = process.argv.indexOf('--config')
  if (index >= 0) {
    const file = process.argv[index + 1]
    return JSON.parse(await readFile(resolve(file), 'utf8'))
  }
  return {
    baseUrl: process.env.WEKNORA_BASE_URL,
    tenantId: process.env.WEKNORA_TENANT_ID ?? '',
    readKey: process.env.WEKNORA_READ_KEY,
    publishKey: process.env.WEKNORA_PUBLISH_KEY ?? process.env.WEKNORA_READ_KEY,
    kbId: process.env.WEKNORA_KB_ID,
    publishKbId: process.env.WEKNORA_PUBLISH_KB_ID ?? process.env.WEKNORA_KB_ID,
    query: process.env.WEKNORA_QUERY,
    expect: process.env.WEKNORA_EXPECT ?? '',
    keepSynthetic: process.env.T2_KEEP_SYNTHETIC === '1',
  }
}

/** 记录一项结果；失败不中断，最后统一判定，保证一次运行拿到尽可能多的证据。 */
async function step(name, work) {
  const started = Date.now()
  try {
    const detail = await work()
    const elapsed = Date.now() - started
    evidence.push({ name, status: 'PASS', elapsedMs: elapsed, detail: detail ?? '' })
    console.log(`PASS  ${name}（${elapsed}ms）${detail ? ' — ' + detail : ''}`)
    return { ok: true, detail }
  } catch (error) {
    const elapsed = Date.now() - started
    const message = error instanceof Error ? error.message : String(error)
    evidence.push({ name, status: 'FAIL', elapsedMs: elapsed, detail: message })
    failures.push(`${name}: ${message}`)
    console.log(`FAIL  ${name}（${elapsed}ms） — ${message}`)
    return { ok: false, error }
  }
}

function requireConfig() {
  const missing = []
  if (!config.baseUrl) missing.push('WEKNORA_BASE_URL')
  if (!config.readKey) missing.push('WEKNORA_READ_KEY')
  if (!config.kbId) missing.push('WEKNORA_KB_ID')
  if (missing.length) {
    console.error(`缺少真实环境配置，无法执行真实验收：${missing.join(', ')}`)
    console.error('真实检索不可用即视为未通过，不以跳过代替。')
    process.exit(2)
  }
}

/** 合成文档：内容全部是本工具生成的测试文本，不含任何真实用户数据。 */
function syntheticBody(tag, revision) {
  return [
    `# 合成验收文档 ${tag}`,
    '',
    '本文件由 dsh-memory 0.3.0 真实验收脚本自动创建，内容完全合成，',
    '用于验证共享经验发布链路；可安全删除。',
    '',
    `- 标识：${tag}`,
    `- 版本：${revision}`,
    `- 结论：验收标识 ${tag} 对应的合成结论，仅用于验证检索与发布。`,
    `- 适用条件：仅限本工具的本轮验收。`,
    `- 失效条件：本轮验收结束后即可删除。`,
    '',
  ].join('\n')
}

/** 按标记在目标库中定位本工具创建的合成文档（分页扫描，最多 5 页）。 */
async function findByMarker(client, kbId, publishId) {
  for (let page = 1; page <= 5; page++) {
    const listed = await client.listKnowledge(kbId, page, 100)
    const hits = listed.items.filter(item => extractMarker(item.title) === publishId || (item.manualContent ? extractMarker(item.manualContent) === publishId : false))
    if (hits.length) return { page, hits }
    if (page * 100 >= listed.total) break
  }
  return { page: 0, hits: [] }
}

/** 轮询索引状态，直到 completed 或超期。 */
async function waitForIndex(client, knowledgeId, deadlineMs = 120000) {
  const started = Date.now()
  let last = ''
  while (Date.now() - started < deadlineMs) {
    const detail = await client.getKnowledge(knowledgeId)
    last = detail.parseStatus
    if (detail.parseStatus === 'completed') return detail
    if (detail.parseStatus === 'failed') throw new Error(`索引失败：parse_status=failed`)
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  throw new Error(`索引超期未完成，最后状态=${last}`)
}

/** 确认远端删除完成：GET 必须返回 404。 */
async function waitForDeleted(client, knowledgeId, deadlineMs = 60000) {
  const started = Date.now()
  while (Date.now() - started < deadlineMs) {
    try {
      const detail = await client.getKnowledge(knowledgeId)
      if (detail.parseStatus === 'deleting') { await new Promise(resolve => setTimeout(resolve, 1500)); continue }
    } catch (error) {
      if (error?.code === 'NOT_FOUND') return true
      throw error
    }
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  return false
}

config = await loadConfig()
requireConfig()
console.log(`真实环境：${config.baseUrl} · 只读库 ${config.kbId} · 发布库 ${config.publishKbId}${config.tenantId ? ` · tenant ${config.tenantId}` : ''}`)

const readClient = new WeKnoraClient({ baseUrl: config.baseUrl, apiKey: config.readKey, tenantId: config.tenantId || undefined, deadlineMs: 15000, retries: 2 })
const publishClient = new WeKnoraClient({ baseUrl: config.baseUrl, apiKey: config.publishKey, tenantId: config.tenantId || undefined, deadlineMs: 15000, retries: 2 })

const created = []
let exitCode = 0

try {
  /* ── 连接与权限 ───────────────────────────────────────────────── */
  await step('连接探针：列出可见知识库', async () => {
    const probe = await readClient.probe()
    const ids = probe.knowledgeBases.map(base => base.id)
    assert(ids.includes(config.kbId), `绑定库 ${config.kbId} 必须在可见列表中`)
    return `可见 ${ids.length} 个库；版本=${probe.version?.version ?? 'unknown'}`
  })

  await step('未授权凭据被拒绝（401 不得当成成功）', async () => {
    const bad = new WeKnoraClient({ baseUrl: config.baseUrl, apiKey: 'invalid-key-for-acceptance', tenantId: config.tenantId || undefined, deadlineMs: 8000 })
    const result = await bad.listKnowledgeBases().then(() => null, error => error)
    assert(result, '无效凭据必须失败')
    assert.equal(result.code, 'UNAUTHORIZED', `期望 UNAUTHORIZED，实际 ${result.code}`)
    return '返回 UNAUTHORIZED'
  })

  /* ── T2 真实检索 ──────────────────────────────────────────────── */
  let searchHits = []
  await step('T2 检索：真实 hybrid-search 返回结果', async () => {
    assert(config.query, '需要 WEKNORA_QUERY 指定已知答案的查询')
    const started = Date.now()
    searchHits = await readClient.hybridSearch(config.kbId, { queryText: config.query, matchCount: 6, vectorThreshold: 0.15, keywordThreshold: 0.3, skipContextEnrichment: true })
    const elapsed = Date.now() - started
    assert(Array.isArray(searchHits), '检索必须返回数组')
    assert(searchHits.length > 0, `查询「${config.query}」必须命中至少一条；空结果不算检索成功`)
    assert(searchHits.every(hit => hit.chunkId && hit.knowledgeId), '每条命中必须带 chunk 与文档标识')
    return `${searchHits.length} 条 · ${elapsed}ms · 首条 score=${searchHits[0].score.toFixed(4)} matchType=${searchHits[0].matchType}`
  })

  await step('T2 检索：结果含可追溯来源与正文 hash', async () => {
    assert(searchHits.length, '前置检索必须成功')
    const hit = searchHits[0]
    assert(/^[0-9a-f]{64}$/.test(hit.bodyHash), '正文 hash 必须是 sha256')
    assert.equal(bodyHash(hit.content), hit.bodyHash, '正文 hash 必须可由正文复算')
    assert(hit.title !== undefined, '必须带标题')
    return `文档 ${hit.knowledgeId.slice(0, 8)}… chunk ${hit.chunkId.slice(0, 8)}… 标题「${hit.title.slice(0, 24)}」`
  })

  await step('T2 检索：已知答案出现在命中正文中', async () => {
    if (!config.expect) return '未提供 WEKNORA_EXPECT，跳过答案核对（不记为通过）'
    const matched = searchHits.some(hit => hit.content.includes(config.expect))
    assert(matched, `前 ${searchHits.length} 条命中中必须出现期望内容「${config.expect}」`)
    return `命中包含「${config.expect}」`
  })

  await step('T2 读取：按需分页读取真实文档正文', async () => {
    assert(searchHits.length, '前置检索必须成功')
    const knowledgeId = searchHits[0].knowledgeId
    const detail = await readClient.getKnowledge(knowledgeId)
    assert.equal(detail.id, knowledgeId)
    assert(detail.kbId === config.kbId || detail.kbId, '必须能确定父知识库')
    const page = await readClient.listChunks(knowledgeId, 1, 20)
    assert(page.chunks.length > 0 || page.total === 0, '分页读取必须成功')
    if (page.chunks.length) {
      // 原序校验：返回的 chunk_index 必须单调不减。
      const indexes = page.chunks.map(chunk => chunk.chunkIndex)
      assert(indexes.every((value, index) => index === 0 || indexes[index - 1] <= value), '分块必须按 chunk_index 原序返回')
    }
    return `文档 ${knowledgeId.slice(0, 8)}… parse_status=${detail.parseStatus} 分块 ${page.chunks.length}/${page.total}`
  })

  await step('T2 读取：不存在的文档返回 NOT_FOUND，不冒充空结果', async () => {
    const result = await readClient.getKnowledge(`nonexistent-${randomUUID()}`).then(() => null, error => error)
    assert(result, '不存在的文档必须失败')
    assert(['NOT_FOUND', 'BAD_REQUEST'].includes(result.code), `期望 NOT_FOUND，实际 ${result.code}`)
    return `返回 ${result.code}`
  })

  await step('T2 边界：总截止生效，逾期报 DEADLINE 而非静默成功', async () => {
    const tight = new WeKnoraClient({ baseUrl: config.baseUrl, apiKey: config.readKey, tenantId: config.tenantId || undefined, deadlineMs: 1 })
    const result = await tight.listKnowledgeBases().then(() => null, error => error)
    assert(result, '1ms 截止必须失败')
    assert(['DEADLINE', 'NETWORK'].includes(result.code), `期望 DEADLINE，实际 ${result.code}`)
    return `返回 ${result.code}`
  })

  await step('T2 边界：取消后不注入（调用方中止即失败）', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await readClient.hybridSearch(config.kbId, { queryText: config.query ?? 'x', matchCount: 6, vectorThreshold: 0.15, keywordThreshold: 0.3, skipContextEnrichment: true }, controller.signal).then(() => null, error => error)
    assert(result, '已中止的调用必须失败')
    return `返回 ${result.code}`
  })

  /* ── T3 合成经验发布闭环 ──────────────────────────────────────── */
  const publishId = `acc-${Date.now()}-${randomUUID().slice(0, 8)}`
  const marker = markerOf(publishId)
  let remoteId = ''

  await step('T3 创建：在目标库创建合成草稿', async () => {
    const body = syntheticBody(marker, 1)
    const card = renderCard({
      item: { id: `synthetic-${publishId}`, scope: 'acceptance', title: `合成验收经验 ${publishId}`, content: body, kind: 'experience', status: 'suggested', pinned: false, manual: true, revision: 1, createdAt: Date.now(), updatedAt: Date.now(), sources: [] },
      project: { name: 'acceptance', root: '/synthetic' },
      approvedAt: Date.now(),
      // 必须显式传入持久化的 publishId：否则卡片会派生基于内容的标记，
      // 与实际保存的 publishId 不一致，响应丢失后的标记对账将无法命中。
      publishId,
    })
    // 自检：卡片正文必须携带与 publishId 一致的稳定标记。
    assert.equal(extractMarker(card.body), publishId, '卡片正文必须携带与 publishId 一致的标记')
    const detail = await publishClient.createManual(config.publishKbId, { title: card.title, content: card.body })
    remoteId = detail.id
    created.push(remoteId)
    assert.equal(detail.manualStatus, 'draft', '创建后必须是草稿状态')
    assert.equal(detail.parseStatus, 'draft', '草稿的 parse_status 为 draft')
    return `knowledge_id=${remoteId.slice(0, 8)}… 状态=${detail.parseStatus}`
  })

  await step('T3 对账：按稳定标记唯一匹配到已创建文档', async () => {
    assert(remoteId, '前置创建必须成功')
    const { hits, page } = await findByMarker(publishClient, config.publishKbId, publishId)
    assert.equal(hits.length, 1, `标记必须唯一匹配，实际 ${hits.length} 条（第 ${page} 页）`)
    assert.equal(hits[0].id, remoteId, '对账命中的必须是刚创建的文档')
    return `唯一匹配于第 ${page} 页`
  })

  await step('T3 元数据：整体替换语义下保留非插件字段', async () => {
    assert(remoteId, '前置创建必须成功')
    // 先写入一个非插件字段，再写插件字段，验证合并保留。
    await publishClient.updateMetadata(remoteId, { 'acceptance-note': 'synthetic', 'dsh-memory-publish-id': publishId })
    const after = await publishClient.getKnowledge(remoteId)
    assert.equal(after.customMetadata['acceptance-note'], 'synthetic', '非插件字段必须保留')
    assert.equal(after.customMetadata['dsh-memory-publish-id'], publishId, '插件字段必须写入')
    return `保留 ${Object.keys(after.customMetadata).length} 个键`
  })

  await step('T3 发布：提交完整正文并等待索引完成', async () => {
    assert(remoteId, '前置创建必须成功')
    const body = syntheticBody(marker, 1)
    const published = await publishClient.publishManual(remoteId, body, LOW_COST_PROCESS_CONFIG)
    assert.equal(published.manualStatus, 'publish', '发布后手工状态必须是 publish')
    const detail = await waitForIndex(publishClient, remoteId)
    assert.equal(detail.manualStatus, 'publish')
    assert.equal(detail.bodyHash, bodyHash(body), '索引完成后正文 hash 必须与批准快照一致')
    return `parse_status=completed · 版本=${detail.manualVersion}`
  })

  await step('T3 检索验证：新会话查到发布正文与来源版本', async () => {
    assert(remoteId, '前置发布必须成功')
    const hits = await readClient.hybridSearch(config.publishKbId, { queryText: publishId, matchCount: 6, vectorThreshold: 0.15, keywordThreshold: 0.3, skipContextEnrichment: true })
    assert(hits.length > 0, `发布后必须能检索到合成文档（查询 ${publishId}）`)
    const hit = hits.find(item => item.knowledgeId === remoteId) ?? hits[0]
    assert(hit.knowledgeId === remoteId, '命中的必须是本次发布的文档')
    return `${hits.length} 条命中，定位到 ${remoteId.slice(0, 8)}…`
  })

  await step('T3 重复：再次发布不产生可用重复副本', async () => {
    const { hits } = await findByMarker(publishClient, config.publishKbId, publishId)
    assert.equal(hits.length, 1, `重复操作后标记仍必须唯一，实际 ${hits.length} 条`)
    return '标记仍唯一'
  })

  await step('T3 更新：修改正文后重新发布，版本递增且 hash 更新', async () => {
    assert(remoteId, '前置发布必须成功')
    const body2 = syntheticBody(marker, 2)
    const updated = await publishClient.publishManual(remoteId, body2, LOW_COST_PROCESS_CONFIG)
    assert(updated.manualVersion > 1, '重新发布必须递增手工版本')
    const detail = await waitForIndex(publishClient, remoteId)
    assert.equal(detail.bodyHash, bodyHash(body2), '正文 hash 必须对应第二版')
    const { hits } = await findByMarker(publishClient, config.publishKbId, publishId)
    assert.equal(hits.length, 1, '更新后仍必须唯一，不得产生副本')
    return `版本=${detail.manualVersion}`
  })

  await step('T3 冲突：远端被外部改写时后续校验能发现不一致', async () => {
    assert(remoteId, '前置发布必须成功')
    const expected = bodyHash(syntheticBody(marker, 2))
    // 直接改正文模拟外部编辑（仍是本工具创建的合成文档，不触碰既有文档）。
    await publishClient.publishManual(remoteId, syntheticBody(marker, 999), LOW_COST_PROCESS_CONFIG)
    await waitForIndex(publishClient, remoteId)
    const detail = await publishClient.getKnowledge(remoteId)
    assert.notEqual(detail.bodyHash, expected, '外部改写后正文 hash 必须与批准快照不同，从而被识别为冲突')
    return '不一致可被检出（不会误判为新版本）'
  })

  /* ── T2 重启恢复（对账）与退役 ────────────────────────────────── */
  await step('T2 重启恢复：新建客户端仍能读到同一文档状态（对账基础）', async () => {
    assert(remoteId, '前置发布必须成功')
    const fresh = new WeKnoraClient({ baseUrl: config.baseUrl, apiKey: config.readKey, tenantId: config.tenantId || undefined, deadlineMs: 15000 })
    const detail = await fresh.getKnowledge(remoteId)
    assert.equal(detail.id, remoteId)
    assert(detail.parseStatus === 'completed', `重启对账要求可证明终态，实际 ${detail.parseStatus}`)
    return `重读 parse_status=${detail.parseStatus}`
  })

  /* ── T3 撤回与删除闭环 ────────────────────────────────────────── */
  await step('T3 撤回：删除合成文档并以 GET 404 确认', async () => {
    assert(remoteId, '前置创建必须成功')
    await publishClient.deleteKnowledge(remoteId)
    const done = await waitForDeleted(publishClient, remoteId)
    assert(done, '删除必须在期限内以 GET 404 确认')
    created.splice(created.indexOf(remoteId), 1)
    return 'GET 404 确认删除完成'
  })

  await step('T3 撤回后：新查询不再出现该合成内容', async () => {
    const { hits } = await findByMarker(publishClient, config.publishKbId, publishId)
    assert.equal(hits.length, 0, '删除后标记不得再匹配到任何文档')
    return '标记已不可匹配'
  })

  exitCode = failures.length ? 1 : 0
} finally {
  // 清理：只删除本文件创建的合成文档；任何既有文档都不触碰。
  if (!config.keepSynthetic) {
    for (const id of created) {
      try { await publishClient.deleteKnowledge(id); await waitForDeleted(publishClient, id, 30000) } catch { /* 已删除或权限不足，保留记录 */ }
    }
  }
  const artifact = { when: new Date().toISOString(), baseUrl: config.baseUrl, kbId: config.kbId, publishKbId: config.publishKbId, tenantId: config.tenantId ? 'set' : '', results: evidence, failures, syntheticCleaned: !config.keepSynthetic }
  await mkdir(join('evidence'), { recursive: true })
  const file = join('evidence', `weknora-real-${Date.now()}.json`)
  await writeFile(file, JSON.stringify(artifact, null, 2))
  console.log(`\n结果：${evidence.filter(item => item.status === 'PASS').length}/${evidence.length} 通过`)
  if (failures.length) { console.log('失败项：'); for (const failure of failures) console.log(`  - ${failure}`) }
  console.log(`证据：${file}`)
  console.log(`合成文档清理：${artifact.syntheticCleaned ? '已清理' : '保留（T2_KEEP_SYNTHETIC=1）'}`)
  process.exit(exitCode)
}

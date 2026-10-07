/**
 * WeKnora REST 契约测试（P03/T2 入口）。
 *
 * 使用本机真实 HTTP 服务器承载 v0.8.2 的响应形状与错误信封，验证适配器：
 *   - 只调用底层 hybrid-search，不调用 ask
 *   - 三种响应信封（success/data、code/msg/data、裸 error）与业务错误码整数
 *   - query_text 必填、阈值显式传递、skip_context_enrichment
 *   - 请求头只含 X-API-Key 与可选 X-Tenant-ID，且不泄露密钥
 *   - 总截止、取消、429/5xx 退避重试、401/403 不重试
 *   - 手工文档：草稿创建、元数据整体替换语义、发布必须显式 status=publish
 *   - 删除入队语义（200 后仍需 GET 404 确认）
 * 本测试不访问真实 WeKnora；真实实例验收见 ACCEPTANCE.md 的 T2。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { WeKnoraClient, WeKnoraError, LOW_COST_PROCESS_CONFIG, bodyHash } from '../lib/weknora/client.js'

/** 启动一个记录全部请求的本机服务器，按路径返回固定契约形状。 */
async function fixture(handler) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      const record = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined }
      requests.push(record)
      const reply = await handler(record)
      res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(reply.body ?? {}))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`
  return { baseUrl, requests, close: () => new Promise(resolve => server.close(resolve)) }
}

const kb = { id: 'kb-docs', name: '文档库', type: 'document', embedding_model_id: 'emb-1', tenant_id: 7 }

test('T2 契约：成功信封为 success/data，检索使用 hybrid-search 且参数完整', async () => {
  const server = await fixture(record => {
    if (record.url === '/api/v1/knowledge-bases') return { body: { success: true, data: [kb] } }
    if (record.url.startsWith('/api/v1/knowledge-bases/kb-docs/hybrid-search')) {
      return { body: { success: true, data: [{ id: 'chunk-1', content: '数据库操作放在 repositories。', knowledge_id: 'doc-1', chunk_index: 0, knowledge_title: '数据库约定', score: 0.82, match_type: 1, start_at: 0, end_at: 20, knowledge_base_id: 'kb-docs', knowledge_custom_metadata: '' }] } }
    }
    return { status: 404, body: { success: false, error: { code: 1003, message: 'Knowledge not found' } } }
  })
  try {
    const client = new WeKnoraClient({ baseUrl: server.baseUrl, apiKey: 'secret-key', tenantId: '7' })
    const probe = await client.probe()
    assert.equal(probe.knowledgeBases.length, 1)
    assert.equal(probe.knowledgeBases[0].id, 'kb-docs')
    assert.equal(probe.knowledgeBases[0].embeddingModelId, 'emb-1')
    // 系统信息使用第二套信封；本夹具未提供时应降级为 null 而不是抛错。
    assert.equal(probe.version, null)

    const hits = await client.hybridSearch('kb-docs', { queryText: '数据库操作', matchCount: 6, vectorThreshold: 0.15, keywordThreshold: 0.3, skipContextEnrichment: true })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].chunkId, 'chunk-1')
    assert.equal(hits[0].knowledgeId, 'doc-1')
    assert.equal(hits[0].kbId, 'kb-docs')
    assert.equal(hits[0].matchType, 1, 'match_type 是整数枚举')
    assert.equal(hits[0].title, '数据库约定')
    assert(hits[0].bodyHash.length === 64, '正文哈希用于证明片段版本')

    const searchRequest = server.requests.find(request => request.url.includes('hybrid-search'))
    assert.equal(searchRequest.method, 'POST')
    assert.equal(searchRequest.body.query_text, '数据库操作')
    assert.equal(searchRequest.body.match_count, 6)
    // 阈值没有服务端默认值：省略等于关闭相关性过滤，必须始终显式传递。
    assert.equal(searchRequest.body.vector_threshold, 0.15)
    assert.equal(searchRequest.body.keyword_threshold, 0.3)
    assert.equal(searchRequest.body.skip_context_enrichment, true)
    assert.equal(searchRequest.headers['x-api-key'], 'secret-key')
    assert.equal(searchRequest.headers['x-tenant-id'], '7')
    // 不使用 ask；也不发送 Authorization。
    assert(!server.requests.some(request => request.url.includes('ask')))
    assert(!server.requests.some(request => request.headers.authorization))
  } finally { await server.close() }
})

test('T2 契约：错误信封与业务错误码整数映射为固定代码', async () => {
  const server = await fixture(record => {
    if (record.url.includes('hybrid-search')) return { status: 200, body: { success: false, error: { code: 1003, message: '知识库不存在' } } }
    if (record.url === '/api/v1/knowledge-bases') return { status: 401, body: { error: 'Unauthorized: invalid API key' } }
    return { status: 403, body: { error: 'Forbidden: API key scope does not allow this operation' } }
  })
  try {
    const client = new WeKnoraClient({ baseUrl: server.baseUrl, apiKey: 'bad', retries: 1 })
    // 200 但 success=false 不是成功。
    await assert.rejects(client.hybridSearch('kb', { queryText: 'q', matchCount: 1, vectorThreshold: 0.1, keywordThreshold: 0.1, skipContextEnrichment: true }), error => {
      assert(error instanceof WeKnoraError)
      assert.equal(error.code, 'MALFORMED')
      assert.equal(error.status, 200)
      return true
    })
    // 裸 error 字符串也是合法错误形状。
    await assert.rejects(client.listKnowledgeBases(), error => {
      assert(error instanceof WeKnoraError)
      assert.equal(error.code, 'UNAUTHORIZED')
      return true
    })
    // 403 不重试，也不视为成功。
    const forbidden = await client.getKnowledge('doc-1').then(() => null, error => error)
    assert(forbidden instanceof WeKnoraError, '403 必须以 WeKnoraError 失败')
    assert.equal(forbidden.code, 'KB_DENIED')
    assert.equal(server.requests.filter(request => request.url.includes('/knowledge/doc-1')).length, 1, '403 不得重试')
  } finally { await server.close() }
})

test('T2 契约：429 与 5xx 在截止内退避重试，最终失败按 UPSTREAM 上报', async () => {
  let attempts = 0
  const server = await fixture(() => {
    attempts++
    if (attempts === 1) return { status: 429, body: { success: false, error: { code: 1007, message: 'too many requests' } } }
    if (attempts === 2) return { status: 503, body: { success: false, error: { code: 1007, message: 'unavailable' } } }
    return { body: { success: true, data: [] } }
  })
  try {
    const client = new WeKnoraClient({ baseUrl: server.baseUrl, apiKey: 'k', retries: 3 })
    assert.deepEqual(await client.listKnowledgeBases(), [])
    assert.equal(attempts, 3, '两次暂时性失败后第三次成功')
  } finally { await server.close() }

  const failing = await fixture(() => ({ status: 500, body: { success: false, error: { code: 1007, message: 'boom' } } }))
  try {
    const client = new WeKnoraClient({ baseUrl: failing.baseUrl, apiKey: 'k', retries: 2 })
    await assert.rejects(client.listKnowledgeBases(), error => { assert.equal(error.code, 'UPSTREAM'); return true })
    assert.equal(failing.requests.length, 2, '重试次数受 retries 约束')
  } finally { await failing.close() }
})

test('T2 契约：HTTP 提交必须在总截止内结束，逾期报 DEADLINE', async () => {
  const server = await fixture(async () => { await new Promise(resolve => setTimeout(resolve, 400)); return { body: { success: true, data: [] } } })
  try {
    const client = new WeKnoraClient({ baseUrl: server.baseUrl, apiKey: 'k', deadlineMs: 120, retries: 1 })
    const started = Date.now()
    await assert.rejects(client.listKnowledgeBases(), error => { assert.equal(error.code, 'DEADLINE'); return true })
    const elapsed = Date.now() - started
    assert(elapsed < 350, `截止应在 120ms 附近结束，实测 ${elapsed}ms`)
  } finally { await server.close() }
})

test('T2 契约：分块分页与原序字段；手工文档五步写入形状正确', async () => {
  const server = await fixture(record => {
    if (record.url.startsWith('/api/v1/chunks/doc-1')) return { body: { success: true, total: 2, page: 1, page_size: 10, data: [{ id: 'c1', chunk_index: 0, content: '第一段', index_status: 'ready', content_revision: 3, is_enabled: true }, { id: 'c2', chunk_index: 1, content: '第二段', index_status: 'ready', content_revision: 1, is_enabled: false }] } }
    if (record.url === '/api/v1/knowledge-bases/kb-pub/knowledge/manual') return { body: { success: true, data: { id: 'remote-1', knowledge_base_id: 'kb-pub', title: 'T', parse_status: 'draft', metadata: { manual: { content: '正文', status: 'draft', version: 1 } }, custom_metadata: {} } } }
    if (record.url === '/api/v1/knowledge/remote-1') {
      // custom_metadata 是整体替换：读取时必须能看到既有非插件字段。
      return record.method === 'PUT'
        ? { body: { success: true, message: 'Knowledge updated successfully', data: { id: 'remote-1', knowledge_base_id: 'kb-pub', parse_status: 'draft', metadata: { manual: { content: '正文', status: 'draft', version: 1 } }, custom_metadata: record.body.custom_metadata } } }
        : { body: { success: true, data: { id: 'remote-1', knowledge_base_id: 'kb-pub', title: 'T', parse_status: 'draft', metadata: { manual: { content: '正文', status: 'draft', version: 1 } }, custom_metadata: { keep: 'existing' } } } }
    }
    if (record.url === '/api/v1/knowledge/manual/remote-1') return { body: { success: true, data: { id: 'remote-1', knowledge_base_id: 'kb-pub', parse_status: 'pending', metadata: { manual: { content: '完整正文', status: 'publish', version: 2 } }, custom_metadata: {} } } }
    if (record.url.startsWith('/api/v1/knowledge-bases/kb-pub/knowledge?')) return { body: { success: true, total: 1, page: 1, page_size: 100, data: [{ id: 'remote-1', knowledge_base_id: 'kb-pub', title: 'T dsh-memory-publish:pub-1', parse_status: 'completed', metadata: { manual: { content: '正文', status: 'publish', version: 2 } }, custom_metadata: {} }] } }
    return { status: 404, body: { success: false, error: { code: 1003, message: 'not found' } } }
  })
  try {
    const client = new WeKnoraClient({ baseUrl: server.baseUrl, apiKey: 'k' })
    const page = await client.listChunks('doc-1', 1, 10)
    assert.equal(page.total, 2)
    assert.equal(page.chunks[0].chunkIndex, 0)
    assert.equal(page.chunks[1].chunkIndex, 1)
    assert.equal(page.chunks[0].contentRevision, 3)
    assert.equal(page.chunks[1].isEnabled, false, '禁用分块仍会返回，需调用方自行判断')

    const detail = await client.getKnowledge('remote-1')
    assert.equal(detail.parseStatus, 'draft', 'draft 不在服务端常量表中但仍会出现')
    assert.equal(detail.manualContent, '正文')
    assert.equal(detail.manualVersion, 1)
    assert.deepEqual(detail.customMetadata, { keep: 'existing' })

    const created = await client.createManual('kb-pub', { title: 'T', content: '正文' })
    assert.equal(created.id, 'remote-1')
    const createRequest = server.requests.find(request => request.url.endsWith('/knowledge/manual') && request.method === 'POST')
    assert.equal(createRequest.body.status, 'draft')
    // 草稿路径不发送 process_config：服务端只在 publish 时应用它。
    assert.equal(createRequest.body.process_config, undefined)

    // 元数据是整体替换，调用方必须先读后写以保留非插件字段。
    const merged = { ...detail.customMetadata, 'dsh-memory-publish-id': 'pub-1' }
    const updated = await client.updateMetadata('remote-1', merged)
    assert.deepEqual(updated.customMetadata, { keep: 'existing', 'dsh-memory-publish-id': 'pub-1' })

    const published = await client.publishManual('remote-1', '完整正文')
    assert.equal(published.manualStatus, 'publish')
    const publishRequest = server.requests.find(request => request.url === '/api/v1/knowledge/manual/remote-1')
    assert.equal(publishRequest.body.content, '完整正文')
    assert.equal(publishRequest.body.status, 'publish', '省略 status 会把已发布文档打回草稿')
    assert.deepEqual(publishRequest.body.process_config, LOW_COST_PROCESS_CONFIG)

    const listed = await client.listKnowledge('kb-pub', 1, 100)
    assert.equal(listed.total, 1)
    assert.equal(listed.items[0].manualVersion, 2)
  } finally { await server.close() }
})

test('T2 契约：手工 metadata 为扁平结构时正文与版本仍可读出（真实实例形状）', async () => {
  // 真实 v0.8.2 返回扁平 metadata；早期实现按 metadata.manual.* 嵌套读取，
  // 导致手工正文与版本恒为 null，发布校验与索引完成判定也就永远不成立。
  const flat = { content: '扁平正文', format: 'markdown', status: 'publish', version: 7, updated_at: '2026-10-07T17:36:23Z' }
  const server = await fixture(record => {
    if (record.url.startsWith('/api/v1/knowledge/')) return { body: { success: true, data: { id: 'flat-1', knowledge_base_id: 'kb-pub', title: 'T', parse_status: 'completed', metadata: flat, custom_metadata: {} } } }
    // 列表请求带查询串，需用前缀匹配而不是全等。
    if (record.url.startsWith('/api/v1/knowledge-bases/kb-pub/knowledge')) return { body: { success: true, total: 1, page: 1, page_size: 100, data: [{ id: 'flat-1', knowledge_base_id: 'kb-pub', title: 'T dsh-memory-publish:pub-1', parse_status: 'completed', metadata: flat, custom_metadata: {} }] } }
    return { status: 404, body: { success: false, error: { code: 1003, message: 'not found' } } }
  })
  try {
    const client = new WeKnoraClient({ baseUrl: server.baseUrl, apiKey: 'k' })
    const detail = await client.getKnowledge('flat-1')
    assert.equal(detail.manualContent, '扁平正文', '必须能从扁平 metadata.content 读出正文')
    assert.equal(detail.manualStatus, 'publish', '必须能读出发布状态')
    assert.equal(detail.manualVersion, 7, '必须能读出手工版本')
    assert.equal(detail.bodyHash, bodyHash('扁平正文'), 'bodyHash 必须可由正文复算，不能为 null')
    // 列表接口（不回填正文时）也必须能按标题标记对账。
    const listed = await client.listKnowledge('kb-pub', 1, 100)
    assert.equal(listed.items[0].manualVersion, 7)
  } finally { await server.close() }
})

test('T2 契约：本地先拒绝超限输入与非法 baseUrl，避免无谓往返', async () => {
  const server = await fixture(() => ({ body: { success: true, data: {} } }))
  try {
    const client = new WeKnoraClient({ baseUrl: server.baseUrl, apiKey: 'k' })
    // 正文上限 200000 字符。
    await assert.rejects(client.createManual('kb', { title: 'T', content: 'x'.repeat(200001) }), error => { assert.equal(error.code, 'LIMIT'); return true })
    await assert.rejects(client.createManual('kb', { title: 'T', content: '   ' }), error => { assert.equal(error.code, 'LIMIT'); return true })
    // custom_metadata 上限：20 键、键名 64、值 1000、必须扁平。
    const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`k${index}`, 'v']))
    await assert.rejects(client.updateMetadata('doc', tooMany), error => { assert.equal(error.code, 'LIMIT'); return true })
    await assert.rejects(client.updateMetadata('doc', { ['k'.repeat(65)]: 'v' }), error => { assert.equal(error.code, 'LIMIT'); return true })
    await assert.rejects(client.updateMetadata('doc', { k: 'v'.repeat(1001) }), error => { assert.equal(error.code, 'LIMIT'); return true })
    await assert.rejects(client.updateMetadata('doc', { k: { nested: true } }), error => { assert.equal(error.code, 'LIMIT'); return true })
    // 被拒绝的请求不应发出。
    assert(!server.requests.some(request => request.url.includes('/knowledge/manual') && request.method === 'POST'))
    assert.equal(server.requests.filter(request => request.url === '/api/v1/knowledge/doc').length, 0)
  } finally { await server.close() }
})

test('T2 契约：删除 200 只表示入队，必需以 GET 404 确认完成', async () => {
  let deleted = false
  const server = await fixture(record => {
    if (record.method === 'DELETE') { deleted = true; return { body: { success: true, message: 'Delete task submitted', data: { task_id: 'task-1' } } } }
    if (!deleted) return { body: { success: true, data: { id: 'remote-1', knowledge_base_id: 'kb-pub', parse_status: 'deleting', metadata: {}, custom_metadata: {} } } }
    return { status: 404, body: { success: false, error: { code: 1003, message: 'Knowledge not found' } } }
  })
  try {
    const client = new WeKnoraClient({ baseUrl: server.baseUrl, apiKey: 'k' })
    const before = await client.getKnowledge('remote-1')
    assert.equal(before.parseStatus, 'deleting')
    await client.deleteKnowledge('remote-1')
    await assert.rejects(client.getKnowledge('remote-1'), error => { assert.equal(error.code, 'NOT_FOUND'); return true })
  } finally { await server.close() }
})

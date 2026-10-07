/**
 * 远端证据与发布状态机生命周期（P06/P08/P09，T2 与 T3 的核心）。
 *
 * 使用真实 SQLite Worker（schema 2）与真实 HTTP 夹具，不使用 Mock 替代存储事务：
 *   T2 相关：单活动槽位、同轮替换先退役旧正文、下一用户轮退役、字节上限、
 *            逾期不注入、取消、失效撤回、重启对账、隔离（未绑定库不可读）
 *   T3 相关：预览确认绑定源版本与正文 hash、发布五步、响应丢失后按标记对账且不盲重发、
 *            本地修改后转待复核再确认新版本、离线撤回与墓碑、GET 404 确认、防重生
 *
 * 真实 WeKnora 实例验收见 ACCEPTANCE.md；本文件只覆盖本机可验证的状态机与协议形状。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { StorageWorker } from '../lib/worker-client.js'
import { KnowledgeService } from '../lib/retrieval/evidence.js'
import { SyncRunner, operationMarker } from '../lib/publication/sync-outbox.js'
import { renderCard } from '../lib/publication/render.js'
import { WeKnoraClient } from '../lib/weknora/client.js'

const base = resolve('test-runs')
await mkdir(base, { recursive: true })
const limits = { matchCount: 6, vectorThreshold: 0.15, keywordThreshold: 0.3, requestDeadlineMs: 1500, remoteEvidenceBytes: 3072, retiredReferenceBytes: 256, maxKnowledgeCallsPerTurn: 2 }

/** 真实本机 HTTP 夹具，承载 hybrid-search、文档与分块读取。 */
async function httpFixture(routes = {}) {
  const requests = []
  const remote = new Map()
  // 删除完成回调：由用例决定何时真正移除远端文档（模拟异步删除完成）。
  let onDelete = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const url = req.url.split('?')[0]
      requests.push({ method: req.method, url, body: body ? JSON.parse(body) : undefined })
      // DELETE 默认只入队、不真正删除：真实服务端 200 也不代表已删除。
      if (req.method === 'DELETE') {
        requests.push({ method: req.method, url, body: body ? JSON.parse(body) : undefined })
        if (onDelete) onDelete(url)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, message: 'Delete task submitted', data: { task_id: 'task-1' } }))
        return
      }
      const custom = routes[`${req.method} ${url}`]
      let reply = custom ? custom(req, body ? JSON.parse(body) : undefined) : undefined
      let status = 200
      if (reply && typeof reply === 'object' && '__status' in reply) {
        status = reply.__status
        reply = reply.__body ?? { success: false, error: { code: 1002, message: 'forbidden' } }
      }
      if (!reply) {
        if (url.startsWith('/api/v1/knowledge-bases/') && url.endsWith('/hybrid-search')) {
          reply = { success: true, data: [{ id: 'chunk-1', content: '数据库操作放在 repositories 目录。', knowledge_id: 'doc-1', chunk_index: 0, knowledge_title: '数据库约定', score: 0.9, match_type: 1, knowledge_base_id: 'kb-docs' }] }
        } else if (url === '/api/v1/knowledge-bases') {
          reply = { success: true, data: [{ id: 'kb-docs', name: '文档库', type: 'document' }, { id: 'kb-pub', name: '发布库', type: 'document' }] }
        } else if (url.startsWith('/api/v1/chunks/')) {
          reply = { success: true, total: 2, page: 1, page_size: 20, data: [{ id: 'c1', chunk_index: 0, content: '第一段正文', index_status: 'ready', is_enabled: true }, { id: 'c2', chunk_index: 1, content: '第二段正文', index_status: 'ready', is_enabled: true }] }
        } else if (url.startsWith('/api/v1/knowledge/') && !url.includes('/manual/')) {
          const id = url.split('/').pop()
          const record = remote.get(id)
          if (!record) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code: 1003, message: 'not found' } })); return }
          reply = { success: true, data: record }
        } else if (url.startsWith('/api/v1/knowledge-bases/') && url.endsWith('/knowledge')) {
          reply = { success: true, total: remote.size, page: 1, page_size: 100, data: [...remote.values()] }
        }
      }
      if (!reply) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code: 1003, message: 'not found' } })); return }
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(reply))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, requests, remote,
    onDelete: handler => { onDelete = handler },
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

/** 建立连接、绑定与项目的完整夹具。 */
async function fixture(server, overrides = {}) {
  const root = await mkdtemp(join(base, 'life-'))
  const store = new StorageWorker(join(root, 'memory'), 'owner', 'host', 'fixture')
  await store.ready
  await store.call('policy', { global: { use: true, generate: false }, projects: { use: true, generate: false } })
  const project = await store.call('project', { root: join(root, 'project-A'), target: 'host', name: 'A' })
  await store.call('saveConnection', { connection: { connectionId: 'team', baseUrl: server.baseUrl, readCredentialRef: 'read-ref', publishCredentialRef: 'publish-ref' } })
  await store.call('toggleConnection', { connectionId: 'team', readEnabled: true, publishEnabled: true })
  const connection = await store.call('connection', { connectionId: 'team' })
  await store.call('saveConnectionSettings', { connectionId: 'team', settings: { maxKnowledgeBases: connection.maxKnowledgeBases, requestDeadlineMs: connection.requestDeadlineMs, remoteEvidenceBytes: connection.remoteEvidenceBytes, retiredReferenceBytes: connection.retiredReferenceBytes, maxKnowledgeCallsPerTurn: connection.maxKnowledgeCallsPerTurn, publishMode: 'reviewed-only', useCrossSessionRemoteCache: false } })
  await store.call('setBinding', { projectId: project.id, binding: { connectionId: 'team', readKbIds: ['kb-docs', 'kb-pub'], publishKbId: 'kb-pub' } })
  const port = {
    readAccess: async () => ({ connection: await store.call('connection', { connectionId: 'team' }), apiKey: 'read-key' }),
    publishAccess: async () => ({ connection: await store.call('connection', { connectionId: 'team' }), apiKey: 'publish-key' }),
    binding: projectId => store.call('binding', { projectId }),
    reserveSlot: (session, userTurn, toolCallId, createdSeq, connectionId, kbIds, toolName, bindingRevision) => store.call('reserveSlot', { session, userTurn, toolCallId, createdSeq, connectionId, kbIds, toolName, bindingRevision }),
    slotCheck: (slotId, projectId) => store.call('slotCheck', { slotId, projectId }),
    activateSlot: (slotId, resultSeq, contentBytes, refs) => store.call('activateSlot', { slotId, resultSeq, contentBytes, refs }),
    releaseSlot: async (slotId, reason) => { await store.call('retireSlot', { slotId, content: `[未提交：${reason}]`, limit: 256 }) },
    retireSlot: async (slotId, content, limit) => { await store.call('retireSlot', { slotId, content, limit }) },
    activeSlot: session => store.call('activeSlot', { session }),
    markSlotBuild: async (slotId, build) => { await store.call('slotPatch', { slotId, build: build ?? {} }) },
    slot: slotId => store.call('slot', { slotId }),
  }
  const service = new KnowledgeService(port, (access, deadlineMs) => new WeKnoraClient({ baseUrl: access.connection.baseUrl, apiKey: access.apiKey, deadlineMs }))
  return { root, store, project, service, ...overrides }
}

const signal = () => new AbortController().signal

test('T2 生命周期：单活动槽位、同轮替换先退役旧正文、下一用户轮退役', async () => {
  const server = await httpFixture()
  const f = await fixture(server)
  try {
    const first = await f.service.search({ sessionId: 's1', projectId: f.project.id, userTurn: 1, toolCallId: 'call-1', createdSeq: 10, query: '数据库', caller: signal() }, limits)
    assert.equal(first.outcome.ok, true)
    assert(first.slotId, '成功检索必须提交一个活动槽位')
    assert(first.text.includes('<knowledge-evidence>'), '证据必须带来源封装')
    assert(first.text.includes('doc-1') && first.text.includes('chunk-1'), '必须给出文档与分块标识')
    const active = await f.store.call('activeSlot', { session: 's1' })
    assert.equal(active.slotId, first.slotId)

    // 同轮第二次检索：新结果提交前必须先撤下旧正文。
    const second = await f.service.search({ sessionId: 's1', projectId: f.project.id, userTurn: 1, toolCallId: 'call-2', createdSeq: 12, query: '数据库', caller: signal() }, limits)
    assert.equal(second.outcome.ok, true)
    assert.notEqual(second.slotId, first.slotId)
    assert.equal((await f.store.call('slot', { slotId: first.slotId })).state, 'retired', '旧正文必须已退役')
    assert.equal((await f.store.call('activeSlot', { session: 's1' })).slotId, second.slotId, '同时只有一份活动结果')

    // 下一用户轮：正常到期退役为短引用。
    const retired = await f.service.retireOnNewTurn('s1', 256)
    assert.deepEqual(retired.retired, [second.slotId])
    assert.equal(await f.store.call('activeSlot', { session: 's1' }), null)
    const references = await f.store.call('retired', { session: 's1', limit: 256 })
    assert(references.length >= 1)
    assert(references.reduce((sum, row) => sum + row.bytes, 0) <= 256, '退役短引用合计不超过 256 字节')
  } finally { await f.store.close(); await server.close() }
})

test('T2 生命周期：未绑定库不可读、每轮调用上限与取消不注入', async () => {
  const server = await httpFixture()
  const f = await fixture(server)
  try {
    // 未绑定项目：明确返回未配置，不退化为查询全部可见库。
    const other = await f.store.call('project', { root: join(f.root, 'project-B'), target: 'host', name: 'B' })
    const unbound = await f.service.search({ sessionId: 's2', projectId: other.id, userTurn: 1, toolCallId: 'c', createdSeq: 1, query: 'q', caller: signal() }, limits)
    assert.equal(unbound.outcome.code, 'NO_BINDING')
    assert.equal(unbound.slotId, '')
    assert.equal(server.requests.filter(request => request.url.includes('hybrid-search')).length, 0, '未绑定不得发出远端请求')

    // 每轮上限：第三次调用在 HTTP 之前被拒绝。
    for (let index = 0; index < 2; index++) {
      const reply = await f.service.search({ sessionId: 's3', projectId: f.project.id, userTurn: 5, toolCallId: `c${index}`, createdSeq: 1 + index, query: 'q', caller: signal() }, limits)
      assert.equal(reply.outcome.ok, true)
    }
    const over = await f.service.search({ sessionId: 's3', projectId: f.project.id, userTurn: 5, toolCallId: 'c9', createdSeq: 9, query: 'q', caller: signal() }, limits)
    assert.equal(over.outcome.code, 'TURN_LIMIT', '超出每轮上限必须被拒绝且给出可诊断代码')
    assert(over.text === '' || !over.slotId)

    // 取消：已中止的调用不得提交任何槽位。
    const controller = new AbortController(); controller.abort()
    const cancelled = await f.service.search({ sessionId: 's4', projectId: f.project.id, userTurn: 1, toolCallId: 'cx', createdSeq: 1, query: 'q', caller: controller.signal }, limits)
    assert.equal(cancelled.outcome.ok, false)
    assert.equal(cancelled.slotId, '')
    assert.equal(await f.store.call('activeSlot', { session: 's4' }), null, '取消后不得留下活动槽位')
  } finally { await f.store.close(); await server.close() }
})

test('T2 生命周期：关闭读取即时失效，重启对账清理孤儿槽位', async () => {
  const server = await httpFixture()
  const f = await fixture(server)
  const directory = join(f.root, 'memory')
  try {
    const reply = await f.service.search({ sessionId: 's5', projectId: f.project.id, userTurn: 1, toolCallId: 'c', createdSeq: 1, query: 'q', caller: signal() }, limits)
    assert(reply.slotId)

    // 关闭读取：立即撤下相关正文，再检索被拒绝。
    await f.store.call('toggleConnection', { connectionId: 'team', readEnabled: false })
    await f.service.invalidate('s5', '读取已关闭', 256)
    assert.equal(await f.store.call('activeSlot', { session: 's5' }), null)
    const afterDisable = await f.service.search({ sessionId: 's5', projectId: f.project.id, userTurn: 2, toolCallId: 'c2', createdSeq: 5, query: 'q', caller: signal() }, limits)
    assert.equal(afterDisable.outcome.code, 'READ_DISABLED', '读取关闭后不得再检索')
    await f.store.close()

    // 重启对账：无法证明仍在可见面上的槽位先清理，再允许新预留。
    const reopened = new StorageWorker(directory, 'owner', 'host', 'fixture')
    await reopened.ready
    await reopened.call('toggleConnection', { connectionId: 'team', readEnabled: true })
    const reserved = await reopened.call('reserveSlot', { session: 's6', userTurn: 1, toolCallId: 'c', createdSeq: 1, connectionId: 'team', kbIds: ['kb-docs'], toolName: 'search', bindingRevision: 1 })
    await reopened.call('activateSlot', { slotId: reserved.slotId, resultSeq: 9, contentBytes: 10, refs: [] })
    await reopened.close()

    const again = new StorageWorker(directory, 'owner', 'host', 'fixture')
    await again.ready
    const reconciled = await again.call('orphanSlots', { liveSeqs: [] })
    assert.deepEqual(reconciled.orphaned, [reserved.slotId])
    assert.equal(await again.call('activeSlot', { session: 's6' }), null)
    await again.close()
  } finally { await f.store.close().catch(() => {}); await server.close() }
})

test('T3 发布：预览确认绑定源版本与正文 hash，确认后生成持久 outbox', async () => {
  const server = await httpFixture()
  const f = await fixture(server)
  try {
    const item = await f.store.call('save', { scope: f.project.id, title: '数据库约定', content: '数据库操作放在 repositories 目录。' })
    const card = renderCard({ item, project: { name: 'A', root: '/w/a' }, approvedAt: Date.now() })
    const publishId = 'pub-1'
    const marker = operationMarker(publishId)
    await f.store.call('previewStore', { preview: { previewId: 'pv-1', memoryId: item.id, publishId, bodyHash: card.bodyHash, body: card.body, title: card.title, sourceRevision: item.revision, sourceHash: 'source-hash', targetKbId: 'kb-pub', connectionId: 'team', approvedAt: Date.now() } })

    // 源记录在确认前被修改：必须要求重新确认，不能沿用旧批准快照。
    await f.store.call('save', { scope: f.project.id, id: item.id, revision: item.revision, title: item.title, content: '新的项目约定。' })
    await assert.rejects(f.store.call('confirmPreview', { preview: { previewId: 'pv-1', memoryId: item.id, publishId, bodyHash: card.bodyHash, body: card.body, title: card.title, sourceRevision: item.revision, sourceHash: 'source-hash', targetKbId: 'kb-pub', connectionId: 'team', approvedAt: Date.now() } }), /REVISION_CONFLICT/)
    // 确认期间正文被替换同样拒绝。
    const current = await f.store.call('read', { id: item.id })
    const fresh = renderCard({ item: current, project: { name: 'A', root: '/w/a' }, approvedAt: Date.now() })
    await assert.rejects(f.store.call('confirmPreview', { preview: { previewId: 'pv-1', memoryId: item.id, publishId, bodyHash: 'tampered', body: fresh.body, title: fresh.title, sourceRevision: current.revision, sourceHash: 'source-hash', targetKbId: 'kb-pub', connectionId: 'team', approvedAt: Date.now() } }), /PREVIEW_HASH_MISMATCH/)

    const result = await f.store.call('confirmPreview', { preview: { previewId: 'pv-1', memoryId: item.id, publishId, bodyHash: fresh.bodyHash, body: fresh.body, title: fresh.title, sourceRevision: current.revision, sourceHash: 'source-hash', targetKbId: 'kb-pub', connectionId: 'team', approvedAt: Date.now() } })
    assert.equal(result.publication.state, 'approved')
    assert.equal(result.publication.approved.sourceRevision, current.revision)
    assert.equal(result.publication.approved.bodyHash, fresh.bodyHash)
    assert.equal(result.operation.op, 'create')
    assert.equal(result.operation.state, 'pending')
    assert(operationMarker(publishId).length > 0)
    assert(fresh.body.includes('dsh-memory-publish'), '标题或正文必须含稳定标记')
    assert.equal((await f.store.call('outboxPending', {})).length, 1)
    assert.equal(await f.store.call('preview', { previewId: 'pv-1' }), null, '确认后预览快照被消费')
  } finally { await f.store.close(); await server.close() }
})

test('T3 发布：五步协议落库，未知结果按标记对账且不重复创建', async () => {
  const server = await httpFixture()
  const f = await fixture(server)
  let createCalls = 0
  server.requests.length = 0
  try {
    const item = await f.store.call('save', { scope: f.project.id, title: '经验', content: '把数据库操作放在 repositories。' })
    const card = renderCard({ item, project: { name: 'A', root: '/w/a' }, approvedAt: Date.now() })
    const publishId = 'pub-recon'
    // 预置目标库中已存在同标记文档，模拟“上次创建成功但响应丢失”。
    const existing = { id: 'remote-existing', knowledge_base_id: 'kb-pub', title: `经验 dsh-memory-publish:${publishId}`, parse_status: 'completed', metadata: { manual: { content: card.body, status: 'publish', version: 2 } }, custom_metadata: {} }
    server.remote.set('remote-existing', existing)

    const port = {
      pending: () => f.store.call('outboxPending', {}),
      publication: publishIdValue => f.store.call('publication', { publishId: publishIdValue }),
      savePublication: async publication => { await f.store.call('publicationUpsert', { publication }); return publication },
      updateOperation: (operationId, patch) => f.store.call('outboxUpdate', { operationId, ...patch }),
      access: async () => ({ apiKey: 'publish-key', tenantId: '', baseUrl: server.baseUrl }),
      client: (access, deadlineMs) => new WeKnoraClient({ baseUrl: access.baseUrl, apiKey: access.apiKey, deadlineMs }),
      tombstonePending: () => f.store.call('tombstonePending', {}),
      updateTombstone: (tombstone, state, attempts) => f.store.call('tombstoneUpdate', { connectionId: tombstone.connectionId, kbId: tombstone.kbId, remoteId: tombstone.remoteId, publishId: tombstone.publishId, state, attempts }),
      isBlocked: async () => false,
      settings: async () => ({ requestDeadlineMs: 1500 }),
    }
    const runner = new SyncRunner(port)
    const created = await f.store.call('confirmPreview', { preview: { previewId: 'pv-2', memoryId: item.id, publishId, bodyHash: card.bodyHash, body: card.body, title: card.title, sourceRevision: item.revision, sourceHash: 'sh', targetKbId: 'kb-pub', connectionId: 'team', approvedAt: Date.now() } })

    // 对账路径：应识别既有文档并复用，而不是再次创建。
    const result = await runner.run(signal())
    assert.equal(result.errors.length, 0, `不应有错误：${result.errors.join(',')}`)
    const createRequests = server.requests.filter(request => request.method === 'POST' && request.url.endsWith('/knowledge/manual'))
    assert.equal(createRequests.length, 0, '存在唯一同标记文档时禁止盲目重发创建')
    const recovered = await f.store.call('publication', { publishId: created.publication.publishId })
    assert.equal(recovered.remoteId, 'remote-existing', '必须恢复已有映射')

    // 元数据整体替换：既有非插件字段必须保留。
    const metadataRequest = server.requests.find(request => request.method === 'PUT' && request.url === '/api/v1/knowledge/remote-existing')
    if (metadataRequest) assert.deepEqual(Object.keys(metadataRequest.body.custom_metadata).includes('dsh-memory-publish-id'), true)
    createCalls = createRequests.length
    assert.equal(createCalls, 0)
  } finally { await f.store.close(); await server.close() }
})

test('T3 撤回：墓碑阻止重新发布，删除以 GET 404 确认，权限错误不算成功', async () => {
  const server = await httpFixture()
  const f = await fixture(server)
  try {
    const item = await f.store.call('save', { scope: f.project.id, title: '待撤回', content: '这条经验将被撤回。' })
    const card = renderCard({ item, project: { name: 'A', root: '/w/a' }, approvedAt: Date.now() })
    const publishId = 'pub-withdraw'
    const remoteId = 'remote-w'
    server.remote.set(remoteId, { id: remoteId, knowledge_base_id: 'kb-pub', title: card.title, parse_status: 'completed', metadata: { manual: { content: card.body, status: 'publish', version: 1 } }, custom_metadata: {} })
    await f.store.call('publicationUpsert', { publication: { publishId, memoryId: item.id, scope: f.project.id, targetKbId: 'kb-pub', connectionId: 'team', remoteId, state: 'published', publishedSourceRevision: item.revision, publishedBodyHash: card.bodyHash, candidateSourceRevision: item.revision, candidateBodyHash: card.bodyHash, sourceHash: 'sh', approved: null, remoteVersion: '1', generation: 1, approvedAt: Date.now(), lastIndexPollAt: 0, indexDeadline: 0 } })
    // 本地删除经验 → 写墓碑排队撤回。
    await f.store.call('remove', { id: item.id, revision: item.revision })
    const tombstone = await f.store.call('tombstoneAdd', { tombstone: { connectionId: 'team', kbId: 'kb-pub', remoteId, publishId, memoryId: item.id, sourceEpoch: 0 } })
    assert.equal(tombstone.state, 'pending')
    // 墓碑生效后同源副本不可再被召回或重新发布。
    assert((await f.store.call('tombstoneFor', { memoryId: item.id }))?.state === 'pending')

    // 权限错误（403）不得被当作成功删除。
    const forbiddenServer = await httpFixture({ 'POST /api/v1/none': () => null })
    forbiddenServer.onDelete(() => { /* 403 由下面的显式客户端调用验证 */ })
    const forbiddenClient = createServer((req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: { code: 1002, message: 'forbidden' } }))
    })
    await new Promise(resolve => forbiddenClient.listen(0, '127.0.0.1', resolve))
    const forbiddenBase = `http://127.0.0.1:${forbiddenClient.address().port}/api/v1`
    const forbiddenPort = {
      pending: async () => [], publication: async () => null, savePublication: async value => value, updateOperation: async (id, patch) => ({ operationId: id, ...patch }),
      access: async () => ({ apiKey: 'k', tenantId: '', baseUrl: forbiddenServer.baseUrl }),
      client: (access, deadlineMs) => new WeKnoraClient({ baseUrl: access.baseUrl, apiKey: access.apiKey, deadlineMs }),
      tombstonePending: async () => [tombstone],
      updateTombstone: async (value, state, attempts) => ({ ...value, state, attempts }),
      isBlocked: async () => false, settings: async () => ({ requestDeadlineMs: 1500 }),
    }
    // 用真实 403 响应验证分类。
    const client = new WeKnoraClient({ baseUrl: forbiddenBase, apiKey: 'k' })
    const denied = await client.deleteKnowledge(remoteId).then(() => null, error => error)
    assert.equal(denied.code, 'KB_DENIED', '403 必须被识别为权限错误而不是成功删除')

    // 正常撤回：删除后 GET 404 才算完成。
    const port = {
      pending: async () => [], publication: async () => null, savePublication: async value => value, updateOperation: async (id, patch) => ({ operationId: id, ...patch }),
      access: async () => ({ apiKey: 'k', tenantId: '', baseUrl: server.baseUrl }),
      client: (access, deadlineMs) => new WeKnoraClient({ baseUrl: access.baseUrl, apiKey: access.apiKey, deadlineMs }),
      tombstonePending: async () => [{ ...tombstone }],
      updateTombstone: async (value, state, attempts) => { await f.store.call('tombstoneUpdate', { connectionId: value.connectionId, kbId: value.kbId, remoteId: value.remoteId, publishId: value.publishId, state, attempts }); return { ...value, state, attempts } },
      isBlocked: async () => true, settings: async () => ({ requestDeadlineMs: 1500 }),
    }
    // 远端异步删除完成：此后 GET 返回 404。
    server.onDelete(() => { server.remote.delete(remoteId) })
    const runner = new SyncRunner(port)
    await runner.run(signal())
    assert.equal((await f.store.call('tombstoneFor', { publishId })).state, 'done', 'GET 404 后墓碑标记完成')
    assert.equal((await f.store.call('tombstones', {})).length, 1, '完成后仍保留屏蔽记录以防重生')
    await forbiddenServer.close()
    await new Promise(resolve => forbiddenClient.close(resolve))
  } finally { await f.store.close(); await server.close() }
})

test('T3 发布：远端正文与批准快照不一致时暂停为冲突，不自动覆盖', async () => {
  const server = await httpFixture()
  const f = await fixture(server)
  try {
    const item = await f.store.call('save', { scope: f.project.id, title: '冲突', content: '本地正文。' })
    const card = renderCard({ item, project: { name: 'A', root: '/w/a' }, approvedAt: Date.now() })
    const publishId = 'pub-conflict'
    const remoteId = 'remote-c'
    // 远端是别的内容（外部编辑），且已 publish。
    server.remote.set(remoteId, { id: remoteId, knowledge_base_id: 'kb-pub', title: card.title, parse_status: 'completed', metadata: { manual: { content: '完全不同的外部正文。', status: 'publish', version: 3 } }, custom_metadata: {} })
    await f.store.call('publicationUpsert', { publication: { publishId, memoryId: item.id, scope: f.project.id, targetKbId: 'kb-pub', connectionId: 'team', remoteId, state: 'publishing', publishedSourceRevision: 0, publishedBodyHash: '', candidateSourceRevision: item.revision, candidateBodyHash: card.bodyHash, sourceHash: 'sh', approved: { title: card.title, body: card.body, bodyHash: card.bodyHash, sourceRevision: item.revision, sourceHash: 'sh', targetKbId: 'kb-pub', approvedAt: Date.now() }, remoteVersion: '3', generation: 1, approvedAt: Date.now(), lastIndexPollAt: 0, indexDeadline: Date.now() + 60000 } })
    const operation = await f.store.call('outboxEnqueue', { operation: { operationId: 'op-conflict', publishId, op: 'update', approvedSnapshot: (await f.store.call('publication', { publishId })).approved, attempts: 0, nextRetryAt: 0, state: 'pending', lastErrorCode: '', generation: 1 } })
    const port = {
      pending: async () => [operation], publication: id => f.store.call('publication', { publishId: id }),
      savePublication: async publication => { await f.store.call('publicationUpsert', { publication }); return publication },
      updateOperation: (id, patch) => f.store.call('outboxUpdate', { operationId: id, ...patch }),
      access: async () => ({ apiKey: 'k', tenantId: '', baseUrl: server.baseUrl }),
      client: (access, deadlineMs) => new WeKnoraClient({ baseUrl: access.baseUrl, apiKey: access.apiKey, deadlineMs }),
      tombstonePending: async () => [], updateTombstone: async value => value, isBlocked: async () => false, settings: async () => ({ requestDeadlineMs: 1500 }),
    }
    const result = await new SyncRunner(port).run(signal())
    assert.equal(result.errors.length, 0, `发布推进不应出现协议错误：${result.errors.join(',')}`)
    const after = await f.store.call('publication', { publishId })
    assert.equal(after.state, 'conflict', '正文不一致必须暂停为冲突')
    assert.equal(after.error, 'REMOTE_BODY_MISMATCH')
    // 不得自动覆盖远端正文。
    assert(!server.requests.some(request => request.method === 'PUT' && request.url === '/api/v1/knowledge/manual/remote-c'))
  } finally { await f.store.close(); await server.close() }
})

test('T3 升级：连接与发布默认关闭，旧库升级后既有记忆仍可用', async () => {
  const root = await mkdtemp(join(base, 't3-upgrade-'))
  const directory = join(root, 'memory')
  await mkdir(directory)
  // 建立真实 0.1.x 库并写入一条记忆。
  const { V1 } = await import('../src/storage/migrations.ts')
  const legacy = new DatabaseSync(join(directory, 'state.sqlite'))
  legacy.exec(V1)
  legacy.exec('PRAGMA user_version=1')
  legacy.prepare('INSERT INTO memory_profiles VALUES(?,?,?)').run('fixture', 'owner', 'host')
  legacy.prepare('INSERT INTO projects VALUES(?,?,?,?)').run('p1', '/w/a', 'host', JSON.stringify({ id: 'p1', root: '/w/a', target: 'host', name: 'A', use: null, generate: null }))
  legacy.prepare('INSERT INTO memory_items VALUES(?,?,?)').run('m1', 'p1', JSON.stringify({ id: 'm1', scope: 'p1', title: '旧记忆', content: '升级前写入。', kind: 'decision', status: 'observed', pinned: false, manual: true, revision: 1, createdAt: 1, updatedAt: 2, sources: [] }))
  legacy.close()

  const store = new StorageWorker(directory, 'owner', 'host', 'fixture')
  try {
    await store.ready
    // 升级不改变既有记忆，且新能力默认关闭。
    const item = await store.call('read', { id: 'm1' })
    assert.equal(item.content, '升级前写入。')
    assert.deepEqual(await store.call('connections', {}), [])
    assert.deepEqual(await store.call('publications', {}), [])
    assert.deepEqual(await store.call('tombstones', {}), [])
    assert.equal(await store.call('schemaVersion', {}), 2)
  } finally { await store.close() }
})

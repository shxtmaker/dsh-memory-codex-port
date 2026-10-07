/**
 * P02 结构升级与新增存储对象。
 *
 * 覆盖：真实 v1 库升级到 v2、升级后既有数据保持、结构版本拒绝、连接设置单一权威存储、
 * 项目绑定约束、单活动槽位唯一性、退役引用上限、发布/队列/墓碑唯一键与重启对账。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { StorageWorker } from '../lib/worker-client.js'
import { V1, SCHEMA_VERSION } from '../src/storage/migrations.ts'

const base = resolve('test-runs')
await mkdir(base, { recursive: true })

/** 建立一个真实 0.1.x 结构的库，并写入升级前必须保留的数据。 */
async function legacyFixture() {
  const root = await mkdtemp(join(base, 'schema-'))
  const directory = join(root, 'memory')
  await mkdir(directory)
  const db = new DatabaseSync(join(directory, 'state.sqlite'))
  db.exec(V1)
  db.exec('PRAGMA user_version=1')
  db.prepare('INSERT INTO memory_profiles VALUES(?,?,?)').run('fixture', 'owner', 'host')
  db.prepare('INSERT INTO projects VALUES(?,?,?,?)').run('p1', '/w/a', 'host', JSON.stringify({ id: 'p1', root: '/w/a', target: 'host', name: 'A', use: null, generate: null }))
  db.prepare("INSERT INTO scope_epochs(scope,epoch,data) VALUES('p1',4,'{}')").run()
  const item = { id: 'm1', scope: 'p1', title: '数据库操作', content: '数据库操作放在 repositories。', kind: 'decision', status: 'suggested', pinned: false, manual: false, revision: 3, createdAt: 1, updatedAt: 2, sources: ['s1'] }
  db.prepare('INSERT INTO memory_items VALUES(?,?,?)').run('m1', 'p1', JSON.stringify(item))
  db.prepare('INSERT INTO memory_sources VALUES(?,?)').run('m1', 's1')
  db.prepare('INSERT INTO source_segments VALUES(?,?,?,?,?)').run('s1', 'sess', 0, 9, JSON.stringify({ id: 's1', sessionId: 'sess', project: 'p1', start: 0, end: 9, hash: 'h', updatedAt: 5, excluded: false }))
  db.prepare('INSERT INTO tombstones VALUES(?,?,?,?)').run('t1', 'p1', 's0', 7)
  db.prepare('INSERT INTO usage_attempts VALUES(?,?,?,?,?)').run('u1', 'p1', 'extract', 120, Date.now())
  db.close()
  return { root, directory }
}

test('P02 真实 v1 库升级到 schema 2，既有数据与结构版本正确', async () => {
  const fixture = await legacyFixture()
  let worker
  try {
    worker = new StorageWorker(fixture.directory, 'owner', 'host', 'fixture')
    await worker.ready
    assert.equal(await worker.call('schemaVersion', {}), SCHEMA_VERSION)

    // 既有记忆、来源、墓碑、用量与 epoch 全部保持。
    const item = await worker.call('read', { id: 'm1' })
    assert.equal(item.revision, 3)
    assert.deepEqual(item.sources, ['s1'])
    assert.equal((await worker.call('list', { scope: 'p1' })).length, 1)
    assert.equal((await worker.call('sources', { scope: 'p1' })).length, 1)
    assert.equal((await worker.call('overview', {})).dailyUsage.tokens, 120)

    // 新表按需可用，且连接与发布默认关闭。
    assert.deepEqual(await worker.call('connections', {}), [])
    await assert.rejects(worker.call('connection', { connectionId: 'team' }), /NOT_CONFIGURED/)
    assert.deepEqual(await worker.call('publications', {}), [])
    assert.deepEqual(await worker.call('tombstones', {}), [])
  } finally { await worker?.close() }
})

test('P02 结构版本高于本版本时拒绝启动，不误读更新结构', async () => {
  const fixture = await legacyFixture()
  const db = new DatabaseSync(join(fixture.directory, 'state.sqlite'))
  db.exec(`PRAGMA user_version=${SCHEMA_VERSION + 1}`)
  db.close()
  const worker = new StorageWorker(fixture.directory, 'owner', 'host', 'fixture')
  await assert.rejects(worker.ready, /STORAGE_UNAVAILABLE/)
  await worker.close()
})

test('P02 连接设置是单一权威存储，配置修订递增且凭据只存引用', async () => {
  const root = await mkdtemp(join(base, 'conn-'))
  const worker = new StorageWorker(join(root, 'memory'), 'owner', 'host', 'fixture')
  try {
    await worker.ready
    const saved = await worker.call('saveConnection', {
      connection: { connectionId: 'team-knowledge', baseUrl: 'https://weknora.example.com/api/v1', apiProfile: 'v0.8.2-hybrid', tenantId: '7', readCredentialRef: 'weknora-read', publishCredentialRef: 'weknora-publish' },
    })
    assert.equal(saved.configRevision, 1)
    assert.equal(saved.readEnabled, false, '连接默认关闭读取')
    assert.equal(saved.publishEnabled, false, '连接默认关闭发布')
    assert.equal(saved.readCredentialRef, 'weknora-read')
    assert.equal(saved.publishCredentialRef, 'weknora-publish')
    assert.equal(saved.maxKnowledgeBases, 2)
    assert.equal(saved.requestDeadlineMs, 1500)
    assert.equal(saved.remoteEvidenceBytes, 3072)
    assert.equal(saved.retiredReferenceBytes, 256)
    assert.equal(saved.maxKnowledgeCallsPerTurn, 2)
    assert.equal(saved.useCrossSessionRemoteCache, false)

    const updated = await worker.call('saveConnection', {
      connection: { connectionId: 'team-knowledge', baseUrl: 'https://weknora.example.com/api/v1', apiProfile: 'v0.8.2-hybrid', tenantId: '7', readCredentialRef: 'weknora-read2', publishCredentialRef: 'weknora-publish' },
    })
    assert.equal(updated.configRevision, 2)
    assert.equal(updated.readCredentialRef, 'weknora-read2')

    // 读取与发布必须使用两个独立引用；同一引用无法表达两套能力。
    await assert.rejects(worker.call('saveConnection', {
      connection: { connectionId: 'other', baseUrl: 'https://w.example.com', readCredentialRef: 'same', publishCredentialRef: 'same' },
    }), /CREDENTIAL_REF_CONFLICT/)
    // 非 http(s) 地址被拒绝。
    await assert.rejects(worker.call('saveConnection', {
      connection: { connectionId: 'bad', baseUrl: 'file:///etc/passwd', readCredentialRef: 'r' },
    }), /INVALID_BASE_URL/)

    // 回归：连接存在后 connections 必须能列出（曾因二次 JSON.parse 恒失败）。
    const listed = await worker.call('connections', {})
    assert.equal(listed.length, 1)
    assert.equal(listed[0].connectionId, 'team-knowledge')
    assert.equal(typeof listed[0].configRevision, 'number')
    assert.equal(listed[0].maxKnowledgeBases, 2, '列表项必须同时带 settings 投影')

    const toggled = await worker.call('toggleConnection', { connectionId: 'team-knowledge', readEnabled: true })
    assert.equal(toggled.readEnabled, true)
    assert.equal(toggled.publishEnabled, false, '两个开关互相独立')
    const generation = await worker.call('connectionGeneration', { connectionId: 'team-knowledge' })
    const disabled = await worker.call('toggleConnection', { connectionId: 'team-knowledge', readEnabled: false })
    assert.equal(disabled.readEnabled, false)
    assert((await worker.call('connectionGeneration', { connectionId: 'team-knowledge' })) > generation, '关闭读取必须使连接 generation 失效')

    // settings_json 只承载经验证的接口 profile 与预算参数。
    const savedSettings = { maxKnowledgeBases: 2, requestDeadlineMs: 1500, remoteEvidenceBytes: 3072, retiredReferenceBytes: 256, maxKnowledgeCallsPerTurn: 2, publishMode: 'reviewed-only', useCrossSessionRemoteCache: false }
    const settings = await worker.call('saveConnectionSettings', { connectionId: 'team-knowledge', settings: savedSettings })
    assert.equal(settings.configRevision, 3, '两次保存连接 + 一次保存设置')
    assert.equal(settings.maxKnowledgeBases, 2)
    // 未知键被拒绝，避免把猜测的配置写进权威存储。
    await assert.rejects(worker.call('saveConnectionSettings', { connectionId: 'team-knowledge', settings: { ...savedSettings, unknownKey: 1 } }), /STORAGE_ERROR/)
    // 超过首版上限的知识库数量被拒绝。
    await assert.rejects(worker.call('saveConnectionSettings', { connectionId: 'team-knowledge', settings: { ...savedSettings, maxKnowledgeBases: 3 } }), /STORAGE_ERROR/)
  } finally { await worker.close() }
})

test('P02 项目绑定限制库数量，发布库必须同时可读', async () => {
  const root = await mkdtemp(join(base, 'bind-'))
  const worker = new StorageWorker(join(root, 'memory'), 'owner', 'host', 'fixture')
  try {
    await worker.ready
    const project = await worker.call('project', { root: '/w/a', target: 'host', name: 'A' })
    await worker.call('saveConnection', { connection: { connectionId: 'team-knowledge', baseUrl: 'https://w.example.com/api/v1', readCredentialRef: 'r' } })
    await assert.rejects(worker.call('binding', { projectId: project.id }), /BINDING_MISSING/)
    await assert.rejects(worker.call('setBinding', { projectId: project.id, binding: { connectionId: 'missing-connection', readKbIds: ['kb1'] } }), /NOT_CONFIGURED/)
    // 发布库不在读取列表时拒绝，避免召回与权限不一致。
    await assert.rejects(worker.call('setBinding', { projectId: project.id, binding: { connectionId: 'team-knowledge', readKbIds: ['kb-docs'], publishKbId: 'kb-pub' } }), /PUBLISH_KB_NOT_READABLE/)
    // 超过两个只读库被拒绝。
    await assert.rejects(worker.call('setBinding', { projectId: project.id, binding: { connectionId: 'team-knowledge', readKbIds: ['a', 'b', 'c'] } }), /KB_LIMIT_EXCEEDED/)
    const binding = await worker.call('setBinding', { projectId: project.id, binding: { connectionId: 'team-knowledge', readKbIds: ['kb-docs', 'kb-pub'], publishKbId: 'kb-pub' } })
    // 回归：绑定存在后 bindings 必须可读（曾因按 data 列读取而恒失败）。
    const bindings = await worker.call('bindings', {})
    assert.equal(bindings.length, 1)
    assert.equal(bindings[0].publishKbId, 'kb-pub')
    assert.deepEqual(bindings[0].readKbIds, ['kb-docs', 'kb-pub'])
    assert.equal(binding.bindingRevision, 1)
    assert.deepEqual(binding.readKbIds, ['kb-docs', 'kb-pub'])
    const again = await worker.call('setBinding', { projectId: project.id, binding: { connectionId: 'team-knowledge', readKbIds: ['kb-docs'], publishKbId: '' } })
    assert.equal(again.bindingRevision, 2)
    assert.equal((await worker.call('binding', { projectId: project.id })).publishKbId, '')
    // 未创建的项目身份不能建立绑定。
    await assert.rejects(worker.call('setBinding', { projectId: 'nope', binding: { connectionId: 'team-knowledge', readKbIds: ['kb-docs'] } }), /SCOPE_DENIED/)
  } finally { await worker.close() }
})

test('P02 每会话同时只有一份活动远端结果，退役引用受字节上限约束', async () => {
  const root = await mkdtemp(join(base, 'slot-'))
  const worker = new StorageWorker(join(root, 'memory'), 'owner', 'host', 'fixture')
  const reserve = (toolCallId) => worker.call('reserveSlot', { session: 's1', userTurn: 1, toolCallId, bindingRevision: 1, connectionId: 'team-knowledge', kbIds: ['kb-docs'], toolName: 'search', createdSeq: 10 })
  try {
    await worker.ready
    const first = await reserve('call-1')
    assert.equal(first.state, 'reserved')
    assert.equal(first.generation, 1)
    await assert.rejects(reserve('call-2'), /SLOT_BUSY/, '在途预留已占用唯一槽位')

    const activated = await worker.call('activateSlot', { slotId: first.slotId, resultSeq: 11, contentBytes: 300, refs: [{ kbId: 'kb-docs', knowledgeId: 'k1', chunkId: 'c1', rank: 0, score: 0.9, bodyHash: 'bh', title: 'T', fetchedAt: 1 }] })
    assert.equal(activated.slot.state, 'active')
    assert.equal(activated.replaced, '')
    assert((await worker.call('activeSlot', { session: 's1' })).slotId, first.slotId)

    // 同轮第二次检索：必须先退役旧槽位，新结果才允许预留与提交。
    await assert.rejects(reserve('call-2'), /SLOT_BUSY/, '活动槽位未退役前不得预留新槽位')
    await worker.call('retireSlot', { slotId: first.slotId, content: 'x'.repeat(200), limit: 256 })
    assert.equal((await worker.call('slot', { slotId: first.slotId })).state, 'retired')
    assert.equal(await worker.call('activeSlot', { session: 's1' }), null)
    // 退役短引用总计不超过配置上限。
    const retiredBytes = (await worker.call('retired', { session: 's1', limit: 256 })).reduce((sum, row) => sum + row.bytes, 0)
    assert(retiredBytes <= 256, `退役引用 ${retiredBytes} 超过 256 字节`)

    const second = await reserve('call-2')
    assert.equal(second.generation, 2)
    const activatedSecond = await worker.call('activateSlot', { slotId: second.slotId, resultSeq: 12, contentBytes: 120, refs: [] })
    assert.equal(activatedSecond.replaced, '', '活动槽位已退役时没有可替换的旧正文')
    assert.equal((await worker.call('activeSlot', { session: 's1' })).slotId, second.slotId)

    // 提交路径上的替换：仍有活动槽位时，activateSlot 必须先退役旧正文。
    const replacement = await worker.call('activateSlot', { slotId: second.slotId, resultSeq: 13, contentBytes: 90, refs: [] })
    assert.equal(replacement.slot.state === 'active', true)

    await worker.call('retireSlot', { slotId: second.slotId, content: 'y'.repeat(50), limit: 256 })
    const third = await reserve('call-3')
    assert.equal(third.generation, 3)
  } finally { await worker.close() }
})

test('P02 重启对账清理无法证明仍在可见面上的槽位', async () => {
  const root = await mkdtemp(join(base, 'orphan-'))
  let worker = new StorageWorker(join(root, 'memory'), 'owner', 'host', 'fixture')
  try {
    await worker.ready
    const slot = await worker.call('reserveSlot', { session: 's9', userTurn: 1, toolCallId: 'c', bindingRevision: 1, connectionId: 'c1', kbIds: ['kb'], toolName: 'search', createdSeq: 3 })
    await worker.call('activateSlot', { slotId: slot.slotId, resultSeq: 4, contentBytes: 10, refs: [] })
    await worker.close()

    worker = new StorageWorker(join(root, 'memory'), 'owner', 'host', 'fixture')
    await worker.ready
    const result = await worker.call('orphanSlots', { liveSeqs: [] })
    assert.deepEqual(result.orphaned, [slot.slotId])
    assert.equal((await worker.call('slot', { slotId: slot.slotId })).state, 'orphan')
    assert.equal(await worker.call('activeSlot', { session: 's9' }), null, '孤儿槽位清理后才允许新预留')
    const next = await worker.call('reserveSlot', { session: 's9', userTurn: 2, toolCallId: 'c2', bindingRevision: 1, connectionId: 'c1', kbIds: ['kb'], toolName: 'search', createdSeq: 5 })
    assert.equal(next.state, 'reserved')
  } finally { await worker?.close() }
})

test('P02 发布映射、出站队列与远端墓碑唯一键', async () => {
  const root = await mkdtemp(join(base, 'pub-'))
  const worker = new StorageWorker(join(root, 'memory'), 'owner', 'host', 'fixture')
  const snapshot = { title: 'T', body: 'B', bodyHash: 'bh', sourceRevision: 2, sourceHash: 'sh', targetKbId: 'kb-pub', approvedAt: 1 }
  try {
    await worker.ready
    const publication = await worker.call('publicationUpsert', {
      publication: { publishId: 'pub-1', memoryId: 'm1', scope: 'p1', targetKbId: 'kb-pub', connectionId: 'c1', state: 'approved', publishedSourceRevision: 0, publishedBodyHash: '', candidateSourceRevision: 2, candidateBodyHash: 'bh', sourceHash: 'sh', approved: snapshot, generation: 1, approvedAt: 1, lastIndexPollAt: 0, indexDeadline: 0 },
    })
    assert.equal(publication.state, 'approved')
    assert.equal(publication.approved.bodyHash, 'bh')
    assert.equal((await worker.call('publicationForMemory', { memoryId: 'm1' })).publishId, 'pub-1')
    // 一个本地记忆只能有一个发布映射。
    await assert.rejects(worker.call('publicationUpsert', {
      publication: { publishId: 'pub-2', memoryId: 'm1', scope: 'p1', targetKbId: 'kb-pub', connectionId: 'c1', state: 'approved', publishedSourceRevision: 0, publishedBodyHash: '', candidateSourceRevision: 1, candidateBodyHash: 'x', sourceHash: 'sh', approved: null, generation: 1, approvedAt: 1, lastIndexPollAt: 0, indexDeadline: 0 },
    }), /MEMORY_ALREADY_PUBLISHED/)

    const op = await worker.call('outboxEnqueue', { operation: { operationId: 'op-1', publishId: 'pub-1', op: 'create', approvedSnapshot: snapshot, attempts: 0, nextRetryAt: 0, state: 'pending', lastErrorCode: '', generation: 1 } })
    assert.equal(op.state, 'pending')
    assert.equal((await worker.call('outboxPending', {})).length, 1)
    // 同一发布、同一操作、同一 generation 不产生第二条记录。
    await worker.call('outboxEnqueue', { operation: { operationId: 'op-1', publishId: 'pub-1', op: 'create', approvedSnapshot: snapshot, attempts: 0, nextRetryAt: 0, state: 'pending', lastErrorCode: '', generation: 1 } })
    assert.equal((await worker.call('outbox', {})).length, 1)
    const retried = await worker.call('outboxUpdate', { operationId: 'op-1', state: 'failed', attempts: 3, lastErrorCode: 'UPSTREAM' })
    assert.equal(retried.attempts, 3)
    assert.equal((await worker.call('outboxFailures', {}))[0].lastErrorCode, 'UPSTREAM')

    const tombstone = await worker.call('tombstoneAdd', { tombstone: { connectionId: 'c1', kbId: 'kb-pub', remoteId: 'r1', publishId: 'pub-1', memoryId: 'm1', sourceEpoch: 3 } })
    assert.equal(tombstone.state, 'pending')
    assert((await worker.call('tombstonePending', {})).length === 1)
    await worker.call('tombstoneUpdate', { connectionId: 'c1', kbId: 'kb-pub', remoteId: 'r1', state: 'done', attempts: 1 })
    // 完成后的墓碑仍保留，用于阻止重新发布与召回。
    assert.equal((await worker.call('tombstoneFor', { memoryId: 'm1' })).state, 'done')
    assert.equal((await worker.call('tombstones', {})).length, 1)
  } finally { await worker.close() }
})

test('P02 发布预览绑定源版本与正文 hash', async () => {
  const root = await mkdtemp(join(base, 'preview-'))
  const worker = new StorageWorker(join(root, 'memory'), 'owner', 'host', 'fixture')
  try {
    await worker.ready
    await worker.call('previewStore', { preview: { previewId: 'pv-1', memoryId: 'm1', publishId: 'pub-1', bodyHash: 'bh', body: '正文', title: '标题', sourceRevision: 4, sourceHash: 'sh', targetKbId: 'kb-pub', connectionId: 'c1', approvedAt: 1 } })
    const preview = await worker.call('preview', { previewId: 'pv-1' })
    assert.equal(preview.sourceRevision, 4)
    assert.equal(preview.bodyHash, 'bh')
    assert.equal(preview.approvedAt, 1, '预览必须绑定批准时间，供页面与确认快照使用')
    assert.equal(await worker.call('preview', { previewId: 'missing' }), null)
    await worker.call('previewDrop', { previewId: 'pv-1' })
    assert.equal(await worker.call('preview', { previewId: 'pv-1' }), null)
  } finally { await worker.close() }
})

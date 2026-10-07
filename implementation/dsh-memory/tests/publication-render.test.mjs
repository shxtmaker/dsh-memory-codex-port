import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PUBLISH_MARKER_PREFIX, renderCard, markerOf, extractMarker, mergeMetadata,
  versionDiff, previewKey, isApprovedSnapshotCurrent, byteLength, sha256,
} from '../src/publication/render.ts'

/** 固定夹具：不使用当前时间，保证断言可复现。 */
const APPROVED_AT = 1749340800000

function memoryItem(overrides = {}) {
  return {
    id: 'mem-1', scope: 'project', title: '发布顺序', content: '先原子替换元数据，再发布正文。',
    kind: 'experience', status: 'observed', pinned: false, manual: true, revision: 3,
    createdAt: 1, updatedAt: 2, sources: ['sha256:aaa'],
    ...overrides,
  }
}

function publication(overrides = {}) {
  return {
    publishId: 'pub-1', memoryId: 'mem-1', scope: 'project', targetKbId: 'kb-1',
    connectionId: 'conn-1', remoteId: 'remote-1', state: 'published',
    publishedSourceRevision: 3, publishedBodyHash: 'hash-1',
    candidateSourceRevision: 0, candidateBodyHash: '', sourceHash: 'sha256:aaa',
    approved: null, remoteVersion: 'v1', generation: 1, approvedAt: APPROVED_AT,
    lastIndexPollAt: 0, indexDeadline: 0, error: '', createdAt: 1, updatedAt: 2,
    ...overrides,
  }
}

function approvedSnapshot(overrides = {}) {
  return {
    title: '发布顺序', body: '# 发布顺序\n', bodyHash: 'hash-1',
    sourceRevision: 3, sourceHash: 'sha256:aaa', targetKbId: 'kb-1', approvedAt: APPROVED_AT,
    ...overrides,
  }
}

const REQUIRED_SECTIONS = ['## 结论', '## 适用条件', '## 已验证程度', '## 失效条件', '## 来源说明', '## 批准时间']

test('卡片包含六个必需小节且顺序固定', () => {
  const card = renderCard({ item: memoryItem(), approvedAt: APPROVED_AT })
  const positions = REQUIRED_SECTIONS.map((section) => card.body.indexOf(section))
  for (const [index, position] of positions.entries()) {
    assert.ok(position >= 0, `缺少小节 ${REQUIRED_SECTIONS[index]}`)
    if (index > 0) assert.ok(positions[index - 1] < position, `${REQUIRED_SECTIONS[index]} 顺序错误`)
  }
  assert.match(card.body, /^# 发布顺序$/m)
  assert.match(card.body, /批准时间（UTC）：2025-06-08T00:00:00\.000Z/)
})

test('字段缺失时写出未提供与未验证，而不是省略小节', () => {
  const card = renderCard({ item: memoryItem({ title: '', status: '', sources: [], scope: '', kind: '' }), approvedAt: APPROVED_AT })
  for (const section of REQUIRED_SECTIONS) assert.ok(card.body.includes(section))
  assert.match(card.body, /具体适用条件：未提供/)
  assert.match(card.body, /未验证（缺少独立验证证据）/)
  assert.match(card.body, /## 失效条件\n未提供/)
  assert.match(card.body, /项目：未提供/)
  assert.match(card.body, /作用域：未提供/)
  assert.ok(card.title.length > 0, '标题为空时必须回退到可用标题')
})

test('绝对路径被剥离且来源标记不含私人路径', () => {
  const content = '证据在 /home/lqy/文档/秘密/notes.md、C:\\\\Users\\\\qy\\\\secret.txt 与 ~/private/x.txt；相对路径 src/publication/render.ts 保留；链接 https://example.com/a?token=abc 省略查询参数。'
  const card = renderCard({
    item: memoryItem({ content }),
    project: { name: '/home/lqy/文档/记忆插件', root: '/home/lqy/文档/deepseek-harness/记忆插件' },
    approvedAt: APPROVED_AT,
  })
  assert.ok(!card.body.includes('/home/lqy'), '不得残留 /home 路径')
  assert.ok(!card.body.includes('C:/Users'), '不得残留 Windows 用户路径')
  assert.ok(!card.body.includes('C:\\\\Users'), '不得残留 Windows 反斜杠路径')
  assert.ok(!card.body.includes('~/private'), '不得残留家目录简写')
  assert.ok(!card.body.includes('token=abc'), 'URL 查询参数必须省略')
  assert.match(card.body, /（已移除本机路径）/)
  assert.match(card.body, /src\/publication\/render\.ts/, '相对路径不应被误删')
  assert.match(card.body, /https:\/\/example\.com\/a（已省略查询参数）/)
  assert.match(card.body, /项目：记忆插件/, '项目名只保留末级名')
})

test('密钥形态在卡片中被脱敏', () => {
  const card = renderCard({ item: memoryItem({ content: '凭据 sk-abcdefghijklmnop 与 api_key=topsecret 不得上传。' }), approvedAt: APPROVED_AT })
  assert.ok(!card.body.includes('sk-abcdefghijklmnop'))
  assert.ok(!card.body.includes('topsecret'))
  assert.match(card.body, /\[REDACTED\]/)
})

test('同一输入重复渲染完全幂等，且 bodyHash 可对最终正文独立复算', () => {
  const input = { item: memoryItem(), project: { name: '记忆插件', root: '/tmp/x' }, approvedAt: APPROVED_AT }
  const first = renderCard(input)
  const second = renderCard(input)
  assert.equal(first.body, second.body)
  assert.equal(first.bodyHash, second.bodyHash)
  assert.equal(first.marker, second.marker)
  assert.equal(first.titleMarker, second.titleMarker)
  // 正文不内嵌自身 hash（避免自引用），但 hash 必须可由最终正文复算，
  // 这样远端正文与批准快照才能用同一算法证明一致。
  assert.equal(first.bodyHash, sha256(first.body), 'bodyHash 必须等于最终正文的 sha256')
  assert.ok(!first.body.includes('@@DSH_BODY_HASH@@'), '占位符不得残留')
  assert.equal(extractMarker(first.body), extractMarker(second.body))
})

test('显式 publishId 与派生 publishId 都稳定且不互相覆盖', () => {
  const explicit = renderCard({ item: memoryItem(), approvedAt: APPROVED_AT, publishId: 'pub-9' })
  assert.match(explicit.marker, /dsh-memory-publish:pub-9/)
  assert.equal(explicit.titleMarker, 'dsh-memory-publish:pub-9')
  assert.equal(explicit.marker, markerOf('pub-9'))
  assert.equal(explicit.marker, renderCard({ item: memoryItem(), approvedAt: APPROVED_AT, publishId: 'pub-9' }).marker)
  const derived = renderCard({ item: memoryItem(), approvedAt: APPROVED_AT })
  const derivedAgain = renderCard({ item: memoryItem({ updatedAt: 999 }), approvedAt: APPROVED_AT })
  assert.equal(derived.marker, derivedAgain.marker, '派生标记只依赖稳定字段')
  const changed = renderCard({ item: memoryItem({ revision: 4 }), approvedAt: APPROVED_AT })
  assert.notEqual(derived.marker, changed.marker)
  assert.throws(() => markerOf('   '), /PUBLISH_ID_EMPTY/)
  assert.equal(PUBLISH_MARKER_PREFIX, 'dsh-memory-publish')
})

test('extractMarker 覆盖多形态与重复出现，冲突或缺失返回 null', () => {
  const id = 'mem-abc123'
  assert.equal(extractMarker(`前缀 <!-- dsh-memory-publish:${id} --> 后缀`), id)
  assert.equal(extractMarker(`标题 dsh-memory-publish:${id} 正文`), id)
  assert.equal(extractMarker(`dsh-memory-publish-${id}`), id)
  assert.equal(extractMarker(`<!--\n  dsh-memory-publish:${id}\n-->`), id)
  const repeated = `<!-- dsh-memory-publish:${id} --> 正文 <!-- dsh-memory-publish:${id} -->`
  assert.equal(extractMarker(repeated), id, '同一标记重复出现应唯一命中')
  assert.equal(extractMarker(`<!-- dsh-memory-publish:${id} --> <!-- dsh-memory-publish:other -->`), null, '多标记冲突返回 null')
  assert.equal(extractMarker('没有任何标记'), null)
  assert.equal(extractMarker(''), null)
  // 真实卡片必须能被自身提取，供 POST 响应丢失后按标记对账。
  const card = renderCard({ item: memoryItem(), approvedAt: APPROVED_AT, publishId: 'pub-9' })
  assert.equal(extractMarker(card.body), 'pub-9')
})

test('mergeMetadata 保留非插件字段、只覆盖插件自有键', () => {
  const patch = { publishId: 'pub-1', memoryId: 'mem-1', sourceRevision: 3, bodyHash: 'h1', sourceHash: 'sha256:aaa', approvedAt: APPROVED_AT }
  const merged = mergeMetadata({ author: 'weknora', score: 7, reviewed: false, publishId: 'old', sourceRevision: 1, memoryId: 'old', bodyHash: 'old', sourceHash: 'old', approvedAt: 0 }, patch)
  assert.equal(merged.author, 'weknora')
  assert.equal(merged.score, 7)
  assert.equal(merged.reviewed, false)
  assert.equal(merged.publishId, 'pub-1')
  assert.equal(merged.memoryId, 'mem-1')
  assert.equal(merged.sourceRevision, 3)
  assert.equal(merged.bodyHash, 'h1')
  assert.equal(merged.sourceHash, 'sha256:aaa')
  assert.equal(merged.approvedAt, APPROVED_AT)
  assert.deepEqual(Object.keys(mergeMetadata({}, patch)).sort(), Object.keys(patch).sort(), '空 existing 时只写插件键')
  assert.deepEqual(mergeMetadata({}, patch), mergeMetadata({ publishId: 'ignored' }, patch), '旧插件键被覆盖而不是保留')
})

test('mergeMetadata 结果是扁平标量并满足服务端上限', () => {
  const patch = { publishId: 'pub-1', memoryId: 'mem-1', sourceRevision: 3, bodyHash: 'h1', sourceHash: 'sha256:aaa', approvedAt: APPROVED_AT }
  const merged = mergeMetadata({ nested: { a: 1 }, list: [1, 2], nothing: null, author: 'x' }, patch)
  for (const value of Object.values(merged)) {
    assert.ok(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean', '值必须是标量')
  }
  const longKey = 'k'.repeat(80)
  assert.throws(() => mergeMetadata({ [longKey]: 1 }, patch), /METADATA_KEY_TOO_LONG/)
  assert.throws(() => mergeMetadata({ big: 'x'.repeat(1001) }, patch), /METADATA_VALUE_TOO_LONG/)
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`k${index}`, index]))
  assert.throws(() => mergeMetadata(many, patch), /METADATA_KEYS_EXCEEDED/)
})

test('isApprovedSnapshotCurrent 正常路径与四种拒绝路径', () => {
  const item = memoryItem()
  const current = publication({ approved: approvedSnapshot() })
  assert.equal(isApprovedSnapshotCurrent(current, item, 'hash-1'), true)
  assert.equal(isApprovedSnapshotCurrent(publication({ approved: null }), item, 'hash-1'), false, '未批准必须拒绝')
  assert.equal(isApprovedSnapshotCurrent(publication({ approved: approvedSnapshot({ sourceRevision: 2 }) }), item, 'hash-1'), false, 'revision 不一致必须拒绝')
  assert.equal(isApprovedSnapshotCurrent(current, memoryItem({ revision: 4 }), 'hash-1'), false, '本地 revision 变化必须拒绝')
  assert.equal(isApprovedSnapshotCurrent(current, item, 'hash-2'), false, '正文 hash 不一致必须拒绝')
  assert.equal(isApprovedSnapshotCurrent(publication({ approved: approvedSnapshot({ targetKbId: 'kb-2' }) }), item, 'hash-1'), false, '目标库不一致必须拒绝')
  assert.equal(isApprovedSnapshotCurrent(publication({ approved: approvedSnapshot({ sourceHash: 'unknown' }) }), item, 'hash-1'), false, '无法证明源版本必须拒绝')
  assert.equal(isApprovedSnapshotCurrent(publication({ approved: approvedSnapshot({ bodyHash: '' }) }), item, ''), false, '缺少当前 hash 必须拒绝')
  assert.equal(isApprovedSnapshotCurrent(publication({ approved: approvedSnapshot({ body: '' }) }), item, 'hash-1'), false, '空正文快照不得当作已完成新版本')
})

test('versionDiff 覆盖四个分支，revision 变化优先于正文变化', () => {
  assert.equal(versionDiff(null, { sourceRevision: 1, bodyHash: 'a' }), 'unpublished')
  assert.equal(versionDiff({ sourceRevision: 1, bodyHash: 'a' }, { sourceRevision: 1, bodyHash: 'a' }), 'none')
  assert.equal(versionDiff({ sourceRevision: 1, bodyHash: 'a' }, { sourceRevision: 2, bodyHash: 'a' }), 'updated')
  assert.equal(versionDiff({ sourceRevision: 1, bodyHash: 'a' }, { sourceRevision: 2, bodyHash: 'b' }), 'updated')
  assert.equal(versionDiff({ sourceRevision: 1, bodyHash: 'a' }, { sourceRevision: 1, bodyHash: 'b' }), 'body-changed')
})

test('previewKey 对四个字段任一变化都敏感且可复现', () => {
  const base = { memoryId: 'mem-1', sourceRevision: 3, bodyHash: 'h1', targetKbId: 'kb-1' }
  const key = previewKey(base)
  assert.equal(key, previewKey({ ...base }), '同一输入必须复现')
  assert.equal(key.length > 32, true)
  assert.notEqual(key, previewKey({ ...base, memoryId: 'mem-2' }))
  assert.notEqual(key, previewKey({ ...base, sourceRevision: 4 }))
  assert.notEqual(key, previewKey({ ...base, bodyHash: 'h2' }))
  assert.notEqual(key, previewKey({ ...base, targetKbId: 'kb-2' }))
  // 字段拼接歧义不得造成同 key。
  assert.notEqual(previewKey({ memoryId: 'ab', sourceRevision: 1, bodyHash: 'c', targetKbId: 'd' }), previewKey({ memoryId: 'a', sourceRevision: 1, bodyHash: 'bc', targetKbId: 'd' }))
})

test('renderCard 结果可直接用于批准快照并跑通发布对账口径', () => {
  const item = memoryItem()
  const card = renderCard({ item, approvedAt: APPROVED_AT, publishId: 'pub-1' })
  const snapshot = { title: card.title, body: card.body, bodyHash: card.bodyHash, sourceRevision: item.revision, sourceHash: 'sha256:aaa', targetKbId: 'kb-1', approvedAt: APPROVED_AT }
  const record = publication({ approved: snapshot })
  assert.equal(isApprovedSnapshotCurrent(record, item, card.bodyHash), true)
  const metadata = mergeMetadata({ serverNote: 'keep' }, {
    publishId: 'pub-1', memoryId: item.id, sourceRevision: item.revision,
    bodyHash: card.bodyHash, sourceHash: 'sha256:aaa', approvedAt: APPROVED_AT,
  })
  assert.equal(metadata.serverNote, 'keep')
  assert.equal(metadata.bodyHash, card.bodyHash)
  assert.equal(versionDiff({ sourceRevision: item.revision, bodyHash: card.bodyHash }, { sourceRevision: item.revision, bodyHash: card.bodyHash }), 'none')
  assert.equal(byteLength(card.body), Buffer.byteLength(card.body, 'utf8'))
})

test('多来源与无来源时卡片如实标注且不宣称版本可证明', () => {
  const multi = renderCard({ item: memoryItem({ sources: ['h1', 'h2'] }), approvedAt: APPROVED_AT })
  assert.match(multi.body, /来源记录 hash：multiple/)
  assert.match(multi.body, /来源记录数量：2 条/)
  const none = renderCard({ item: memoryItem({ sources: [] }), approvedAt: APPROVED_AT })
  assert.match(none.body, /来源记录 hash：untracked/)
  assert.match(none.body, /来源记录数量：未提供/)
  assert.equal(isApprovedSnapshotCurrent(publication({ approved: approvedSnapshot({ sourceHash: 'multiple' }) }), memoryItem(), 'hash-1'), false)
  assert.equal(isApprovedSnapshotCurrent(publication({ approved: approvedSnapshot({ sourceHash: 'untracked' }) }), memoryItem(), 'hash-1'), false)
})

test('发布标识不匹配的发布记录不得当作当前版本', () => {
  const item = memoryItem()
  const record = publication({ memoryId: 'other-mem', approved: approvedSnapshot() })
  assert.equal(isApprovedSnapshotCurrent(record, item, 'hash-1'), false)
  assert.equal(isApprovedSnapshotCurrent(publication({ targetKbId: '', approved: approvedSnapshot() }), item, 'hash-1'), false)
})

test('卡片不含聊天日志与未经检查的命令输出等被明令排除的内容', () => {
  const card = renderCard({ item: memoryItem(), approvedAt: APPROVED_AT })
  assert.match(card.body, /不含聊天日志、隐藏推理、密钥、未经检查的命令输出或本机绝对路径/)
  assert.match(card.body, /不是已完成事实/)
  assert.match(card.body, /当前用户指令与项目正式规则优先/)
  assert.ok(!card.body.includes('localhost'), '回环地址不得出现')
  assert.ok(!card.body.includes('127.0.0.1'), '回环地址不得出现')
})

test('项目名取末级名，只有末级名仍被判定为路径时才退回未提供', () => {
  const fromRoot = renderCard({ item: memoryItem(), project: { name: '', root: '/home/lqy/项目/记忆插件' }, approvedAt: APPROVED_AT })
  assert.match(fromRoot.body, /项目：记忆插件/)
  const fromName = renderCard({ item: memoryItem(), project: { name: '/home/lqy/文档/记忆插件', root: '' }, approvedAt: APPROVED_AT })
  assert.match(fromName.body, /项目：记忆插件/)
  assert.ok(!fromName.body.includes('/home/lqy'), '项目名不得残留本机路径')
  const pathOnly = renderCard({ item: memoryItem(), project: { name: '/home/lqy/', root: '/tmp' }, approvedAt: APPROVED_AT })
  assert.match(pathOnly.body, /项目：lqy/, '只剥路径不剥末级名')
  const missing = renderCard({ item: memoryItem(), approvedAt: APPROVED_AT })
  assert.match(missing.body, /项目：未提供/)
})

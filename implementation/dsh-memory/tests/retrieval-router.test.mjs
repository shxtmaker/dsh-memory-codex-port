/**
 * P05 检索融合与包装：跨库轮转融合、来源配额、正文去重、字节裁剪与轮次计数。
 *
 * 只测试 src/retrieval/router.ts 的纯函数与纯状态，不触达网络、存储或槽位生命周期
 * （槽位生命周期由 tests/weknora-lifecycle.test.mjs 覆盖）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  rankAcross,
  renderEvidence,
  clipPage,
  TurnCounter,
  formatSearchResult,
  formatReadResult,
} from '../src/retrieval/router.ts'

const FETCHED_AT = 1759881600000 // 2025-10-08T00:00:00.000Z
const GENEROUS = { activeBytes: 0, retiredBytes: 0, limitBytes: 8192, retiredLimitBytes: 256 }

/** 正文哈希与生产实现一致（sha256 十六进制），保证去重用例贴近真实数据。 */
function hash(text) {
  return createHash('sha256').update(text).digest('hex')
}

/** 构造一条库内命中；默认字段互不相同，避免用例之间互相干扰。 */
function makeHit(kbId, rank, overrides = {}) {
  const content = overrides.content ?? `${kbId} 第 ${rank} 条正文`
  return {
    kbId,
    kbRank: rank,
    knowledgeId: `${kbId}-doc-${rank}`,
    chunkId: `${kbId}-chunk-${rank}`,
    title: `${kbId} 标题 ${rank}`,
    score: 1 - rank / 100,
    bodyHash: hash(content),
    fetchedAt: FETCHED_AT,
    matchType: 1,
    ...overrides,
    content,
  }
}

/** 构造远端引用，用于工具结果文案用例。 */
function makeRef(overrides = {}) {
  const content = overrides.content ?? '引用正文'
  return {
    kbId: 'kb-a',
    knowledgeId: 'doc-1',
    chunkId: 'chunk-1',
    rank: 1,
    score: 0.42,
    bodyHash: hash(content),
    title: '接口约定',
    fetchedAt: FETCHED_AT,
    ...overrides,
  }
}

test('rankAcross 按库内排名轮转融合：低分库的高排名先于高分库', () => {
  // 两库分数尺度差异极大；若混排 score，kb-b 会全部排在前面。
  const low = [makeHit('kb-a', 0, { score: 0.002 }), makeHit('kb-a', 1, { score: 0.001 })]
  const high = [makeHit('kb-b', 0, { score: 900 }), makeHit('kb-b', 1, { score: 800 })]
  const fused = rankAcross([low, high], 4)
  assert.deepEqual(fused.map(hit => hit.chunkId), ['kb-a-chunk-0', 'kb-b-chunk-0', 'kb-a-chunk-1', 'kb-b-chunk-1'])
  assert.deepEqual(fused.map(hit => hit.kbRank), [1, 1, 2, 2])
  // 原始分数原样保留，供同库内比较与审计，但不参与跨库排序。
  assert.deepEqual(fused.map(hit => hit.score), [0.002, 900, 0.001, 800])
})

test('rankAcross 不比较不同库的原始分数：分数只是记录，不参与排序', () => {
  const tiny = [makeHit('kb-a', 0, { score: 1e-9 })]
  const huge = [makeHit('kb-b', 0, { score: 1e9 }), makeHit('kb-b', 1, { score: 9e8 })]
  const fused = rankAcross([tiny, huge], 3)
  assert.equal(fused[0].kbId, 'kb-a')
  assert.equal(fused[0].score, 1e-9)
  // 第 2、3 条来自 kb-b 的第 1、2 轮，与分数大小无关。
  assert.deepEqual(fused.map(hit => hit.kbRank), [1, 1, 2])
})

test('rankAcross 确定性排序：与库数组顺序无关，同轮次按 (kbId, knowledgeId, chunkId) 字典序', () => {
  const kbB = [makeHit('kb-b', 0), makeHit('kb-b', 1)]
  const kbA = [makeHit('kb-a', 0), makeHit('kb-a', 1)]
  const forward = rankAcross([kbA, kbB], 4)
  const reversed = rankAcross([kbB, kbA], 4)
  assert.deepEqual(forward, reversed)
  // 同一轮次内先 kb-a 再 kb-b，与传入顺序无关。
  assert.deepEqual(forward.map(hit => hit.chunkId), ['kb-a-chunk-0', 'kb-b-chunk-0', 'kb-a-chunk-1', 'kb-b-chunk-1'])
  // 完全相同的输入重复调用必须完全一致。
  assert.deepEqual(rankAcross([kbA, kbB], 4), forward)
})

test('rankAcross 来源配额：同一 kbId+knowledgeId 最多两条，避免单文档占满', () => {
  const greedy = [
    makeHit('kb-a', 0, { knowledgeId: 'doc-S' }),
    makeHit('kb-a', 1, { knowledgeId: 'doc-S' }),
    makeHit('kb-a', 2, { knowledgeId: 'doc-S' }),
    makeHit('kb-a', 3, { knowledgeId: 'doc-S' }),
  ]
  const other = [makeHit('kb-b', 0, { knowledgeId: 'doc-T' })]
  const fused = rankAcross([greedy, other], 4)
  assert.equal(fused.filter(hit => hit.knowledgeId === 'doc-S').length, 2)
  assert.ok(fused.some(hit => hit.knowledgeId === 'doc-T'))
  // 配额按 kbId+knowledgeId 计；不同库的同名文档各自最多两条。
  const sameNameOtherKb = [makeHit('kb-c', 0, { knowledgeId: 'doc-S' })]
  const acrossKb = rankAcross([greedy, sameNameOtherKb], 6)
  assert.equal(acrossKb.filter(hit => hit.knowledgeId === 'doc-S').length, 3)
  // 轮转顺序：第 1 轮 kb-a 与 kb-c 各一条，第 2 轮再取 kb-a 的第二条。
  assert.deepEqual(acrossKb.map(hit => hit.kbId), ['kb-a', 'kb-c', 'kb-a'])
})

test('rankAcross 按正文哈希去重，保留排名更靠前的一条', () => {
  const shared = '同一份正文在两个库里都存在'
  const better = makeHit('kb-a', 0, { content: shared })
  const worse = makeHit('kb-b', 0, { content: shared })
  const fused = rankAcross([[better], [worse]], 4)
  assert.equal(fused.length, 1)
  assert.equal(fused[0].kbId, 'kb-a')
  // 去重后另一个文档仍可入选，不会因为去重丢空结果集。
  const another = [makeHit('kb-b', 1, { content: '另一份正文' })]
  assert.equal(rankAcross([[better], [worse, ...another]], 4).length, 2)
  // 缺少正文哈希时无法证明重复，不做合并。
  const noHashA = makeHit('kb-a', 0, { content: shared, bodyHash: '' })
  const noHashB = makeHit('kb-b', 0, { content: shared, bodyHash: '' })
  assert.equal(rankAcross([[noHashA], [noHashB]], 4).length, 2)
})

test('rankAcross 边界：limit 非正、空输入与空库', () => {
  const hits = [makeHit('kb-a', 0)]
  assert.deepEqual(rankAcross([hits], 0), [])
  assert.deepEqual(rankAcross([hits], -3), [])
  assert.deepEqual(rankAcross([], 5), [])
  assert.deepEqual(rankAcross([[], []], 5), [])
  assert.equal(rankAcross([hits, [], []], 5).length, 1)
})

test('renderEvidence 产出带封装的证据，引用字段齐全且字节计量用 UTF-8', () => {
  const hit = makeHit('kb-a', 0, { title: '数据库操作约定', content: '数据库操作统一放在 repositories 层。' })
  const out = renderEvidence([hit], GENEROUS)
  assert.equal(out.code, 'OK')
  assert.equal(out.used.length, 1)
  assert.equal(out.bytes, Buffer.byteLength(out.text, 'utf8'))
  assert.ok(out.text.startsWith('<knowledge-evidence>'))
  assert.ok(out.text.endsWith('</knowledge-evidence>'))
  assert.ok(out.text.includes('标题：数据库操作约定'))
  assert.ok(out.text.includes(`文档ID：${hit.knowledgeId}`))
  assert.ok(out.text.includes(`块ID：${hit.chunkId}`))
  assert.ok(out.text.includes(`正文hash：${hit.bodyHash}`))
  assert.ok(out.text.includes('获取时间：2025-10-08T00:00:00.000Z'))
  assert.ok(out.text.includes(hit.content))
  // 必须声明外部证据身份与优先级。
  assert.ok(out.text.includes('不是已完成事实'))
  assert.ok(out.text.includes('当前用户指令与项目正式规则优先'))
  const ref = out.used[0]
  assert.deepEqual(ref, {
    kbId: 'kb-a', knowledgeId: hit.knowledgeId, chunkId: hit.chunkId, rank: 1,
    score: hit.score, bodyHash: hit.bodyHash, title: hit.title, fetchedAt: FETCHED_AT,
  })
})

test('renderEvidence 发布卡片携带版本时附发布版本', () => {
  const hit = { ...makeHit('kb-a', 0), version: 'manual-v3', remoteRevision: 7 }
  const out = renderEvidence([hit], GENEROUS)
  assert.equal(out.code, 'OK')
  assert.ok(out.text.includes('发布版本：manual-v3'))
  assert.equal(out.used[0].version, 'manual-v3')
  assert.equal(out.used[0].remoteRevision, 7)
  // 未携带版本时不产出该字段。
  const plain = renderEvidence([makeHit('kb-b', 0)], GENEROUS)
  assert.equal(plain.used[0].version, undefined)
  assert.ok(!plain.text.includes('发布版本：'))
})

test('renderEvidence 标题、引用、正文与封装一起计入 limitBytes', () => {
  const hit = makeHit('kb-a', 0, { content: '正文' })
  const full = renderEvidence([hit], GENEROUS)
  // 上限恰好等于整份文本时，不允许截断，也不允许超限。
  const exact = renderEvidence([hit], { ...GENEROUS, limitBytes: full.bytes })
  assert.equal(exact.code, 'OK')
  assert.equal(exact.bytes, full.bytes)
  assert.deepEqual(exact.used, full.used)
  assert.ok(!exact.text.includes('正文已截断'))
})

test('renderEvidence 超出上限时截断正文但保留引用行，且不产生非法 UTF-8', () => {
  const hit = makeHit('kb-a', 0, { content: '知'.repeat(4000) }) // 12000 字节
  const out = renderEvidence([hit], { activeBytes: 0, retiredBytes: 0, limitBytes: 1024, retiredLimitBytes: 256 })
  assert.equal(out.code, 'OK')
  assert.equal(out.used.length, 1)
  assert.ok(out.bytes <= 1024)
  assert.ok(out.text.includes(`正文hash：${hit.bodyHash}`))
  assert.ok(out.text.includes('正文已截断'))
  assert.ok(out.text.startsWith('<knowledge-evidence>'))
  assert.ok(out.text.endsWith('</knowledge-evidence>'))
  // 字节截断不得切碎多字节字符。
  assert.equal(Buffer.from(out.text, 'utf8').toString('utf8'), out.text)
  assert.ok(!out.text.includes('\uFFFD'))
})

test('renderEvidence activeBytes 视为已占用字节，与扣减上限等价', () => {
  const hit = makeHit('kb-a', 0, { content: '中'.repeat(200) })
  const full = renderEvidence([hit], GENEROUS)
  const byLimit = renderEvidence([hit], { ...GENEROUS, limitBytes: full.bytes - 40 })
  const byActive = renderEvidence([hit], { ...GENEROUS, activeBytes: 40, limitBytes: full.bytes })
  assert.equal(byLimit.code, 'OK')
  assert.deepEqual(byLimit, byActive)
  assert.ok(byActive.bytes <= full.bytes - 40)
})

test('renderEvidence 连引用行都放不下时返回 TOO_LARGE 且不产出半条', () => {
  const hit = makeHit('kb-a', 0, { content: '正文' })
  const tiny = renderEvidence([hit], { activeBytes: 0, retiredBytes: 0, limitBytes: 16, retiredLimitBytes: 256 })
  assert.equal(tiny.code, 'TOO_LARGE')
  assert.equal(tiny.text, '')
  assert.equal(tiny.bytes, 0)
  assert.deepEqual(tiny.used, [])
  // 槽位已被占满时同样整体降级，不发半条。
  const occupied = renderEvidence([hit], { activeBytes: 3072, retiredBytes: 0, limitBytes: 3072, retiredLimitBytes: 256 })
  assert.equal(occupied.code, 'TOO_LARGE')
  assert.deepEqual(occupied.used, [])
})

test('renderEvidence 后续条目放不下时整份降级，不提交半份证据', () => {
  const hits = [makeHit('kb-a', 0, { content: '甲'.repeat(120) }), makeHit('kb-b', 0, { content: '乙'.repeat(120) }), makeHit('kb-c', 0, { content: '丙'.repeat(120) })]
  const two = renderEvidence(hits.slice(0, 2), GENEROUS)
  assert.equal(two.code, 'OK')
  assert.equal(two.used.length, 2)
  // 只比“两条整份”多 10 字节：第三条连引用行都放不下。
  const rejected = renderEvidence(hits, { ...GENEROUS, limitBytes: two.bytes + 10 })
  assert.equal(rejected.code, 'TOO_LARGE')
  assert.equal(rejected.text, '')
  assert.deepEqual(rejected.used, [])
})

test('renderEvidence 无命中或正文为空时不产出空壳证据', () => {
  assert.deepEqual(renderEvidence([], GENEROUS), { text: '', used: [], bytes: 0, code: 'OK' })
  const blank = renderEvidence([makeHit('kb-a', 0, { content: '   ' })], GENEROUS)
  assert.deepEqual(blank, { text: '', used: [], bytes: 0, code: 'OK' })
})

test('clipPage 只返回完整块，nextCursor 取最后一块 chunkIndex+1', () => {
  const chunks = [
    { id: 'c0', chunkIndex: 0, content: 'a'.repeat(100) },
    { id: 'c1', chunkIndex: 1, content: 'b'.repeat(100) },
    { id: 'c2', chunkIndex: 2, content: 'c'.repeat(100) },
  ]
  // 100 + 1(块间换行) + 100 = 201 可容纳；再加一块为 302，超出即停止。
  const clipped = clipPage(chunks, 250)
  assert.deepEqual(clipped.blocks, ['a'.repeat(100), 'b'.repeat(100)])
  assert.equal(clipped.bytes, 201)
  assert.equal(clipped.nextCursor, 2)
  // 首块就是完整块，不会返回半块。
  assert.deepEqual(clipPage(chunks, 99), { blocks: [], bytes: 0, nextCursor: 0 })
  assert.deepEqual(clipPage(chunks, 0), { blocks: [], bytes: 0, nextCursor: 0 })
  assert.deepEqual(clipPage(chunks, -5), { blocks: [], bytes: 0, nextCursor: 0 })
  assert.deepEqual(clipPage([], 500), { blocks: [], bytes: 0, nextCursor: 0 })
})

test('clipPage 按 UTF-8 字节而不是字符数计算', () => {
  const chunks = [{ id: 'z0', chunkIndex: 5, content: '中'.repeat(10) }] // 30 字节
  assert.equal(clipPage(chunks, 29).blocks.length, 0)
  const fitted = clipPage(chunks, 30)
  assert.deepEqual(fitted.blocks, ['中'.repeat(10)])
  assert.equal(fitted.bytes, 30)
  assert.equal(fitted.nextCursor, 6)
})

test('TurnCounter 按 userTurn 计数，超出 limit 即拒绝', () => {
  const counter = new TurnCounter(2)
  assert.equal(counter.use(1), true)
  assert.equal(counter.use(1), true)
  assert.equal(counter.use(1), false)
  assert.equal(counter.use(1), false)
  // 换轮后重新计数；轮次回退同样视为新的一轮。
  assert.equal(counter.use(2), true)
  assert.equal(counter.use(2), true)
  assert.equal(counter.use(2), false)
  assert.equal(counter.use(1), true)
  // reset 清空轮次与计数。
  counter.reset()
  assert.equal(counter.use(2), true)
  assert.equal(counter.use(2), true)
  assert.equal(counter.use(2), false)
})

test('TurnCounter 边界：limit 为 0、每调用上限覆盖与非法值', () => {
  const closed = new TurnCounter(0)
  assert.equal(closed.use(1), false)
  const unlimited = new TurnCounter(Number.MAX_SAFE_INTEGER)
  // evidence.ts 以会话为键共享计数器，上限按当前设置逐次传入。
  assert.equal(unlimited.use(7, 1), true)
  assert.equal(unlimited.use(7, 1), false)
  assert.equal(unlimited.use(8, 1), true)
  const nan = new TurnCounter(Number.NaN)
  assert.equal(nan.use(1), false)
})

test('formatSearchResult 成功时给出引用，未命中时不冒充成功', () => {
  const refs = [makeRef(), makeRef({ chunkId: 'chunk-2', rank: 2, content: '第二条' })]
  const ok = formatSearchResult(refs, 'OK', '')
  assert.ok(ok.includes('条依据'))
  assert.ok(ok.includes('标题：接口约定'))
  assert.ok(ok.includes('文档ID：doc-1'))
  assert.ok(ok.includes(`正文hash：${refs[0].bodyHash}`))
  assert.ok(ok.includes('不是已完成事实'))
  assert.ok(ok.includes('仅同库内可比'))
  const empty = formatSearchResult([], 'OK', '')
  assert.ok(empty.includes('未命中'))
  assert.ok(empty.includes('不等于资料不存在'))
})

test('formatSearchResult 失败时给出固定降级代码，不输出空结果冒充成功', () => {
  const codes = ['NO_BINDING', 'READ_DISABLED', 'DEADLINE', 'CANCELLED', 'UPSTREAM', 'UNAUTHORIZED', 'KB_DENIED', 'TURN_LIMIT', 'SLOT_BUSY', 'NOT_FOUND', 'TOO_LARGE', 'NOT_CONFIGURED']
  for (const code of codes) {
    const text = formatSearchResult([], code, '上游说明')
    assert.ok(text.startsWith('知识库检索未完成'), code)
    assert.ok(text.includes(code), code)
    assert.ok(text.includes('降级'), code)
    assert.ok(text.includes('上游说明'), code)
    assert.ok(!text.includes('条依据'), code)
    assert.ok(text.length > 20, code)
  }
  // 未知代码也必须原样可见，不能被吞掉或当成成功。
  const unknown = formatSearchResult([], 'SOMETHING_NEW', '')
  assert.ok(unknown.includes('SOMETHING_NEW'))
  assert.ok(unknown.includes('降级'))
  assert.ok(unknown.includes('未知或未分类'))
})

test('formatReadResult 成功时给出目标、页码与正文块', () => {
  const text = formatReadResult({ knowledgeId: 'doc-9', title: '部署说明', page: 2, blocks: ['第一步：构建。', '第二步：重启 Host。'], total: 12, code: 'OK', message: '' })
  assert.ok(text.startsWith('<knowledge-document>'))
  assert.ok(text.endsWith('</knowledge-document>'))
  assert.ok(text.includes('部署说明'))
  assert.ok(text.includes('文档ID：doc-9'))
  assert.ok(text.includes('第 2 页'))
  assert.ok(text.includes('本页 2 块'))
  assert.ok(text.includes('文档共 12 块'))
  assert.ok(text.includes('第一步：构建。'))
  assert.ok(text.includes('第二步：重启 Host。'))
  assert.ok(text.includes('不是已完成事实'))
})

test('formatReadResult 失败或空页时明确降级，不用空页冒充读取成功', () => {
  const failed = formatReadResult({ knowledgeId: 'doc-9', title: '部署说明', page: 3, blocks: [], total: 12, code: 'TOO_LARGE', message: '超出槽位上限' })
  assert.ok(failed.startsWith('知识库文档读取未完成'))
  assert.ok(failed.includes('TOO_LARGE'))
  assert.ok(failed.includes('降级'))
  assert.ok(failed.includes('本页正文未注入'))
  assert.ok(failed.includes('超出槽位上限'))
  assert.ok(!failed.includes('<knowledge-document>'))
  const blank = formatReadResult({ knowledgeId: 'doc-9', title: '部署说明', page: 1, blocks: [], total: 12, code: 'OK', message: '' })
  assert.ok(blank.includes('不代表文档为空'))
  assert.ok(blank.includes('请求页码：1'))
  assert.ok(!blank.includes('<knowledge-document>'))
})

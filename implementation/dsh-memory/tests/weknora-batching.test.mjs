/**
 * P11 整理输入分批：来源数与 UTF-8 字节双上限，且只推进本批次已处理来源的游标。
 *
 * 方案要求：不能仅截断 prompt 后把全部来源标记完成，否则被截断的变化会永久遗漏。
 * 本测试直接针对这一不变式，使用真实 SQLite Worker。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { StorageWorker } from '../lib/worker-client.js'

const base = resolve('test-runs')
await mkdir(base, { recursive: true })
const digest = text => createHash('sha256').update(text).digest('hex')
const signal = () => new AbortController().signal

/** 建立项目并写入 N 个已提炼来源，每个来源含一条候选结论。 */
async function fixture(count, contentSize = 20) {
  // contentSize 控制候选结论正文长度，用于让 UTF-8 字节上限真正生效。
  const root = await mkdtemp(join(base, 'batch-'))
  const store = new StorageWorker(join(root, 'memory'), 'owner', 'host', 'fixture')
  await store.ready
  await store.call('policy', { global: { use: false, generate: true }, projects: { use: true, generate: true } })
  const project = await store.call('project', { root: join(root, 'project-A'), target: 'host', name: 'A' })
  const sources = []
  for (let index = 0; index < count; index++) {
    const text = JSON.stringify([{ seq: index, role: 'user', text: `约定 ${index}：${'内容'.repeat(contentSize)}` }])
    // 来源时间取过去：capture 以 updatedAt+idleMs 作为首次可调度时间，取未来会让任务暂时不可租。
    const source = { id: `${String(index).padStart(3, '0')}-${randomUUID()}`, sessionId: randomUUID(), project: project.id, start: index, end: index, hash: digest(text), updatedAt: Date.now() - 60000 + index, excluded: false }
    await store.call('capture', { source, idleMs: 0 })
    const job = (await store.call('pending', {})).find(row => row.source === source.id)
    assert(job, `来源 ${source.id} 必须产生可调度的提炼任务`)
    const leased = await store.call('lease', { id: job.id, reserve: 100 })
    assert(leased, `提炼任务 ${job.id} 必须能取得租约`)
    await store.call('commitExtraction', {
      id: job.id, fence: leased.fence, hash: source.hash, intervalMs: 0,
      output: { rollout_summary: `摘要 ${index}`, rollout_slug: `slug-${index}`, items: [{ scope: 'project', kind: 'decision', title: `约定 ${index}`, content: `项目约定 ${index} ${'细节'.repeat(contentSize)}`, status: 'observed', source_refs: [index] }] },
    })
    await store.call('settleJob', { id: job.id, fence: leased.fence, usage: 1, state: 'succeeded' })
    sources.push(source)
  }
  return { root, store, project, sources }
}

/**
 * 取得该项目作用域的整理任务。
 *
 * capture 会同时为 global 与 project 生成整理任务；global 侧没有候选条目时
 * 不写入 extraction，因此它的输入恒为空。测试必须锁定项目作用域的任务。
 */
async function consolidateJob(store, projectId) {
  // pending 只返回到期任务；overview.jobs 是完整的持久任务视图。
  const jobs = (await store.call('overview', {})).jobs
  const job = jobs.filter(row => row.kind === 'consolidate' && row.scope === projectId).sort((a, b) => a.createdAt - b.createdAt)[0]
  assert(job, '项目作用域必须存在整理任务')
  return job
}

test('P11 批次按来源数上限裁剪，未纳入的变化保持待处理', async () => {
  const f = await fixture(6)
  try {
    const first = await f.store.call('consolidationInput', { scope: f.project.id, maxSources: 2, maxBytes: 262144 })
    assert.equal(first.inputs.length, 2, '单批来源数不得超过上限')
    assert.equal(first.pending, 4, '剩余 4 个变化来源必须顺延')
    assert.equal(first.removed.length, 0, '变化未全部覆盖时不得处理删除')
    // 顺序确定：按来源 id 排序，保证同一状态得到同一批次划分。
    assert.deepEqual(first.inputs.map(row => row.source), [...first.inputs.map(row => row.source)].sort())
  } finally { await f.store.close() }
})

test('P11 批次按 UTF-8 字节上限裁剪，并给出实际字节数', async () => {
  const f = await fixture(6, 900)
  try {
    const first = await f.store.call('consolidationInput', { scope: f.project.id, maxSources: 8, maxBytes: 8192 })
    assert(first.inputs.length >= 1 && first.inputs.length < 6, `字节上限必须生效，实际纳入 ${first.inputs.length}`)
    assert.equal(first.pending, 6 - first.inputs.length)
    assert(first.bytes > 0 && first.bytes <= 8192 + 20000, 'bytes 应反映本批实际输入规模')
    // 至少纳入一条，避免单条超预算时永远无法推进。
    assert(first.inputs.length >= 1)
  } finally { await f.store.close() }
})

test('P11 游标只推进本批次：分批提交后剩余变化仍可被处理，不遗漏', async () => {
  const f = await fixture(5)
  try {
    const all = await f.store.call('consolidationInput', { scope: f.project.id, maxSources: 8, maxBytes: 262144 })
    assert.equal(all.inputs.length, 5)
    assert.equal(all.pending, 0)

    // 第一批：只纳入 2 个来源，并只提交这 2 个。
    const batch1 = await f.store.call('consolidationInput', { scope: f.project.id, maxSources: 2, maxBytes: 262144 })
    const batch2 = await f.store.call('consolidationInput', { scope: f.project.id, maxSources: 2, maxBytes: 262144 })
    // 用真实的整理任务驱动 commitProposal，验证游标语义。
    const job = await consolidateJob(f.store, f.project.id)
    const leased = await f.store.call('lease', { id: job.id, reserve: 100 })
    assert(leased, '整理任务必须能取得租约')
    const committedBatch = await f.store.call('consolidationInput', { scope: f.project.id, maxSources: 2, maxBytes: 262144 })
    await f.store.call('commitProposal', {
      id: job.id, fence: leased.fence, hash: committedBatch.hash, batchHash: committedBatch.batchHash,
      maxSources: 2, maxBytes: 262144,
      output: { changes: committedBatch.inputs.map(row => ({ op: 'add', title: `新增 ${row.source.slice(0, 6)}`, content: `来自 ${row.source} 的结论`, kind: 'decision', status: 'observed', sources: [row.source] })) },
    })

    // 剩余 3 个来源必须仍然待处理，而不是被标记完成。
    const after = await f.store.call('consolidationInput', { scope: f.project.id, maxSources: 8, maxBytes: 262144 })
    assert.equal(after.inputs.length, 3, '未提交的来源必须保持待处理')
    assert.equal(after.pending, 0, '本批覆盖了全部剩余变化')
    // 已提交的 2 个来源不得再次出现；剩余 3 个必须都能被处理。
    const committed = new Set(committedBatch.inputs.map(row => row.source))
    assert(after.inputs.every(row => !committed.has(row.source)), '已提交来源不得重复进入下一批')
    assert.equal(after.inputs.length + committed.size, 5, '两批合并必须覆盖全部 5 个来源且无重复')
  } finally { await f.store.close() }
})

test('P11 批次与提交必须对应：batchHash 不符即拒绝提交', async () => {
  const f = await fixture(4)
  try {
    const job = await consolidateJob(f.store, f.project.id)
    const leased = await f.store.call('lease', { id: job.id, reserve: 100 })
    const batch = await f.store.call('consolidationInput', { scope: f.project.id, maxSources: 2, maxBytes: 262144 })
    // 用另一批次划分的 batchHash 提交必须失败，避免用旧游标结算新变化。
    await assert.rejects(f.store.call('commitProposal', {
      id: job.id, fence: leased.fence, hash: batch.hash, batchHash: 'not-the-batch', maxSources: 2, maxBytes: 262144,
      output: { changes: [] },
    }), /BATCH_CHANGED/)
    // 引用未纳入本批的来源必须被拒绝。
    const other = (await f.store.call('consolidationInput', { scope: f.project.id, maxSources: 8, maxBytes: 262144 })).inputs.map(row => row.source)
    const outside = other.find(source => !batch.inputs.some(row => row.source === source))
    assert(outside, '夹具必须存在本批之外的来源')
    await assert.rejects(f.store.call('commitProposal', {
      id: job.id, fence: leased.fence, hash: batch.hash, batchHash: batch.batchHash, maxSources: 2, maxBytes: 262144,
      output: { changes: [{ op: 'add', title: '越界', content: '引用本批之外来源', kind: 'decision', status: 'observed', sources: [outside] }] },
    }), /INVALID_SOURCE_REF/)
  } finally { await f.store.close() }
})

test('P11 前台预算口径以字节表达，且不再出现“tokens（保守计量）”文案', async () => {
  const { readFile } = await import('node:fs/promises')
  const client = await readFile(resolve('src/client/MemorySettingsSection.tsx'), 'utf8')
  const locales = await readFile(resolve('src/client/locales.ts'), 'utf8')
  assert(!client.includes('tokens（保守计量）'), '1024 不得再被标为 tokens（保守计量）')
  assert(client.includes('字节证据额度'), '本地额度必须标为字节证据额度')
  assert(locales.includes('字节额度与估算/实际 token 必须分开表述') || locales.includes('budgetHelp'), '文案必须说明字节与 token 的区别')
  // 整理批次文案必须说明“顺延”而不是截断。
  assert(/顺延/.test(locales), '必须说明未纳入本批的变化顺延')
})

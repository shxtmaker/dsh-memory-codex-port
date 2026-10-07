/**
 * 真实插件上下文端到端 Host 集成测试（P05/P06/P08/P09，T-E）。
 *
 * 宿主组合与 tests/production-source.mjs 一致：真实 Context / LlmRuntime / SessionStore /
 * AgentRegistry / AgentLoop / Tools / SystemPrompt / Commands / Persistence，
 * 再用 `import * as plugin from '../lib/index.js'` 挂载真实插件。工具通过 ctx.tools 真实调度，
 * 管理操作通过 ctx.memory.invoke（MemoryRemote）真实调用，存储是真实 SQLite Worker。
 *
 * 注意：lib/ 是构建产物，改动 src 后必须先 `npm run build`，否则本文件测的是旧产物。
 *
 * 覆盖范围：
 *   1 本地来源：source 省略时仍走本地证据，行为与改造前一致，且不发出知识库请求；
 *   2 未开启检索：knowledgeRead=false 时给出明确“未开启”文本，即使连接与绑定齐备也不发 HTTP；
 *   3 知识检索：真实本机 HTTP 夹具收到 POST .../hybrid-search，证据带 <knowledge-evidence>，
 *               同一会话再次调用时旧槽位先退役、同时只有一份活动结果；
 *   4 未绑定：未绑定连接的项目返回“该项目未配置知识库”，且不发出 HTTP 请求；
 *   5 管理操作：connections / connection / knowToggle / binding / publications 与只读拒绝；
 *   6 凭据：连接只保存引用名，密钥仅在 Host 解析后进入请求头，页面与存储都不含正文。
 *
 * 模型是固定适配器，不访问网络；隔离 home 由 mkdtemp 建立并指向 DSH_HOME。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { homedir, hostname, userInfo } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Commands from '@deepseek-ai/dsh-commands'
import Projections from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as plugin from '../lib/index.js'
import { StorageWorker } from '../lib/worker-client.js'

await mkdir('test-runs', { recursive: true })
/** 隔离 home：插件按 DSH_HOME 解析存储与项目身份，用例之间用不同 memoryProfileId 再隔离一层。 */
const home = await mkdtemp(resolve('test-runs', 'weknora-host-'))
process.env.DSH_HOME = home

const digest = text => createHash('sha256').update(text).digest('hex')
const normalize = value => value.replace(/\\/g, '/')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
/** 轮询真实插件状态；不用固定 sleep 假定后台已经完成。 */
async function wait(predicate, code) {
  for (let index = 0; index < 150; index++) {
    if (await predicate()) return
    await delay(20)
  }
  throw Error(code)
}
/** 打开同一配置档的存储，用于核对槽位状态；owner/trust 口径与插件一致。 */
async function openStore(profile) {
  const store = new StorageWorker(join(home, 'memory', profile), digest(userInfo().username + '\0' + homedir()), digest(hostname() + '\0' + home), profile)
  await store.ready
  return store
}
/** 以 latin1 读取数据库文件（含 WAL），用于断言密钥正文没有落盘。 */
async function storeBytes(profile) {
  let text = ''
  for (const name of ['state.sqlite', 'state.sqlite-wal']) {
    try { text += await readFile(join(home, 'memory', profile, name), 'latin1') } catch { /* 尚未创建的文件跳过。 */ }
  }
  return text
}
/** 真实本机 HTTP 夹具：承载 hybrid-search 与知识库列表，记录方法、路径、请求头与请求体。 */
async function httpFixture() {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const url = req.url.split('?')[0]
      requests.push({ method: req.method, url, headers: req.headers, body: body ? JSON.parse(body) : undefined })
      let reply
      if (url.endsWith('/hybrid-search')) {
        reply = { success: true, data: [{ id: 'chunk-1', content: '数据库操作放在 repositories 目录。', knowledge_id: 'doc-1', chunk_index: 0, knowledge_title: '数据库约定', score: 0.9, match_type: 1, knowledge_base_id: 'kb-docs' }] }
      } else if (url === '/api/v1/knowledge-bases') {
        reply = { success: true, data: [{ id: 'kb-docs', name: '文档库', type: 'document' }] }
      }
      if (!reply) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: { code: 1003, message: 'not found' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(reply))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

/** 搭建真实插件上下文的完整夹具；每个用例用独立配置档，互不共享存储。 */
async function harness({ profile, knowledgeRead = false, consent = false }) {
  const capability = { host: '127.0.0.1' }
  const modelCalls = []
  /** 固定模型适配器：只回固定文本，不发出任何真实网络请求。 */
  class FixedAdapter extends LlmAdapter {
    async listModels(provider) { return [{ provider, id: 'fixed', name: 'Fixed model' }] }
    async *stream(options) {
      modelCalls.push(options)
      const text = '固定模型回复。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
  await ctx.plugin(Tools)
  await ctx.plugin(Commands)
  await ctx.plugin(Projections)
  await ctx.plugin(Persistence, { root: join(home, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['fixture'], new FixedAdapter())
  // 本机 Host 组合：isWritable 由 ctx.get('webServer').host === '127.0.0.1' 且存在 configEditor 决定，
  // 与 tests/host.mjs 一样通过改 host 在同一进程内覆盖只读分支，不需要第二套内核。
  ctx.provide('webServer', capability)
  ctx.provide('configEditor', {})
  // 凭据先放占位实现（拒绝解析），用例可随后用 ctx.set 注入最小凭据服务。
  ctx.provide('credentials', { resolve: async () => { throw new Error('NOT_CONFIGURED') }, describe: async () => ({ configured: false }) })
  // 配置走 Cordis 配置层：显式项来自用例，其余沿用插件 Config 的默认值。
  const kernel = await ctx.plugin(plugin, {
    memoryProfileId: profile, projectUse: true, projectGenerate: false,
    globalUse: false, globalGenerate: false, consent,
    provider: 'fixture', model: 'fixed', knowledgeRead,
  })
  const signal = () => new AbortController().signal
  const invoke = async request => JSON.parse((await ctx.memory.invoke(request, signal())).json)
  const overview = () => invoke({ action: 'overview' })
  const cwdFor = async name => { const dir = join(home, name); await mkdir(dir, { recursive: true }); return dir }
  const projectOf = async dir => {
    let found
    await wait(async () => {
      found = (await overview()).projects.find(item => normalize(item.root) === normalize(dir) || item.root.endsWith(basename(dir)))
      return !!found
    }, 'PROJECT_TIMEOUT')
    return found
  }
  const agentFor = async dir => {
    const handle = await ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: dir }, agentOptions: { provider: 'fixture', model: 'fixed' } })
    await projectOf(dir)
    return handle
  }
  /** 真实调用 memory 工具；exec.agent 决定项目与配额归属。 */
  const call = (callId, args, handle) => ctx.tools.execute({ callId, name: 'memory', arguments: args, agent: handle.agent, signal: signal() })
  /** 注入最小凭据服务：只按引用名解析，页面与存储都拿不到正文。 */
  const useCredentials = (value, seen = []) => ctx.set('credentials', {
    resolve: async ref => { seen.push(String(ref)); return { value, source: 'env' } },
    describe: async () => ({ configured: true }),
  })
  return {
    ctx, capability, kernel, invoke, overview, cwdFor, projectOf, agentFor, call, useCredentials, modelCalls,
    dispose: async () => { await kernel.dispose(); await ctx.fiber.dispose() },
  }
}

test('P05 本地来源：source 省略时仍走本地证据，且不发出知识库请求', async () => {
  const server = await httpFixture()
  const h = await harness({ profile: 'host-local' })
  let handle
  try {
    const dir = await h.cwdFor('project-A')
    handle = await h.agentFor(dir)
    const project = await h.projectOf(dir)
    const saved = await h.invoke({ action: 'save', scope: project.id, title: '数据库操作', content: '数据库操作放在 SQLite Worker 中。' })
    assert.equal(saved.revision, 1)
    // source 省略 → 默认 local；本地路径不依赖任何 WeKnora 配置。
    const result = await h.call('call-local-1', { action: 'search', query: 'SQLite' }, handle)
    assert.equal(result.isError, false, `本地证据调用不得失败：${JSON.stringify(result.error)}`)
    assert.match(result.value.text, /<memory-evidence>/)
    assert(result.value.evidence.items.some(item => item.id === saved.id), '本地证据必须包含刚保存的条目')
    assert.equal(result.meta.memoryEvidence.items[0].id, saved.id)
    assert.equal(server.requests.length, 0, '本地来源不得发出任何知识库 HTTP 请求')
  } finally { await handle?.dispose(); await h.dispose(); await server.close() }
})

test('P05 知识来源未开启：knowledgeRead=false 时给出明确未开启文本，且连接与绑定齐备也不发 HTTP', async () => {
  const server = await httpFixture()
  const h = await harness({ profile: 'host-read-off', knowledgeRead: false })
  let handle
  try {
    const dir = await h.cwdFor('project-A')
    handle = await h.agentFor(dir)
    const project = await h.projectOf(dir)
    h.useCredentials('test-key')
    // 连接与绑定都真实存在：短路的只能是 knowledgeRead 总开关。
    await h.invoke({ action: 'connection', connection: { connectionId: 'team', baseUrl: server.baseUrl, readCredentialRef: 'DSH_MEMORY_READ_KEY' } })
    await h.invoke({ action: 'knowToggle', connection: { connectionId: 'team' }, use: true })
    await h.invoke({ action: 'knowSave', scope: project.id, binding: { connectionId: 'team', readKbIds: ['kb-docs'] } })
    assert.deepEqual((await h.invoke({ action: 'binding', scope: project.id })).readKbIds, ['kb-docs'])
    const result = await h.call('call-off-1', { action: 'search', source: 'knowledge', query: '数据库' }, handle)
    assert.equal(result.isError, false, `未开启时必须正常返回而不是工具错误：${JSON.stringify(result.error)}`)
    assert.match(result.value.text, /知识检索未开启/)
    assert.equal(Object.hasOwn(result.value, 'knowledgeEvidence'), false, '未开启时不得给出证据槽位')
    assert.equal(server.requests.length, 0, '未开启读取时不得发出任何 HTTP 请求')
  } finally { await handle?.dispose(); await h.dispose(); await server.close() }
})

test('P06 知识检索端到端：夹具收到 hybrid-search、证据带封装、同会话再次调用先退役旧槽位', async () => {
  const server = await httpFixture()
  const h = await harness({ profile: 'host-knowledge', knowledgeRead: true })
  let handle, store
  try {
    const dir = await h.cwdFor('project-A')
    handle = await h.agentFor(dir)
    const project = await h.projectOf(dir)
    h.useCredentials('test-key')
    const connection = await h.invoke({ action: 'connection', connection: { connectionId: 'team', baseUrl: server.baseUrl, readCredentialRef: 'DSH_MEMORY_READ_KEY', publishCredentialRef: 'DSH_MEMORY_PUBLISH_KEY' } })
    assert.equal(connection.readEnabled, false, '连接读取默认关闭')
    await h.invoke({ action: 'knowToggle', connection: { connectionId: 'team' }, use: true })
    await h.invoke({ action: 'knowSave', scope: project.id, binding: { connectionId: 'team', readKbIds: ['kb-docs'] } })

    const first = await h.call('call-k-1', { action: 'search', source: 'knowledge', query: '数据库' }, handle)
    assert.equal(first.isError, false, `知识检索不得失败：${JSON.stringify(first.error)}`)
    assert.match(first.value.text, /<knowledge-evidence>/)
    assert.match(first.value.text, /数据库操作放在 repositories 目录/)
    assert.match(first.value.text, /不是已完成事实/, '证据必须声明来源与优先级')
    const firstSlot = first.value.knowledgeEvidence?.slotId
    assert(firstSlot, '成功检索必须提交活动槽位')
    assert.equal(first.meta.knowledgeEvidence.slotId, firstSlot, '呈现元数据必须与返回值一致')

    const search = server.requests.filter(request => request.method === 'POST' && request.url.endsWith('/hybrid-search'))
    assert.equal(search.length, 1, '每个绑定库每次调用只发一次有界召回')
    assert.equal(search[0].url, '/api/v1/knowledge-bases/kb-docs/hybrid-search')
    assert.equal(search[0].body.query_text, '数据库')
    assert.equal(search[0].body.match_count, 6, 'Config 默认 matchCount')
    assert.equal(search[0].body.skip_context_enrichment, true)

    // 同一会话再次调用：新结果提交前旧正文必须先退役，同时只有一份活动结果。
    const second = await h.call('call-k-2', { action: 'search', source: 'knowledge', query: '数据库' }, handle)
    assert.equal(second.isError, false)
    const secondSlot = second.value.knowledgeEvidence?.slotId
    assert(secondSlot && secondSlot !== firstSlot, '再次检索必须提交新槽位')
    store = await openStore('host-knowledge')
    assert.equal((await store.call('slot', { slotId: firstSlot })).state, 'retired', '旧槽位必须先退役')
    assert.equal((await store.call('activeSlot', { session: handle.agent.id })).slotId, secondSlot, '同时只有一份活动结果')
    assert.equal(server.requests.filter(request => request.method === 'POST').length, 2)
  } finally { await store?.close(); await handle?.dispose(); await h.dispose(); await server.close() }
})

test('P06 未绑定项目：返回“该项目未配置知识库”，且不发出 HTTP 请求', async () => {
  const server = await httpFixture()
  const h = await harness({ profile: 'host-unbound', knowledgeRead: true })
  let boundHandle, unboundHandle
  try {
    h.useCredentials('test-key')
    await h.invoke({ action: 'connection', connection: { connectionId: 'team', baseUrl: server.baseUrl, readCredentialRef: 'DSH_MEMORY_READ_KEY' } })
    await h.invoke({ action: 'knowToggle', connection: { connectionId: 'team' }, use: true })
    const boundDir = await h.cwdFor('project-A')
    boundHandle = await h.agentFor(boundDir)
    const bound = await h.projectOf(boundDir)
    await h.invoke({ action: 'knowSave', scope: bound.id, binding: { connectionId: 'team', readKbIds: ['kb-docs'] } })
    // 正向对照：夹具在本组合下确实可达，后面的 0 请求才有意义。
    const positive = await h.call('call-bound-1', { action: 'search', source: 'knowledge', query: '数据库' }, boundHandle)
    assert.equal(positive.isError, false)
    const afterPositive = server.requests.length
    assert(afterPositive > 0, '已绑定项目必须真的发出请求')

    const unboundDir = await h.cwdFor('project-B')
    unboundHandle = await h.agentFor(unboundDir)
    const unbound = await h.projectOf(unboundDir)
    assert.notEqual(unbound.id, bound.id)
    assert.equal(await h.invoke({ action: 'binding', scope: unbound.id }), null, '未绑定项目没有绑定记录')
    const result = await h.call('call-unbound-1', { action: 'search', source: 'knowledge', query: '数据库' }, unboundHandle)
    assert.equal(result.isError, false, `未绑定必须降级返回而不是工具错误：${JSON.stringify(result.error)}`)
    assert.match(result.value.text, /该项目未配置知识库/)
    assert.match(result.value.text, /NO_BINDING/, '降级必须给出可诊断代码')
    assert.equal(server.requests.length, afterPositive, '未绑定项目不得发出任何远端请求')
  } finally { await unboundHandle?.dispose(); await boundHandle?.dispose(); await h.dispose(); await server.close() }
})

test('P08 管理操作：连接保存、读取与发布开关独立、绑定查询、发布列表与只读拒绝', async () => {
  const h = await harness({ profile: 'host-manage' })
  let handle
  try {
    assert.deepEqual(await h.invoke({ action: 'connections' }), [], '初始没有任何连接')
    const view = await h.invoke({ action: 'connection', connection: { connectionId: 'team', baseUrl: 'http://127.0.0.1:9/api/v1', readCredentialRef: 'DSH_MEMORY_READ_KEY', publishCredentialRef: 'DSH_MEMORY_PUBLISH_KEY' } })
    assert.equal(view.connectionId, 'team')
    assert.equal(view.readEnabled, false, '新连接默认关闭读取')
    assert.equal(view.publishEnabled, false, '新连接默认关闭发布')
    const list = await h.invoke({ action: 'connections' })
    assert.equal(list.length, 1, '保存后必须能从连接列表看到')
    assert.equal(list[0].connectionId, 'team')

    // 读取与发布互相独立：任一开关的变化都不得带走另一个。
    const readOn = await h.invoke({ action: 'knowToggle', connection: { connectionId: 'team' }, use: true, generate: false })
    assert.equal(readOn.readEnabled, true)
    assert.equal(readOn.publishEnabled, false)
    const publishOn = await h.invoke({ action: 'knowToggle', connection: { connectionId: 'team' }, use: false, generate: true })
    assert.equal(publishOn.readEnabled, false, '关闭读取不得影响发布开关')
    assert.equal(publishOn.publishEnabled, true)
    const readBack = await h.invoke({ action: 'knowToggle', connection: { connectionId: 'team' }, use: true })
    assert.equal(readBack.readEnabled, true)
    assert.equal(readBack.publishEnabled, true, '省略 generate 时不得改动发布开关')

    const dir = await h.cwdFor('project-A')
    handle = await h.agentFor(dir)
    const project = await h.projectOf(dir)
    assert.equal(await h.invoke({ action: 'binding', scope: project.id }), null, '未绑定时返回 null')
    const binding = await h.invoke({ action: 'knowSave', scope: project.id, binding: { connectionId: 'team', readKbIds: ['kb-docs'], publishKbId: 'kb-docs' } })
    assert.equal(binding.connectionId, 'team')
    assert.deepEqual(binding.readKbIds, ['kb-docs'])
    assert.equal(binding.bindingRevision, 1)
    assert.deepEqual((await h.invoke({ action: 'binding', scope: project.id })).readKbIds, ['kb-docs'])

    const publications = await h.invoke({ action: 'publications' })
    assert(Array.isArray(publications.publications), '发布记录必须是数组')
    assert(Array.isArray(publications.outbox), '发布队列必须是数组')
    assert(Array.isArray(publications.tombstones), '撤回墓碑必须是数组')
    assert.equal(publications.publications.length, 0)

    // 只读连接：读操作仍可查看，写操作一律拒绝。
    h.capability.host = 'remote-fixture'
    assert.equal((await h.overview()).writable, false)
    assert.equal((await h.invoke({ action: 'connections' })).length, 1, '只读下仍可查看连接')
    assert.equal((await h.invoke({ action: 'publications' })).publications.length, 0)
    await assert.rejects(h.invoke({ action: 'connection', connection: { connectionId: 'team', baseUrl: 'http://127.0.0.1:9/api/v1' } }), /READ_ONLY_CONNECTION/)
    await assert.rejects(h.invoke({ action: 'knowToggle', connection: { connectionId: 'team' }, use: false }), /READ_ONLY_CONNECTION/)
    await assert.rejects(h.invoke({ action: 'syncNow' }), /READ_ONLY_CONNECTION/)
    await assert.rejects(h.invoke({ action: 'publishConfirm', previewId: 'missing' }), /READ_ONLY_CONNECTION/)
  } finally { await handle?.dispose(); await h.dispose() }
})

test('P09 凭据：连接只保存引用名，密钥仅在 Host 解析后进入请求头，页面与存储都不含正文', async () => {
  const server = await httpFixture()
  const h = await harness({ profile: 'host-credential', knowledgeRead: true })
  let handle
  const secret = 'sk-FIXTURE-SECRET-0123456789'
  const resolved = []
  try {
    h.useCredentials(secret, resolved)
    const view = await h.invoke({ action: 'connection', connection: { connectionId: 'team', baseUrl: server.baseUrl, tenantId: 'tenant-1', readCredentialRef: 'DSH_MEMORY_READ_KEY', publishCredentialRef: 'DSH_MEMORY_PUBLISH_KEY' } })
    assert.equal(view.readCredentialRef, 'DSH_MEMORY_READ_KEY')
    assert.equal(view.publishCredentialRef, 'DSH_MEMORY_PUBLISH_KEY')
    assert.equal(view.tenantId, 'tenant-1')
    // ConnectionView 只包含引用名与开关，不存在任何密钥正文或值字段。
    assert.deepEqual(Object.keys(view).sort(), [
      'apiProfile', 'baseUrl', 'configRevision', 'connectionId', 'createdAt', 'maxKnowledgeBases',
      'maxKnowledgeCallsPerTurn', 'publishCredentialRef', 'publishEnabled', 'publishMode',
      'readCredentialRef', 'readEnabled', 'remoteEvidenceBytes', 'requestDeadlineMs',
      'retiredReferenceBytes', 'tenantId', 'updatedAt', 'useCrossSessionRemoteCache',
    ].sort())
    assert.equal(JSON.stringify(view).includes(secret), false, '连接视图不得包含密钥正文')
    assert.equal(JSON.stringify(await h.invoke({ action: 'connections' })).includes(secret), false, '连接列表不得包含密钥正文')

    const dir = await h.cwdFor('project-A')
    handle = await h.agentFor(dir)
    const project = await h.projectOf(dir)
    await h.invoke({ action: 'knowToggle', connection: { connectionId: 'team' }, use: true })
    await h.invoke({ action: 'knowSave', scope: project.id, binding: { connectionId: 'team', readKbIds: ['kb-docs'] } })
    const result = await h.call('call-cred-1', { action: 'search', source: 'knowledge', query: '数据库' }, handle)
    assert.equal(result.isError, false, `凭据解析后检索必须成功：${JSON.stringify(result.error)}`)

    // 密钥在 Host 内按引用名解析，只出现在请求头里。
    assert.deepEqual(resolved, ['DSH_MEMORY_READ_KEY'], '只解析读取引用的名字，不解析正文')
    const request = server.requests.find(item => item.url.endsWith('/hybrid-search'))
    assert(request, '夹具必须收到 hybrid-search')
    assert.equal(request.headers['x-api-key'], secret, '请求头必须是解析后的密钥')
    assert.equal(request.headers['x-tenant-id'], 'tenant-1')

    // 页面（管理视图）与存储都没有密钥正文。
    assert.equal(JSON.stringify(await h.overview()).includes(secret), false, '概览不得包含密钥正文')
    assert.equal((await storeBytes('host-credential')).includes(secret), false, 'SQLite 与 WAL 不得写入密钥正文')
  } finally { await handle?.dispose(); await h.dispose(); await server.close() }
})

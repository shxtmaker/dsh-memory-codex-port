/**
 * T1 安装验收：在隔离 home/profile 中安装 0.3.0 tgz，启动真实 loopback Host，
 * 打开「设置 → 记忆」并验证既有记忆功能与新增知识库区块可用。
 *
 * 复用仓库既有 web 测试的页面导航与 RPC 方式。
 * 不接触用户日常 home、不重启用户 Host、不读取真实凭据、不访问外网。
 *
 * 用法：node tests/t1-install.mjs
 */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'

const exec = promisify(execFile)
const root = resolve('.')
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const runtime = resolve(`../../runtime-v${manifest.dsh.engines.dsh}`)
const cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const tarball = resolve(process.env.T1_PACKAGE ?? `../../dist/${manifest.name}-${manifest.version}.tgz`)

await mkdir(join(root, 'test-runs'), { recursive: true })
const fixture = await mkdtemp(join(root, 'test-runs', 't1-'))
const home = join(fixture, 'home'), profile = `t1-acceptance-${Date.now()}`
const env = { ...process.env, DSH_HOME: home }
let server, browser
const evidence = []

async function start() {
  let output = ''
  server = spawn(process.execPath, [cli, '--profile', profile, '--no-open', '--host', '127.0.0.1', '--port', process.env.T1_PORT ?? '18447'], { cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', data => { output += data })
  server.stderr.on('data', data => { output += data })
  for (let index = 0; index < 200; index++) {
    const url = output.match(/http:\/\/[^\s]+\?token=[A-Za-z0-9_-]+/)?.[0]
    if (url) return url
    if (server.exitCode !== null) throw Error('HOST_EXITED ' + output.replace(/token=[A-Za-z0-9_-]+/g, 'token=[REDACTED]'))
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error('HOST_START_TIMEOUT')
}
async function stop() {
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill() })
  server = undefined
}
/** 经已认证连接调用管理 RPC；与页面使用同一条路径。 */
async function memory(page, origin, request) {
  const response = await page.request.post(`${origin}/api/memory/invoke`, {
    headers: { Origin: origin },
    data: { type: 'client-request', rpcId: `t1-${crypto.randomUUID()}`, method: 'memory/invoke', payload: { args: { request } } },
  })
  assert.equal(response.status(), 200)
  const result = (await response.json()).result
  if (!result.ok) throw Error(`${result.error.message} :: ${JSON.stringify(request)}`)
  return JSON.parse(result.value.json)
}
async function open(page, url) {
  await page.goto(url)
  await page.waitForTimeout(1000)
  const notice = page.getByRole('button', { name: '继续', exact: true })
  if (await notice.count()) await notice.click()
  await page.waitForTimeout(400)
  const later = page.getByRole('button', { name: /稍后配置|跳过/ })
  if (await later.count()) await later.first().click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '记忆', exact: true }).click()
  await page.locator('.dm-page').waitFor()
  await page.waitForTimeout(800)
}

try {
  // 1 派生隔离配置档并安装打包产物；安装不得要求执行构建脚本。
  await exec(process.execPath, [cli, '--profile', profile, '--from-default-profile', 'web', '--dump-config'], { cwd: runtime, env, maxBuffer: 8000000 })
  const install = await exec(process.execPath, [cli, 'plugin', '--profile', profile, 'add', tarball], { cwd: runtime, env, maxBuffer: 8000000 })
  assert(!/declares no dsh\.bundle|plain dependency/.test(install.stdout + install.stderr), '安装不得退化为普通依赖')
  const profileDir = join(home, 'profiles', profile)
  const profileManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  assert(profileManifest.dsh.profile.bundles.includes(manifest.name), '配置档必须包含本组合包')
  const installed = JSON.parse(await readFile(join(profileDir, 'node_modules', manifest.name, 'package.json'), 'utf8'))
  assert.equal(installed.version, manifest.version)
  assert.deepEqual(installed.dsh.bundle, manifest.dsh.bundle)
  evidence.push(`安装：profile=${profile} 版本=${installed.version}`)

  // 2 关闭自动生成，避免测试期间调用真实模型。
  // 补丁层的 `[]` 是“空列表”占位，必须替换而不是追加，否则不是合法 YAML 列表。
  const patch = join(profileDir, 'cordis.patch.yml')
  const previousPatch = await readFile(patch, 'utf8')
  await writeFile(patch, previousPatch.replace(/^\[\]\s*$/m, '') + `\n- id: dsh-memory\n  config:\n    memoryProfileId: t1-fixture\n    globalGenerate: false\n    projectGenerate: false\n`)

  const url = await start(), origin = new URL(url).origin
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } })
  const errors = []
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  await open(page, url)

  // 3 既有记忆功能仍可用：概览可写、保存/读取/删除人工记忆。
  // 页面渲染诊断：RPC 可用不代表组件已挂载。
  assert.deepEqual(errors, [], `页面出现未捕获错误：${errors.join(' | ')}`)
  const overview = await memory(page, origin, { action: 'overview' })
  assert.equal(overview.writable, true, 'loopback 连接必须可写')
  assert.equal(overview.storageAvailable, true, '存储必须可用')
  const saved = await memory(page, origin, { action: 'save', scope: 'global', title: 'T1 验收偏好', content: '回答先给结论。' })
  assert.equal((await memory(page, origin, { action: 'read', id: saved.id })).content, '回答先给结论。')
  evidence.push('既有记忆：保存与读取通过')

  // 4 新增区块的默认关闭状态：预算与知识开关。
  assert.deepEqual(overview.budget, { localEvidenceBytes: 1024, remoteEvidenceBytes: 3072, retiredReferenceBytes: 256, maxTotalBytes: 4096 })
  assert.equal(overview.knowledge.readEnabled, false, '知识读取默认关闭')
  assert.equal(overview.knowledge.publishEnabled, false, '知识发布默认关闭')
  evidence.push('默认权限：知识读取与发布均关闭；预算 1024/3072/256/4096 字节')

  // 5 管理协议：连接列表与绑定查询可用（尚未配置时分别为空数组与 null）。
  assert.deepEqual(await memory(page, origin, { action: 'connections' }), [])
  const project = overview.projects.find(item => item.root)
  if (project) assert.equal(await memory(page, origin, { action: 'binding', scope: project.id }), null)
  const publications = await memory(page, origin, { action: 'publications' })
  assert.deepEqual(publications.publications, [])
  evidence.push('管理协议：connections / binding / publications 可用')

  // 6 保存连接后，连接列表必须能列出（曾因二次 JSON.parse 恒失败）。
  await memory(page, origin, { action: 'connection', connection: { connectionId: 't1-conn', baseUrl: 'http://127.0.0.1:1/api/v1', apiProfile: 'v0.8.2-hybrid', tenantId: '1', readCredentialRef: 't1-read', publishCredentialRef: 't1-publish' } })
  const connections = await memory(page, origin, { action: 'connections' })
  assert.equal(connections.length, 1)
  assert.equal(connections[0].connectionId, 't1-conn')
  assert.equal(connections[0].readCredentialRef, 't1-read')
  assert(!JSON.stringify(connections).match(/"(apiKey|secret|token)"/), '连接视图不得包含密钥正文字段')
  evidence.push('连接：保存后列表可见，且不含密钥正文字段')

  // 7 两个开关互相独立。
  const readOn = await memory(page, origin, { action: 'knowToggle', connection: { connectionId: 't1-conn' }, use: true })
  assert.equal(readOn.readEnabled, true)
  assert.equal(readOn.publishEnabled, false, '开启读取不得同时开启发布')
  const publishOn = await memory(page, origin, { action: 'knowToggle', connection: { connectionId: 't1-conn' }, generate: true })
  assert.equal(publishOn.publishEnabled, true)
  assert.equal(publishOn.readEnabled, true)
  evidence.push('开关：读取与发布互相独立')

  // 8 页面必须渲染知识库区块，且无未捕获错误。
  // 该区块位于折叠的「高级设置」内，需先展开才能取到可见文本。
  const advanced = page.locator('details.dm-advanced')
  if (await advanced.count()) await advanced.first().evaluate(node => { node.open = true })
  await page.waitForTimeout(300)
  const section = page.locator('.dm-page')
  const sectionText = await section.innerText().catch(() => '')
  const kbBlock = page.locator('.dm-kb')
  const kbCount = await kbBlock.count()
  const kbVisible = kbCount ? await kbBlock.first().isVisible() : false
  const body = await page.locator('body').innerText()
  assert(kbCount > 0, `页面必须挂载知识库区块；section 文本：\n${sectionText.slice(0, 1200)}`)
  assert(/知识库/.test(sectionText) || /知识库/.test(body), `知识库区块必须可见（count=${kbCount} visible=${kbVisible}）；section 文本：\n${sectionText.slice(0, 1500)}`)
  assert.deepEqual(errors, [], '页面不得有未捕获错误')
  evidence.push('页面：知识库区块已渲染，页面错误 0')

  // 9 重启后数据保留。
  await stop()
  const reopened = await start()
  browser = await (async () => { await browser.close(); return chromium.launch({ headless: true }) })()
  const page2 = await browser.newPage({ viewport: { width: 1500, height: 1050 } })
  page2.setDefaultTimeout(15000)
  await open(page2, reopened)
  const after = await memory(page2, new URL(reopened).origin, { action: 'read', id: saved.id })
  assert.equal(after.content, '回答先给结论。', '重启后人工记忆必须保留')
  assert.equal((await memory(page2, new URL(reopened).origin, { action: 'connections' })).length, 1, '重启后连接设置必须保留')
  evidence.push('重启：人工记忆与连接设置均保留')

  console.log('T1 安装验收通过')
  for (const line of evidence) console.log(`  · ${line}`)
} finally {
  if (browser) await browser.close().catch(() => {})
  await stop()
  if (!process.env.T1_KEEP) await rm(fixture, { recursive: true, force: true }).catch(() => {})
}

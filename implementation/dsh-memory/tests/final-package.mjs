/** 最终包与已验收候选逐文件核对，再复用隔离 profile 进行实际加载。 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const hash = data => createHash('sha256').update(data).digest('hex')
function unpack(bytes) {
  const tar = gunzipSync(bytes), files = new Map()
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const string = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/s, '')
    const name = string(0, 100), prefix = string(345, 155), size = parseInt(string(124, 12).trim(), 8) || 0
    const path = prefix ? prefix + '/' + name : name
    if (header[156] === 0 || header[156] === 48) files.set(path, tar.subarray(offset + 512, offset + 512 + size))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const exec = promisify(execFile), root = resolve('.'), runtime = resolve('../../runtime-v'+manifest.dsh.engines.dsh)
const cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const fixture = JSON.parse(await readFile('evidence/package-lifecycle.json', 'utf8'))
assert.equal(fixture.status, 'PASS')
const { home, profile } = fixture, env = { ...process.env, DSH_HOME: home }
const packagePath = resolve(`artifacts/dsh-memory-local-${manifest.version}.tgz`)
const bytes = await readFile(packagePath), finalFiles = unpack(bytes), candidate = unpack(await readFile(fixture.package))
const built = [...finalFiles.keys()].filter(path => path.startsWith('package/lib/')).sort()
assert(built.length > 10)
assert.deepEqual(built, [...candidate.keys()].filter(path => path.startsWith('package/lib/')).sort())
for (const path of built) assert.equal(hash(finalFiles.get(path)), hash(candidate.get(path)), path)
assert.equal(JSON.parse(finalFiles.get('package/package.json').toString()).version, manifest.version)
const installation = await exec(process.execPath, [cli, 'plugin', '--profile', profile, 'add', packagePath], { cwd: runtime, env, maxBuffer: 8000000 })
await writeFile('evidence/final-package-install.log', installation.stdout + installation.stderr)
for (const [path, data] of finalFiles) {
  const installed = join(home, 'profiles', profile, 'node_modules', 'dsh-memory-local', path.replace(/^package\//, ''))
  assert.equal(hash(await readFile(installed)), hash(data), 'installed ' + path)
}
let output = '', server, browser
const errors = []
try {
  server = spawn(process.execPath, [cli, '--profile', profile, '--no-open', '--host', '127.0.0.1', '--port', '18438'], { cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', data => { output += data }); server.stderr.on('data', data => { output += data })
  let url
  for (let i = 0; i < 150; i++) {
    url = output.match(/http:\/\/[^\s]+\?token=[A-Za-z0-9_-]+/)?.[0]
    if (url) break
    if (server.exitCode !== null) throw Error('WEB_EXITED ' + output)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(url, 'WEB_START_TIMEOUT')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } })
  page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message))
  await page.goto(url); await page.waitForTimeout(1000)
  const notice = page.getByRole('button', { name: '继续', exact: true }); if (await notice.count()) await notice.click()
  await page.waitForTimeout(500)
  const later = page.getByRole('button', { name: /稍后配置|跳过/ }); if (await later.count()) await later.first().click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '记忆', exact: true }).click(); await page.locator('.dm-page').waitFor()
  const origin = new URL(url).origin
  const response = await page.request.post(origin + '/api/memory/invoke', { headers: { Origin: origin }, data: { type: 'client-request', rpcId: 'final-package-' + crypto.randomUUID(), method: 'memory/invoke', payload: { args: { request: { action: 'overview' } } } } })
  assert.equal(response.status(), 200)
  const rpc = (await response.json()).result; assert(rpc.ok)
  const overview = JSON.parse(rpc.value.json); assert(overview.writable)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: 'evidence/final-package-settings.png', fullPage: true })
  const result = { status: 'PASS', hostVersion: manifest.dsh.engines.dsh, environment: 'isolated loopback Web', package: packagePath, version: manifest.version, sha256: hash(bytes), fileCount: finalFiles.size, builtFilesIdenticalToAcceptedCandidate: built.length, allInstalledFilesMatchFinalPackage: true, actualSettingsPage: true, actualRemote200: true, home, profile, realModel: 'BLOCKED', desktop: 'BLOCKED', realRemote: 'BLOCKED' }
  await writeFile('evidence/final-package.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2))
  await writeFile('artifacts/SHA256SUMS.txt', hash(bytes) + `  dsh-memory-local-${manifest.version}.tgz\n`)
} finally {
  await browser?.close()
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill() })
  await writeFile('evidence/final-package-host.log', output.replace(/token=[A-Za-z0-9_-]+/g, 'token=[REDACTED]'))
}

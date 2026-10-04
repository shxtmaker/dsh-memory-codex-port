/** 隔离 Git 仓库安装后启动真实 Host，验证组合包及记忆页面；不使用用户配置。 */
import assert from 'node:assert/strict'
import {execFile, spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
import {cp, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {chromium} from '@playwright/test'

const exec = promisify(execFile), plugin = resolve('.'), repository = resolve('../..')
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const runtime = join(repository, 'runtime-v' + manifest.dsh.engines.dsh)
const cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
await mkdir(join(repository, '.publication-local'), {recursive: true})
const fixture = await mkdtemp(join(repository, '.publication-local/git-package-'))
const git = join(fixture, 'repository'), home = join(fixture, 'home'), profile = 'git-install'
await mkdir(git)
for (const file of ['.gitattributes', 'package.json', 'cordis.patch.yml', 'lib', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  await cp(join(repository, file), join(git, file), {recursive: true})
}
await exec('git', ['init', '--quiet'], {cwd: git})
await exec('git', ['add', '.'], {cwd: git})
await exec('git', ['-c', 'user.name=Installation Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Git installation fixture'], {cwd: git})
const revision = (await exec('git', ['rev-parse', 'HEAD'], {cwd: git})).stdout.trim()
const spec = process.env.MEMORY_INSTALL_SPEC ?? 'git+' + pathToFileURL(git).href + '#' + revision
const env = {...process.env, DSH_HOME: home}
await exec(process.execPath, [cli, '--profile', profile, '--from-default-profile', 'web', '--dump-config'], {cwd: runtime, env, maxBuffer: 8000000})
const installation = await exec(process.execPath, [cli, 'plugin', '--profile', profile, 'add', spec], {cwd: runtime, env, maxBuffer: 8000000})
assert(!/declares no dsh\.bundle|plain dependency/.test(installation.stdout + installation.stderr))
const installedProfile = JSON.parse(await readFile(join(home, 'profiles', profile, 'package.json'), 'utf8'))
assert(installedProfile.dsh.profile.bundles.includes(manifest.name))
const installed = JSON.parse(await readFile(join(home, 'profiles', profile, 'node_modules', manifest.name, 'package.json'), 'utf8'))
assert.equal(installed.version, manifest.version)
assert.deepEqual(installed.dsh.bundle, manifest.dsh.bundle)
const installedDirectory = join(home, 'profiles', profile, 'node_modules', manifest.name)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
for (const file of ['lib/index.js', 'lib/client.js', 'lib/storage-worker.js', 'lib/typert.host.js', 'lib/typert.remote-client.js', 'README.md', 'cordis.patch.yml']) {
  assert.equal(hash(await readFile(join(installedDirectory, file))), hash(await readFile(join(repository, file))), 'installed ' + file)
}
let server, browser, output = ''
const errors = []
try {
  server = spawn(process.execPath, [cli, '--profile', profile, '--no-open', '--host', '127.0.0.1', '--port', '18446'], {cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
  server.stdout.on('data', data => {output += data}); server.stderr.on('data', data => {output += data})
  let url
  for (let i = 0; i < 200; i++) {
    url = output.match(/http:\/\/[^\s]+\?token=[A-Za-z0-9_-]+/)?.[0]
    if (url) break
    if (server.exitCode !== null) throw Error('HOST_EXITED ' + output.replace(/token=[A-Za-z0-9_-]+/g, 'token=[REDACTED]'))
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(url, 'HOST_START_TIMEOUT')
  browser = await chromium.launch({headless: true})
  const page = await browser.newPage({viewport: {width: 1500, height: 1050}})
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.waitForTimeout(1000)
  const notice = page.getByRole('button', {name: '继续', exact: true}); if (await notice.count()) await notice.click()
  await page.waitForTimeout(500)
  const later = page.getByRole('button', {name: /稍后配置|跳过/}); if (await later.count()) await later.first().click()
  await page.getByRole('button', {name: '设置', exact: true}).click()
  await page.getByRole('button', {name: '记忆', exact: true}).click()
  await page.locator('.dm-page').waitFor()
  const origin = new URL(url).origin
  const response = await page.request.post(origin + '/api/memory/invoke', {
    headers: {Origin: origin},
    data: {type: 'client-request', rpcId: 'git-install-' + crypto.randomUUID(), method: 'memory/invoke', payload: {args: {request: {action: 'overview'}}}},
  })
  assert.equal(response.status(), 200)
  const rpc = (await response.json()).result
  assert(rpc.ok)
  const overview = JSON.parse(rpc.value.json)
  assert(overview.writable)
  assert.equal(typeof overview.dailyUsage.tokens, 'number')
  assert.deepEqual(errors, [])
  await page.screenshot({path: join(plugin, 'evidence/git-package-settings.png'), fullPage: true})
  const result = {status: 'PASS', version: manifest.version, hostVersion: manifest.dsh.engines.dsh, environment: 'isolated installation and loopback Web Host', source: spec, home, revision, bundleSelected: true, installedRuntimeAndReadmeMatch: true, actualSettingsPage: true, actualRemote200: true, publicGitRepository: spec.startsWith('https://github.com/') ? 'PASS' : 'NOT_RUN', installedDesktop: 'NOT_RUN', automaticUpgrade: 'NOT_IMPLEMENTED'}
  await writeFile(join(plugin, process.env.MEMORY_INSTALL_EVIDENCE ?? 'evidence/git-package.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser?.close()
  if (server && server.exitCode === null) await new Promise(resolve => {server.once('exit', resolve); server.kill()})
  await writeFile(join(plugin, 'evidence/git-package-host.log'), output.replace(/token=[A-Za-z0-9_-]+/g, 'token=[REDACTED]'))
}

/**
 * P12 发布打包与一致性核对。
 *
 * 步骤：
 *   1  子包构建（生成 Host、SQLite Worker、client bundle 与严格 Typert Remote，
 *      并同步到仓库根 lib/，因为 Git 安装以根清单 + 根 lib/ 为入口）。
 *   2  核对根清单与子包清单的版本、包名、dsh.bundle、client inject 完全一致。
 *   3  核对 cordis.patch.yml 的插件名与包名一致，且根/子包补丁字节相同。
 *   4  在 dist/ 产出 tgz 与源码 zip，并生成 SHA256SUMS。
 *   5  逐文件核对 tgz 内容与仓库根 lib/ 及清单文件字节一致。
 *
 * 用法：node scripts/release.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const plugin = join(root, 'implementation/dsh-memory')
const dist = join(root, 'dist')
const sha256 = data => createHash('sha256').update(data).digest('hex')

/** 从 tgz 读取文件表；只用于核对，不落盘。 */
export function unpackTarball(bytes) {
  const tar = gunzipSync(bytes)
  const files = new Map()
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const text = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/s, '')
    const name = text(0, 100), prefix = text(345, 155), size = parseInt(text(124, 12).trim(), 8) || 0
    const path = prefix ? `${prefix}/${name}` : name
    if (header[156] === 0 || header[156] === 48) files.set(path, tar.subarray(offset + 512, offset + 512 + size))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const pluginManifest = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'))

// 1 构建（子包构建会把 lib/ 同步到仓库根）。
console.log('· 构建')
execFileSync(process.execPath, ['build/build.mjs'], { cwd: plugin, stdio: 'inherit' })

// 2 清单一致性：任何一项不一致都会让 Git 安装与 tgz 安装产生不同插件。
const failures = []
const expect = (label, actual, wanted) => { if (actual !== wanted) failures.push(`${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(wanted)}`) }
expect('根/子包 name', rootManifest.name, pluginManifest.name)
expect('根/子包 version', rootManifest.version, pluginManifest.version)
expect('根/子包 dsh.bundle', JSON.stringify(rootManifest.dsh?.bundle), JSON.stringify(pluginManifest.dsh?.bundle))
expect('根/子包 dsh.engines.dsh', rootManifest.dsh?.engines?.dsh, pluginManifest.dsh?.engines?.dsh)
expect('根/子包 client', JSON.stringify(rootManifest.dsh?.client), JSON.stringify(pluginManifest.dsh?.client))
const rootPatch = await readFile(join(root, 'cordis.patch.yml'))
const pluginPatch = await readFile(join(plugin, 'cordis.patch.yml'))
expect('根/子包 cordis.patch.yml', sha256(rootPatch), sha256(pluginPatch))
if (!rootPatch.toString().includes(`name: ${rootManifest.name}`)) failures.push('cordis.patch.yml 未插入本插件名')
if (failures.length) { console.error('清单一致性失败：\n  ' + failures.join('\n  ')); process.exit(1) }

// 3 关键入口必须存在且非空。
const required = ['lib/index.js', 'lib/client.js', 'lib/storage-worker.js', 'lib/worker-client.js', 'lib/contracts.js',
  'lib/typert.host.js', 'lib/typert.remote-client.js', 'lib/types/index.d.ts', 'cordis.patch.yml', 'package.json']
for (const file of required) {
  const path = join(root, file)
  if (!existsSync(path)) { console.error(`缺少发布入口：${file}`); process.exit(1) }
  if ((await readFile(path)).length === 0) { console.error(`发布入口为空：${file}`); process.exit(1) }
}

// 4 打包。
await mkdir(dist, { recursive: true })
for (const file of await readdir(dist)) if (/^dsh-memory-local-0\.3\.0\.tgz$|^dsh-memory-codex-port-0\.3\.0-source\.zip$/.test(file)) await rm(join(dist, file), { force: true })
console.log('· 打包 tgz')
execFileSync('npm', ['pack', '--pack-destination', dist, '--silent'], { cwd: root, stdio: 'inherit', env: { ...process.env, npm_config_cache: join(root, '.npm-cache') } })
const tarball = join(dist, `${rootManifest.name}-${rootManifest.version}.tgz`)
if (!existsSync(tarball)) { console.error('npm pack 未产出预期文件名'); process.exit(1) }

// 5 逐文件核对 tgz 与工作区字节一致。
const files = unpackTarball(await readFile(tarball))
for (const [path, data] of files) {
  const relative = path.replace(/^package\//, '')
  const local = join(root, relative)
  if (!existsSync(local)) { console.error(`tgz 含工作区不存在的文件：${relative}`); process.exit(1) }
  if (sha256(await readFile(local)) !== sha256(data)) { console.error(`tgz 与工作区不一致：${relative}`); process.exit(1) }
}
console.log(`· tgz 内 ${files.size} 个文件与工作区逐字节一致`)

// 6 校验清单。
const listings = [...files.keys()].sort().map(path => `${sha256(files.get(path))}  ${path}`).join('\n') + '\n'
await writeFile(join(dist, `SHA256SUMS-${rootManifest.version}.txt`), listings)
const tarballHash = sha256(await readFile(tarball))
await writeFile(join(dist, `SHA256SUMS.txt`), `${tarballHash}  ${rootManifest.name}-${rootManifest.version}.tgz\n`)
console.log(`· 安装包：dist/${rootManifest.name}-${rootManifest.version}.tgz`)
console.log(`· SHA256：${tarballHash}`)
console.log('发布打包完成')

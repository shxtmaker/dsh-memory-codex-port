/** 将最终包安装到已建立的隔离 Desktop profile，核对文档而非复用候选缓存。 */
import {desktopExecutable} from './desktop-runtime.mjs'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join,sep} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const fixture=JSON.parse(await readFile('evidence/desktop-context.json','utf8'))
assert(fixture.home.startsWith(resolve('test-runs')+sep))
const manifest=JSON.parse(await readFile('package.json','utf8')),packagePath=resolve(`artifacts/dsh-memory-local-${manifest.version}.tgz`)
const result=await promisify(execFile)(desktopExecutable(),[resolve('tests/desktop-plugin-cli.mjs'),'plugin','--profile','desktop','add',packagePath],{cwd:resolve('.'),env:{...process.env,DSH_HOME:fixture.home,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,maxBuffer:8000000})
await writeFile('evidence/final-desktop-install.log',result.stdout+result.stderr)
const hash=data=>createHash('sha256').update(data).digest('hex')
for(const path of ['README.md','IMPLEMENTATION_STATUS.md','ACCEPTANCE.md','lib/index.js','lib/client.js'])assert.equal(hash(await readFile(join(fixture.home,'profiles','desktop','node_modules','dsh-memory-local',path))),hash(await readFile(path)),path)
fixture.package=packagePath
await writeFile('evidence/desktop-context.json',JSON.stringify(fixture,null,2))
console.log('PASS final package installed by actual bundled runtime into isolated desktop profile')

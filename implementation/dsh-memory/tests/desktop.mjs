/** 真实已装 Desktop；仅写入独立 DSH_HOME 与 Electron user-data-dir。 */
import { desktopExecutable } from './desktop-runtime.mjs'
import { _electron } from '@playwright/test'
import { readFile,writeFile,mkdtemp,mkdir } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
const exec=promisify(execFile),root=resolve('.'),executable=desktopExecutable()
const manifest=JSON.parse(await readFile('package.json','utf8')),home=await mkdtemp(resolve('test-runs','desktop-')),userData=join(home,'electron-user-data'),env={...process.env,DSH_HOME:home,DSH_DESKTOP_DIAGNOSTIC_FILE:join(home,'startup-diagnostic.log')}
delete env.ELECTRON_RUN_AS_NODE
await mkdir(userData)
const profileRoot=join(home,'profiles','desktop'),documents=join(home,'documents')
await mkdir(profileRoot,{recursive:true});await mkdir(documents)
// 首次 Host 初始化前提供测试 Documents 目录，避免默认工作区落到日常路径。
await writeFile(join(profileRoot,'cordis.patch.yml'),`- id: workspace-controller\n  config:\n    documentsDirectory: '${documents}'\n`)
const logs=[],errors=[];let application
async function launch(){
  application=await _electron.launch({executablePath:executable,args:['--user-data-dir='+userData],env,timeout:30000})
  application.process().stdout?.on('data',data=>logs.push(data.toString()));application.process().stderr?.on('data',data=>logs.push(data.toString()))
  assert.equal((await application.evaluate(({app})=>app.getPath('userData'))).toLowerCase(),userData.toLowerCase())
  assert.equal(await application.evaluate(()=>process.env.DSH_HOME),home)
  return application
}
async function stop(){if(application){await application.close();application=undefined}}
async function cli(args){const result=await exec(executable,[join(root,'tests','desktop-plugin-cli.mjs'),'plugin','--profile','desktop',...args],{cwd:root,env:{...env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,maxBuffer:8000000});logs.push(result.stdout,result.stderr)}
try{
  await launch();const first=await application.firstWindow();await first.waitForTimeout(2500)
  await writeFile('evidence/desktop-bootstrap-body.txt',await first.locator('body').innerText());await first.screenshot({path:'evidence/desktop-bootstrap.png'})
  await stop()
  assert.equal(JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8')).name,'dsh-profile-desktop')
  const packagePath=resolve(process.env.MEMORY_TEST_PACKAGE??`artifacts/candidate/dsh-memory-local-${manifest.version}.tgz`)
  await cli(['add',packagePath])
  const patch=join(profileRoot,'cordis.patch.yml'),previous=await readFile(patch,'utf8')
  await writeFile(patch,previous.replace(/^\[\]\s*$/m,'')+`\n- id: dsh-memory\n  config:\n    memoryProfileId: desktop-fixture\n`)
  await launch();let page=await application.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForTimeout(2000)
  await writeFile('evidence/desktop-installed-body.txt',await page.locator('body').innerText());await page.screenshot({path:'evidence/desktop-installed.png'})
  console.log(JSON.stringify({status:'DESKTOP_STARTED',home,userData,windows:await Promise.all(application.windows().map(async window=>({url:window.url(),body:await window.locator('body').innerText()})))},null,2))
  await writeFile('evidence/desktop-context.json',JSON.stringify({home,userData,profile:'desktop',package:packagePath},null,2))
}finally{await stop();await writeFile('evidence/desktop-host.log',logs.join('\n').replace(/token=[A-Za-z0-9_-]+/g,'token=[REDACTED]'))}

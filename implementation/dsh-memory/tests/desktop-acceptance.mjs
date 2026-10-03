/** 已装 Desktop 的隔离安装和后台 Remote；不跳过登录欢迎页。 */
import {desktopExecutable} from './desktop-runtime.mjs'
import {_electron} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const fixture=JSON.parse(await readFile('evidence/desktop-context.json','utf8'))
const env={...process.env,DSH_HOME:fixture.home};delete env.ELECTRON_RUN_AS_NODE
let application
try{
  application=await _electron.launch({executablePath:desktopExecutable(),args:['--user-data-dir='+fixture.userData],env,timeout:30000})
  assert.equal(await application.evaluate(()=>process.env.DSH_HOME),fixture.home)
  assert.equal((await application.evaluate(({app})=>app.getPath('userData'))).toLowerCase(),fixture.userData.toLowerCase())
  await application.firstWindow();let page
  for(let i=0;i<100;i++){page=application.windows().find(window=>window.url()==='dsh-app://app/');if(page)break;await new Promise(resolve=>setTimeout(resolve,100))}
  assert(page);await page.waitForTimeout(2000)
  let response
  for(let i=0;i<40;i++){
    response=await page.evaluate(async()=>{const response=await fetch('/api/memory/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'desktop-acceptance',method:'memory/invoke',payload:{args:{request:{action:'overview'}}}})});return{status:response.status,body:await response.text()}})
    if(response.status!==503)break
    await page.waitForTimeout(250)
  }
  await writeFile('evidence/desktop-remote-response.json',JSON.stringify(response,null,2))
  assert.equal(response.status,200)
  const rpc=JSON.parse(response.body).result;assert(rpc.ok,JSON.stringify(rpc))
  const overview=JSON.parse(rpc.value.json);assert(overview.writable)
  assert(overview.projects.every(project=>project.root.startsWith(fixture.home.toLowerCase())), 'DEFAULT_WORKSPACE_MUST_STAY_IN_TEST_HOME')
  const nativeWindow=await application.browserWindow(page)
  let visible, welcome
  for(let i=0;i<30;i++){
    visible=await nativeWindow.evaluate(window=>window.isVisible())
    welcome=application.windows().find(window=>window.url().includes('/welcome.html'))
    if(visible||welcome)break
    await page.waitForTimeout(200)
  }
  await writeFile('evidence/desktop-window-state.json',JSON.stringify({visible,welcome:Boolean(welcome),buttons:await page.locator('button').evaluateAll(buttons=>buttons.map(button=>({text:button.innerText,label:button.getAttribute('aria-label'),title:button.title})))},null,2))
  const loginNeeded=Boolean(welcome)&&!visible
  const result={hostVersion:'0.2.0-rc.2',desktopVersion:'0.2.0-rc.2',environment:'installed executable and bundled runtime; isolated home/user-data-dir',home:fixture.home,userData:fixture.userData,package:fixture.package,actualBundledInstallation:'PASS',actualMemoryRemote200:'PASS',writable:overview.writable,sqliteRoot:overview.root,visibleWorkspace:loginNeeded||!visible?'BLOCKED':'NOT_RUN',reason:loginNeeded?'Isolated Desktop presents login/API Key welcome and keeps workspace hidden; no login credentials used and no welcome bypass attempted':!visible?'Workspace remains hidden; visible management interaction blocked':'Visible management interaction not executed',realModel:'BLOCKED'}
  await writeFile('evidence/desktop-acceptance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{await application?.close()}

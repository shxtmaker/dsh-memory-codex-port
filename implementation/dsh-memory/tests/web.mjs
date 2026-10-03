/** 实际本地包安装与 Web 管理操作；复用原生闭环生成的隔离数据。 */
import { execFile,spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import assert from 'node:assert/strict'
import { chromium,expect } from '@playwright/test'
const manifest=JSON.parse(await readFile('package.json','utf8'))
const exec=promisify(execFile),root=resolve('.'),runtime=resolve('../../runtime-v'+manifest.dsh.engines.dsh),cli=join(runtime,'node_modules/@deepseek-ai/dsh/lib/bin.js')
const fixture=JSON.parse(await readFile('evidence/native-host.json','utf8')),home=fixture.home,profile='web-fixture-'+Date.now(),env={...process.env,DSH_HOME:home},packagePath=resolve(process.env.MEMORY_TEST_PACKAGE??`artifacts/dsh-memory-local-${manifest.version}.tgz`),previousPackage=process.env.MEMORY_PREVIOUS_PACKAGE
const result=[],logs=[];let server,browser
async function command(args){const output=await exec(process.execPath,[cli,...args],{cwd:runtime,env,maxBuffer:8000000});logs.push(output.stdout,output.stderr);return output}
async function start(host,port){
  let output='';server=spawn(process.execPath,[cli,'--profile',profile,'--no-open','--host',host,'--port',String(port)],{cwd:runtime,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
  server.stdout.on('data',data=>{output+=data});server.stderr.on('data',data=>{output+=data})
  for(let i=0;i<150;i++){const url=output.match(/http:\/\/[^\s]+\?token=[A-Za-z0-9_-]+/)?.[0];if(url){logs.push(output.replace(/token=[A-Za-z0-9_-]+/g,'token=[REDACTED]'));return url.replace('0.0.0.0','127.0.0.1')}if(server.exitCode!==null)throw Error('WEB_EXITED '+output);await new Promise(r=>setTimeout(r,100))}throw Error('WEB_START_TIMEOUT')
}
async function stop(){if(!server)return;if(server.exitCode!==null){server=undefined;return}await new Promise(resolve=>{server.once('exit',resolve);server.kill();});server=undefined}
async function rpc(page,origin,method,request){const response=await page.request.post(`${origin}/api/${method}`,{headers:{Origin:origin},data:{type:'client-request',rpcId:'fixture-'+crypto.randomUUID(),method,payload:{args:{request}}}});assert.equal(response.status(),200);return (await response.json()).result}
async function memory(page,origin,request){const res=await rpc(page,origin,'memory/invoke',request);if(!res.ok)throw Error(res.error.message);return JSON.parse(res.value.json)}
async function open(page,url,withMemory=true){await page.goto(url);await page.waitForTimeout(1000);const notice=page.getByRole('button',{name:'继续',exact:true});if(await notice.count())await notice.click();await page.waitForTimeout(500);const later=page.getByRole('button',{name:/稍后配置|跳过/});if(await later.count())await later.first().click();await page.getByRole('button',{name:'设置',exact:true}).click();if(withMemory){await page.getByRole('button',{name:'记忆',exact:true}).click();await page.locator('.dm-page').waitFor()}}
try {
  await command(['--profile',profile,'--from-default-profile','web','--dump-config'])
  const installed=join(home,'profiles',profile,'node_modules','dsh-memory-local','package.json')
  if(previousPackage) await command(['plugin','--profile',profile,'add',resolve(previousPackage)])
  await command(['plugin','--profile',profile,'add',packagePath])
  assert.equal(JSON.parse(await readFile(installed,'utf8')).version,manifest.version)
  const patch=join(home,'profiles',profile,'cordis.patch.yml'),previous=await readFile(patch,'utf8'),documents=join(home,'documents');await mkdir(documents,{recursive:true})
  await writeFile(patch,previous.replace(/^\[\]\s*$/m,'')+`\n- id: dsh-memory\n  config:\n    memoryProfileId: native-fixture\n    provider: fixture\n    model: fixed\n- id: workspace-controller\n  config:\n    documentsDirectory: '${documents}'\n- id: session-persistence-jsonl\n  config:\n    root: '${join(home,'sessions')}'\n    compression: none\n`)
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
  let url=await start('127.0.0.1',18438),origin=new URL(url).origin;await open(page,url)
  const projectA=join(home,'project-A'),projectB=join(home,'project-B');await mkdir(projectB,{recursive:true})
  const a=await rpc(page,origin,'session/create',{cwd:projectA}),b=await rpc(page,origin,'session/create',{cwd:projectB});assert(a.ok&&b.ok,JSON.stringify({a,b}))
  await page.locator('.dm-page').getByRole('button',{name:'刷新',exact:true}).click();await page.waitForTimeout(200)
  let overview=await memory(page,origin,{action:'overview'});assert(overview.writable)
  const project=overview.projects.find(p=>p.root===projectA.toLowerCase()),other=overview.projects.find(p=>p.root===projectB.toLowerCase());assert(project&&other)
  const row=page.locator('.dm-row').filter({has:page.locator('strong',{hasText:'project-A'})});await row.getByRole('button',{name:'浏览',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'浏览'});await dialog.getByRole('button',{name:'SQLite Worker',exact:true}).click();await dialog.getByText('事件范围',{exact:false}).waitFor()
  await page.screenshot({path:'evidence/web-detail.png',fullPage:true})
  const item=(await memory(page,origin,{action:'list',scope:project.id}))[0]
  await dialog.locator('textarea').fill('保留草稿 SQLite Worker。')
  await memory(page,origin,{action:'save',scope:project.id,id:item.id,revision:item.revision,title:item.title,content:'并发更新 SQLite Worker。'})
  await dialog.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('alert').filter({hasText:'草稿已保留'}).first().waitFor();assert.equal(await dialog.locator('textarea').inputValue(),'保留草稿 SQLite Worker。')
  await dialog.getByRole('button',{name:'重新载入',exact:true}).click();await page.waitForTimeout(100);await dialog.locator('textarea').fill('最终人工更正 SQLite Worker。');await dialog.getByRole('button',{name:'保存',exact:true}).click();await page.waitForTimeout(200)
  assert.equal((await memory(page,origin,{action:'read',id:item.id})).content,'最终人工更正 SQLite Worker。')
  await dialog.getByRole('button',{name:'MEMORY.md',exact:true}).click();await dialog.locator('pre').filter({hasText:'最终人工更正'}).waitFor();await dialog.getByRole('button',{name:'导出 Markdown',exact:true}).click();await page.waitForTimeout(100)
  await dialog.getByRole('button',{name:'关闭',exact:true}).click()
  for(const name of ['全局记忆','项目记忆']){const toggle=page.getByRole('switch',{name,exact:true});await toggle.click();await expect(toggle).toBeChecked();await toggle.click();await expect(toggle).not.toBeChecked()}
  const globalRow=page.locator('.dm-card').filter({has:page.locator('.dm-row strong',{hasText:'全局记忆'})}).last();await globalRow.getByRole('button',{name:'浏览',exact:true}).click();await dialog.getByRole('button',{name:'新建记忆',exact:true}).click();await dialog.locator('main input').fill('页面新增');await dialog.locator('textarea').fill('页面内人工新增记忆。');await dialog.getByRole('button',{name:'保存',exact:true}).click();await page.waitForTimeout(150);assert((await memory(page,origin,{action:'list',scope:'global'})).some(i=>i.title==='页面新增'));await dialog.getByRole('button',{name:'关闭',exact:true}).click()
  await globalRow.getByRole('button',{name:'清空',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确认清空',exact:true}).click();await page.waitForTimeout(150);assert.equal((await memory(page,origin,{action:'list',scope:'global'})).length,0);assert.equal((await memory(page,origin,{action:'list',scope:project.id})).length,1)
  await page.screenshot({path:'evidence/web-settings.png',fullPage:true});assert.deepEqual(errors,[]);result.push({name:'A1/A3 actual loopback Web',status:'PASS',installedPackage:packagePath,sourceDetails:true,conflictPreservesDraft:true,manualSave:true,pageFileBrowser:true,export:true,doubleSwitch:true,clearScopeIsolation:true})
  await stop();try{url=await start('0.0.0.0',18439)}catch(error){
    if(!String(error).includes('intentionally not supported yet'))throw error
    result.push({name:'non-loopback actual Web',status:'BLOCKED',reason:'Harness CLI refuses non-loopback binding for safety; no override attempted'})
    url=''
  }
  if(url){origin=new URL(url).origin;await open(page,url)
  const selected=await rpc(page,origin,'session/create',{sessionId:a.value.sessionId,cwd:projectA});assert(selected.ok)
  overview=await memory(page,origin,{action:'overview',sessionId:a.value.sessionId});assert.equal(overview.writable,false);assert(overview.projects.some(p=>p.id===project.id));assert(!overview.projects.some(p=>p.id===other.id))
  assert.equal((await memory(page,origin,{action:'list',scope:project.id,sessionId:a.value.sessionId})).length,1)
  const denied=await rpc(page,origin,'memory/invoke',{action:'list',scope:other.id,sessionId:a.value.sessionId});assert.equal(denied.ok,false);assert.equal(denied.error.message,'SCOPE_DENIED')
  const deniedWrite=await rpc(page,origin,'memory/invoke',{action:'save',scope:'global',title:'拒绝',content:'拒绝'});assert.equal(deniedWrite.ok,false);assert.equal(deniedWrite.error.message,'READ_ONLY_CONNECTION')
  const forbidden=(await rpc(page,origin,'memory/invoke',{action:'read',id:item.id}));assert.equal(forbidden.ok,false)
  result.push({name:'A1/A2 non-loopback Host through local browser',status:'PASS',currentScopeReadable:true,otherScopeDenied:true,writesDenied:true,network:'local browser; WAN NOT_RUN'})}
  await stop()
  await command(['plugin','--profile',profile,'remove','dsh-memory-local'])
  const profilePatch=await readFile(patch,'utf8'),removedPatch=profilePatch.replace(/\n- id: dsh-memory\n(?: {2}.*\n)*/,'\n');await writeFile(patch,removedPatch)
  url=await start('127.0.0.1',18438);origin=new URL(url).origin;await open(page,url,false);assert.equal(await page.getByRole('button',{name:'记忆',exact:true}).count(),0);await stop()
  const dbBytes=await readFile(join(home,'memory','native-fixture','state.sqlite'));assert(dbBytes.length>0)
  await command(['plugin','--profile',profile,'add',packagePath]);await writeFile(patch,profilePatch)
  url=await start('127.0.0.1',18438);origin=new URL(url).origin;await open(page,url);assert.equal((await memory(page,origin,{action:'list',scope:project.id})).length,1);assert.equal((await memory(page,origin,{action:'list',scope:'global'})).length,0)
  assert.equal(await page.getByRole('button',{name:'记忆',exact:true}).count(),1)
  await writeFile('evidence/package-lifecycle.json',JSON.stringify({status:'PASS',home,profile,hostVersion:manifest.dsh.engines.dsh,package:packagePath,version:manifest.version,upgradedFrom:previousPackage??null,uninstallRemovesPage:true,retainsSQLite:true,reinstallReadsSameData:true},null,2))
  await writeFile('evidence/web-acceptance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{await browser?.close();await stop();await writeFile('evidence/web-host.log',logs.join('\n').replace(/token=[A-Za-z0-9_-]+/g,'token=[REDACTED]'))}

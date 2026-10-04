/** 实际本地包安装与 Web 管理操作；复用原生闭环生成的隔离数据。 */
import { execFile,spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { localUsageDay } from '../src/usage-statistics.ts'
import { DatabaseSync } from 'node:sqlite'
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
  await writeFile(patch,previous.replace(/^\[\]\s*$/m,'')+`\n- id: dsh-memory\n  config:\n    memoryProfileId: native-fixture\n    provider: fixture\n    model: fixed\n- id: llm-pi-ai\n  config:\n    providers:\n      fixture:\n        displayName: 页面测试供应商\n        api: openai-completions\n        baseURL: http://127.0.0.1:9/v1\n        models:\n          - id: fixed\n            name: 固定目录模型\n      other-fixture:\n        displayName: 第二供应商\n        api: openai-completions\n        baseURL: http://127.0.0.1:9/v1\n        models:\n          - id: other-fixed\n            name: 第二目录模型\n- id: workspace-controller\n  config:\n    documentsDirectory: '${documents}'\n- id: session-persistence-jsonl\n  config:\n    root: '${join(home,'sessions')}'\n    compression: none\n`)
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
  // 复用当前验收服务；仅在隔离home建立一个升级前已绑定的空配置档。
  await stop()
  const nativeDb=new DatabaseSync(join(home,'memory','native-fixture','state.sqlite'),{readOnly:true}),identity=nativeDb.prepare('SELECT owner,trust FROM memory_profiles').get();nativeDb.close()
  const legacyId='grant-legacy-'+Date.now(),legacyRoot=join(home,'memory',legacyId);await mkdir(legacyRoot)
  const legacyDb=new DatabaseSync(join(legacyRoot,'state.sqlite'))
  legacyDb.exec('CREATE TABLE memory_profiles(id TEXT PRIMARY KEY,owner TEXT NOT NULL,trust TEXT NOT NULL)')
  legacyDb.prepare('INSERT INTO memory_profiles VALUES(?,?,?)').run(legacyId,identity.owner,identity.trust);legacyDb.close()
  assert(profilePatch.includes('memoryProfileId: native-fixture'))
  await writeFile(patch,profilePatch.replace('memoryProfileId: native-fixture','memoryProfileId: '+legacyId+'\n    alarmTokens: 50'))
  url=await start('127.0.0.1',18438);origin=new URL(url).origin;await open(page,url)
  assert.equal((await memory(page,origin,{action:'overview'})).budget,undefined)
  await page.getByText('高级设置与后台状态',{exact:true}).click()
  assert.equal(await page.locator('.dm-icon').count(),0)
  assert.equal(await page.getByText('后台可用额度',{exact:false}).count(),0)
  assert.equal(await page.getByRole('button',{name:'补充至10000 tokens',exact:true}).count(),0)
  assert.equal(await page.getByRole('spinbutton',{name:'每日后台上限（tokens）',exact:true}).count(),0)
  const providerSelect=page.getByRole('combobox',{name:'供应商',exact:true}),modelSelect=page.getByRole('combobox',{name:'模型',exact:true})
  await expect(providerSelect).toHaveValue('fixture');await expect(modelSelect).toHaveValue('fixed')
  const providerRows=await memory(page,origin,{action:'providers'});assert(providerRows.some(p=>p.id==='fixture'))
  assert(!providerRows.some(p=>p.id==='unconfigured'))
  await providerSelect.selectOption('other-fixture');await expect(modelSelect.locator('option[value="other-fixed"]')).toHaveCount(1)
  await expect(modelSelect).toHaveValue('');await modelSelect.selectOption('other-fixed')
  await page.locator('.dm-route-line').getByRole('button',{name:'保存',exact:true}).click()
  await expect(providerSelect).toHaveValue('other-fixture');await expect(modelSelect).toHaveValue('other-fixed')
  await expect.poll(async()=>(await memory(page,origin,{action:'overview'})).route).toEqual({provider:'other-fixture',model:'other-fixed'})
  await expect(page.getByRole('spinbutton',{name:'单次后台用量报警阈值（tokens）',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'保存报警阈值',exact:true})).toHaveCount(0)
  await expect(page.locator('.dm-usage-stat')).toHaveText('每次提炼、整理和重试分别按供应商返回的总 tokens 计量。今日已使用0 token。')
  await stop()
  // 停止Host后在隔离数据库写入历史夹具；页面与Remote仍使用真实插件。
  const historyDb=new DatabaseSync(join(legacyRoot,'state.sqlite')),now=Date.now()
  for(const [id,kind,time] of [['old-extract','extract',now-2000],['new-extract','extract',now-1000],['new-consolidate','consolidate',now]]){
    const job={id,key:id,scope:'global',kind,source:'',epoch:0,fence:1,leaseUntil:0,attempts:1,retryAt:now+86400000,state:'succeeded',reserved:100,error:'',createdAt:time,updatedAt:time,attemptUsage:100}
    historyDb.prepare('INSERT INTO jobs VALUES(?,?,?,?)').run(id,id,'global',JSON.stringify(job))
  }
  for(const [session,time] of [['old-session',now-1000],['new-session',now]])historyDb.prepare('INSERT INTO budget_ledger(session,settled,updatedAt) VALUES(?,?,?)').run(session,10,time)
  const alert={id:'page-alarm',job:'new-extract',scope:'global',session:'new-session',kind:'extract',usage:101,threshold:50,time:now}
  historyDb.exec('CREATE TABLE IF NOT EXISTS usage_alerts(id TEXT PRIMARY KEY,data TEXT NOT NULL)')
  historyDb.prepare('INSERT INTO usage_alerts VALUES(?,?)').run(alert.id,JSON.stringify(alert))
  const usageInsert=historyDb.prepare('INSERT INTO usage_attempts VALUES(?,?,?,?,?)'),{start:usageDayStart}=localUsageDay()
  for(const [id,kind,usage,time] of [['extract-1','extract',300,now],['retry-1','extract',75,now],['consolidate-1','consolidate',25,now],['unknown-1','extract',null,now],['yesterday','extract',999,usageDayStart-1]])usageInsert.run(id,'global',kind,usage,time)
  historyDb.close()
  url=await start('127.0.0.1',18438);origin=new URL(url).origin;await open(page,url)
  await page.getByText('高级设置与后台状态',{exact:true}).click()
  await expect(page.locator('.dm-usage-stat')).toContainText('今日已使用400 token。')
  await expect(page.getByText('另有 1 次调用未返回用量，未计入合计。',{exact:true})).toHaveCount(1)
  await expect(page.getByText('单次后台用量超额报警',{exact:false})).toHaveCount(0)
  assert.equal((await memory(page,origin,{action:'overview'})).dailyUsage.tokens,400)
  const liveDb=new DatabaseSync(join(legacyRoot,'state.sqlite'));liveDb.prepare('INSERT INTO usage_attempts VALUES(?,?,?,?,?)').run('live-update','global','extract',17,Date.now());liveDb.close()
  await expect(page.locator('.dm-usage-stat')).toContainText('今日已使用417 token。',{timeout:15000})
await expect(providerSelect).toHaveValue('other-fixture');await expect(modelSelect).toHaveValue('other-fixed')
  await expect(page.locator('.dm-evidence small')).toHaveCount(1);await expect(page.locator('.dm-evidence')).toContainText('new-session')
  await expect(page.locator('.dm-jobs li')).toHaveCount(1);await expect(page.locator('.dm-jobs li')).toContainText('extract')
  await page.getByRole('button',{name:'展开会话计量历史',exact:true}).click();await expect(page.locator('.dm-evidence small')).toHaveCount(2)
  await page.getByRole('button',{name:'展开后台任务历史',exact:true}).click();await expect(page.locator('.dm-jobs li')).toHaveCount(3)
  await page.getByRole('button',{name:'收起历史',exact:true}).first().click();await page.getByRole('button',{name:'收起历史',exact:true}).click()
  await expect(page.locator('.dm-evidence small')).toHaveCount(1);await expect(page.locator('.dm-jobs li')).toHaveCount(1)
  const routeBox=await page.locator('.dm-route-line .dm-save-action').boundingBox();assert(routeBox);assert.equal(routeBox.height,36)
  const singleLine=await page.locator('.dm-setting-line').evaluateAll(rows=>rows.map(row=>{
    const bounds=row.getBoundingClientRect(),controls=[...row.querySelectorAll('label > span,select,input,button')].map(el=>{const b=el.getBoundingClientRect();return {center:b.y+b.height/2,left:b.left,right:b.right}});
    return {height:bounds.height,inline:controls.every(c=>Math.abs(c.center-(bounds.y+bounds.height/2))<1),contained:controls.every(c=>c.left>=bounds.left-1&&c.right<=bounds.right+1)}
  }));assert.equal(singleLine.length,1);for(const row of singleLine){assert.equal(row.height,36);assert(row.inline);assert(row.contained)}
  const alignedEdges=await page.locator('.dm-setting-line,.dm-row,.dm-fields').evaluateAll(rows=>rows.map(row=>{
    const elements=row.matches('.dm-setting-line')?[...row.querySelectorAll('select,input,button')]:[...row.querySelectorAll(':scope > button')];
    const boxes=elements.map(el=>{const b=el.getBoundingClientRect();return {top:b.top,bottom:b.bottom,height:b.height}});
    return boxes.length>1?{count:boxes.length,aligned:boxes.every(b=>Math.abs(b.top-boxes[0].top)<1&&Math.abs(b.bottom-boxes[0].bottom)<1),height:boxes[0].height}:null
  }).filter(Boolean));assert(alignedEdges.length>=3);for(const row of alignedEdges){assert(row.aligned);assert.equal(row.height,36)}
  const typography=await page.locator('.dm-page').evaluate(element=>({fontFamily:getComputedStyle(element).fontFamily,fontSize:getComputedStyle(element).fontSize,lineHeight:getComputedStyle(element).lineHeight})),navTypography=await page.getByRole('button',{name:'记忆',exact:true}).evaluate(element=>({fontFamily:getComputedStyle(element).fontFamily,fontSize:getComputedStyle(element).fontSize}))
  assert.equal(typography.fontSize,'14px');assert.equal(typography.lineHeight,'22px');assert.equal(typography.fontFamily,navTypography.fontFamily);assert.equal(typography.fontSize,navTypography.fontSize)
  await page.locator('.dm-route-line').scrollIntoViewIfNeeded();await page.screenshot({path:'evidence/web-settings-0.2.0.png',fullPage:true})
  assert.deepEqual(errors,[])
  result.push({name:'0.2.0 daily token usage replaces alarms',status:'PASS',hostCatalog:true,providerModelCascade:true,routeSaveAndRestart:true,alarmsRemoved:true,dailyUsage:417,dailyUnknownCalls:1,dailyRestartPersistence:true,dailyLiveUpdate:true,legacyAlarmIgnored:true,iconsRemoved:true,sameRowButtonsAligned:true,alignedEdges,singleLine,controlHeight:36,bodyTypography:'14px/22px',fontMatchesSettings:true,latestSessionDefault:true,latestExtractDefault:true,historyExpandable:true,creditAndDailyUiRemoved:true,fixture:'synthetic catalogs and historical usage; no real provider call'})
  await stop();await writeFile(patch,profilePatch)
  await writeFile('evidence/package-lifecycle.json',JSON.stringify({status:'PASS',home,profile,hostVersion:manifest.dsh.engines.dsh,package:packagePath,version:manifest.version,upgradedFrom:previousPackage??null,uninstallRemovesPage:true,retainsSQLite:true,reinstallReadsSameData:true},null,2))
  await writeFile('evidence/web-acceptance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{await browser?.close();await stop();await writeFile('evidence/web-host.log',logs.join('\n').replace(/token=[A-Za-z0-9_-]+/g,'token=[REDACTED]'))}

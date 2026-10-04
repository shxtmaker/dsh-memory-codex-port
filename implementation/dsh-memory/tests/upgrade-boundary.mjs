/** A1/A5：实际旧包运行中升级，验证restart-required和重启后的严格接口。 */
import assert from 'node:assert/strict'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {chromium} from '@playwright/test'

const exec=promisify(execFile),root=resolve('.'),runtime=resolve('../../runtime-v0.2.0-rc.2')
const cli=join(runtime,'node_modules/@deepseek-ai/dsh/lib/bin.js')
const previousPackage=resolve('../../dist/dsh-memory-local-0.1.6.tgz')
const nextPackage=resolve('../../dist/dsh-memory-local-0.1.7.tgz')
await mkdir('test-runs',{recursive:true})
const home=await mkdtemp(join(root,'test-runs','upgrade-boundary-')),profile='upgrade-fixture',env={...process.env,DSH_HOME:home}
const logs=[];let server,browser
async function command(args){const output=await exec(process.execPath,[cli,...args],{cwd:runtime,env,maxBuffer:8000000});logs.push(output.stdout,output.stderr)}
async function start(){
  let output=''
  server=spawn(process.execPath,[cli,'--profile',profile,'--no-open','--host','127.0.0.1','--port','18440'],{cwd:runtime,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
  server.stdout.on('data',data=>{output+=data});server.stderr.on('data',data=>{output+=data})
  for(let i=0;i<150;i++){
    const url=output.match(/http:\/\/[^\s]+\?token=[A-Za-z0-9_-]+/)?.[0]
    if(url){logs.push(output);return url}
    if(server.exitCode!==null)throw Error('WEB_EXITED '+output.replace(/token=[A-Za-z0-9_-]+/g,'token=[REDACTED]'))
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw Error('WEB_START_TIMEOUT')
}
async function stop(){if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill()});server=undefined}
async function open(page,url){
  await page.goto(url);await page.waitForTimeout(1000)
  const notice=page.getByRole('button',{name:'继续',exact:true});if(await notice.count())await notice.click()
  await page.waitForTimeout(500)
  const later=page.getByRole('button',{name:/稍后配置|跳过/});if(await later.count())await later.first().click()
}
async function rpc(page,url,method,args){
  const origin=new URL(url).origin
  const response=await page.request.post(origin+'/api/'+method,{headers:{Origin:origin},data:{type:'client-request',rpcId:'upgrade-'+randomUUID(),method,payload:{args}}})
  assert.equal(response.status(),200)
  return (await response.json()).result
}
try{
  await command(['--profile',profile,'--from-default-profile','web','--dump-config'])
  await command(['plugin','--profile',profile,'add',previousPackage])
  const patch=join(home,'profiles',profile,'cordis.patch.yml'),existing=await readFile(patch,'utf8'),documents=join(home,'documents')
  await mkdir(documents)
  await writeFile(patch,existing.replace(/^\[\]\s*$/m,'')+`\n- id: dsh-memory\n  config:\n    memoryProfileId: upgrade-fixture\n- id: workspace-controller\n  config:\n    documentsDirectory: '${documents}'\n`)
  browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(8000)
  let url=await start();await open(page,url)
  const before=await rpc(page,url,'memory/invoke',{request:{action:'overview'}});assert(before.ok)
  assert.equal(JSON.parse(before.value.json).budget.credit,0)
  const installation=await rpc(page,url,'pluginManager/installBundle',{spec:nextPackage,options:{enabled:true,requestId:randomUUID()}})
  assert(installation.ok,JSON.stringify(installation))
  assert.equal(installation.value.application,'restart-required',JSON.stringify(installation.value))
  const installed=JSON.parse(await readFile(join(home,'profiles',profile,'node_modules/dsh-memory-local/package.json'),'utf8'))
  assert.equal(installed.version,'0.1.7')
  const request={action:'topUpCredit',confirmation:'TOP_UP_CREDIT:10000',requestId:randomUUID()}
  const stale=await rpc(page,url,'memory/invoke',{request})
  assert.equal(stale.ok,false)
  assert.equal(stale.error.message,'typert gateway: memory/invoke: wire field "request" failed boundary validation')
  console.log('REPRODUCED '+stale.error.message)
  await stop();url=await start();await open(page,url)
  const after=await rpc(page,url,'memory/invoke',{request:{action:'overview'}});assert(after.ok)
  assert.equal(JSON.parse(after.value.json).budget.credit,0,'upgrade must not automatically grant credit')
  const granted=await rpc(page,url,'memory/invoke',{request});assert(granted.ok,JSON.stringify(granted))
  const overview=JSON.parse((await rpc(page,url,'memory/invoke',{request:{action:'overview'}})).value.json)
  assert.equal(overview.budget.credit,10000);assert.equal(overview.budget.manualGranted,10000)
  assert.equal(overview.budget.initialGranted,0);assert.equal(overview.budget.used,0)
  const result={status:'PASS',hostVersion:'0.2.0-rc.2',environment:'actual isolated loopback Web; no model calls',from:'0.1.6',to:'0.1.7',upgradeApplication:installation.value.application,beforeRestart:{diskVersion:'0.1.7',newActionRejected:true,error:stale.error.message},afterRestart:{newActionAccepted:true,manualCredit:10000,initialCredit:0,dailyUsed:0,existingLedgerPreserved:true},realDesktopRestart:'NOT_RUN',realModel:'NOT_RUN',home,profile}
  await writeFile('evidence/upgrade-boundary-0.1.7.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{await browser?.close();await stop();await writeFile('evidence/upgrade-boundary-0.1.7.log',logs.join('\n').replace(/token=[A-Za-z0-9_-]+/g,'token=[REDACTED]'))}

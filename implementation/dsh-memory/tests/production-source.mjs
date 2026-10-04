/** 原生插件上下文读取默认压缩日志；固定模型、隔离 home，不访问凭证。 */
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {Context} from '@deepseek-ai/cordis'
import LlmRuntime,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm'
import SessionStore,{SessionId} from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Commands from '@deepseek-ai/dsh-commands'
import Projections from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as plugin from '../lib/index.js'
import {proposalSchema} from '../src/shared.ts'
import {CONSOLIDATE_PROMPT} from '../lib/engine.js'
await mkdir('test-runs',{recursive:true})
const home=await mkdtemp(resolve('test-runs','production-source-'))
process.env.DSH_HOME=home
const cwd=join(home,'project-A');await mkdir(cwd)
const officialApiDefault=process.argv.includes('--official-api-default'),officialDefault=officialApiDefault||process.argv.includes('--official-default'),fixtureProvider=officialApiDefault?'deepseek-official':officialDefault?'deepseek-account':'fixture'
const reasoningRegression=process.argv.includes('--reasoning-regression')
const consolidationContract=process.argv.includes('--consolidation-contract')
const ctx=new Context(),calls=[],backgroundConfigs=[];let kernel,agent
class FixedAdapter extends LlmAdapter {
  async listModels(provider){return [{provider,id:'fixed',name:'Fixed model'}]}
  async resolveModel(provider,model){return reasoningRegression?{provider,id:model,name:model,reasoning:{efforts:[{id:'off',name:'Off'},{id:'high',name:'High'}],defaultEffort:'high'}}:super.resolveModel(provider,model)}
  async *stream(options){
    const prompt=options.messages.filter(m=>m.role==='user').flatMap(m=>typeof m.content==='string'?[m.content]:m.content.filter(b=>b.type==='text').map(b=>b.text)).join('\n')
    calls.push(prompt)
    const background=prompt.startsWith('只输出 JSON：')
    if(background){
      backgroundConfigs.push({reasoningEffort:options.reasoningEffort,maxTokens:options.maxTokens})
      if(reasoningRegression&&options.reasoningEffort!=='off'){
        yield {type:'reasoning-delta',index:0,text:'synthetic reasoning fixture'}
        yield {type:'usage',usage:{inputTokens:352,outputTokens:1024,totalTokens:1376}}
        yield {type:'finish',reason:{kind:'max-tokens'}}
        return
      }
    }else if(reasoningRegression)assert.equal(options.reasoningEffort,'high','foreground route defaults must stay unchanged')
    let text='已确认数据库操作放在 src/repositories。',usage=1000000
    if(prompt.startsWith('只输出 JSON：{"raw_memory"')){
      const events=JSON.parse(prompt.split('\n').at(-1)),seq=events.find(e=>e.role==='user').seq
      text=JSON.stringify({raw_memory:'项目数据库约定。',rollout_summary:'用户明确项目约定。',rollout_slug:'source-regression',items:[{scope:'project',kind:'decision',title:'数据库操作',content:'数据库操作放在 src/repositories。',status:'observed',source_refs:[seq]}]});usage=100
    }else if(prompt.startsWith('只输出 JSON：{"changes"')){
      const batch=JSON.parse(prompt.split('\n').at(-1))
      let template={op:'add'}
      if(consolidationContract){
        // 模拟模型按示例填写：旧协议不是合法JSON，新增时可能把未定义revision填成null。
        // 此为合成复现，不代表已获得用户真实响应中的字段值。
        try{template=JSON.parse(prompt.split('\n')[0].slice('只输出 JSON：'.length).replace(/。$/u,'')).changes[0]}
        catch{template={op:'add',revision:null}}
      }
      text=JSON.stringify({changes:batch.inputs.flatMap(i=>i.output.items.map(f=>({...template,op:'add',title:f.title,content:f.content,kind:f.kind,status:f.status,sources:[i.source]})))});usage=100
    }
    yield {type:'block-start',index:0,blockType:'text'}
    yield {type:'text-delta',index:0,text}
    yield {type:'block-end',index:0,block:{type:'text',text}}
    yield {type:'usage',usage:{inputTokens:usage-10,outputTokens:10,totalTokens:usage}}
    yield {type:'finish',reason:{kind:'stop'}}
  }
}
const overview=async()=>JSON.parse((await ctx.memory.invoke({action:'overview'},new AbortController().signal)).json)
async function wait(predicate){for(let i=0;i<150;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,20))}throw Error('PRODUCTION_SOURCE_TIMEOUT')}
function advanceFixtureJobs(){
  const db=new DatabaseSync(join(home,'memory','source-fixture','state.sqlite'))
  try{for(const row of db.prepare('SELECT id,data FROM jobs').all()){const job=JSON.parse(row.data);if(job.state==='queued'){job.retryAt=0;db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(job),row.id)}}}finally{db.close()}
}
async function triggerProductionTick(){
  // 新会话事件触发实际插件的 engine；不用另建 Engine 或绕过插件上下文。
  ctx.sessions.create(SessionId(randomUUID()),{meta:{cwd}})
}
try{
  await ctx.plugin(LlmRuntime);await ctx.plugin(SessionStore);await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false,includeRuntimeContext:false})
  await ctx.plugin(Tools);await ctx.plugin(Commands);await ctx.plugin(Projections)
  await ctx.plugin(Persistence,{root:join(home,'sessions')})
  await ctx.plugin(AgentLoop,{agents:[]})
  const fixtureProviders=officialApiDefault?['deepseek-account','deepseek-official']:[fixtureProvider]
  ctx.llm.registerAdapter(fixtureProviders,new FixedAdapter())
  if(officialApiDefault){
    ctx.llm.registerConfigurableProviders([{provider:'deepseek-official',displayName:'Official fixture',settingsNs:'api-fixture',settingsPath:[]}])
    ctx.provide('settings',{describe:()=>[{ns:'api-fixture',value:{apiKeyEnv:'FAKE_MEMORY_API_KEY'}}]})
    ctx.provide('credentials',{describe:async ref=>({configured:ref==='FAKE_MEMORY_API_KEY'})})
  }
  ctx.provide('webServer',{host:'127.0.0.1'});ctx.provide('configEditor',{})
  kernel=await ctx.plugin(plugin,{memoryProfileId:'source-fixture',projectUse:true,projectGenerate:true,consent:true,...(!officialDefault?{provider:fixtureProvider,model:'fixed'}:{})})
  assert.deepEqual(JSON.parse((await ctx.memory.invoke({action:'providers'},new AbortController().signal)).json),fixtureProviders.map(id=>({id,name:id})))
  assert.deepEqual(JSON.parse((await ctx.memory.invoke({action:'models',provider:fixtureProvider},new AbortController().signal)).json),[{id:'fixed',name:'Fixed model'}])
  await assert.rejects(ctx.memory.invoke({action:'models',provider:'unconfigured'},new AbortController().signal),/PROVIDER_UNAVAILABLE/)
  if(officialDefault)assert.deepEqual((await overview()).route,{provider:fixtureProvider,model:'fixed'})
  agent=await ctx.agents.create({sessionId:SessionId(randomUUID()),meta:{cwd},agentOptions:{provider:fixtureProvider,model:'fixed'}})
  agent.agent.followup(createUserMessage({content:[{type:'text',text:'本项目的数据库操作放在 src/repositories。'}],source:{kind:'user'}}))
  await wait(async()=>agent.agent.status==='idle'&&(await overview()).jobs.some(j=>j.kind==='extract'))
  advanceFixtureJobs();await triggerProductionTick()
  await wait(async()=>(await overview()).jobs.some(j=>j.kind==='extract'&&['retry','failed','succeeded'].includes(j.state)))
  const extracted=(await overview()).jobs.find(j=>j.kind==='extract')
  assert.equal(extracted.state,'succeeded',`production extract failed: ${extracted.error}`)
  await new Promise(r=>setTimeout(r,30))
  advanceFixtureJobs();await triggerProductionTick()
  await wait(async()=>(await overview()).jobs.some(j=>j.kind==='consolidate'&&['retry','failed','succeeded'].includes(j.state)))
  const consolidated=(await overview()).jobs.find(j=>j.kind==='consolidate')
  assert.equal(consolidated.state,'succeeded',`production consolidate failed: ${consolidated.error}; ${consolidated.diagnostic}`)
  assert.equal(calls.filter(p=>p.startsWith('只输出 JSON：{"raw_memory"')).length,1)
  assert.equal(calls.filter(p=>p.startsWith('只输出 JSON：{"changes"')).length,1)
  if(reasoningRegression)assert.deepEqual(backgroundConfigs,[{reasoningEffort:'off',maxTokens:1024},{reasoningEffort:'off',maxTokens:1024}])
  const project=(await overview()).projects.find(p=>p.root===cwd.toLowerCase())
  const items=JSON.parse((await ctx.memory.invoke({action:'list',scope:project.id},new AbortController().signal)).json)
  assert.equal(items.length,1)
  if(consolidationContract){
    const examples=CONSOLIDATE_PROMPT.split('\n').filter(line=>/^(只输出 JSON：|更新示例：|撤销示例：)/u.test(line)).map(line=>JSON.parse(line.slice(line.indexOf('：')+1).replace(/。$/u,'')))
    assert.equal(examples.length,3)
    assert.deepEqual(examples.map(example=>proposalSchema.parse(example).changes[0].op),['add','update','revoke'])
    assert(!Object.hasOwn(examples[0].changes[0],'id'))
    assert(!Object.hasOwn(examples[0].changes[0],'revision'))
    for(const example of examples.slice(1)){
      assert.equal(typeof example.changes[0].id,'string')
      assert.equal(typeof example.changes[0].revision,'number')
      assert(example.changes[0].revision>0)
      for(const revision of [null,'1',0,-1,1.5])assert.equal(proposalSchema.safeParse({changes:[{...example.changes[0],revision}]}).success,false)
    }
    const schemaError=proposalSchema.safeParse({changes:[{...examples[0].changes[0],revision:null}]})
    assert.equal(schemaError.success,false)
    assert.deepEqual(schemaError.error.issues[0].path,['changes',0,'revision'])
    assert.equal(schemaError.error.issues[0].code,'invalid_type')
    console.log('PASS consolidation JSON examples → production extract/consolidate; invalid revision still rejected (FIXTURE model)')
  }
  if(officialDefault)console.log('PASS default '+fixtureProvider+' → production extract → consolidate (FIXTURE model and credential metadata)')
  console.log(reasoningRegression?'PASS background off selection → extract → consolidate; foreground High and output cap 1024 unchanged (FIXTURE model)':'PASS production plugin context → default zstd log → extract → consolidate (FIXTURE model)')
}finally{await agent?.dispose();await kernel?.dispose();await ctx.fiber.dispose()}

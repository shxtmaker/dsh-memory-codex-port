/** 真实 Harness 内核、日志及插件；模型为明确标识的固定适配器，不使用凭证。 */
import assert from 'node:assert/strict'
import { mkdir,mkdtemp,writeFile,readFile } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { userInfo,homedir,hostname } from 'node:os'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm'
import SessionStore,{Session,SessionId} from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Commands from '@deepseek-ai/dsh-commands'
import Projections from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as plugin from '../lib/index.js'
import { StorageWorker } from '../lib/worker-client.js'
import { MemoryEngine } from '../lib/engine.js'
const manifest=JSON.parse(await readFile('package.json','utf8'))
await mkdir('test-runs',{recursive:true});const home=await mkdtemp(resolve('test-runs','native-'));process.env.DSH_HOME=home
const cwd=join(home,'project-A');await mkdir(cwd);const ctx=new Context(),calls=[];let toolItem;const capability={host:'127.0.0.1'}
class FixedAdapter extends LlmAdapter {
  async *stream(options){
    const input=options.messages.filter(m=>m.role==='user').flatMap(m=>typeof m.content==='string'?[m.content]:m.content.filter(b=>b.type==='text').map(b=>b.text)).join('\n')
    calls.push({input,tools:options.tools?.map(t=>t.name)??[]})
    if(toolItem&&input.includes('工具夹具')&&!options.messages.some(m=>m.role==='tool')){
      const id='fixture-memory-'+randomUUID(),args=JSON.stringify({action:'read',id:toolItem.id})
      yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name:'memory',argumentsDelta:args};yield {type:'block-end',index:0,block:{type:'tool-call',id,name:'memory',arguments:args}};yield {type:'usage',usage:{inputTokens:90,outputTokens:10,totalTokens:100}};yield {type:'finish',reason:{kind:'tool-calls'}};return
    }
    let text='已按用户要求记录 SQLite Worker。',usage=1000000
    if(input.startsWith('只输出 JSON：{"raw_memory"')){
      const events=JSON.parse(input.split('\n').at(-1)),seq=events.find(e=>e.role==='user').seq
      text=JSON.stringify({raw_memory:'SQLite Worker 选择。',rollout_summary:'用户明确选择 SQLite Worker。',rollout_slug:'native-sqlite',items:[{scope:'project',kind:'decision',title:'SQLite Worker',content:'数据库操作放在 SQLite Worker 中。',status:'observed',source_refs:[seq]}]});usage=100
    }else if(input.startsWith('只输出 JSON：{"changes"')){
      const batch=JSON.parse(input.split('\n').at(-1));text=JSON.stringify({changes:batch.inputs.flatMap(i=>i.output.items.map(f=>({op:'add',title:f.title,content:f.content,kind:f.kind,status:f.status,sources:[i.source]})))});usage=100
    }
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'usage',usage:{inputTokens:usage-10,outputTokens:10,totalTokens:usage}};yield {type:'finish',reason:{kind:'stop'}}
  }
}
const wait=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,20))}throw Error('NATIVE_TIMEOUT')}
let kernel,handle,second,engine,faultKernel,faultAgent
try {
  await ctx.plugin(LlmRuntime);await ctx.plugin(SessionStore);await ctx.plugin(AgentRegistry);await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false,includeRuntimeContext:false});await ctx.plugin(Tools);await ctx.plugin(Commands);await ctx.plugin(Projections);await ctx.plugin(Persistence,{root:join(home,'sessions'),compression:'none'});await ctx.plugin(AgentLoop,{agents:[]})
  ctx.llm.registerAdapter(['fixture'],new FixedAdapter())
  // 本地管理能力由测试 Host 组合提供；不修改生产 Remote 的权限条件。
  ctx.provide('webServer',capability);ctx.provide('configEditor',{})
  kernel=await ctx.plugin(plugin,{memoryProfileId:'native-fixture',projectUse:true,projectGenerate:true,globalUse:true,globalGenerate:false,consent:true,provider:'fixture',model:'fixed'})
  handle=await ctx.agents.create({sessionId:SessionId(randomUUID()),meta:{cwd},agentOptions:{provider:'fixture',model:'fixed'}})
  handle.agent.followup(createUserMessage({content:[{type:'text',text:'请把数据库操作放在 SQLite Worker 中。'}],source:{kind:'user'}}))
  await wait(()=>handle.agent.status==='idle'&&Number(handle.agent.session.seq)>3);await ctx.sessions.flush(handle.agent.session)
  let overview;await wait(async()=>{overview=JSON.parse((await ctx.memory.invoke({action:'overview'},new AbortController().signal)).json);return overview.jobs.length>0})
  const project=overview.projects.find(p=>p.root===cwd.toLowerCase());assert(project)
  const root=join(home,'memory','native-fixture'),digest=s=>createHash('sha256').update(s).digest('hex')
  const store=new StorageWorker(root,digest(userInfo().username+'\0'+homedir()),digest(hostname()+'\0'+resolve(home)),'native-fixture');await store.ready
  engine=new MemoryEngine(store,{consent:()=>true,route:()=>({provider:'fixture',model:'fixed'}),idleMs:()=>600000,intervalMs:()=>1800000,outputLimit:()=>1024,foregroundBusy:()=>ctx.agents.list().some(a=>a.status==='running'),readSource:async(source,signal)=>{
    const reader=await ctx.sessionPersistence.open(SessionId(source.sessionId),'read',{signal});try{const {events}=await reader.read(source.start,source.end-source.start+1,{signal});return plugin.transcript(events)}finally{await reader.close()}
  },model:async(prompt,maxTokens,signal)=>{let text='',usage=null;const prepared=await ctx.llm.prepareCall({provider:'fixture',model:'fixed',maxTokens},signal);for await(const chunk of prepared.stream({...prepared.config,messages:[{role:'user',content:[{type:'text',text:prompt}]}],signal})){if(chunk.type==='text-delta')text+=chunk.text;if(chunk.type==='usage')usage=chunk.usage.totalTokens}return {text,usage}}})
  // 只前移隔离夹具任务的等待时钟。生产默认仍为 10/30 分钟。
  function advanceJobs(){const db=new DatabaseSync(join(root,'state.sqlite'));for(const row of db.prepare('SELECT id,data FROM jobs').all()){const job=JSON.parse(row.data);if(job.state==='queued'){job.retryAt=0;db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(job),row.id)}}db.close()}
  advanceJobs();await engine.tick();advanceJobs();await engine.tick()
  assert.equal((await store.call('list',{scope:project.id})).length,1)
  second=await ctx.agents.create({sessionId:SessionId(randomUUID()),meta:{cwd},agentOptions:{provider:'fixture',model:'fixed'}})
  second.agent.followup(createUserMessage({content:[{type:'text',text:'SQLite 的数据库操作放在哪里？'}],source:{kind:'user'}}));await wait(()=>second.agent.status==='idle'&&Number(second.agent.session.seq)>3);await ctx.sessions.flush(second.agent.session)
  const reader=await ctx.sessionPersistence.open(second.agent.id,'read');let snapshot;try{snapshot=await reader.read(0,Number(second.agent.session.seq))}finally{await reader.close()}
  const memoryEvent=snapshot.events.find(e=>e.type==='user/message'&&e.data.source.kind==='dsh-memory');assert(memoryEvent,'native user/message must commit memory')
  assert(calls.at(-1).input.includes('memory-evidence'));assert(calls.at(-1).tools.includes('memory'))
  assert((await store.call('overview',{})).evidence.find(e=>e.session===second.agent.id).settled>0)
  const beforeCompaction=(await store.call('overview',{})).evidence.find(e=>e.session===second.agent.id).settled
  second.agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'压缩夹具摘要。'}],source:{kind:'user'}}),{surfaceOp:{op:'replace',startSeq:memoryEvent.seq,endSeq:memoryEvent.seq},sourceEventSeqs:[memoryEvent.seq]})
  second.agent.followup(createUserMessage({content:[{type:'text',text:'SQLite 再检查一次。'}],source:{kind:'user'}}));await wait(()=>second.agent.status==='idle'&&Number(second.agent.session.seq)>snapshot.events.length)
  assert.equal((await store.call('overview',{})).evidence.find(e=>e.session===second.agent.id).settled,beforeCompaction)
  const withdrawalItem=await store.call('save',{scope:project.id,title:'单独撤回规则',content:'撤回夹具使用短句。'})
  second.agent.followup(createUserMessage({content:[{type:'text',text:'撤回夹具的规则是什么？'}],source:{kind:'user'}}));await wait(()=>second.agent.status==='idle'&&second.agent.session.snapshotEvents().filter(e=>e.type==='user/message'&&e.data.source.kind==='dsh-memory').length===2)
  toolItem=await store.call('save',{scope:'global',title:'路径规则',content:'采用短路径。'})
  second.agent.followup(createUserMessage({content:[{type:'text',text:'工具夹具：按 id 读取所选条目。'}],source:{kind:'user'}}));await wait(()=>second.agent.status==='idle'&&second.agent.session.snapshotEvents().some(e=>e.type==='tool/result'))
  const toolResult=second.agent.session.snapshotEvents().find(e=>e.type==='tool/result');assert(toolResult.data.message.content.some(b=>b.type==='text'&&b.text.includes('采用短路径')));assert(toolResult.data.meta.memoryEvidence.items.length>0)
  await store.call('policy',{global:{use:false,generate:false},projects:{use:true,generate:true}})
  await store.call('projectPolicy',{scope:project.id,use:false,generate:false})
  second.agent.followup(createUserMessage({content:[{type:'text',text:'继续检查。'}],source:{kind:'user'}}));await wait(()=>second.agent.status==='idle'&&Number(second.agent.session.seq)>snapshot.events.length)
  await ctx.sessions.flush(second.agent.session)
  const withdrawn=second.agent.session.snapshotEvents();await writeFile("evidence/native-debug.json",JSON.stringify({events:withdrawn,surface:second.agent.session.surface.nodes,overview:await store.call("overview",{})},null,2))
  assert(withdrawn.some(e=>e.type==='user/message'&&e.data.source.kind==='dsh-memory-invalidated'&&e.surfaceOp.op==='replace'))
  assert(withdrawn.some(e=>e.type==='tool/result'&&e.data.message.content.some(b=>b.type==='text'&&b.text==='先前的记忆工具结果已失效。')&&e.surfaceOp.op==='replace'))
  await store.call('remove',{id:withdrawalItem.id,revision:withdrawalItem.revision})
  capability.host='remote-fixture'
  const remoteOverview=JSON.parse((await ctx.memory.invoke({action:'overview',sessionId:second.agent.id},new AbortController().signal)).json);assert.equal(remoteOverview.writable,false);assert(remoteOverview.projects.some(p=>p.id===project.id))
  await assert.rejects(ctx.memory.invoke({action:'save',scope:'global',title:'拒绝',content:'拒绝'},new AbortController().signal),/READ_ONLY_CONNECTION/)
  await assert.rejects(ctx.memory.invoke({action:'list',scope:project.id},new AbortController().signal),/SCOPE_DENIED/)
  assert.equal(JSON.parse((await ctx.memory.invoke({action:'list',scope:project.id,sessionId:second.agent.id},new AbortController().signal)).json).length,1)
  capability.host='127.0.0.1'
  await engine.close();engine=undefined;await kernel.dispose();kernel=undefined
  assert(!ctx.tools.schemas().some(t=>t.name==='memory'));assert.equal(ctx.get('memory'),undefined)
  const replay=Session.create(second.agent.id,withdrawn,second.agent.session.header);assert(replay.deriveMessages().length>0)
  await writeFile(join(home,'memory','bad-store'),'synthetic unavailable directory')
  faultKernel=await ctx.plugin(plugin,{memoryProfileId:'bad-store'})
  faultAgent=await ctx.agents.create({sessionId:SessionId(randomUUID()),meta:{cwd},agentOptions:{provider:'fixture',model:'fixed'}});faultAgent.agent.followup(createUserMessage({content:[{type:'text',text:'存储故障夹具仍继续前台。'}],source:{kind:'user'}}));await wait(()=>faultAgent.agent.status==='idle'&&faultAgent.agent.session.snapshotEvents().some(e=>e.type==='assistant/message'))
  await faultKernel.dispose();faultKernel=undefined
  await writeFile('evidence/native-host.json',JSON.stringify({status:'PASS',model:'FIXTURE',hostVersion:manifest.dsh.engines.dsh,home,sourceSession:handle.agent.id,newSession:second.agent.id,sourceCount:overview.jobs.length,nativeInjectionSeq:memoryEvent.seq,modelCalls:calls.length,uninstallReplay:true,withdrawal:true,canonicalToolVisible:true,readonlyCapabilityFixture:true,nativeCompactionDoesNotResetBudget:true,storageFailureForegroundContinues:true,unloadRemovesToolAndRemote:true},null,2))
  console.log('PASS native Harness AgentLoop → Session persistence → extract → consolidate → new Session injection → withdrawal → uninstall replay (FIXTURE model)')
}finally{await faultAgent?.dispose();await faultKernel?.dispose();await engine?.close();await second?.dispose();await handle?.dispose();await kernel?.dispose();await ctx.fiber.dispose()}

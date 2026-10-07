import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile, writeFile,symlink,readdir } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { createHash,randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { localUsageDay } from '../src/usage-statistics.ts'
import { StorageWorker } from '../lib/worker-client.js'
import { MemoryEngine,ModelCallError,withinDeadline } from '../lib/engine.js'
const base=resolve('test-runs');await mkdir(base,{recursive:true})
const digest=text=>createHash('sha256').update(text).digest('hex')
const policy={global:{use:true,generate:true},projects:{use:true,generate:true}}
const signal=()=>new AbortController().signal
async function fixture({existing=true}={}){
  const root=await mkdtemp(join(base,'A-'))
  if(existing){
    // 模拟升级前已绑定的配置档：新版本不能给已有配置档静默授予初始额度。
    await mkdir(join(root,'memory'))
    const db=new DatabaseSync(join(root,'memory','state.sqlite'))
    db.exec('CREATE TABLE memory_profiles(id TEXT PRIMARY KEY,owner TEXT NOT NULL,trust TEXT NOT NULL)')
    db.prepare('INSERT INTO memory_profiles VALUES(?,?,?)').run('fixture','owner','host');db.close()
  }
  const store=new StorageWorker(join(root,'memory'),'owner','host','fixture');await store.ready
  await store.call('policy',policy)
  const project=await store.call('project',{root:join(root,'project-A'),target:'host',name:'A'})
  const other=await store.call('project',{root:join(root,'project-B'),target:'host',name:'B'})
  return {root,store,project,other}
}
function engineFor(store,overrides={}) {
  // 默认保持生产策略 150ms；需要断言内容而不与墙上时钟竞争的用例显式传入 localDeadlineMs。
  return new MemoryEngine(store,{consent:()=>true,route:()=>({provider:'FIXTURE',model:'FIXED'}),idleMs:()=>0,intervalMs:()=>0,outputLimit:()=>1024,foregroundBusy:()=>false,readSource:async()=>{throw Error('SOURCE_MISSING')},model:async()=>{throw Error('MODEL_MISSING')},...overrides})
}
const facts=[{scope:'global',kind:'preference',title:'中文沟通',content:'始终使用中文沟通。',status:'observed',source_refs:[0]},{scope:'project',kind:'decision',title:'SQLite Worker',content:'数据库操作放在 SQLite Worker 中。',status:'observed',source_refs:[0]}]
/** 内容断言用宽松截止；150ms 生产策略由 A4 单独测量，两者不互相干扰。 */
const CONTENT_DEADLINE=()=>5000
async function pipeline(f,extra={}) {
  const text=JSON.stringify([{seq:0,role:'user',text:'请用中文；数据库操作放在 SQLite Worker 中。'}])
  const source={id:randomUUID(),sessionId:randomUUID(),project:f.project.id,start:0,end:0,hash:digest(text),updatedAt:Date.now(),excluded:false}
  const calls=[]
  const engine=engineFor(f.store,{localDeadlineMs:CONTENT_DEADLINE,readSource:async()=>text,model:async prompt=>{
    calls.push(prompt)
    if(prompt.startsWith('只输出 JSON：{"raw_memory"'))return {text:JSON.stringify({raw_memory:'项目细节不进入全局快照。',rollout_summary:'用户确认 SQLite Worker。',rollout_slug:'sqlite-worker',items:facts}),usage:100}
    const input=JSON.parse(prompt.split('\n').at(-1))
    return {text:JSON.stringify({changes:input.inputs.flatMap(row=>row.output.items.map(item=>({op:'add',title:item.title,content:item.content,kind:item.kind,status:item.status,sources:[row.source]})))}),usage:100}
  },...extra})
  await engine.capture(source);await engine.tick();await engine.tick()
  return {engine,calls,source,text}
}
test('A2 固定模型闭环、全局/项目隔离、增量差异和重启',async()=>{
  const f=await fixture();let engine
  try {
    const p=await pipeline(f);engine=p.engine
    assert.equal(p.calls.length,3);assert.equal((await f.store.call('overview',{})).dailyUsage.tokens,300)
    const global=await f.store.call('list',{scope:'global'}),local=await f.store.call('list',{scope:f.project.id})
    assert.equal(global.length,1);assert.equal(local.length,1)
    // 本用例断言召回内容，不断言墙上时钟：并发负载下 SQLite 往返会偶发超过
    // 150ms 硬截止，而 recall 会按设计放行主流程并返回 null。150ms 截止与晚到回收
    // 由 A4 用专门用例测量，此处用宽松截止把两者解耦。
    const evidence=await engine.recall('new-session',f.project.id,'SQLite 中文',1,signal())
    assert(evidence,'本地召回应返回证据（150ms 截止由 A4 单独测量）')
    assert(evidence.text.includes('SQLite Worker'));assert(evidence.text.includes('中文沟通'))
    await engine.settle(evidence.id,'native-log:1')
    const foreign=await engine.retrieve('B-session',f.other.id,'SQLite',local[0].id,signal());assert.equal(foreign,null)
    assert.deepEqual(await f.store.call('search',{scopes:[f.other.id],query:'SQLite'}),[])
    const safeGlobal=await f.store.call('file',{scope:'global',id:'raw_memories.md'});assert(!safeGlobal.content.includes('项目细节'))
    const source2={...p.source,id:randomUUID(),sessionId:randomUUID(),updatedAt:Date.now()};await engine.capture(source2);await engine.tick()
    const delta=await f.store.call('consolidationInput',{scope:f.project.id});assert.equal(delta.inputs.length,1);assert.equal(delta.inputs[0].source,source2.id)
    await engine.tick();assert.equal((await f.store.call('list',{scope:f.project.id})).length,1)
    await engine.close();engine=undefined
    const reopened=new StorageWorker(join(f.root,'memory'),'owner','host','fixture');await reopened.ready
    try {assert.equal((await reopened.call('list',{scope:f.project.id})).length,1);assert.equal(await reopened.call('reserveEvidence',{session:'new-session',ids:[local[0].id],limit:1024}),null)}finally{await reopened.close()}
  }finally{if(engine)await engine.close();else await f.store.close()}
})
test('A3 双策略、人工保护、revision、删除及 clear 防旧任务重生',async()=>{
  const f=await fixture();let engine
  try {
    const p=await pipeline(f);engine=p.engine
    const item=(await f.store.call('list',{scope:f.project.id}))[0]
    const manual=await f.store.call('save',{scope:f.project.id,id:item.id,revision:item.revision,title:item.title,content:'人工更正 SQLite Worker。'})
    await assert.rejects(f.store.call('save',{scope:f.project.id,id:item.id,revision:item.revision,title:'旧版',content:'不可覆盖'}),/REVISION_CONFLICT/)
    await f.store.call('removeSource',{scope:f.project.id,id:p.source.id});assert.equal((await f.store.call('read',{id:item.id})).manual,true)
    await f.store.call('policy',{global:{use:false,generate:false},projects:{use:false,generate:true}})
    assert.equal(await engine.retrieve('off-use',f.project.id,'SQLite',item.id,signal()),null)
    await f.store.call('policy',policy)
    const text=p.text,source={...p.source,id:randomUUID(),sessionId:randomUUID()};await engine.capture(source)
    const queued=(await f.store.call('pending',{})).find(j=>j.source===source.id)
    const leased=await f.store.call('lease',{id:queued.id,reserve:200});assert(leased)
    const overview=await f.store.call('overview',{}),scope=overview.scopes.find(s=>s.id===f.project.id)
    await assert.rejects(f.store.call('clear',{scope:scope.id,epoch:scope.epoch,confirmation:'bad'}),/CONFIRMATION_REQUIRED/)
    await f.store.call('clear',{scope:scope.id,epoch:scope.epoch,confirmation:`CLEAR:${scope.id}:${scope.epoch}`})
    await assert.rejects(f.store.call('commitExtraction',{id:queued.id,fence:leased.fence,hash:digest(text),output:{rollout_summary:'旧结果',rollout_slug:'old',items:facts},intervalMs:0}),/STALE_EPOCH/)
    assert.equal((await f.store.call('list',{scope:scope.id})).length,0)
    const afterClear=await engine.capture({...source,id:randomUUID()});assert(afterClear);assert(!Object.keys(afterClear.epochs).includes(scope.id));assert.deepEqual(Object.keys(afterClear.epochs),["global"])
    assert.equal((await f.store.call('file',{scope:scope.id,id:'MEMORY.md'})).content.trim(),'')
    await f.store.call('sessionOff',{session:'session-private'});assert.equal(await engine.capture({...source,id:randomUUID(),sessionId:'session-private'}),null)
    const newManual=await f.store.call('save',{scope:'global',title:'中文',content:'中文短句'})
    await f.store.call('remove',{id:newManual.id,revision:newManual.revision});await assert.rejects(f.store.call('read',{id:newManual.id}),/NOT_FOUND/)
    assert.equal(manual.pinned,true)
  }finally{if(engine)await engine.close();else await f.store.close()}
})
test('A4 共用持久 1024、一次 turn、总截止与晚到丢弃',async()=>{
  const f=await fixture(),engine=engineFor(f.store)
  try {
    const entries=[];for(let i=0;i<6;i++)entries.push(await f.store.call('save',{scope:i%2?'global':f.project.id,title:`中文 ${i}`,content:'短句规则 '.repeat(12)}))
    let total=0
    for(const item of entries){const evidence=await engine.retrieve('long-session',f.project.id,'',item.id,signal());if(evidence){total+=evidence.cost;await engine.settle(evidence.id,`request-${item.id}`)}}
    assert(total>0&&total<=1024);const ledger=(await f.store.call('overview',{})).evidence.find(e=>e.session==='long-session');assert.equal(ledger.settled,total)
    assert.equal(await engine.retrieve('long-session',f.project.id,'',entries[0].id,signal()),null)
    const first=await engine.recall('turn-once',f.project.id,'中文',7,signal());if(first)await engine.release(first.id)
    assert.equal(await engine.recall('turn-once',f.project.id,'中文',7,signal()),null)
    const start=performance.now();let late=0,invalidated=0
    assert.equal(await withinDeadline(signal(),async()=>{await new Promise(r=>setTimeout(r,260));return 'late'},()=>late++,()=>invalidated++),null)
    const waited=performance.now()-start;assert(waited>=140&&waited<190,`observed ${waited} ms`)
    await new Promise(r=>setTimeout(r,150));assert.equal(late,1);assert.equal(invalidated,1)
    const lock=new DatabaseSync(join(f.root,'memory','state.sqlite'));lock.exec('BEGIN IMMEDIATE')
    const busyStart=performance.now();const busy=await engine.retrieve('busy-session',f.project.id,'',entries[0].id,signal());const busyWait=performance.now()-busyStart;assert.equal(busy,null);assert(busyWait<190,`SQLite contention waited ${busyWait} ms`);lock.exec('COMMIT');lock.close()
    await new Promise(r=>setTimeout(r,70));const busyLedger=(await f.store.call('overview',{})).evidence.find(e=>e.session==='busy-session');assert.equal(busyLedger?.reserved??0,0)
    console.log(`A4 shared deadline observed=${waited.toFixed(1)}ms; settled=${total}/1024 UTF-8 conservative tokens`)
    console.log(`A4 actual SQLite contention observed=${busyWait.toFixed(1)}ms; late reservation released`)
  }finally{await engine.close()}
})
test('A4 无额度拦截、失败重试逐次累计和未知用量继续',async()=>{
  const f=await fixture(),text=JSON.stringify([{seq:0,role:'user',text:'中文'}])
  const engine=engineFor(f.store,{readSource:async()=>text,model:async()=>({text:'INVALID_JSON',usage:100})})
  try {
    const src={id:randomUUID(),sessionId:randomUUID(),project:f.project.id,start:0,end:0,hash:digest(text),updatedAt:Date.now(),excluded:false}
    const dbPath=join(f.root,'memory','state.sqlite'),legacy=new DatabaseSync(dbPath)
    legacy.prepare('UPDATE background_ledger SET credit=0,used=999999,paused=1').run();legacy.close()
    await engine.capture(src);await engine.tick()
    let value=await f.store.call('overview',{}),job=value.jobs.find(j=>j.source===src.id)
    assert.equal(job.state,'retry');assert.equal(job.attempts,1);assert.equal(job.error,'MODEL_INVALID_JSON');assert.equal(job.attemptUsage,100)
    assert.equal(value.dailyUsage.tokens,100);assert.equal(value.dailyUsage.calls,1);assert.equal(value.usageAlerts,undefined);assert.equal(value.budget,undefined)
    const db=new DatabaseSync(dbPath);job.retryAt=0;db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(job),job.id);db.close()
    await engine.tick();value=await f.store.call('overview',{});assert.equal(value.jobs.find(j=>j.id===job.id).state,'failed');assert.equal(value.dailyUsage.tokens,200);assert.equal(value.dailyUsage.calls,2)
    const j1=await engine.capture({...src,id:randomUUID(),sessionId:randomUUID()}),j2=await engine.capture({...src,id:randomUUID(),sessionId:randomUUID()})
    const lease=await f.store.call('lease',{id:j1.id,reserve:500});assert(lease)
    assert.equal(await f.store.call('lease',{id:j2.id,reserve:500}),null)
    await f.store.call('settleJob',{id:j1.id,fence:lease.fence,usage:null,state:'failed'})
    value=await f.store.call('overview',{});assert.equal(value.dailyUsage.tokens,200);assert.equal(value.dailyUsage.calls,3);assert.equal(value.dailyUsage.unknownCalls,1)
    const next=await f.store.call('lease',{id:j2.id,reserve:500});assert(next,'unknown usage must not block the next call')
    await f.store.call('settleJob',{id:j2.id,fence:next.fence,usage:50,state:'succeeded'})
    assert.equal((await f.store.call('overview',{})).dailyUsage.tokens,250)
    const j3=await engine.capture({...src,id:randomUUID(),sessionId:randomUUID()}),third=await f.store.call('lease',{id:j3.id,reserve:500})
    await f.store.call('settleJob',{id:j3.id,fence:third.fence,usage:49,state:'succeeded'})
    assert.equal((await f.store.call('overview',{})).dailyUsage.tokens,299)
    await assert.rejects(f.store.call('topUpCredit',{}),/UNKNOWN_OPERATION/)
    await assert.rejects(f.store.call('settleJob',{id:j2.id,fence:next.fence,usage:99,state:'succeeded'}),/STALE_LEASE/);assert.equal((await f.store.call('overview',{})).dailyUsage.tokens,299)
  }finally{await engine.close()}
})

test('A4 今日用量重启保留、旧等待任务恢复、旧账本保留和最新session排序',async()=>{
  const f=await fixture({existing:false});let reopened
  try{
    const source={id:randomUUID(),sessionId:randomUUID(),project:f.project.id,start:0,end:0,hash:'fixture',updatedAt:Date.now(),excluded:false}
    const job=await f.store.call('capture',{source,idleMs:0}),db=new DatabaseSync(join(f.root,'memory','state.sqlite'))
    const old={...job,state:'waiting-credit'};db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(old),job.id)
    assert.equal(db.prepare('SELECT count(*) AS count FROM credit_grants').get().count,0);db.close()
    const lease=await f.store.call('lease',{id:job.id,reserve:2000})
    assert(lease);await f.store.call('settleJob',{id:job.id,fence:lease.fence,usage:101,state:'succeeded'})
    const item=await f.store.call('save',{scope:f.project.id,title:'排序',content:'计量排序'})
    for(const session of ['older','newer','older']){
      const value=await f.store.call('reserveEvidence',{session,ids:[item.id],limit:1024})
      if(value)await f.store.call('releaseEvidence',{id:value.id})
      await new Promise(resolve=>setTimeout(resolve,5))
    }
    const value=await f.store.call('overview',{});assert.equal(value.evidence[0].session,'older')
    await f.store.close();reopened=new StorageWorker(join(f.root,'memory'),'owner','host','fixture');await reopened.ready
    const restored=await reopened.call('overview',{});assert.deepEqual(restored.dailyUsage,value.dailyUsage);assert.equal(restored.dailyUsage.tokens,101);assert.equal(restored.evidence[0].session,'older')
    const retained=new DatabaseSync(join(f.root,'memory','state.sqlite'));assert.equal(retained.prepare('SELECT credit FROM background_ledger').get().credit,0);retained.close()
  }finally{await reopened?.close();await f.store.close()}
})

test('A5 模型格式和截断诊断不记录敏感正文，实际失败用量保留',async()=>{
  for(const [reply,code,path] of [
    [{text:'sk-FAKE0123456789 invalid JSON',usage:37},'MODEL_INVALID_JSON',''],
    [{text:JSON.stringify({rollout_summary:'摘要',rollout_slug:'test',items:[{...facts[1],source_refs:[]}]}),usage:37},'MODEL_SCHEMA_FAILURE','source_refs'],
    [{text:'{}',usage:37,finish:'max-tokens'},'MODEL_OUTPUT_TRUNCATED',''],
    [new ModelCallError(37),'MODEL_CALL_FAILURE',''],
  ]){
    const f=await fixture(),text=JSON.stringify([{seq:0,role:'user',text:'项目决策'}])
    const engine=engineFor(f.store,{readSource:async()=>text,model:async()=>{if(reply instanceof Error)throw reply;return reply}})
    try{
          await engine.capture({id:randomUUID(),sessionId:randomUUID(),project:f.project.id,start:0,end:0,hash:digest(text),updatedAt:Date.now(),excluded:false})
      await engine.tick()
      const value=await f.store.call('overview',{}),job=value.jobs[0]
      assert.equal(job.error,code);assert.equal(job.attemptUsage,37);assert.equal(value.dailyUsage.tokens,37);assert.equal(value.budget,undefined)
      if(path)assert(job.diagnostic.includes(path))
      assert(!JSON.stringify(job).includes('FAKE0123456789'))
    }finally{await engine.close()}
  }
})
test('A5 Worker 故障、身份拒绝、快照重建、路径拒绝与可停止生命周期',async()=>{
  const f=await fixture()
  try {
    await f.store.call('save',{scope:'global',title:'安全',content:'api_key=sk-FAKE0123456789 保留中文'})
    const snap=await f.store.call('files',{scope:'global'});await rm(join(snap.path,'MEMORY.md'))
    const content=(await f.store.call('file',{scope:'global',id:'MEMORY.md'})).content;assert(content.includes('[REDACTED]'));assert(!content.includes('FAKE0123456789'))
    await assert.rejects(f.store.call('file',{scope:'global',id:'../state.sqlite'}),/PATH_DENIED/)
    const outside=join(f.root,'outside');await mkdir(outside);await symlink(outside,join(f.root,'memory','exports'),process.platform==='win32'?'junction':'dir');await assert.rejects(f.store.call('export',{scope:'global'}),/PATH_DENIED/);assert.deepEqual(await readdir(outside),[])
    const text=JSON.stringify([{seq:0,role:'user',text:'取消夹具'}]);let started;const startedPromise=new Promise(resolve=>{started=resolve})
    const engine=engineFor(f.store,{readSource:async()=>text,model:async(_prompt,_limit,signal)=>{started();return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('CANCELLED')),{once:true})})}})
    await engine.capture({id:randomUUID(),sessionId:randomUUID(),project:f.project.id,start:0,end:0,hash:digest(text),updatedAt:Date.now(),excluded:false});const active=engine.tick();await startedPromise;engine.cancel();await active
    const cancelled=(await f.store.call('overview',{})).jobs.find(j=>j.state==='cancelled');assert(cancelled);assert.equal((await f.store.call('overview',{})).dailyUsage.unknownCalls,1)
    await engine.close()
    await f.store.close();await assert.rejects(f.store.call('overview',{}),/STORAGE_STOPPED/)
    const mismatch=new StorageWorker(join(f.root,'memory'),'other-owner','host','fixture');await assert.rejects(mismatch.ready,/STORAGE_UNAVAILABLE/);await mismatch.close()
    const futureRoot=join(f.root,'future');await mkdir(futureRoot);const db=new DatabaseSync(join(futureRoot,'state.sqlite'));db.exec('PRAGMA user_version=99');db.close()
    const future=new StorageWorker(futureRoot,'owner','host','fixture');await assert.rejects(future.ready,/STORAGE_UNAVAILABLE/);await future.close()
    const badRoot=join(f.root,'not-directory');await writeFile(badRoot,'fixture');const bad=new StorageWorker(badRoot,'owner','host','fixture');await assert.rejects(bad.ready,/STORAGE_UNAVAILABLE/);await bad.close()
  }finally{await f.store.close()}
})

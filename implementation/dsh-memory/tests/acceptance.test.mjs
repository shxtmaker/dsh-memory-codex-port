import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile, writeFile,symlink,readdir } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { createHash,randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { StorageWorker } from '../lib/worker-client.js'
import { MemoryEngine,withinDeadline } from '../lib/engine.js'
const base=resolve('test-runs');await mkdir(base,{recursive:true})
const digest=text=>createHash('sha256').update(text).digest('hex')
const policy={global:{use:true,generate:true},projects:{use:true,generate:true}}
const signal=()=>new AbortController().signal
async function fixture(){
  const root=await mkdtemp(join(base,'A-')),store=new StorageWorker(join(root,'memory'),'owner','host','fixture');await store.ready
  await store.call('policy',policy)
  const project=await store.call('project',{root:join(root,'project-A'),target:'host',name:'A'})
  const other=await store.call('project',{root:join(root,'project-B'),target:'host',name:'B'})
  return {root,store,project,other}
}
function engineFor(store,overrides={}) {
  return new MemoryEngine(store,{consent:()=>true,route:()=>({provider:'FIXTURE',model:'FIXED'}),idleMs:()=>0,intervalMs:()=>0,dailyLimit:()=>20000,outputLimit:()=>1024,foregroundBusy:()=>false,readSource:async()=>{throw Error('SOURCE_MISSING')},model:async()=>{throw Error('MODEL_MISSING')},...overrides})
}
const facts=[{scope:'global',kind:'preference',title:'中文沟通',content:'始终使用中文沟通。',status:'observed',source_refs:[0]},{scope:'project',kind:'decision',title:'SQLite Worker',content:'数据库操作放在 SQLite Worker 中。',status:'observed',source_refs:[0]}]
async function pipeline(f,extra={}) {
  const text=JSON.stringify([{seq:0,role:'user',text:'请用中文；数据库操作放在 SQLite Worker 中。'}])
  const source={id:randomUUID(),sessionId:randomUUID(),project:f.project.id,start:0,end:0,hash:digest(text),updatedAt:Date.now(),excluded:false}
  const calls=[]
  const engine=engineFor(f.store,{readSource:async()=>text,model:async prompt=>{
    calls.push(prompt)
    if(prompt.startsWith('只输出 JSON：{"raw_memory"'))return {text:JSON.stringify({raw_memory:'项目细节不进入全局快照。',rollout_summary:'用户确认 SQLite Worker。',rollout_slug:'sqlite-worker',items:facts}),usage:100}
    const input=JSON.parse(prompt.split('\n').at(-1))
    return {text:JSON.stringify({changes:input.inputs.flatMap(row=>row.output.items.map(item=>({op:'add',title:item.title,content:item.content,kind:item.kind,status:item.status,sources:[row.source]})))}),usage:100}
  },...extra})
  await engine.credit('fixture-authoritative-usage',1000000)
  await engine.capture(source);await engine.tick();await engine.tick()
  return {engine,calls,source,text}
}
test('A2 固定模型闭环、全局/项目隔离、增量差异和重启',async()=>{
  const f=await fixture();let engine
  try {
    const p=await pipeline(f);engine=p.engine
    assert.equal(p.calls.length,3)
    const global=await f.store.call('list',{scope:'global'}),local=await f.store.call('list',{scope:f.project.id})
    assert.equal(global.length,1);assert.equal(local.length,1)
    const evidence=await engine.recall('new-session',f.project.id,'SQLite 中文',1,signal());assert(evidence);assert(evidence.text.includes('SQLite Worker'));assert(evidence.text.includes('中文沟通'))
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
    const leased=await f.store.call('lease',{id:queued.id,reserve:200,dailyLimit:20000});assert(leased)
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
test('A4 3% 无透支、日额度、并发一、失败重试及未知 usage 暂停',async()=>{
  const f=await fixture(),text=JSON.stringify([{seq:0,role:'user',text:'中文'}])
  const engine=engineFor(f.store,{readSource:async()=>text,model:async()=>({text:'INVALID_JSON',usage:100})})
  try {
    const src={id:randomUUID(),sessionId:randomUUID(),project:f.project.id,start:0,end:0,hash:digest(text),updatedAt:Date.now(),excluded:false}
    await engine.capture(src);await engine.tick();assert.equal((await f.store.call('overview',{})).jobs[0].state,'waiting-credit')
    await engine.credit('native-usage',1000000);await engine.credit('native-usage',1000000)
    assert.equal((await f.store.call('overview',{})).budget.credit,30000)
    await engine.tick();let overview=await f.store.call('overview',{});assert.equal(overview.budget.used,100);assert.equal(overview.jobs[0].attempts,1)
    // 仅将隔离夹具的时钟条件前移，生产退避规则不变。
    const db=new DatabaseSync(join(f.root,'memory','state.sqlite')),job=overview.jobs[0];job.retryAt=0;db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(job),job.id);db.close()
    await engine.tick();overview=await f.store.call('overview',{});assert.equal(overview.budget.used,200);assert.equal(overview.jobs[0].state,'failed')
    const j1=await engine.capture({...src,id:randomUUID(),sessionId:randomUUID()}),j2=await engine.capture({...src,id:randomUUID(),sessionId:randomUUID()})
    assert.equal(await f.store.call('lease',{id:j1.id,reserve:500,dailyLimit:600}),null)
    const lease=await f.store.call('lease',{id:j1.id,reserve:500,dailyLimit:20000});assert(lease)
    assert.equal(await f.store.call('lease',{id:j2.id,reserve:500,dailyLimit:20000}),null)
    await f.store.call('settleJob',{id:j1.id,fence:lease.fence,usage:null,state:'failed'})
    overview=await f.store.call('overview',{});assert.equal(overview.budget.used,700);assert.equal(overview.budget.paused,1)
    assert.equal(await f.store.call('lease',{id:j2.id,reserve:500,dailyLimit:20000}),null)
  }finally{await engine.close()}
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
    await engine.credit('cancel-fixture',1000000);await engine.capture({id:randomUUID(),sessionId:randomUUID(),project:f.project.id,start:0,end:0,hash:digest(text),updatedAt:Date.now(),excluded:false});const active=engine.tick();await startedPromise;engine.cancel();await active
    const cancelled=(await f.store.call('overview',{})).jobs.find(j=>j.state==='cancelled');assert(cancelled);assert.equal((await f.store.call('overview',{})).budget.paused,1)
    await engine.close()
    await f.store.close();await assert.rejects(f.store.call('overview',{}),/STORAGE_STOPPED/)
    const mismatch=new StorageWorker(join(f.root,'memory'),'other-owner','host','fixture');await assert.rejects(mismatch.ready,/STORAGE_UNAVAILABLE/);await mismatch.close()
    const futureRoot=join(f.root,'future');await mkdir(futureRoot);const db=new DatabaseSync(join(futureRoot,'state.sqlite'));db.exec('PRAGMA user_version=99');db.close()
    const future=new StorageWorker(futureRoot,'owner','host','fixture');await assert.rejects(future.ready,/STORAGE_UNAVAILABLE/);await future.close()
    const badRoot=join(f.root,'not-directory');await writeFile(badRoot,'fixture');const bad=new StorageWorker(badRoot,'owner','host','fixture');await assert.rejects(bad.ready,/STORAGE_UNAVAILABLE/);await bad.close()
  }finally{await f.store.close()}
})

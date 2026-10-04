import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir,mkdtemp } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { StorageWorker } from '../lib/worker-client.js'
import { localUsageDay } from '../src/usage-statistics.ts'

test('今日用量日界使用本地自然日，并覆盖夏令时23/25小时',()=>{
  const moduleUrl=new URL('../src/usage-statistics.ts',import.meta.url).href
  const script=`import {localUsageDay} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(['2026-03-08T12:00:00-04:00','2026-11-01T12:00:00-05:00'].map(t=>localUsageDay(Date.parse(t)))))`
  const days=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ:'America/New_York'},encoding:'utf8'}))
  assert.equal(days[0].day,'2026-03-08');assert.equal(days[0].end-days[0].start,23*3600000)
  assert.equal(days[1].day,'2026-11-01');assert.equal(days[1].end-days[1].start,25*3600000)
})

test('今日用量跨日边界、未知用量、作用域隔离、超过30条和清空后保留',async()=>{
  const base=resolve('test-runs');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'daily-'))
  const store=new StorageWorker(root,'owner','host','daily-fixture');await store.ready
  try {
    const p=await store.call('project',{root:join(root,'project'),target:'host',name:'A'})
    const {start,end,day}=localUsageDay(),db=new DatabaseSync(join(root,'state.sqlite'))
    const insert=db.prepare('INSERT INTO usage_attempts VALUES(?,?,?,?,?)')
    for(const [id,scope,usage,time] of [['start','global',10,start],['now',p.id,20,Date.now()],['unknown',p.id,null,Date.now()],['yesterday',p.id,1000,start-1],['tomorrow',p.id,2000,end]])insert.run(id,scope,'extract',usage,time)
    for(let i=0;i<40;i++)insert.run('other-'+i,'hidden-project','consolidate',1,Date.now())
    // 旧版仅保存最新任务用量及超额记录，不冒充完整逐次统计。
    db.exec('CREATE TABLE usage_alerts(id TEXT PRIMARY KEY,data TEXT NOT NULL)')
    db.prepare('INSERT INTO usage_alerts VALUES(?,?)').run('legacy',JSON.stringify({usage:999999,time:Date.now()}));db.close()
    let overview=await store.call('overview',{});assert.equal(overview.dailyUsage.day,day);assert.equal(overview.dailyUsage.tokens,70);assert.equal(overview.dailyUsage.calls,43);assert.equal(overview.dailyUsage.unknownCalls,1);assert.equal(overview.usageAlerts,undefined)
    const visible=await store.call('overview',{usageScopes:['global',p.id]});assert.equal(visible.dailyUsage.tokens,30);assert.equal(visible.dailyUsage.calls,3)
    assert.equal((await store.call('overview',{usageScopes:['global']})).dailyUsage.tokens,10)
    const scope=overview.scopes.find(s=>s.id===p.id);await store.call('clear',{scope:p.id,epoch:scope.epoch,confirmation:`CLEAR:${p.id}:${scope.epoch}`})
    assert.equal((await store.call('overview',{usageScopes:['global',p.id]})).dailyUsage.tokens,30)
  } finally {await store.close()}
})

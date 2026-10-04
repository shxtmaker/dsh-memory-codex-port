import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveMemoryRoute} from '../src/model-route.ts'
const empty={provider:'',model:''}
function catalog(ids,models={}){return {listProviders:()=>ids.map(id=>({id,name:id})),listModels:async id=>models[id]??[{id:'default-model'}]}}
test('官方API已有密钥时优先使用API，只有账号时选择账号官方路由',async()=>{
  assert.deepEqual(await resolveMemoryRoute(catalog(['deepseek-account','deepseek-official']),empty,async()=>true),{provider:'deepseek-official',model:'default-model'})
  assert.deepEqual(await resolveMemoryRoute(catalog(['deepseek-account']),empty,async()=>false),{provider:'deepseek-account',model:'default-model'})
  assert.deepEqual(await resolveMemoryRoute(catalog(['deepseek-official']),empty,async()=>true),{provider:'deepseek-official',model:'default-model'})
})
test('官方API没有密钥时不覆盖可用账号；不编造模型或第三方默认路由',async()=>{
  assert.deepEqual(await resolveMemoryRoute(catalog(['deepseek-account','deepseek-official']),empty,async()=>false),{provider:'deepseek-account',model:'default-model'})
  assert.deepEqual(await resolveMemoryRoute(catalog(['deepseek-account','deepseek-official']),empty,async()=>{throw Error('CREDENTIAL_STATE_UNAVAILABLE')}),{provider:'deepseek-account',model:'default-model'})
  assert.deepEqual(await resolveMemoryRoute(catalog(['deepseek-official']),empty,async()=>false),empty)
  assert.deepEqual(await resolveMemoryRoute(catalog(['deepseek-account'],{'deepseek-account':[]}),empty,async()=>false),empty)
  assert.deepEqual(await resolveMemoryRoute(catalog(['deepseek-account','custom']),empty,async()=>true),empty)
  assert.deepEqual(await resolveMemoryRoute(catalog([]),empty,async()=>true),empty)
})
test('保留已有有效的显式选择，不因默认规则切换供应商或模型',async()=>{
  const stored={provider:'deepseek-account',model:'chosen-model'}
  assert.deepEqual(await resolveMemoryRoute(catalog(['deepseek-account','deepseek-official']),stored,async()=>true),stored)
  const custom={provider:'custom',model:'custom-model'}
  assert.deepEqual(await resolveMemoryRoute(catalog(['custom','deepseek-official']),custom,async()=>true),custom)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
test('仓库根目录声明组合包，并与本地包使用相同名称、版本、入口与运行文件',async()=>{
  const root=resolve('../..'),manifest=JSON.parse(await readFile(root+'/package.json','utf8')),inner=JSON.parse(await readFile('package.json','utf8'))
  assert.equal(manifest.name,inner.name);assert.equal(manifest.version,inner.version)
  assert.deepEqual(manifest.dsh,inner.dsh);assert.deepEqual(manifest.exports,inner.exports)
  assert(!manifest.scripts?.prepare);assert(!manifest.scripts?.postinstall)
  assert.equal(await readFile(root+'/cordis.patch.yml','utf8'),await readFile('cordis.patch.yml','utf8'))
  for(const file of ['index.js','client.js','storage-worker.js','typert.host.js','typert.remote-client.js'])assert.deepEqual(await readFile(root+'/lib/'+file),await readFile('lib/'+file))
})

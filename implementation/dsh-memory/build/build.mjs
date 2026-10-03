import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'
import { execFileSync } from 'node:child_process'

const root=resolve('.'),lib=join(root,'lib')
await mkdir(lib,{recursive:true})
await mkdir(join(root,'artifacts'),{recursive:true})
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.host.json','--noEmit','false','--declaration','--emitDeclarationOnly','--outDir','lib/types'],{stdio:'inherit'})
const manifest=JSON.parse(await readFile('package.json','utf8'))
// 官方分析器要求 packages/ 下的项目引用；独立构建目录仅复制本插件接口。
const stage=join(root,'build','.typert'),pkg=join(stage,'packages','memory')
const protocol=join(stage,'packages','protocol')
await mkdir(protocol,{recursive:true})
await cp(join(root,'node_modules/@deepseek-ai/dsh-typert-protocol/lib/types'),join(protocol,'src'),{recursive:true})
await writeFile(join(protocol,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh-typert-protocol',type:'module',exports:{'.':'./src/index.d.ts'}}))
await writeFile(join(protocol,'tsconfig.host.json'),JSON.stringify({compilerOptions:{module:'NodeNext',moduleResolution:'NodeNext',target:'ES2024',skipLibCheck:true,noEmit:true},include:['src/**/*.d.ts']}))
await mkdir(join(pkg,'src'),{recursive:true})
for(const file of ['remote-service.ts','contracts.ts'])await cp(join(root,'src',file),join(pkg,'src',file))
await writeFile(join(pkg,'src','index.ts'),"export { MemoryRemote } from './remote-service.ts'\nexport type { ManageRequest, ManageResult } from './contracts.ts'\n")
await writeFile(join(pkg,'package.json'),JSON.stringify({...manifest,exports:{'.':{types:'./lib/types/index.d.ts',default:'./lib/index.js'},'./contracts':{types:'./lib/types/contracts.d.ts',default:'./lib/contracts.js'},'./typert':{types:'./lib/typert.host.d.ts',default:'./lib/typert.host.js'},'./remote':{types:'./lib/typert.remote-client.d.ts',default:'./lib/typert.remote-client.js'}},files:['lib/typert.host.js','lib/typert.host.d.ts','lib/typert.remote-client.js','lib/typert.remote-client.d.ts']}))
await writeFile(join(pkg,'tsconfig.host.json'),JSON.stringify({compilerOptions:{strict:true,skipLibCheck:true,module:'NodeNext',moduleResolution:'NodeNext',target:'ES2024',noEmit:true,allowImportingTsExtensions:true,paths:{'@deepseek-ai/dsh-typert-protocol':[join(protocol,'src/index.d.ts')]}},include:['src/**/*.ts']}))
await writeFile(join(stage,'tsconfig.host.json'),JSON.stringify({compilerOptions:{module:'NodeNext',moduleResolution:'NodeNext',target:'ES2024',skipLibCheck:true,strict:true,paths:{'@deepseek-ai/dsh-typert-protocol':[join(protocol,'src/index.d.ts')]}},files:[],references:[{path:'./packages/protocol/tsconfig.host.json'},{path:'./packages/memory/tsconfig.host.json'}]}))
const artifacts=new WorkspaceTypertGenerator(stage).generate(['dsh-memory-local'],['host'])
if(artifacts.length!==1||!artifacts[0].remote)throw new Error('Remote generation did not produce one strict contribution')
const artifact=artifacts[0]
for(const [name,content]of Object.entries({'typert.host.js':artifact.js,'typert.host.d.ts':artifact.dts,'typert.remote-client.js':artifact.remote.js,'typert.remote-client.d.ts':artifact.remote.dts}))await writeFile(join(lib,name),content)
await build({entryPoints:{index:'src/index.ts',engine:'src/engine.ts','worker-client':'src/storage/worker-client.ts','storage-worker':'src/storage/storage-worker.ts',contracts:'src/contracts.ts'},outdir:'lib',bundle:true,packages:'external',format:'esm',platform:'node',target:'es2024',sourcemap:true})
const client=await build({entryPoints:['src/client/index.ts'],bundle:true,write:false,format:'cjs',platform:'browser',target:'es2022',external:['react','@deepseek-ai/cordis','@deepseek-ai/dsh-client-ui-slots'],minify:true})
await writeFile(join(lib,'client.js'),`window.__ModuleLoader__.load({id:"dsh-memory-local",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`)
console.log('Built Host, SQLite Worker, lazy-CJS Client and strict Typert Remote for '+manifest.dsh.engines.dsh)

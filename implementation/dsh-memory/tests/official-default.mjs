/** 通过真实插件上下文验证默认官方账号路由；模型与用量均为隔离夹具。 */
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
for(const mode of ['--official-default','--official-api-default']){
  const {stdout,stderr}=await promisify(execFile)(process.execPath,['tests/production-source.mjs',mode],{maxBuffer:8000000})
  process.stdout.write(stdout)
  process.stderr.write(stderr)
}

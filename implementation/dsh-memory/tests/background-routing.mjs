/** 复用实际插件上下文闭环；独立子进程仅建立合成home。 */
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const {stdout,stderr}=await promisify(execFile)(process.execPath,['tests/production-source.mjs','--reasoning-regression'],{maxBuffer:8000000})
process.stdout.write(stdout)
process.stderr.write(stderr)

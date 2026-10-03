/** 仅测试脚本：使用已装 Desktop 的 bundled runtime 与官方 CLI 管理隔离 profile。 */
import {desktopExecutable,desktopResources} from './desktop-runtime.mjs'
import { pathToFileURL } from 'node:url'
import { delimiter } from 'node:path'
const executable=desktopExecutable()
const resources=desktopResources()
const {runCli}=await import(pathToFileURL(resources+'/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js').href)
await runCli({manageDesktopProfile:true,packageManager:{command:executable,args:[resources+'/runtime/pnpm/bin/pnpm.mjs'],env:{ELECTRON_RUN_AS_NODE:'1',DSH_DESKTOP_NODE_EXECUTABLE:executable,PATH:resources+'/runtime/bin'+delimiter+(process.env.PATH??'')}}})

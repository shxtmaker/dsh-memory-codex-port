/** 可选真实 Desktop 验收必须明确给出目标 exe，禁止猜测日常实例。 */
import {resolve,dirname,join,isAbsolute} from 'node:path'
export function desktopExecutable(){
  const value=process.env.DSH_MEMORY_DESKTOP_EXECUTABLE
  if(!value||!isAbsolute(value))throw Error('Set DSH_MEMORY_DESKTOP_EXECUTABLE to the actual Desktop executable absolute path')
  return resolve(value)
}
export function desktopResources(){return join(dirname(desktopExecutable()),'resources')}

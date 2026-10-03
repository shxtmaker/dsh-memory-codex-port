import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { homedir, hostname, userInfo } from 'node:os'
import { join, basename, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { z } from 'zod'
import { Config } from './config.ts'
import { MemoryEngine, withinDeadline, POLICY, MEMORY_TOOL, type Evidence } from './engine.ts'
import { StorageWorker } from './storage/worker-client.ts'
import { MemoryRemote } from './remote-service.ts'
import { redact } from './shared.ts'
import type { Source, Project, MemoryItem, ManageRequest, ManageResult } from './contracts.ts'
const evidenceMetadata=z.object({epochs:z.record(z.string(),z.number()),items:z.array(z.object({id:z.string(),scope:z.string(),revision:z.number()}))})
export { Config } from './config.ts'
export { MemoryRemote } from './remote-service.ts'
export type { ManageRequest, ManageResult } from './contracts.ts'
export const name='dsh-memory'
export const inject=['sessions','agents','systemPrompt','tools','commands','llm']
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-memory': {kind:'dsh-memory';form:'recall';reservation:string;epochs:Record<string,number>;items:{id:string;revision:number;scope:string}[]}
    'dsh-memory-invalidated': {kind:'dsh-memory-invalidated';form:'notice';summary:string}
  }
}
/** 从已提交原生日志选取有界证据。隐藏推理、模型记忆工具和所有高优先级指令。 */
export function transcript(events: readonly SessionEvent[]): string {
  const output:{seq:number;role:string;text:string}[]=[]
  const names=new Map(events.filter(e=>e.type==='tool/call').map(e=>[e.data.callId,e.data.name]))
  for(const event of events){
    let blocks:readonly ContentBlock[]|undefined,role=''
    if(event.type==='user/message'){
      if(event.data.source.kind!=='user')continue
      blocks=typeof event.data.content==='string'?[{type:'text',text:event.data.content}]:event.data.content;role='user'
    }else if(event.type==='assistant/message'){blocks=event.data.message.content;role='assistant'}
    else if(event.type==='tool/result'){
      const name=names.get(event.data.message.toolCallId)
      if(!name || name==='memory')continue
      blocks=event.data.message.content;role=`tool:${name}`
    }else continue
    const text=redact(blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n')).slice(0,role.startsWith('tool')?1000:3000)
    if(text)output.push({seq:event.seq,role,text})
  }
  // 逐条保留完整证据，避免 JSON 截断破坏来源范围。
  while(JSON.stringify(output).length>12000)output.shift()
  return JSON.stringify(output)
}
/** 只挂载插件扩展点，不修改宿主的日志解释器或模型请求。 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const home=resolve(process.env.DSH_HOME?.trim()||join(homedir(),'.dsh'))
  const digest=(s:string):string=>createHash('sha256').update(s).digest('hex')
  const owner=digest(userInfo().username+'\0'+homedir()),trust=digest(hostname()+'\0'+home)
  const storage=new StorageWorker(join(home,'memory',config.memoryProfileId),owner,trust,config.memoryProfileId)
  let storageAvailable=true
  try {await storage.ready}catch{storageAvailable=false;ctx.logger.warn('dsh-memory: STORAGE_UNAVAILABLE; foreground continues without memory')}
  const projects=new Map<string,Promise<Project>>()
  const excluded=new Set<string>()
  const captureCursor=new Map<string,number>()
  const captureTasks=new Set<Promise<unknown>>()
  const pending=new Map<string,Evidence>()
  const toolPending=new Map<string,Evidence>()
  const attemptedTurns=new Map<string,number>()
  let stopped=false,policyReady:Promise<unknown>=Promise.resolve()
  const projectFor=(session:Session):Promise<Project>=>{
    const cwd=session.header.cwd
    if(!cwd)return Promise.reject(new Error('PROJECT_UNAVAILABLE'))
    let result=projects.get(cwd)
    if(!result){result=realpath(cwd).then(root=>storage.call<Project>('project',{root:process.platform==='win32'?root.toLowerCase():root,target:trust,name:basename(root)}));projects.set(cwd,result)}
    return result
  }
  const engine=new MemoryEngine(storage,{
    consent:()=>config.consent.get(),route:()=>({provider:config.provider.get(),model:config.model.get()}),
    idleMs:()=>config.idleMinutes.get()*60000,intervalMs:()=>config.consolidationMinutes.get()*60000,
    dailyLimit:()=>config.dailyTokens.get(),outputLimit:()=>config.outputTokens.get(),
    foregroundBusy:()=>ctx.agents.list().some(agent=>agent.status==='running'),
    readSource:async(source,signal)=>{
      const live=ctx.sessions.get(SessionId(source.sessionId))
      if(live)await ctx.sessions.flush(live)
      const handle=await ctx.sessionPersistence.open(SessionId(source.sessionId),'read',{signal})
      try {const {events}=await handle.read(source.start,source.end-source.start+1,{signal});if(events.at(-1)?.seq!==source.end)throw new Error('SOURCE_NOT_FLUSHED');return transcript(events)}finally{await handle.close()}
    },
    model:async(prompt,maxTokens,signal)=>{
      const route={provider:config.provider.get(),model:config.model.get()}
      const prepared=await ctx.llm.prepareCall({...route,maxTokens},signal)
      let text='',usage:number|null=null,failed=false
      for await(const chunk of prepared.stream({...prepared.config,messages:[{role:'user',content:[{type:'text',text:prompt}]}],signal})){
        if(chunk.type==='text-delta')text+=chunk.text
        if(text.length>20000)throw new Error('OUTPUT_TOO_LARGE')
        if(chunk.type==='usage')usage=chunk.usage.totalTokens??chunk.usage.inputTokens+chunk.usage.outputTokens+(chunk.usage.cacheReadTokens??0)+(chunk.usage.cacheWriteTokens??0)
        if(chunk.type==='finish'&&['error','aborted'].includes(chunk.reason.kind))failed=true
      }
      return {text:failed?'MODEL_FAILURE':redact(text),usage}
    },
  })
  function policy():void {
    engine.cancel()
    policyReady=policyReady.then(()=>storage.call('policy',{global:{use:config.globalUse.get(),generate:config.globalGenerate.get()&&config.consent.get()},projects:{use:config.projectUse.get(),generate:config.projectGenerate.get()&&config.consent.get()}})).catch(()=>{storageAvailable=false})
  }
  policy();await policyReady
  ctx.on('loader/volatile-update',policy)
  async function capture(session:Session,end:number):Promise<void> {
    if(stopped || excluded.has(session.id) || session.header.origin==='subagent')return
    const start=Math.max(captureCursor.get(session.id)??session.firstLiveSeq,end-511)
    captureCursor.set(session.id,end+1)
    if(start>end)return
    const events:SessionEvent[]=[]
    for(let seq=start;seq<=end;seq++){const event=session.eventAt(SessionSeq(seq));if(event)events.push(event)}
    const text=transcript(events);if(text==='[]')return
    const project=await projectFor(session)
    const source:Source={id:digest(`${session.id}:${start}:${end}`),sessionId:session.id,project:project.id,start,end,hash:digest(text),updatedAt:Date.now(),excluded:false}
    await engine.capture(source)
  }
  const scheduleCapture=(session:Session,end:number):void=>{
    const task=capture(session,end).catch(()=>{engine.lastError='CAPTURE_UNAVAILABLE'}).finally(()=>captureTasks.delete(task));captureTasks.add(task)
  }
  ctx.on('session/created',session=>{
    captureCursor.set(session.id,session.firstLiveSeq)
    if(session.header.cwd)void projectFor(session).catch(()=>{})
    void engine.tick()
  })
  ctx.on('session/event',(session,event)=>{
    if(event.type==='assistant/message'&&event.data.usage){const usage=event.data.usage;void engine.credit(`${session.id}:${event.seq}`,usage.totalTokens??usage.inputTokens+usage.outputTokens+(usage.cacheReadTokens??0)+(usage.cacheWriteTokens??0)).catch(()=>{})}
    if(event.type==='user/message'&&event.data.source.kind==='dsh-memory'){
      const evidence=pending.get(event.data.source.reservation)
      if(evidence){pending.delete(evidence.id);void engine.settle(evidence.id,`${session.id}:${event.seq}`).catch(()=>{})}
    }
    if(event.type==='tool/result'){
      const evidence=toolPending.get(event.data.message.toolCallId)
      if(evidence){toolPending.delete(event.data.message.toolCallId);if(event.data.message.isError)void engine.release(evidence.id);else void engine.settle(evidence.id,`${session.id}:${event.seq}`).catch(()=>{})}
    }
    if(event.type==='turn/end'){
      scheduleCapture(session,event.seq)
      for(const [id,evidence]of pending)if(evidence.session===session.id){pending.delete(id);void engine.release(evidence.id)}
    }
  })
  const isWritable=():boolean=>ctx.get('webServer')?.host==='127.0.0.1' && !!ctx.get('configEditor')
  const operation=async(request:ManageRequest,signal:AbortSignal):Promise<ManageResult>=>{
    const reads=['overview','list','read','files','file','job','sources']
    if(!reads.includes(request.action)&&!isWritable())throw new Error('READ_ONLY_CONNECTION')
    await policyReady
    const scopes=['global']
    if(!isWritable()&&request.sessionId){const session=ctx.sessions.get(SessionId(request.sessionId));if(session&&!session.header.origin)scopes.push((await projectFor(session)).id)}
    if(!isWritable() && request.scope && !scopes.includes(request.scope))throw new Error('SCOPE_DENIED')
    if(request.action==='clear'){await Promise.allSettled([...captureTasks]);for(const session of ctx.sessions.list())scheduleCapture(session,Number(session.seq)-1);await Promise.allSettled([...captureTasks]);engine.cancel()}
    const {action,...args}=request
    let result=await storage.call(action,args,signal)
    if(action==='overview'){
      const value=result as {projects:Project[];scopes:{id:string}[];jobs:{scope:string}[];evidence:{session:string}[];root:string}
      if(!isWritable()){value.projects=value.projects.filter(p=>scopes.includes(p.id));value.scopes=value.scopes.filter(s=>scopes.includes(s.id));value.jobs=value.jobs.filter(j=>scopes.includes(j.scope));value.evidence=value.evidence.filter(e=>e.session===request.sessionId);value.root=''}
      result={...value,writable:isWritable(),revealStore:false,route:{provider:config.provider.get(),model:config.model.get()},consent:config.consent.get(),lastError:engine.lastError,staticCost:engine.staticCost,storageAvailable}
    }
    if(!isWritable()&&action==='read'&&!scopes.includes((result as MemoryItem).scope))throw new Error('SCOPE_DENIED')
    if(!isWritable()&&action==='job'&&result&&!scopes.includes((result as {scope:string}).scope))throw new Error('SCOPE_DENIED')
    return {json:JSON.stringify(result)}
  }
  new MemoryRemote(ctx,operation)
  async function withdraw(agent:Agent,signal:AbortSignal):Promise<void> {
    const overview=await storage.call<{scopes:{id:string;epoch:number;use:boolean}[]}>('overview',{},signal)
    const enabled=new Map(overview.scopes.map(s=>[s.id,s]))
    const sessionAllowed=await storage.call<boolean>('sessionAllowed',{session:agent.id},signal)
    const nodes=[...agent.session.surface.nodes]
    for(const seq of nodes){
      const event=agent.session.eventAt(seq)
      if(event?.type==='tool/result'&&event.data.message.content.some(b=>b.type==='text'&&['先前的记忆工具结果已失效。','先前记忆暂时不可核对。'].includes(b.text)))continue
      const source=event?.type==='user/message'&&event.data.source.kind==='dsh-memory'?event.data.source:event?.type==='tool/result'?z.object({memoryEvidence:evidenceMetadata}).safeParse(event.data.meta).data?.memoryEvidence:undefined
      if(source){
        let invalid=!sessionAllowed||Object.entries(source.epochs).some(([scope,epoch])=>!enabled.get(scope)?.use||enabled.get(scope)?.epoch!==epoch)
        for(const item of source.items){try{const live=await storage.call<MemoryItem>('read',{id:item.id},signal);invalid ||= live.revision!==item.revision}catch{signal.throwIfAborted();invalid=true}}
        signal.throwIfAborted()
        if(invalid&&event?.type==='user/message'){const notice=createUserMessage({content:[{type:'text',text:'先前的直接记忆证据已失效。'}],source:{kind:'dsh-memory-invalidated',form:'notice',summary:'记忆证据已失效'}});agent.session.append('user/message',notice,{surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]})}
        if(invalid&&event?.type==='tool/result')agent.session.append('tool/result',{...event.data,message:{...event.data.message,content:[{type:'text',text:'先前的记忆工具结果已失效。'}]}},{surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]})
      }
    }
  }
  function withdrawUnavailable(agent:Agent):void {
    for(const seq of [...agent.session.surface.nodes]){
      const event=agent.session.eventAt(seq)
      if(event?.type==='tool/result'&&event.data.message.content.some(b=>b.type==='text'&&['先前的记忆工具结果已失效。','先前记忆暂时不可核对。'].includes(b.text)))continue
      if(event?.type==='user/message'&&event.data.source.kind==='dsh-memory')agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'先前记忆暂时不可核对。'}],source:{kind:'dsh-memory-invalidated',form:'notice',summary:'记忆证据不可核对'}}),{surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]})
      if(event?.type==='tool/result'&&z.object({memoryEvidence:evidenceMetadata}).safeParse(event.data.meta).success)agent.session.append('tool/result',{...event.data,message:{...event.data.message,content:[{type:'text',text:'先前记忆暂时不可核对。'}]}},{surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]})
    }
  }
  ctx.on('agent/pre-step',async(payload,next)=>{
    const decision=await next()
    if(decision.kind!=='enter'||payload.agent.session.header.origin==='subagent')return decision
    const alreadyAttempted=attemptedTurns.get(payload.agent.id)===payload.turn
    attemptedTurns.set(payload.agent.id,payload.turn)
    const evidence=await withinDeadline(payload.signal,async signal=>{
      await policyReady;signal.throwIfAborted();await withdraw(payload.agent,signal)
      if(alreadyAttempted)return null
      const query=decision.messages.filter(m=>m.source.kind==='user').map(m=>typeof m.content==='string'?m.content:m.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')).join('\n')
      if(!query||excluded.has(payload.agent.id))return null
      const project=await projectFor(payload.agent.session)
      signal.throwIfAborted()
      return engine.recall(payload.agent.id,project.id,query,payload.turn,signal)
    },late=>{if(late)void engine.release(late.id)},()=>withdrawUnavailable(payload.agent))
    if(evidence&&!payload.signal.aborted){
      pending.set(evidence.id,evidence)
      const message:UserMessage=createUserMessage({content:[{type:'text',text:evidence.text}],source:{kind:'dsh-memory',form:'recall',reservation:evidence.id,epochs:evidence.epochs,items:evidence.records.map(i=>({id:i.id,revision:i.revision,scope:i.scope}))}})
      return {...decision,messages:[...decision.messages,message]}
    }
    return decision
  })
  ctx.systemPrompt.section({name:'dsh-memory-policy',order:90,text:POLICY,interpolate:false})
  ctx.tools.register({...MEMORY_TOOL,output:{schema:{type:'object',properties:{text:{type:'string'},evidence:{type:'object',additionalProperties:true}},required:['text'],additionalProperties:false},presentationMeta:(_args,value)=>({memoryEvidence:z.object({evidence:evidenceMetadata.optional()}).parse(value).evidence??{epochs:{},items:[]}}),render:(_args,value)=>[{type:'text',text:z.object({text:z.string()}).parse(value).text}]},execute:async(args,exec)=>{
    const input=z.object({action:z.enum(['search','read']),query:z.string().max(1000).optional(),id:z.string().optional()}).strict().parse(args)
    if(!exec.agent||exec.rootCallId!==exec.callId||excluded.has(exec.agent.id)||exec.agent.session.header.origin==='subagent')return {text:''}
    try {await policyReady;const project=await projectFor(exec.agent.session);const evidence=await engine.retrieve(exec.agent.id,project.id,input.query??'',input.action==='read'?input.id:undefined,exec.signal);if(!evidence)return {text:''};toolPending.set(exec.callId,evidence);return {text:evidence.text,evidence:{epochs:evidence.epochs,items:evidence.records.map(i=>({id:i.id,revision:i.revision,scope:i.scope}))}}}catch{return {text:''}}
  }})
  ctx.commands.register({name:'memory',description:'管理记忆；note 保存人工记忆；off 停止本会话读取与贡献。',recordInput:false,input:{hint:'note <文本> / off'},handler:async({agent,rawInput,signal})=>{
    const text=rawInput.trim()
    if(text==='off'){excluded.add(agent.id);await storage.call('sessionOff',{session:agent.id},signal);engine.cancel();return {kind:'success',text:'本会话已停止读取和贡献记忆。关闭不抹除历史对话；严格隔离请新建会话。'}}
    if(text.startsWith('note ')){if(!isWritable())return {kind:'error',text:'当前连接只读。'};const project=await projectFor(agent.session);await storage.call('save',{scope:project.id,title:text.slice(5,85),content:text.slice(5)},signal);return {kind:'success',text:'人工记忆已保存。'}}
    return {kind:'success',text:'请打开 设置 → 记忆 查看和管理长期记忆。'}
  }})
  const timer=setInterval(()=>{void engine.tick()},30000);timer.unref()
  ctx.effect(()=>async()=>{stopped=true;clearInterval(timer);engine.cancel();await Promise.allSettled([...captureTasks]);for(const evidence of pending.values())await engine.release(evidence.id);for(const evidence of toolPending.values())await engine.release(evidence.id);await engine.close()},'dsh-memory: tasks and SQLite Worker')
}


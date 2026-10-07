import type { Context } from '@deepseek-ai/cordis'
import { createHash, randomUUID } from 'node:crypto'
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
import type {} from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import { Config } from './config.ts'
import { MemoryEngine, ModelCallError, withinDeadline, POLICY, MEMORY_TOOL, type Evidence } from './engine.ts'
import { StorageWorker } from './storage/worker-client.ts'
import { MemoryRemote } from './remote-service.ts'
import { redact } from './shared.ts'
import { resolveMemoryRoute } from './model-route.ts'
import { WeKnoraClient } from './weknora/client.ts'
import { KnowledgeService, type KnowledgePort, type KnowledgeLimits, type ResolvedConnection } from './retrieval/evidence.ts'
import { SyncRunner, type OutboxPort, type LoginAccess, operationMarker } from './publication/sync-outbox.ts'
import { renderCard, versionDiff, previewKey } from './publication/render.ts'
import type { Source, Project, MemoryItem, ManageRequest, ManageResult, WeKnoraConnection, ConnectionSettings, ProjectBinding, ExternalEvidence, RemoteRef, Publication, OutboxOperation, RemoteTombstone, ApprovedSnapshot } from './contracts.ts'
const evidenceMetadata=z.object({epochs:z.record(z.string(),z.number()),items:z.array(z.object({id:z.string(),scope:z.string(),revision:z.number()}))})
const knowledgeMetadata=z.object({slotId:z.string(),generation:z.number(),refs:z.array(z.object({knowledgeId:z.string(),chunkId:z.string(),title:z.string(),bodyHash:z.string()}))})
export { Config } from './config.ts'
export { MemoryRemote } from './remote-service.ts'
export type { ManageRequest, ManageResult } from './contracts.ts'
export const name='dsh-memory'
export const inject=['sessions','sessionPersistence','agents','systemPrompt','tools','commands','llm']
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
  /** 已解析的项目身份，供发布预览等非会话路径使用。 */
  const projectsById=new Map<string,Project>()
  const excluded=new Set<string>()
  const captureCursor=new Map<string,number>()
  const captureTasks=new Set<Promise<unknown>>()
  const pending=new Map<string,Evidence>()
  const toolPending=new Map<string,Evidence>()
  /** 已提交的知识工具结果：按 toolCallId 记录槽位，供同轮替换与失效撤回使用。 */
  const toolSlots=new Map<string,{slotId:string;generation:number;refs:RemoteRef[]}>()
  const attemptedTurns=new Map<string,number>()
  const retiredTurns=new Map<string,number>()
  let stopped=false,policyKey='',policyReady:Promise<unknown>=Promise.resolve()
  /**
   * 凭据只在 Host 解析，且每次操作重新解析：页面与日志都不接触密钥正文，
   * 轮换后下一个操作即生效，不需要重启插件。
   */
  const credentialValue=async(ref:string):Promise<string>=>{
    if(!ref)throw new Error('NOT_CONFIGURED')
    const credentials=ctx.get('credentials')
    if(!credentials)throw new Error('NOT_CONFIGURED')
    const resolved=await credentials.resolve(credentialRef(ref))
    if(!resolved?.value)throw new Error('NOT_CONFIGURED')
    return resolved.value
  }
  const connectionSnapshot=async(connectionId:string,kind:'read'|'publish'):Promise<ResolvedConnection>=>{
    const connection=await storage.call<WeKnoraConnection&ConnectionSettings>('connection',{connectionId},undefined)
    const ref=kind==='read'?connection.readCredentialRef:connection.publishCredentialRef
    return {connection,apiKey:await credentialValue(ref)}
  }
  const clientFor=(access:ResolvedConnection,deadlineMs:number):WeKnoraClient=>new WeKnoraClient({
    baseUrl:access.connection.baseUrl,apiKey:access.apiKey,tenantId:access.connection.tenantId||undefined,deadlineMs,
  })
  /** 每次工具调用读取一次配置快照；运行时不再维护第二份可编辑配置。 */
  const knowledgeLimits=():KnowledgeLimits=>({
    matchCount:config.matchCount.get(),vectorThreshold:config.vectorThreshold.get(),
    keywordThreshold:config.keywordThreshold.get(),requestDeadlineMs:config.requestDeadlineMs.get(),
    remoteEvidenceBytes:config.remoteEvidenceBytes.get(),retiredReferenceBytes:config.retiredReferenceBytes.get(),
    maxKnowledgeCallsPerTurn:config.maxKnowledgeCallsPerTurn.get(),
  })
  const knowledgePort:KnowledgePort={
    readAccess:id=>connectionSnapshot(id,'read'),
    publishAccess:id=>connectionSnapshot(id,'publish'),
    binding:projectId=>storage.call<ProjectBinding>('binding',{projectId}),
    reserveSlot:(session,userTurn,toolCallId,createdSeq,connectionId,kbIds,toolName,bindingRevision)=>storage.call<ExternalEvidence>('reserveSlot',{session,userTurn,toolCallId,createdSeq,connectionId,kbIds,toolName,bindingRevision}),
    slotCheck:(slotId,projectId)=>storage.call<{ok:boolean;code:string}>('slotCheck',{slotId,projectId}),
    activateSlot:(slotId,resultSeq,contentBytes,refs)=>storage.call<{slot:ExternalEvidence;replaced:string}>('activateSlot',{slotId,resultSeq,contentBytes,refs}),
    releaseSlot:async(slotId,reason)=>{await storage.call('retireSlot',{slotId,content:`[未提交：${reason}]`,limit:config.retiredReferenceBytes.get()}).catch(()=>{})},
    retireSlot:(slotId,content,limit)=>storage.call('retireSlot',{slotId,content,limit}).then(()=>undefined),
    activeSlot:session=>storage.call<ExternalEvidence|null>('activeSlot',{session}),
    markSlotBuild:async(slotId,build)=>{await storage.call('slotPatch',{slotId,build})},
    slot:slotId=>storage.call<ExternalEvidence|null>('slot',{slotId}),
  }
  const knowledge=new KnowledgeService(knowledgePort,clientFor)
  const outboxPort:OutboxPort={
    pending:()=>storage.call<OutboxOperation[]>('outboxPending',{}),
    publication:publishId=>storage.call<Publication|null>('publication',{publishId}),
    savePublication:async publication=>{
      await storage.call('publicationUpsert',{publication})
      return publication
    },
    updateOperation:(operationId,patch)=>storage.call<OutboxOperation>('outboxUpdate',{operationId,...patch}),
    access:(connectionId)=>connectionSnapshot(connectionId,'publish').then(access=>({apiKey:access.apiKey,tenantId:access.connection.tenantId,baseUrl:access.connection.baseUrl})),
    client:(access:LoginAccess,deadlineMs)=>new WeKnoraClient({baseUrl:access.baseUrl,apiKey:access.apiKey,tenantId:access.tenantId||undefined,deadlineMs}),
    tombstonePending:()=>storage.call<RemoteTombstone[]>('tombstonePending',{}),
    updateTombstone:(tombstone,state,attempts)=>storage.call<RemoteTombstone>('tombstoneUpdate',{connectionId:tombstone.connectionId,kbId:tombstone.kbId,remoteId:tombstone.remoteId,publishId:tombstone.publishId,state,attempts}),
    isBlocked:async(memoryId,publishId)=>{
      const tombstone=await storage.call<RemoteTombstone|null>('tombstoneFor',{memoryId,publishId})
      return !!tombstone
    },
    settings:async connectionId=>{const connection=await storage.call<WeKnoraConnection&ConnectionSettings>('connection',{connectionId});return {requestDeadlineMs:connection.requestDeadlineMs}},
  }
  const sync=new SyncRunner(outboxPort)
  let syncTask:Promise<unknown>|undefined
  /** 后台同步只在发布开关开启且无前台活动时启动；不阻塞任何 awaited 生命周期。 */
  const startSync=():void=>{
    if(syncTask||stopped||!config.knowledgePublish.get()||!config.consent.get())return
    if(ctx.agents.list().some(agent=>agent.status==='running'))return
    const controller=new AbortController()
    syncTask=sync.run(controller.signal).catch(()=>undefined).finally(()=>{syncTask=undefined})
  }
  const projectFor=(session:Session):Promise<Project>=>{
    const cwd=session.header.cwd
    if(!cwd)return Promise.reject(new Error('PROJECT_UNAVAILABLE'))
    let result=projects.get(cwd)
    if(!result){result=realpath(cwd).then(root=>storage.call<Project>('project',{root:process.platform==='win32'?root.toLowerCase():root,target:trust,name:basename(root)})).then(project=>{projectsById.set(project.id,project);return project});projects.set(cwd,result)}
    return result
  }
  const resolveRoute=()=>resolveMemoryRoute(ctx.llm,{provider:config.provider.get(),model:config.model.get()},async()=>{
    const credentials=ctx.get('credentials'),settings=ctx.get('settings')
    const provider=ctx.llm.listConfigurableProviders().find(p=>p.provider==='deepseek-official')
    let profile:unknown=provider?settings?.describe({redactSecrets:true}).find(s=>s.ns===provider.settingsNs)?.value:undefined
    for(const key of provider?.settingsPath??[])profile=typeof profile==='object'&&profile!==null?Reflect.get(profile,key):undefined
    const ref=typeof profile==='object'&&profile!==null?Reflect.get(profile,'apiKeyEnv'):undefined
    if(!credentials||typeof ref!=='string')return false
    return (await credentials.describe(credentialRef(ref))).configured
  })
  const engine=new MemoryEngine(storage,{
    consent:()=>config.consent.get(),route:resolveRoute,
    idleMs:()=>config.idleMinutes.get()*60000,intervalMs:()=>config.consolidationMinutes.get()*60000,
    outputLimit:()=>config.outputTokens.get(),
    foregroundBusy:()=>ctx.agents.list().some(agent=>agent.status==='running'),
    routeAllowed:route=>(!config.provider.get()&&!config.model.get())||(config.provider.get()===route.provider&&config.model.get()===route.model),
    readSource:async(source,signal)=>{
      const live=ctx.sessions.get(SessionId(source.sessionId))
      if(live)await ctx.sessions.flush(live)
      const handle=await ctx.sessionPersistence.open(SessionId(source.sessionId),'read',{signal})
      try {const {events}=await handle.read(source.start,source.end-source.start+1,{signal});if(events.at(-1)?.seq!==source.end)throw new Error('SOURCE_NOT_FLUSHED');return transcript(events)}finally{await handle.close()}
    },
    model:async(prompt,maxTokens,signal,route)=>{
      // 旧路由已失效时，默认选择只用于展示；须重新保存并确认后才能发送。
      const stored={provider:config.provider.get(),model:config.model.get()}
      if((stored.provider||stored.model)&&(stored.provider!==route.provider||stored.model!==route.model))throw new Error('ROUTE_CONFIRMATION_REQUIRED')
      // 后台结构化任务只选择路由明确声明的off；不改变前台或假定其他模型支持它。
      const modelInfo=await ctx.llm.resolveModelInfo(route.provider,route.model,signal)
      const off=modelInfo.reasoning?.efforts.find(effort=>effort.id==='off')?.id
      const prepared=await ctx.llm.prepareCall({...route,maxTokens,...(off?{reasoningEffort:off}:{})},signal)
      let text='',usage:number|null=null,finish:string|undefined
      try {for await(const chunk of prepared.stream({...prepared.config,messages:[{role:'user',content:[{type:'text',text:prompt}]}],signal})){
        if(chunk.type==='text-delta')text+=chunk.text
        if(text.length>20000)throw new Error('OUTPUT_TOO_LARGE')
        if(chunk.type==='usage')usage=chunk.usage.totalTokens??chunk.usage.inputTokens+chunk.usage.outputTokens+(chunk.usage.cacheReadTokens??0)+(chunk.usage.cacheWriteTokens??0)
        if(chunk.type==='finish')finish=['stop','max-tokens','error','aborted','tool-calls'].includes(chunk.reason.kind)?chunk.reason.kind:'other'
      }
      }catch(error){throw new ModelCallError(usage,finish,error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'MODEL_CALL_FAILURE')}
      return {text:redact(text),usage,finish}
    },
  })
  function policy():void {
    const nextKey=JSON.stringify([config.globalUse.get(),config.globalGenerate.get(),config.projectUse.get(),config.projectGenerate.get(),config.consent.get(),config.provider.get(),config.model.get(),config.knowledgeRead.get(),config.knowledgePublish.get()])
    if(nextKey===policyKey)return
    const previousRead=policyKey?JSON.parse(policyKey)[7]:false
    policyKey=nextKey
    engine.cancel()
    policyReady=policyReady.then(()=>storage.call('policy',{global:{use:config.globalUse.get(),generate:config.globalGenerate.get()&&config.consent.get()},projects:{use:config.projectUse.get(),generate:config.projectGenerate.get()&&config.consent.get()}})).catch(()=>{storageAvailable=false})
    // 关闭知识检索属于即时失效：在下一次模型请求前撤下相关正文。
    if(previousRead&&!config.knowledgeRead.get()){
      for(const session of ctx.sessions.list())void knowledge.invalidate(session.id,'读取已关闭',config.retiredReferenceBytes.get()).catch(()=>{})
    }
    if(config.knowledgePublish.get()&&config.consent.get())startSync()
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
  /** 项目绑定的发布库必须同时出现在只读列表中，否则拒绝保存。 */
  const bindingView=(binding:ProjectBinding)=>binding
  /** 发布预览：绑定 memoryId、源 revision、目标库与最终发布正文 hash。 */
  const buildPreview=async(memoryId:string)=>{
    const item=await storage.call<MemoryItem>('read',{id:memoryId})
    if(item.status==='expired')throw new Error('NOT_FOUND')
    const binding=await storage.call<ProjectBinding|null>('bindingOrNull',{projectId:item.scope})
    if(!binding?.publishKbId)throw new Error('BINDING_MISSING')
    const project=projectsById.get(item.scope)
    const existing=await storage.call<Publication|null>('publicationForMemory',{memoryId})
    const publishId=existing?.publishId??randomUUID()
    const approvedAt=Date.now()
    const card=renderCard({item,project:project?{name:project.name,root:project.root}:undefined,approvedAt})
    const key=previewKey({memoryId,sourceRevision:item.revision,bodyHash:card.bodyHash,targetKbId:binding.publishKbId})
    const preview={previewId:randomUUID(),memoryId,publishId,bodyHash:card.bodyHash,body:card.body,title:card.title,
      sourceRevision:item.revision,sourceHash:item.sources.length?`sources:${item.sources.length}`:'manual',
      targetKbId:binding.publishKbId,connectionId:binding.connectionId,approvedAt}
    await storage.call('previewStore',{preview})
    return {...preview,previewKey:key,marker:operationMarker(publishId),publishMarker:card.marker,
      targetTitle:binding.publishKbId,existing:existing?{state:existing.state,remoteId:existing.remoteId}:null}
  }
  /** 发布记录视图：已发布版本与待复核候选分别显示，不用单一状态覆盖两者。 */
  const publicationView=(publication:Publication)=>({
    ...publication,
    approvedHash:publication.approved?.bodyHash??'',
    diff:versionDiff(
      publication.publishedSourceRevision?{sourceRevision:publication.publishedSourceRevision,bodyHash:publication.publishedBodyHash}:null,
      {sourceRevision:publication.candidateSourceRevision,bodyHash:publication.candidateBodyHash},
    ),
  })
  const operation=async(request:ManageRequest,signal:AbortSignal):Promise<ManageResult>=>{
    const reads=['overview','providers','models','list','read','files','file','job','sources','connections','knowledgeBases','binding','publications','preview']
    if(!reads.includes(request.action)&&!isWritable())throw new Error('READ_ONLY_CONNECTION')
    await policyReady
    if(request.action==='providers')return {json:JSON.stringify(ctx.llm.listProviders().map(({id,name})=>({id,name})))}
    /* ── WeKnora 连接与项目绑定 ───────────────────────────────────── */
    if(request.action==='connections')return {json:JSON.stringify(await storage.call('connections',{},signal))}
    if(request.action==='knowledgeBases'){
      if(!request.connection)throw new Error('NOT_CONFIGURED')
      try {
        const access=await connectionSnapshot(request.connection.connectionId,'read')
        const probe=await clientFor(access,config.requestDeadlineMs.get()).probe(signal)
        return {json:JSON.stringify({ok:true,code:'OK',message:'',bases:probe.knowledgeBases.map(base=>({id:base.id,name:base.name,type:base.type})),version:probe.version})}
      } catch(error){
        // 失败必须回传可诊断代码，不能显示为空列表。
        const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'UPSTREAM'
        return {json:JSON.stringify({ok:false,code,message:`知识库列表读取失败：${code}`,bases:[],version:null})}
      }
    }
    if(request.action==='binding'){
      const scope=request.scope??''
      if(!scope)throw new Error('SCOPE_DENIED')
      return {json:JSON.stringify(await storage.call('bindingOrNull',{projectId:scope},signal))}
    }
    if(request.action==='publications'){
      const list=await storage.call<Publication[]>('publications',{},signal)
      const filtered=request.scope?list.filter(item=>item.scope===request.scope):list
      const outbox=await storage.call<OutboxOperation[]>('outbox',{},signal)
      const tombstones=await storage.call<RemoteTombstone[]>('tombstones',{},signal)
      return {json:JSON.stringify({
        publications:filtered.map(publication=>{
          // 队列错误与发布记录一起返回，页面无需再取一次。
          const operations=outbox.filter(op=>op.publishId===publication.publishId).sort((a,b)=>b.attempts-a.attempts)
          const latest=operations[0]
          return {...publicationView(publication),lastErrorCode:latest?.lastErrorCode??'',attempts:latest?.attempts??0,outboxState:latest?.state??''}
        }),
        outbox:outbox.filter(op=>filtered.some(item=>item.publishId===op.publishId)),
        tombstones:tombstones.filter(item=>filtered.some(pub=>pub.publishId===item.publishId)),
      })}
    }
    if(request.action==='preview'){
      if(!request.id)throw new Error('NOT_FOUND')
      return {json:JSON.stringify(await buildPreview(request.id))}
    }
    if(request.action==='models'){
      if(!ctx.llm.listProviders().some(p=>p.id===request.provider))throw new Error('PROVIDER_UNAVAILABLE')
      const models=await ctx.llm.listModels(request.provider!)
      signal.throwIfAborted()
      return {json:JSON.stringify(models.map(({id,name})=>({id,name})))}
    }
    const scopes=['global']
    if(!isWritable()&&request.sessionId){const session=ctx.sessions.get(SessionId(request.sessionId));if(session&&!session.header.origin)scopes.push((await projectFor(session)).id)}
    if(!isWritable() && request.scope && !scopes.includes(request.scope))throw new Error('SCOPE_DENIED')
    if(request.action==='clear'){await Promise.allSettled([...captureTasks]);for(const session of ctx.sessions.list())scheduleCapture(session,Number(session.seq)-1);await Promise.allSettled([...captureTasks]);engine.cancel()}
    /* ── 连接、绑定与发布的写操作 ─────────────────────────────────── */
    if(request.action==='connection'){
      if(!request.connection)throw new Error('BAD_REQUEST')
      return {json:JSON.stringify(await storage.call('saveConnection',{connection:request.connection},signal))}
    }
    if(request.action==='knowRemove'){
      if(!request.connection)throw new Error('BAD_REQUEST')
      // 删除连接前先撤回该连接上所有活动证据，避免留下无法核对的正文。
      for(const session of ctx.sessions.list())await knowledge.invalidate(session.id,'连接已删除',config.retiredReferenceBytes.get()).catch(()=>{})
      return {json:JSON.stringify(await storage.call('removeConnection',{connectionId:request.connection.connectionId},signal))}
    }
    if(request.action==='knowToggle'){
      if(!request.connection)throw new Error('BAD_REQUEST')
      const connection=await storage.call<WeKnoraConnection>('connection',{connectionId:request.connection.connectionId},signal)
      const wantRead=typeof request.use==='boolean'?request.use:connection.readEnabled
      const wantPublish=typeof request.generate==='boolean'?request.generate:connection.publishEnabled
      const toggled=await storage.call<WeKnoraConnection>('toggleConnection',{connectionId:request.connection.connectionId,readEnabled:wantRead,publishEnabled:wantPublish},signal)
      // 关闭读取属于即时失效：在下一次模型请求前撤下相关正文。
      if(connection.readEnabled&&!wantRead)for(const session of ctx.sessions.list())await knowledge.invalidate(session.id,'连接读取已关闭',config.retiredReferenceBytes.get()).catch(()=>{})
      if(wantPublish)startSync()
      return {json:JSON.stringify(toggled)}
    }
    if(request.action==='knowSave'){
      const scope=request.scope??''
      if(!scope||!request.binding)throw new Error('BAD_REQUEST')
      return {json:JSON.stringify(bindingView(await storage.call<ProjectBinding>('setBinding',{projectId:scope,binding:request.binding},signal)))}
    }
    if(request.action==='publishConfirm'){
      if(!request.previewId)throw new Error('NOT_FOUND')
      const preview=await storage.call<{previewId:string;memoryId:string;publishId:string;bodyHash:string;body:string;title:string;sourceRevision:number;sourceHash:string;targetKbId:string;connectionId:string;approvedAt:number}|null>('preview',{previewId:request.previewId},signal)
      if(!preview)throw new Error('NOT_FOUND')
      const result=await storage.call<{publication:Publication;operation:OutboxOperation}>('confirmPreview',{preview},signal)
      return {json:JSON.stringify(publicationView(result.publication))}
    }
    if(request.action==='withdrawRecall'){
      // 页面传 publishId；本地经验不被删除，只撤回共享副本。
      if(!request.id)throw new Error('NOT_FOUND')
      const publication=await storage.call<Publication|null>('publication',{publishId:request.id},signal)
      if(!publication)throw new Error('NOT_FOUND')
      await storage.call('publicationUpsert',{publication:{...publication,state:'withdraw_queued',approved:null}},signal)
      const tombstone=await storage.call<RemoteTombstone>('tombstoneAdd',{tombstone:{connectionId:publication.connectionId,kbId:publication.targetKbId,remoteId:publication.remoteId,publishId:publication.publishId,memoryId:publication.memoryId,sourceEpoch:0}},signal)
      // 撤回同时撤下本机活动证据，删除期间本机不重生。
      for(const session of ctx.sessions.list())await knowledge.invalidate(session.id,'发布已撤回',config.retiredReferenceBytes.get()).catch(()=>{})
      if(config.knowledgePublish.get())startSync()
      return {json:JSON.stringify({queued:tombstone.state!=='done',tombstone})}
    }
    if(request.action==='syncNow'){
      const controller=new AbortController()
      const result=await sync.run(controller.signal)
      return {json:JSON.stringify(result)}
    }
    const {action,...args}=request
    let result=await storage.call(action,action==='overview'?{...args,...(!isWritable()?{usageScopes:scopes}:{})}:args,signal)
    if(action==='overview'){
      const value=result as {projects:Project[];scopes:{id:string}[];jobs:{scope:string}[];evidence:{session:string}[];root:string}
      if(!isWritable()){value.projects=value.projects.filter(p=>scopes.includes(p.id));value.scopes=value.scopes.filter(s=>scopes.includes(s.id));value.jobs=value.jobs.filter(j=>scopes.includes(j.scope));value.evidence=value.evidence.filter(e=>e.session===request.sessionId);value.root=''}
      result={...value,writable:isWritable(),revealStore:false,route:await resolveRoute(),consent:config.consent.get(),lastError:engine.lastError,staticCost:engine.staticCost,storageAvailable}
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
      await policyReady;signal.throwIfAborted()
      // 常规到期在下一用户轮入口处理一次，不在每个 agent step 清理。
      const turn=payload.turn
      if(retiredTurns.get(payload.agent.id)!==turn){
        retiredTurns.set(payload.agent.id,turn)
        void knowledge.retireOnNewTurn(payload.agent.id,config.retiredReferenceBytes.get()).catch(()=>{})
        toolSlots.clear()
      }
      await withdraw(payload.agent,signal)
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
  ctx.tools.register({...MEMORY_TOOL,output:{schema:{type:'object',properties:{text:{type:'string'},evidence:{type:'object',additionalProperties:true}},required:['text'],additionalProperties:false},presentationMeta:(_args,value)=>{
      const parsed=z.object({evidence:evidenceMetadata.optional(),knowledgeEvidence:knowledgeMetadata.optional()}).parse(value)
      // JsonValue 不接受 undefined：缺失的键必须整个省略。
      return {...(parsed.evidence?{memoryEvidence:parsed.evidence}:{memoryEvidence:{epochs:{},items:[]}}),...(parsed.knowledgeEvidence?{knowledgeEvidence:parsed.knowledgeEvidence}:{})}
    },render:(_args,value)=>[{type:'text',text:z.object({text:z.string()}).parse(value).text}]},execute:async(args,exec)=>{
    const input=z.object({action:z.enum(['search','read']),source:z.enum(['local','knowledge']).default('local'),query:z.string().max(1000).optional(),id:z.string().optional(),cursor:z.number().int().nonnegative().optional()}).strict().parse(args)
    if(!exec.agent||exec.rootCallId!==exec.callId||excluded.has(exec.agent.id)||exec.agent.session.header.origin==='subagent')return {text:''}
    // 知识来源需要同时满足总开关与连接级读取开关；默认关闭。
    if(input.source==='knowledge'){
      if(!config.knowledgeRead.get())return {text:'知识检索未开启。',knowledgeEvidence:undefined}
      try {
        await policyReady
        const project=await projectFor(exec.agent.session)
        const session=exec.agent.id,userTurn=attemptedTurns.get(session)??0
        const reply=input.action==='read'
          ? await knowledge.read({sessionId:session,projectId:project.id,userTurn,toolCallId:exec.callId,createdSeq:Number(exec.agent.session.seq),knowledgeId:input.id??'',cursor:input.cursor??1,caller:exec.signal},knowledgeLimits())
          : await knowledge.search({sessionId:session,projectId:project.id,userTurn,toolCallId:exec.callId,createdSeq:Number(exec.agent.session.seq),query:input.query??'',caller:exec.signal},knowledgeLimits())
        if(!reply.outcome.ok&&!reply.text)return {text:''}
        toolSlots.set(exec.callId,{slotId:reply.slotId,generation:reply.slotId?1:0,refs:reply.refs})
        return {text:reply.text,knowledgeEvidence:reply.slotId?{slotId:reply.slotId,generation:1,refs:reply.refs.map(ref=>({knowledgeId:ref.knowledgeId,chunkId:ref.chunkId,title:ref.title,bodyHash:ref.bodyHash}))}:undefined}
      } catch { return {text:''} }
    }
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


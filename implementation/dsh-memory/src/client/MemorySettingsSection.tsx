import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConfigView } from './index.ts'
import type { ManageRequest, MemoryItem, Project, Source, Job, DailyUsage, ConnectionInput } from '../contracts.ts'
import { copy as t } from './locales.ts'
export interface PageOperations { form:ConfigForm<ConfigView>;call:(request:ManageRequest)=>Promise<unknown>;subscribe:(notify:()=>void)=>()=>void }
interface Scope {id:string;epoch:number;use:boolean;generate:boolean;count:number;fileCount:number;updatedAt:number}
interface Overview {root:string;profile:string;projects:Project[];scopes:Scope[];writable:boolean;route:{provider:string;model:string};consent:boolean;lastError:string;jobs:Job[];dailyUsage:DailyUsage;evidence:{session:string;settled:number;reserved:number;updatedAt:number}[];staticCost:{policyBytes:number;toolSchemaBytes:number}
  /** 预算以 UTF-8 字节计量；估算 tokens 与供应商实际 usage 另行显示，不混为一谈。 */
  budget?:{localEvidenceBytes:number;remoteEvidenceBytes:number;retiredReferenceBytes:number;maxTotalBytes:number}
  knowledge?:{readEnabled:boolean;publishEnabled:boolean;requestDeadlineMs:number;maxKnowledgeCallsPerTurn:number;matchCount:number}
  consolidationBatch?:{sources:number;bytes:number}
  lastBatch?:{scope:string;pending:number;bytes:number;sources:number}|null}
interface Choice {id:string;name:string}
interface Detail extends MemoryItem {sourceDetails:Source[]}
interface ConnectionView {connectionId:string;baseUrl:string;apiProfile:string;tenantId:string;readCredentialRef:string;publishCredentialRef:string;readEnabled:boolean;publishEnabled:boolean;configRevision:number;maxKnowledgeBases:number;requestDeadlineMs:number;remoteEvidenceBytes:number;retiredReferenceBytes:number;maxKnowledgeCallsPerTurn:number;publishMode:string;useCrossSessionRemoteCache:boolean}
interface BindingView {localProjectId:string;connectionId:string;readKbIds:string[];publishKbId:string;bindingRevision:number;updatedAt:number}
interface PreviewView {previewId:string;memoryId:string;publishId:string;title:string;body:string;bodyHash:string;sourceRevision:number;sourceHash:string;targetKbId:string;connectionId:string;publishMarker:string;targetTitle:string;approvedAt?:number}
interface PublicationView {publishId:string;memoryId:string;scope:string;targetKbId:string;state:string;publishedSourceRevision:number;publishedBodyHash:string;candidateSourceRevision:number;candidateBodyHash:string;remoteId:string;remoteVersion:string;generation:number;error:string;approvedHash:string;diff:'none'|'updated'|'body-changed'|'unpublished';lastErrorCode?:string;attempts?:number}
/** 出站队列条目；state='failed' 才是可手动重试的失败项。 */
interface OutboxView {operationId:string;publishId:string;op:string;state:string;attempts:number;lastErrorCode:string;nextRetryAt:number}
/** Host 的 publications 动作返回三个并列数组，不是一个扁平数组。 */
interface PublicationsResponse {publications:PublicationView[];outbox:OutboxView[];tombstones:unknown[]}
interface BaseChoice {id:string;name:string;type:string}
interface BaseResult {ok:boolean;bases:BaseChoice[];code:string;message:string}
/** 连接编辑草稿；凭据只以引用名传递。 */
const blankConnection:ConnectionInput={connectionId:'',baseUrl:'',apiProfile:'',tenantId:'',readCredentialRef:'',publishCredentialRef:''}
/** Host 已实现但共享契约尚未收录的管理动作；窄化集中在这一处。 */
type ManageCall=ManageRequest
  |{action:'connections'}
  |{action:'connection';connection:ConnectionInput}
  |{action:'binding';scope:string}
  |{action:'knowledgeBases';connection:{connectionId:string}}
  |{action:'knowToggle';connection:{connectionId:string};use:boolean;generate:boolean}
  |{action:'knowRemove';connection:{connectionId:string}}
  |{action:'knowSave';scope:string;binding:{connectionId:string;readKbIds:string[];publishKbId:string}}
/** 双开关、概览与作用域浏览器；写入失败保留草稿。 */
export function MemorySettingsSection({operations:o}:{operations:PageOperations}):React.ReactElement {
  const form=useSyncExternalStore(o.form.subscribe.bind(o.form),o.form.getSnapshot.bind(o.form))
  const [overview,setOverview]=useState<Overview>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [selected,setSelected]=useState<Scope>(),[list,setList]=useState<MemoryItem[]>([]),[detail,setDetail]=useState<Detail>()
  const [hasMore,setHasMore]=useState(false)
  const [title,setTitle]=useState(''),[content,setContent]=useState(''),[fileList,setFileList]=useState<string[]>([]),[fileContent,setFileContent]=useState(''),[path,setPath]=useState('')
  const [clearScope,setClearScope]=useState<Scope>(),[provider,setProvider]=useState(''),[model,setModel]=useState('')
  const [providers,setProviders]=useState<Choice[]>([]),[models,setModels]=useState<Choice[]>([]),[modelsLoading,setModelsLoading]=useState(false)
  const [showEvidence,setShowEvidence]=useState(false),[showJobs,setShowJobs]=useState(false),modelRequest=useRef(0)
  const [connections,setConnections]=useState<ConnectionView[]>([]),[kbResults,setKbResults]=useState<Record<string,BaseResult>>({})
  const [bindScope,setBindScope]=useState(''),[binding,setBinding]=useState<BindingView|null>(),[draftDirty,setDraftDirty]=useState(false)
  const [draft,setDraft]=useState({connectionId:'',readKbIds:[] as string[],publishKbId:''})
  const [connDraft,setConnDraft]=useState<ConnectionInput>(blankConnection),[connEditing,setConnEditing]=useState(false)
  const [publications,setPublications]=useState<PublicationView[]>([]),[queue,setQueue]=useState<OutboxView[]>([]),[preview,setPreview]=useState<PreviewView|null>(),[previewTarget,setPreviewTarget]=useState('')
  const [syncNote,setSyncNote]=useState('')
  const config=form.value,writable=!!overview?.writable&&form.writable
  async function run(action:()=>Promise<void>):Promise<void>{setBusy(true);setError('');try{await action()}catch(e){const message=e instanceof Error?e.message:String(e);setError(message.includes('REVISION_CONFLICT')?t.conflict:message)}finally{setBusy(false)}}
  async function loadModels(id:string,selection=''):Promise<void>{
    const request=++modelRequest.current;setModels([]);setModel(selection);setModelsLoading(true)
    try{const values=id?await o.call({action:'models',provider:id}) as Choice[]:[];if(request===modelRequest.current){setModels(values);setModel(values.some(m=>m.id===selection)?selection:'')}}
    catch(error){if(request===modelRequest.current)throw error}
    finally{if(request===modelRequest.current)setModelsLoading(false)}
  }
  async function load():Promise<void>{const value=await o.call({action:'overview'}) as Overview;setOverview(value);const choices=await o.call({action:'providers'}) as Choice[];setProviders(choices);const id=choices.some(p=>p.id===value.route.provider)?value.route.provider:'';setProvider(id);await loadModels(id,value.route.model);await loadKnow(value.projects)}
  useEffect(()=>{void run(load);return o.subscribe(()=>{setSelected(undefined);void run(load)})},[])
  useEffect(()=>{let disposed=false,polling=false;const timer=setInterval(()=>{if(document.hidden||polling)return;polling=true;void o.call({action:'overview'}).then(value=>{if(!disposed)setOverview(value as Overview)}).catch(()=>{}).finally(()=>{polling=false})},10000);return()=>{disposed=true;clearInterval(timer);modelRequest.current++}},[])
  async function browse(scope:Scope):Promise<void>{setSelected(scope);setDetail(undefined);setContent('');setTitle('');setFileContent('');const first=await o.call({action:'list',scope:scope.id,limit:50}) as MemoryItem[];setList(first);setHasMore(first.length===50);const files=await o.call({action:'files',scope:scope.id}) as {files:string[];path:string};setFileList(files.files);setPath(files.path)}
  async function open(item:MemoryItem):Promise<void>{const value=await o.call({action:'read',id:item.id}) as Detail;setDetail(value);setTitle(value.title);setContent(value.content);setFileContent('');setPreview(undefined);setPreviewTarget(value.id)}
  async function mutate(ops:Parameters<ConfigForm<ConfigView>['mutate']>[0]):Promise<void>{if(!await o.form.mutate(ops,form.revision))throw new Error(t.policyRejected);await load()}
  async function toggle(kind:'global'|'project',value:boolean):Promise<void>{
    const route=overview?.route;const routeChanged=!!route&&(route.provider!==config?.provider||route.model!==config?.model)
    if(value&&(!config?.consent||routeChanged)){if(!route?.provider||!route.model)throw new Error(t.routeNeeded);if(!window.confirm(`${t.enableWarning}\n${route.provider} / ${route.model}`))return}
    await mutate([...(value&&routeChanged?[{op:'set' as const,path:['provider'],value:route!.provider},{op:'set' as const,path:['model'],value:route!.model}]:[]),{op:'set',path:[kind+'Use'],value},{op:'set',path:[kind+'Generate'],value},...(value?[{op:'set' as const,path:['consent'],value:true}]:[])])
  }
  const ask=<T,>(request:ManageCall):Promise<T>=>o.call(request as ManageRequest) as Promise<T>
  const projects=overview?.projects??[],editable=writable&&!busy
  const active=connections.find(c=>c.connectionId===draft.connectionId)??connections[0]
  const bases=kbResults[draft.connectionId],maxRead=active?.maxKnowledgeBases||2
  const publishOptions=bases?.ok?bases.bases:[]
  // 队列错误以 outbox 为准（state='failed'），发布记录本身不能代表队列健康。
  const failed=queue.filter(op=>op.state==='failed')
  const pending=queue.filter(op=>op.state==='pending'||op.state==='running').length
  const publicationOf=(publishId:string):PublicationView|undefined=>publications.find(p=>p.publishId===publishId)
  const previewTargets=[...(detail?[detail]:[]),...list].filter((item,index,all)=>all.findIndex(other=>other.id===item.id)===index)
  const diffText=(diff:PublicationView['diff']):string=>diff==='none'?t.kbDiffNone:diff==='updated'?t.kbDiffUpdated:diff==='body-changed'?t.kbDiffBodyChanged:t.kbDiffUnpublished
  const connectionField=(key:keyof ConnectionInput,label:string,hint:string):React.ReactElement=><label key={key}><span>{label}</span><input aria-label={label} value={connDraft[key]??''} placeholder={hint} disabled={!editable} onChange={event=>setConnDraft({...connDraft,[key]:event.target.value} as ConnectionInput)}/></label>
  async function loadPublications():Promise<void>{
    // 契约：{publications, outbox, tombstones}；防御性解析避免整页崩溃。
    const value=await ask<PublicationsResponse>({action:'publications'})
    setPublications(Array.isArray(value?.publications)?value.publications:[])
    setQueue(Array.isArray(value?.outbox)?value.outbox:[])
  }
  async function loadBinding(scope:string,known:ConnectionView[]=connections,force=false):Promise<void>{
    let value:BindingView|null
    try{value=await ask<BindingView|null>({action:'binding',scope})}
    catch(error){const message=error instanceof Error?error.message:String(error);if(!message.includes('BINDING_MISSING'))throw error;value=null}
    setBinding(value)
    if(force||!draftDirty){setDraft({connectionId:value?.connectionId??known[0]?.connectionId??'',readKbIds:value?[...value.readKbIds]:[],publishKbId:value?.publishKbId??''});setDraftDirty(false)}
  }
  /** 连接、发布记录与当前项目绑定；写入失败时草稿保留，未配置时不影响本地记忆功能。 */
  async function loadKnow(values:Project[]=projects):Promise<void>{
    setConnections(await ask<ConnectionView[]>({action:'connections'}))
    await loadPublications()
    const scope=values.some(p=>p.id===bindScope)?bindScope:(values[0]?.id??'')
    if(scope&&scope!==bindScope)setBindScope(scope)
    if(scope)await loadBinding(scope)
  }
  async function saveConnection():Promise<void>{const saved=await ask<ConnectionView>({action:'connection',connection:connDraft});setConnEditing(false);setConnDraft(blankConnection);await loadKnow();setSyncNote(t.kbSaved.replace('{name}',saved.connectionId))}
  async function toggleConnection(id:string,use:boolean,generate:boolean):Promise<void>{await ask<ConnectionView>({action:'knowToggle',connection:{connectionId:id},use,generate});await loadKnow()}
  async function removeConnection(id:string):Promise<void>{if(!window.confirm(t.kbRemoveConfirm))return;await ask<{removed:boolean}>({action:'knowRemove',connection:{connectionId:id}});await loadKnow()}
  async function loadBases(id:string):Promise<void>{setKbResults({...kbResults,[id]:await ask<BaseResult>({action:'knowledgeBases',connection:{connectionId:id}})})}
  function editConnection(value:ConnectionView):void{setConnDraft({connectionId:value.connectionId,baseUrl:value.baseUrl,apiProfile:value.apiProfile,tenantId:value.tenantId,readCredentialRef:value.readCredentialRef,publishCredentialRef:value.publishCredentialRef});setConnEditing(true)}
  function toggleReadKb(id:string,checked:boolean):void{setDraft({...draft,readKbIds:checked?[...draft.readKbIds,id]:draft.readKbIds.filter(value=>value!==id)});setDraftDirty(true)}
  async function saveBinding():Promise<void>{const saved=await ask<BindingView>({action:'knowSave',scope:bindScope,binding:{connectionId:draft.connectionId,readKbIds:draft.readKbIds,publishKbId:draft.publishKbId}});setBinding(saved);setDraft({connectionId:saved.connectionId,readKbIds:[...saved.readKbIds],publishKbId:saved.publishKbId});setDraftDirty(false);setSyncNote(t.kbSaved.replace('{name}',saved.localProjectId))}
  async function loadPreview(id:string):Promise<void>{const value=await ask<PreviewView|null>({action:'preview',id});if(!value)throw new Error(t.kbNoPreview);setPreview(value)}
  async function confirmPublish():Promise<void>{
    if(!preview)return
    if(!window.confirm(`${t.kbConfirmPublish}\n${preview.targetTitle||preview.targetKbId}`))return
    await ask<PublicationView>({action:'publishConfirm',previewId:preview.previewId});setPreview(undefined);setSyncNote(t.kbPublishedNote);await loadPublications()
  }
  async function withdraw(value:PublicationView):Promise<void>{
    if(!window.confirm(t.kbWithdrawConfirm))return
    const result=await ask<{queued:boolean}>({action:'withdrawRecall',id:value.publishId});setSyncNote(result.queued?t.kbWithdrawQueued:t.kbWithdrawNotQueued);await loadPublications()
  }
  async function syncNow():Promise<void>{const result=await ask<{processed:number}>({action:'syncNow'});setSyncNote(t.kbSyncDone.replace('{count}',String(result.processed)));await loadPublications()}
  const date=(time:number):string=>time?new Date(time).toLocaleString():t.noTime
  const row=(s:Scope,name:string,subtitle?:string):React.ReactElement=><div className="dm-row" key={s.id}><div className="dm-grow"><strong>{name}</strong>{subtitle&&<small>{subtitle}</small>}<small>{s.fileCount} {t.fileCount} · {s.count} {t.itemCount} · {t.updated} {date(s.updatedAt)}</small></div><button onClick={()=>void run(()=>browse(s))}>{t.browse}</button><button className="dm-danger" disabled={!writable} onClick={()=>setClearScope(s)}>{t.clear}</button>{s.id!=='global'&&<label className="dm-override"><input type="checkbox" disabled={!writable} checked={s.use&&s.generate} onChange={event=>void run(async()=>{await o.call({action:'projectPolicy',scope:s.id,use:event.target.checked,generate:event.target.checked});await load()})}/>{t.override}</label>}</div>
  const evidence=overview?.evidence??[],extracts=(overview?.jobs??[]).filter(j=>j.kind==='extract')
  const visibleJobs=showJobs?overview?.jobs??[]:extracts.slice(0,1)
  return <section className="dm-page" aria-label={t.nav}>
    <div className="dm-heading"><div><h2>{t.nav}</h2><p>{t.description}</p><small>{t.local} · {t.profile}：{overview?.profile??'…'}</small></div><button disabled={busy} onClick={()=>void run(load)}>{t.refresh}</button></div>
    {error&&<p role="alert" className="dm-error">{error}</p>}{!writable&&overview&&<p>{t.readonly}</p>}
    <h3>{t.behavior}</h3><div className="dm-card">{(['global','project'] as const).map(kind=><div className="dm-row" key={kind}><div className="dm-grow"><strong>{kind==='global'?t.global:t.project}</strong><p>{kind==='global'?t.globalDescription:t.projectDescription}</p></div><input className="dm-switch" type="checkbox" role="switch" aria-label={kind==='global'?t.global:t.project} disabled={!writable||busy} checked={!!config?.[`${kind}Use`]&&!!config?.[`${kind}Generate`]} onChange={event=>void run(()=>toggle(kind,event.target.checked))}/></div>)}</div>
    <p className="dm-muted">{t.history}</p>
    <h3>{t.global}</h3><div className="dm-card">{overview?.scopes.filter(s=>s.id==='global').map(s=>row(s,t.global))}</div>
    <h3>{t.project}</h3><div className="dm-card">{overview?.projects.map(p=>{const scope=overview.scopes.find(s=>s.id===p.id);return scope&&row(scope,p.name,p.root)})}{overview&&!overview.projects.length&&<p className="dm-empty">{t.noProjects}</p>}</div>
    <details className="dm-advanced"><summary>{t.advanced}</summary><div className="dm-setting-line dm-route-line"><div className="dm-route-fields"><label><span>{t.provider}</span><select value={provider} disabled={!writable||busy} onChange={e=>{const id=e.target.value;setProvider(id);void run(()=>loadModels(id))}}><option value="">{t.chooseProvider}</option>{providers.map(p=><option key={p.id} value={p.id}>{p.id==='deepseek-official'?t.officialApi:p.id==='deepseek-account'?t.officialAccount:p.name}</option>)}</select></label><label><span>{t.model}</span><select value={model} disabled={!writable||busy||!provider||modelsLoading} onChange={e=>setModel(e.target.value)}><option value="">{modelsLoading?t.loadingModels:t.chooseModel}</option>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div><button className="dm-save-action" disabled={!writable||busy||modelsLoading||!providers.some(p=>p.id===provider)||!models.some(m=>m.id===model)} onClick={()=>void run(()=>mutate([{op:'set',path:['provider'],value:provider},{op:'set',path:['model'],value:model},...(config?.provider!==provider||config.model!==model?[{op:'set' as const,path:['consent'],value:false}]:[])]))}>{t.save}</button></div>
      {!providers.length&&<p>{t.noProviders}</p>}{provider&&!modelsLoading&&!models.length&&<p>{t.noModels}</p>}
      <p>{t.enableWarning}</p>
      {(['global','project'] as const).map(kind=><div className="dm-fields" key={kind}><strong>{kind==='global'?t.global:t.project}</strong><label><input type="checkbox" checked={!!config?.[`${kind}Use`]} disabled={!writable} onChange={e=>void run(()=>mutate([{op:'set',path:[`${kind}Use`],value:e.target.checked}]))}/>{t.useOnly}</label><label><input type="checkbox" checked={!!config?.[`${kind}Generate`]} disabled={!writable} onChange={e=>void run(()=>mutate([{op:'set',path:[`${kind}Generate`],value:e.target.checked}]))}/>{t.generateOnly}</label></div>)}
      <label><input type="checkbox" checked={!!config?.consent} disabled={!writable||busy||config?.provider!==provider||config?.model!==model||!model} onChange={e=>void run(async()=>{if(e.target.checked&&!window.confirm(`${t.enableWarning}\n${provider} / ${model}`))return;await mutate([{op:'set',path:['consent'],value:e.target.checked}])})}/>{t.consent}</label>
      <p className="dm-usage-stat">{t.usageHelp}{overview?<>{t.todayUsed}<strong>{overview.dailyUsage.tokens}</strong> token。</>:t.loadingUsage}</p>
      {!!overview?.dailyUsage.unknownCalls&&<p className="dm-muted">{t.unknownUsageCalls.replace('{count}',String(overview.dailyUsage.unknownCalls))}</p>}
      <p>{t.static}：{overview?.staticCost.policyBytes??0} + {overview?.staticCost.toolSchemaBytes??0} UTF-8 bytes</p>
      <h4>{t.latestEvidence}</h4><div className="dm-evidence">{(showEvidence?evidence:evidence.slice(0,1)).map(e=><small key={e.session}>{e.session}：{e.settled+e.reserved} / {(overview?.budget?.localEvidenceBytes??1024)} 字节证据额度（本地直接证据，整会话累计；不是计费 tokens）<br/></small>)}{!evidence.length&&<p>{t.noEvidence}</p>}</div>{evidence.length>1&&<button onClick={()=>setShowEvidence(!showEvidence)}>{showEvidence?t.collapseHistory:t.showEvidenceHistory}</button>}
      <h4>{t.latestExtract}</h4><ul className="dm-jobs">{visibleJobs.map(j=><li key={j.id}>{j.kind} · {t[j.state as keyof typeof t]??j.state}{j.error&&` · ${j.error}`}{j.diagnostic&&` · ${j.diagnostic}`}{j.modelFinish&&` · ${t.modelFinish}：${j.modelFinish}`}{j.attemptUsage!==undefined&&` · ${t.attemptUsage}：${j.attemptUsage===null?t.usageUnknown:j.attemptUsage+' tokens'}`}</li>)}</ul>{!visibleJobs.length&&<p>{t.noExtract}</p>}{(showJobs||(overview?.jobs.length??0)>visibleJobs.length)&&<button onClick={()=>setShowJobs(!showJobs)}>{showJobs?t.collapseHistory:t.showJobHistory}</button>}{overview?.lastError&&<p role="status">{overview.lastError}</p>}
    </details>
    <div className="dm-kb">
    <h3>{t.knowHeading}</h3><p className="dm-muted">{t.knowIntro}</p>
    <div className="dm-card">
      {connections.map(c=><div className="dm-row" key={c.connectionId}>
        <div className="dm-grow"><strong>{c.connectionId}</strong><small>{c.baseUrl}{c.apiProfile&&` · ${c.apiProfile}`}{c.tenantId&&` · ${t.kbTenantId}：${c.tenantId}`}</small><small>{t.kbReadCredentialRef}：{c.readCredentialRef||t.kbUnknown} · {t.kbPublishCredentialRef}：{c.publishCredentialRef||t.kbUnknown}</small></div>
        <label className="dm-kb-toggle">{t.kbRead}：{c.readEnabled?t.kbOn:t.kbOff}<input className="dm-switch" type="checkbox" role="switch" aria-label={`${c.connectionId} ${t.kbRead}`} disabled={!editable} checked={c.readEnabled} onChange={event=>void run(()=>toggleConnection(c.connectionId,event.target.checked,c.publishEnabled))}/></label>
        <label className="dm-kb-toggle">{t.kbPublish}：{c.publishEnabled?t.kbOn:t.kbOff}<input className="dm-switch" type="checkbox" role="switch" aria-label={`${c.connectionId} ${t.kbPublish}`} disabled={!editable} checked={c.publishEnabled} onChange={event=>void run(()=>toggleConnection(c.connectionId,c.readEnabled,event.target.checked))}/></label>
        <button disabled={!editable} onClick={()=>editConnection(c)}>{t.edit}</button>
        <button className="dm-danger" disabled={!editable} onClick={()=>void run(()=>removeConnection(c.connectionId))}>{t.remove}</button>
      </div>)}
      {!connections.length&&<p className="dm-empty">{t.kbNoConnections}</p>}
      <p className="dm-muted">{t.kbReadHelp}{t.kbPublishHelp}</p>
      <p className="dm-muted">{t.kbQueueNote.replace('{count}',String(pending))}</p>
      <div className="dm-fields"><button disabled={!editable} onClick={()=>{setConnDraft(blankConnection);setConnEditing(true)}}>{t.kbNewConnection}</button>{connEditing&&<button disabled={busy} onClick={()=>setConnEditing(false)}>{t.kbCancel}</button>}</div>
    </div>
    {connEditing&&<div className="dm-card">
      <div className="dm-heading"><div><strong>{connections.some(c=>c.connectionId===connDraft.connectionId)?t.kbEditConnection:t.kbNewConnection}</strong><p>{t.kbSecretNote}</p></div></div>
      <div className="dm-kb-fields">
        {connectionField('connectionId',t.kbConnectionId,t.kbConnectionIdHint)}
        {connectionField('baseUrl',t.kbBaseUrl,t.kbBaseUrlHint)}
        {connectionField('apiProfile',t.kbApiProfile,t.kbApiProfileHint)}
        {connectionField('tenantId',t.kbTenantId,t.kbOptional)}
        {connectionField('readCredentialRef',t.kbReadCredentialRef,t.kbCredentialHint)}
        {connectionField('publishCredentialRef',t.kbPublishCredentialRef,t.kbCredentialHint)}
      </div>
      <div className="dm-fields"><button disabled={!editable||!connDraft.connectionId||!connDraft.baseUrl} onClick={()=>void run(saveConnection)}>{t.save}</button><button disabled={busy} onClick={()=>setConnEditing(false)}>{t.kbCancel}</button></div>
    </div>}
    <h4>{t.kbStatus}</h4>
    <div className="dm-card">
      {connections.map(c=><div className="dm-row" key={c.connectionId}><div className="dm-grow"><strong>{c.connectionId}</strong>
        <small>{t.kbProbe}：{kbResults[c.connectionId]?`${kbResults[c.connectionId].ok?'OK':kbResults[c.connectionId].code} · ${kbResults[c.connectionId].message||t.kbUnknown}`:t.kbProbeNever}</small>
        <small>{t.kbRead}：{c.readEnabled?t.kbOn:t.kbOff} · {t.kbPublish}：{c.publishEnabled?t.kbOn:t.kbOff}</small>
        <small>{t.kbEvidenceBytes}：{c.remoteEvidenceBytes} bytes · {t.kbRetiredBytes}：{c.retiredReferenceBytes} bytes · {t.kbCallsPerTurn}：{c.maxKnowledgeCallsPerTurn}</small>
        <small>{t.kbDeadline}：{c.requestDeadlineMs} ms · {t.kbPublishMode}：{c.publishMode} · {t.kbApiProfile}：{c.apiProfile||t.kbUnknown}</small>
      </div></div>)}
      {!connections.length&&<p className="dm-empty">{t.kbNoConnections}</p>}
    </div>
    <h4>{t.kbBinding}</h4>
    <div className="dm-card">
      {!projects.length&&<p className="dm-empty">{t.kbNoProject}</p>}
      <div className="dm-fields">
        <label><span>{t.kbProject}</span><select value={bindScope} disabled={busy||!projects.length} onChange={event=>{const id=event.target.value;setBindScope(id);void run(()=>loadBinding(id,connections,true))}}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><span>{t.kbConnection}</span><select value={draft.connectionId} disabled={!editable} onChange={event=>{setDraft({...draft,connectionId:event.target.value});setDraftDirty(true)}}>{connections.map(c=><option key={c.connectionId} value={c.connectionId}>{c.connectionId}</option>)}{draft.connectionId&&!connections.some(c=>c.connectionId===draft.connectionId)&&<option value={draft.connectionId}>{draft.connectionId}（{t.kbUnknown}）</option>}<option value="">{t.kbNoConnection}</option></select></label>
        <button disabled={!editable||!draft.connectionId} onClick={()=>void run(()=>loadBases(draft.connectionId))}>{t.kbLoadBases}</button>
      </div>
      {binding===null&&<p className="dm-muted">{t.kbNoBinding}</p>}
      {binding&&<p className="dm-muted">{t.kbBound}：{binding.connectionId} · {t.revision} {binding.bindingRevision} · {t.updated} {date(binding.updatedAt)}</p>}
      {!draft.connectionId&&<p className="dm-muted">{t.kbChooseConnectionFirst}</p>}
      {!!draft.connectionId&&<>
        <p className="dm-muted">{t.kbReadKbs.replace('{count}',String(maxRead))}</p>
        {!bases&&<p className="dm-muted">{t.kbLoadBasesFirst}</p>}
        {bases&&!bases.ok&&<p role="alert" className="dm-error">{t.kbListFailed}：{bases.code} · {bases.message||t.kbUnknown}</p>}
        {bases?.ok&&<div className="dm-kb-bases">{bases.bases.map(b=><label key={b.id}><input type="checkbox" checked={draft.readKbIds.includes(b.id)} disabled={!editable||(!draft.readKbIds.includes(b.id)&&draft.readKbIds.length>=maxRead)} onChange={event=>toggleReadKb(b.id,event.target.checked)}/>{b.name}{b.type&&<small> · {b.type}</small>}</label>)}{!bases.bases.length&&<p className="dm-empty">{t.kbEmptyList}</p>}</div>}
        <div className="dm-fields">
          <label><span>{t.kbPublishKb}</span><select value={draft.publishKbId} disabled={!editable} onChange={event=>{setDraft({...draft,publishKbId:event.target.value});setDraftDirty(true)}}><option value="">{t.kbChooseKb}</option>{publishOptions.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}{draft.publishKbId&&!publishOptions.some(b=>b.id===draft.publishKbId)&&<option value={draft.publishKbId}>{draft.publishKbId}</option>}</select></label>
          <button disabled={!editable||!draft.publishKbId||!draft.readKbIds.includes(draft.publishKbId)} onClick={()=>void run(saveBinding)}>{t.kbSaveBinding}</button>
        </div>
        {!draft.publishKbId&&<p className="dm-warning">{t.kbPublishRequired}</p>}
        {!!draft.publishKbId&&!draft.readKbIds.includes(draft.publishKbId)&&<p className="dm-warning">{t.kbPublishMustBeRead}</p>}
      </>}
    </div>
    <h4>{t.kbPreview}</h4>
    <div className="dm-card">
      <div className="dm-fields">
        <label><span>{t.kbPreviewItem}</span><select value={previewTarget} disabled={busy||!previewTargets.length} onChange={event=>setPreviewTarget(event.target.value)}><option value="">{t.kbChooseItem}</option>{previewTargets.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <button disabled={busy||!previewTarget} onClick={()=>void run(()=>loadPreview(previewTarget))}>{t.kbPreviewAction}</button>
      </div>
      {!previewTargets.length&&<p className="dm-muted">{t.kbBrowseFirst}</p>}
      {preview&&<>
        <p><strong>{preview.title}</strong></p>
        <p className="dm-muted">{t.kbTarget}：{preview.targetTitle||t.kbUnknown}（{preview.targetKbId}） · {t.kbConnection}：{preview.connectionId}</p>
        <p className="dm-muted">{t.kbSourceRevision}：{preview.sourceRevision} · {t.kbSourceHash}：{preview.sourceHash}</p>
        <p className="dm-muted">{t.kbBodyHash}：{preview.bodyHash} · {t.kbMarker}：{preview.publishMarker}</p>
        <p className="dm-muted">{t.kbApprovedAt}：{preview.approvedAt?date(preview.approvedAt):t.kbApprovedAtPending}</p>
        <pre>{preview.body}</pre>
        <div className="dm-fields"><button className="dm-danger" disabled={!writable||busy||!preview.body} onClick={()=>void run(confirmPublish)}>{t.kbConfirmAction}</button><button disabled={busy} onClick={()=>setPreview(undefined)}>{t.kbCancel}</button></div>
        <p className="dm-muted">{t.kbConfirmNote}</p>
      </>}
    </div>
    <h4>{t.kbPublications}</h4>
    {!!failed.length&&<div className="dm-card">
      <div className="dm-heading"><div><strong>{t.kbQueueErrors}</strong><p>{t.kbQueueHelp}</p></div><button disabled={!editable} onClick={()=>void run(syncNow)}>{t.kbSyncNow}</button></div>
      {failed.map(op=>{const p=publicationOf(op.publishId);return <div className="dm-row" key={op.operationId}><div className="dm-grow"><strong>{p?.memoryId??op.publishId}</strong><small>{t.kbOperation}：{op.op} · {t.kbStateLabel}：{op.state} · {t.kbErrorCode}：{op.lastErrorCode||t.kbUnknown}</small><small>{t.kbAttempts}：{op.attempts} · {t.kbTarget}：{p?.targetKbId??t.kbUnknown}{p?.remoteId?` · ${t.kbRemoteId}：${p.remoteId}`:''}</small></div>{p&&<button className="dm-danger" disabled={!editable} onClick={()=>void run(()=>withdraw(p))}>{t.kbWithdraw}</button>}</div>})}
    </div>}
    <div className="dm-card">
      {publications.map(p=><div className="dm-row" key={p.publishId}><div className="dm-grow"><strong>{p.memoryId}</strong>
        <small>{p.scope} · {t.kbTarget}：{p.targetKbId}{p.remoteId?` · ${t.kbRemoteId}：${p.remoteId}`:''}{p.remoteVersion?` · ${t.kbRemoteVersion}：${p.remoteVersion}`:''}</small>
        <small>{t.kbPublishedVersion}：{t.revision} {p.publishedSourceRevision} · {p.publishedBodyHash||t.kbNotPublished}</small>
        <small>{t.kbCandidateVersion}：{t.revision} {p.candidateSourceRevision} · {p.candidateBodyHash||t.kbUnknown}</small>
        <small className={p.diff==='none'?'dm-muted':'dm-warning'}>{diffText(p.diff)} · {t.kbStateLabel}：{p.state}</small>
        {p.error&&<small className="dm-error">{p.error}</small>}
      </div><button className="dm-danger" disabled={!editable} onClick={()=>void run(()=>withdraw(p))}>{t.kbWithdraw}</button></div>)}
      {!publications.length&&<p className="dm-empty">{t.kbNoPublications}</p>}
    </div>
    <p className="dm-muted">{t.kbWithdrawNote}</p>
    {syncNote&&<p role="status" className="dm-muted">{syncNote}</p>}
    </div>
    {selected&&<div className="dm-overlay"><div role="dialog" aria-modal="true" aria-label={t.browse} className="dm-browser"><div className="dm-heading"><h3>{selected.id==='global'?t.global:overview?.projects.find(p=>p.id===selected.id)?.name}</h3><button onClick={()=>setSelected(undefined)}>{t.close}</button></div><div className="dm-browser-grid"><aside><h4>{t.items}</h4>{!list.length&&<p>{t.empty}</p>}{list.map(item=><button key={item.id} onClick={()=>void run(()=>open(item))}>{item.title}</button>)}<button disabled={!writable} onClick={()=>{setDetail(undefined);setTitle('');setContent('');setFileContent('')}}>{t.new}</button>{hasMore&&<button onClick={()=>void run(async()=>{const more=await o.call({action:'list',scope:selected.id,cursor:list.length,limit:50}) as MemoryItem[];setList([...list,...more]);setHasMore(more.length===50)})}>{t.loadMore}</button>}<h4>{t.files}</h4>{fileList.map(file=><button key={file} onClick={()=>void run(async()=>{const result=await o.call({action:'file',scope:selected.id,id:file}) as {content:string};setFileContent(result.content)})}>{file}</button>)}</aside><main>{fileContent?<pre>{fileContent}</pre>:<><label>{t.title}<input aria-label={t.title} value={title} disabled={!writable} onChange={e=>setTitle(e.target.value)}/></label><label>{t.content}<textarea aria-label={t.content} value={content} disabled={!writable} onChange={e=>setContent(e.target.value)}/></label><div className="dm-fields"><button disabled={!writable||busy||!title||!content} onClick={()=>void run(async()=>{const item=await o.call({action:'save',scope:selected.id,id:detail?.id,title,content,revision:detail?.revision}) as MemoryItem;await browse(selected);await open(item);await load()})}>{t.save}</button>{detail&&<><button onClick={()=>void run(()=>open(detail))}>{t.loadLatest}</button><button className="dm-danger" disabled={!writable} onClick={()=>void run(async()=>{if(!window.confirm(t.remove))return;await o.call({action:'remove',id:detail.id,revision:detail.revision});await browse(selected);await load()})}>{t.remove}</button></>}</div>{detail&&<><p>{t.status}：{detail.status} · {t.revision}：{detail.revision} · {date(detail.updatedAt)}</p><h4>{t.sources}</h4>{detail.sourceDetails.filter(Boolean).map(source=><p key={source.id}>{source.sessionId} · {t.sourceRange} {source.start}–{source.end}<br/><code>{source.hash}</code><button disabled={!writable} onClick={()=>void run(async()=>{if(!window.confirm(t.remove))return;await o.call({action:'removeSource',scope:selected.id,id:source.id});await browse(selected);await load()})}>{t.remove}</button></p>)}</>}</>}</main></div><div className="dm-fields"><code>{path}</code><button onClick={()=>void run(async()=>{await navigator.clipboard.writeText(path)})}>{t.copyPath}</button><button disabled={!writable} onClick={()=>void run(async()=>{const result=await o.call({action:'export',scope:selected.id}) as {path:string};setPath(result.path)})}>{t.export}</button></div>{error&&<p role="alert" className="dm-error">{error}</p>}</div></div>}
    {clearScope&&<div className="dm-overlay"><div role="alertdialog" aria-modal="true" className="dm-confirm"><h3>{t.confirmClear}</h3><p>{t.clearWarning}</p><div className="dm-fields"><button onClick={()=>setClearScope(undefined)}>{t.close}</button><button className="dm-danger" disabled={busy} onClick={()=>void run(async()=>{await o.call({action:'clear',scope:clearScope.id,epoch:clearScope.epoch,confirmation:`CLEAR:${clearScope.id}:${clearScope.epoch}`});setClearScope(undefined);if(selected?.id===clearScope.id)setSelected(undefined);await load()})}>{t.confirmClear}</button></div></div></div>}
  </section>
}

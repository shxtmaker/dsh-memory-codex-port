import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import contribution from '../../lib/typert.remote-client.js'
import { MemorySettingsSection, type PageOperations } from './MemorySettingsSection.tsx'
import { copy } from './locales.ts'
import { css } from './style.ts'
export const inject=['remote','slots','configForms']
/** 先挂载自有 contribution，再由声明 namespace 依赖的消费子插件注册页面。 */
export function apply(ctx:Context):void {
  ctx.effect(()=>ctx.remote.$mount(contribution),'dsh-memory: Remote contribution')
  ctx.effect(()=>{const tag=document.createElement('style');tag.dataset.plugin='dsh-memory-local';tag.textContent=css;document.head.append(tag);return()=>tag.remove()},'dsh-memory: styles')
  ctx.plugin({inject:['remote','remote.memory','slots','configForms'],apply:(consumer:Context)=>{
    const form=consumer.configForms.get<ConfigView>('dsh-memory')
    const listeners=new Set<()=>void>()
    consumer.on('connection/reset',()=>{for(const notify of listeners)notify()})
    const operations:PageOperations={form,subscribe:notify=>{listeners.add(notify);return()=>{listeners.delete(notify)}},call:async request=>{
      const state=consumer.get('sessions')?.list.getSnapshot()
      const current=state?.ids.filter(id=>(state.byId[id]?.retainedBy.mainView??0)>0)
      const result=await consumer.remote.memory.invoke({...request,sessionId:current?.length===1?current[0]:undefined})
      if(!result.ok)throw new Error(result.error.message)
      return JSON.parse(result.value.json) as unknown
    }}
    consumer.slots.inject('settings.section',()=>consumer.slots.register({name:'settings.section',id:'memory',order:65,label:()=>copy.nav,inject:()=>({operations})},MemorySettingsSection))
  }})
}
export interface ConfigView {globalUse:boolean;globalGenerate:boolean;projectUse:boolean;projectGenerate:boolean;consent:boolean;provider:string;model:string;idleMinutes:number;consolidationMinutes:number;outputTokens:number}

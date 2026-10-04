export interface ModelRoute {provider:string;model:string}
interface Catalog {
  listProviders:()=>{id:string;name:string}[]
  listModels:(provider:string)=>Promise<readonly {id:string}[]>
}
/** 官方目录是默认路由的唯一来源；不猜测模型或切换已有有效选择。 */
export async function resolveMemoryRoute(catalog:Catalog,stored:ModelRoute,apiConfigured:()=>Promise<boolean>):Promise<ModelRoute> {
  const providers=catalog.listProviders()
  if(stored.provider&&stored.model&&providers.some(p=>p.id===stored.provider))return stored
  if(!providers.length||providers.some(p=>!['deepseek-official','deepseek-account'].includes(p.id)))return {provider:'',model:''}
  let apiReady=false
  try{apiReady=providers.some(p=>p.id==='deepseek-official')&&await apiConfigured()}
  catch{/* API凭证状态不可核对时，不将其视为已配置。 */}
  for(const provider of [...(apiReady?['deepseek-official']:[]),'deepseek-account']){
    if(!providers.some(p=>p.id===provider))continue
    try{const models=await catalog.listModels(provider);if(models[0])return {provider,model:models[0].id}}
    catch{/* 某一官方路由不可用时，继续检查另一条已配置的官方路由。 */}
  }
  return {provider:'',model:''}
}

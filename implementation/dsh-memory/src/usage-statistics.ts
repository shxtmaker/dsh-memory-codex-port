/** 按执行主机的本地自然日结算，日界按日历递增以适应夏令时。 */
export function localUsageDay(now=Date.now()):{day:string;timezone:string;start:number;end:number} {
  const start=new Date(now);start.setHours(0,0,0,0)
  const end=new Date(start);end.setDate(end.getDate()+1)
  const day=[start.getFullYear(),String(start.getMonth()+1).padStart(2,'0'),String(start.getDate()).padStart(2,'0')].join('-')
  return {day,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,start:start.getTime(),end:end.getTime()}
}

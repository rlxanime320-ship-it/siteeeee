import { z } from "zod";
import { formatSchema, MediaError, type MediaJob } from "./types";
import { type ApiContext } from "./server";
import { UUID } from "./security";
import { httpProvider } from "./providers/http";

export interface AnalysisRow { id:string; scope:string; provider:string; reference:string; formats:string; expires_at:number; }
export interface JobRow { id:string; scope:string; analysis_id:string; format_id:string; provider:string; reference:string; state:string; expires_at:number; }
export async function getAnalysis(context:ApiContext,id:string) {
  if(!UUID.test(id))throw new MediaError("INVALID_REQUEST","This analysis link is invalid.");
  const row=await context.db.prepare("SELECT * FROM media_analyses WHERE id = ? AND scope = ? AND expires_at > ?").bind(id,context.scope,Date.now()).first<AnalysisRow>();
  if(!row)throw new MediaError("EXPIRED","This analysis has expired. Analyze your link again.",410);
  return {row,formats:z.array(formatSchema).parse(JSON.parse(row.formats))};
}
export async function getJobRow(context:ApiContext,id:string) {
  if(!UUID.test(id))throw new MediaError("INVALID_REQUEST","This export link is invalid.");
  const row=await context.db.prepare("SELECT * FROM media_jobs WHERE id = ? AND scope = ? AND expires_at > ?").bind(id,context.scope,Date.now()).first<JobRow>();
  if(!row)throw new MediaError("EXPIRED","This export has expired. Prepare a new download.",410);
  return row;
}
export function publicJob(row:JobRow,extra:Partial<MediaJob>={}):MediaJob {
  return {id:row.id,state:row.state as MediaJob["state"],expiresAt:new Date(row.expires_at).toISOString(),...(row.state==="ready"?{downloadUrl:`/api/download/${row.id}`}:{phase:row.state==="queued"?"Waiting for the media processor":"Processing your selected format"}),...extra};
}
export async function refreshJob(context:ApiContext,row:JobRow) {
  if(row.provider==="sample"||row.state==="ready"||row.state==="failed")return publicJob(row);
  if(!row.reference) {
    if(Date.now() > row.expires_at-30*60_000+45_000){await context.db.prepare("UPDATE media_jobs SET state = 'failed' WHERE id = ? AND reference = ''").bind(row.id).run();return publicJob({...row,state:"failed"},{error:"The processor did not acknowledge this export. Please try again."});}
    return publicJob(row);
  }
  const status=await httpProvider.job(row.reference);
  // Keep terminal status monotonic when concurrent polls arrive out of order.
  await context.db.prepare("UPDATE media_jobs SET state = ? WHERE id = ? AND state NOT IN ('ready', 'failed')").bind(status.state,row.id).run();
  const current=await getJobRow(context,row.id);
  return publicJob(current,{...(current.state===status.state?{progress:status.progress,phase:status.phase,error:status.error}: {})});
}
export async function deterministicJobId(analysisId:string,formatId:string){const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${analysisId}:${formatId}`)));hash[6]=(hash[6]&15)|64;hash[8]=(hash[8]&63)|128;const h=Array.from(hash.slice(0,16),b=>b.toString(16).padStart(2,"0")).join("");return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;}

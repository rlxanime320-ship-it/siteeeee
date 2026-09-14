import { z } from "zod";
import { withApi } from "@/lib/media/server";
import { boundedJson } from "@/lib/media/security";
import { deterministicJobId, getAnalysis, getJobRow, publicJob, refreshJob, type JobRow } from "@/lib/media/jobs";
import { MediaError } from "@/lib/media/types";
import { sampleAsset } from "@/lib/media/providers/sample";
import { httpProvider } from "@/lib/media/providers/http";

export function POST(request:Request) {
  return withApi(request,"prepare",async context=>{
    const input=z.object({analysisId:z.string().uuid(),formatId:z.string().min(1).max(160)}).strict().parse(await boundedJson(request));
    const {row:analysis,formats}=await getAnalysis(context,input.analysisId);
    if(!formats.some(f=>f.id===input.formatId))throw new MediaError("INVALID_REQUEST","Choose a format available for this source.");
    const id=await deterministicJobId(input.analysisId,input.formatId);const expiry=Date.now()+30*60_000;
    const reservation=await context.db.prepare("INSERT OR IGNORE INTO media_jobs (id, scope, analysis_id, format_id, provider, reference, state, expires_at) VALUES (?, ?, ?, ?, ?, '', 'queued', ?) RETURNING id").bind(id,context.scope,analysis.id,input.formatId,analysis.provider,expiry).first();
    if(!reservation){const existing=await getJobRow(context,id);if(existing.state!=="failed")return Response.json(await refreshJob(context,existing));const resumed=await context.db.prepare("UPDATE media_jobs SET state = 'queued', reference = '', expires_at = ? WHERE id = ? AND state = 'failed' RETURNING id").bind(expiry,id).first();if(!resumed)return Response.json(await refreshJob(context,await getJobRow(context,id)));}
    let row:JobRow={id,scope:context.scope,analysis_id:analysis.id,format_id:input.formatId,provider:analysis.provider,reference:"",state:"queued",expires_at:expiry};
    try {
      if(analysis.provider==="sample") {sampleAsset(input.formatId);row={...row,state:"ready",reference:input.formatId};}
      else {const next=await httpProvider.prepare(analysis.reference,input.formatId,id);row={...row,state:next.state,reference:next.id};}
      await context.db.prepare("UPDATE media_jobs SET reference = ?, state = ? WHERE id = ?").bind(row.reference,row.state,row.id).run();
      return Response.json(publicJob(row),{status:row.state==="queued"||row.state==="processing"?202:200});
    } catch(error) {await context.db.prepare("UPDATE media_jobs SET state = 'failed' WHERE id = ?").bind(row.id).run();throw error;}
  });
}

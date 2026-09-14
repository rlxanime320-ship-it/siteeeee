import { withApi } from "@/lib/media/server";
import { getJobRow, refreshJob } from "@/lib/media/jobs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {const {id}=await params;return withApi(request,"poll",async context=>Response.json(await refreshJob(context,await getJobRow(context,id))));}

import { z } from "zod";
import { withApi, getConfig } from "@/lib/media/server";
import { boundedJson, validateSourceUrl } from "@/lib/media/security";
import { sampleAnalysis } from "@/lib/media/providers/sample";
import { httpProvider } from "@/lib/media/providers/http";

export async function POST(request:Request) {
  return withApi(request,"analyze",async({db,scope})=>{
    const input=z.object({url:z.string().min(1).max(2048)}).strict().parse(await boundedJson(request));
    const source=validateSourceUrl(input.url,new URL(request.url).origin,getConfig().additionalHosts);
    const data=source.demo?sampleAnalysis():await httpProvider.analyze(source.url.href);
    const id=crypto.randomUUID();const expiry=Date.now()+30*60_000;
    await db.prepare("INSERT INTO media_analyses (id, scope, provider, reference, formats, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id,scope,source.demo?"sample":"http",source.demo?"chromatic":("id"in data?data.id:""),JSON.stringify(data.formats),expiry).run();

    if(source.demo) return Response.json({...data,id,demo:true,expiresAt:new Date(expiry).toISOString()});

    const live=data as typeof data & {thumbnailAvailable?:boolean;previewAvailable?:boolean};
    return Response.json({
      ...data,
      id,
      demo:false,
      thumbnail:live.thumbnailAvailable?`/api/media/${id}/thumbnail`:undefined,
      preview:live.previewAvailable?`/api/media/${id}/preview`:undefined,
      expiresAt:new Date(expiry).toISOString(),
    });
  });
}

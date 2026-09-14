import { env } from "cloudflare:workers";
import { withApi } from "@/lib/media/server";
import { getJobRow, getAnalysis } from "@/lib/media/jobs";
import { sampleAsset } from "@/lib/media/providers/sample";
import { httpProvider } from "@/lib/media/providers/http";
import { safeFilename } from "@/lib/media/security";
import { MediaError } from "@/lib/media/types";

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  return withApi(request,"download",async context=>{
    const row=await getJobRow(context,id);
    if(row.state!=="ready")throw new MediaError("CONVERSION_ERROR","Your file isn’t ready yet. Wait for preparation to finish.",409,true);
    if(row.provider==="sample") {
      const asset=sampleAsset(row.reference);
      const binding=(env as unknown as {ASSETS?:Fetcher}).ASSETS;
      // Local development may serve static assets through Vite rather than a binding.
      // Relative redirects resolve only to this app's fixed manifest-owned asset path.
      if(!binding)return new Response(null,{status:302,headers:{Location:`/media/${asset.filename}`,"Content-Disposition":`attachment; filename="${safeFilename(asset.filename)}"`}});
      const response=await binding.fetch(new Request(new URL(`/media/${asset.filename}`,request.url)));
      if(!response.ok||!response.body)throw new MediaError("MEDIA_UNAVAILABLE","The sample file is temporarily unavailable.",503,true);
      return new Response(response.body,{headers:{"Content-Type":asset.mimeType,"Content-Length":String(asset.bytes),"Content-Disposition":`attachment; filename="${safeFilename(asset.filename)}"`}});
    }
    const {formats}=await getAnalysis(context,row.analysis_id);
    const format=formats.find(f=>f.id===row.format_id);
    if(!format)throw new MediaError("EXPIRED","This export’s source has expired. Analyze the link again.",410);
    const upstream=await httpProvider.download(row.reference);
    const type=upstream.headers.get("content-type")?.split(";")[0]??"";
    const permitted=new Set(["video/mp4","video/webm","video/quicktime","audio/mpeg","audio/mp4","audio/aac","audio/wav","audio/x-wav","audio/ogg","audio/opus"]);
    if(!permitted.has(type)||!upstream.body){await upstream.body?.cancel();throw new MediaError("MEDIA_UNAVAILABLE","The processor did not return a supported media file.",502);}
    const maxBytes=2_000_000_000;const length=Number(upstream.headers.get("content-length"));
    if(length>maxBytes){await upstream.body.cancel();throw new MediaError("CONVERSION_ERROR","This file is larger than the 2 GB export limit.",413);}
    let transferred=0;
    const stream=upstream.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){transferred+=chunk.byteLength;if(transferred>maxBytes){controller.error(new Error("Export exceeded its byte limit"));return;}controller.enqueue(chunk);}}));
    const headers:Record<string,string>={"Content-Type":type,"Content-Disposition":`attachment; filename="viddow-${safeFilename(format.id)}.${format.container}"`};
    if(length>0&&Number.isSafeInteger(length))headers["Content-Length"]=String(length);
    return new Response(stream,{headers});
  });
}

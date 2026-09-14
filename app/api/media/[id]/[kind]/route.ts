import { withApi } from "@/lib/media/server";
import { getAnalysis } from "@/lib/media/jobs";
import { httpProvider } from "@/lib/media/providers/http";
import { MediaError } from "@/lib/media/types";

const permittedTypes={
  thumbnail:new Set(["image/jpeg","image/png","image/webp","image/avif","image/gif"]),
  preview:new Set(["video/mp4","video/webm","video/quicktime"]),
} as const;

export async function GET(request:Request,{params}:{params:Promise<{id:string;kind:string}>}) {
  const {id,kind}=await params;
  if(kind!=="thumbnail"&&kind!=="preview") return new Response(null,{status:404});
  return withApi(request,"poll",async context=>{
    const {row}=await getAnalysis(context,id);
    if(row.provider!=="http") throw new MediaError("MEDIA_UNAVAILABLE","This preview is unavailable.",404);
    const range=kind==="preview"?request.headers.get("range")??undefined:undefined;
    const upstream=await httpProvider.asset(row.reference,kind,range);
    const type=upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()??"";
    if(!permittedTypes[kind].has(type as never)||!upstream.body){await upstream.body?.cancel();throw new MediaError("MEDIA_UNAVAILABLE","This preview is unavailable.",502);}
    const headers=new Headers({"Content-Type":type,"Cache-Control":"private, max-age=120","Accept-Ranges":upstream.headers.get("accept-ranges")||"bytes"});
    for(const name of ["content-length","content-range","etag","last-modified"]){const value=upstream.headers.get(name);if(value)headers.set(name,value);}
    return new Response(upstream.body,{status:upstream.status,headers});
  });
}

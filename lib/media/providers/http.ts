import { z } from "zod";
import { analysisSchema, jobSchema, MediaError } from "../types";
import { cleanText, readBoundedJson } from "../security";
import { getConfig, providerConfigured } from "../server";

/** Provider IDs are opaque identifiers, never URLs or paths. */
const referenceSchema=z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
const providerAnalysisSchema=analysisSchema.omit({id:true,expiresAt:true,demo:true,thumbnail:true,preview:true}).extend({
  id:referenceSchema,
  thumbnailAvailable:z.boolean().optional(),
  previewAvailable:z.boolean().optional(),
});
const providerJobSchema=jobSchema.omit({id:true,downloadUrl:true,expiresAt:true}).extend({id:referenceSchema});

export interface MediaProvider {
  analyze(url: string): Promise<z.infer<typeof providerAnalysisSchema>>;
  prepare(reference: string, formatId: string, idempotencyKey: string): Promise<z.infer<typeof providerJobSchema>>;
  job(reference: string): Promise<z.infer<typeof providerJobSchema>>;
  download(reference: string): Promise<Response>;
  asset(reference: string, kind: "thumbnail" | "preview", range?: string): Promise<Response>;
}

async function providerRequest(path: string, body?: unknown, idempotencyKey?: string, extraHeaders:Record<string,string>={}) {
  const config=getConfig();
  if(!providerConfigured()) throw new MediaError("PROVIDER_UNAVAILABLE", "Live platform downloads need a connected media provider. You can explore every step with the VIDdow original sample.", 503, false);
  const origin=new URL(config.providerUrl!);
  const url=new URL(`${origin.pathname.replace(/\/$/,"")}${path}`,origin.origin);
  const binary=path.startsWith("/download/")||path.startsWith("/asset/");
  let response:Response;
  try { response=await fetch(url.href,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${config.providerToken}`,Accept:binary?"image/*, video/*, audio/*":"application/json",...(body?{"Content-Type":"application/json"}:{}),...(idempotencyKey?{"Idempotency-Key":idempotencyKey}:{}),...extraHeaders},body:body?JSON.stringify(body):undefined,redirect:"manual",signal:AbortSignal.timeout(path.startsWith("/download/")?120_000:path.startsWith("/asset/")?60_000:30_000)}); }
  catch { throw new MediaError("NETWORK_ERROR","The media provider isn’t responding. Please try again.",503,true); }
  if(response.status>=300&&response.status<400) { await response.body?.cancel(); throw new MediaError("MEDIA_UNAVAILABLE","The media provider returned an unsupported redirect.",502); }
  if(!response.ok) {
    const errorCode = response.status===401||response.status===403 ? "PRIVATE_MEDIA" : response.status===404||response.status===410 ? "MEDIA_UNAVAILABLE" : response.status===429 ? "RATE_LIMITED" : "CONVERSION_ERROR";
    await response.body?.cancel();
    throw new MediaError(errorCode, errorCode==="PRIVATE_MEDIA"?"This media requires access that VIDdow cannot use. Try a public, unrestricted source.":errorCode==="MEDIA_UNAVAILABLE"?"This media is no longer available from its source.":errorCode==="RATE_LIMITED"?"The media provider is busy. Wait a minute and try again.":"The media provider couldn’t process this source. Try again or choose another format.",response.status===429?429:502,response.status>=500||response.status===429);
  }
  return response;
}
async function providerJson(path:string,body?:unknown,key?:string) { const response=await providerRequest(path,body,key); if(!response.headers.get("content-type")?.includes("application/json")){await response.body?.cancel();throw new MediaError("MEDIA_UNAVAILABLE","The media provider returned an invalid response.",502);} return readBoundedJson(response.body,150_000); }

export const httpProvider:MediaProvider={
  async analyze(url){
    const parsed=providerAnalysisSchema.safeParse(await providerJson("/analyze",{url}));
    if(!parsed.success)throw new MediaError("MEDIA_UNAVAILABLE","The source didn’t include usable media metadata.",502);
    const value=parsed.data;
    return {...value,title:cleanText(value.title)||"Untitled media",source:cleanText(value.source,80)||"Public media",creator:value.creator?cleanText(value.creator,160):undefined,formats:value.formats.map(f=>({...f,codec:f.codec?cleanText(f.codec,80):undefined}))};
  },
  async prepare(reference,formatId,idempotencyKey){return providerJobSchema.parse(await providerJson("/prepare",{analysisId:referenceSchema.parse(reference),formatId},idempotencyKey));},
  async job(reference){return providerJobSchema.parse(await providerJson(`/jobs/${referenceSchema.parse(reference)}`));},
  async download(reference){return providerRequest(`/download/${referenceSchema.parse(reference)}`);},
  async asset(reference,kind,range){return providerRequest(`/asset/${referenceSchema.parse(reference)}/${kind}`,undefined,undefined,range?{Range:range}:{});},
};

import manifest from "../demo-manifest.json";
import { formatSchema, MediaError, type MediaAnalysis } from "../types";
import { z } from "zod";

const assetSchema=z.object({filename:z.string().regex(/^[a-zA-Z0-9_-]+\.[a-z0-9]+$/),mimeType:z.string(),bytes:z.number().positive(),duration:z.number().nonnegative().optional(),width:z.number().optional(),height:z.number().optional(),fps:z.number().optional(),codec:z.string().optional(),bitrateKbps:z.number().optional()}).passthrough();
export const sampleAssets=z.array(assetSchema).parse(manifest.assets);
export function sampleAnalysis():Omit<MediaAnalysis,"id"|"expiresAt"> {
  const video=sampleAssets.find(a=>a.filename==="chromatic.mp4");
  if(!video)throw new MediaError("MEDIA_UNAVAILABLE","The original sample is being prepared. Please try again shortly.",503,true);
  const formats=sampleAssets.filter(a=>a.mimeType.startsWith("video/")||a.mimeType.startsWith("audio/")).map(asset=>formatSchema.parse({id:asset.filename,kind:asset.mimeType.startsWith("video/")?"video":"audio",container:asset.filename.split(".").pop(),codec:asset.codec==="h264"?"H.264":asset.codec,width:asset.width,height:asset.height,fps:asset.fps,bitrateKbps:asset.mimeType.startsWith("audio/")?asset.bitrateKbps:undefined,bytes:asset.bytes,original:asset.filename==="chromatic.mp4"})).sort((a,b)=>Number(b.original)-Number(a.original)||(a.kind===b.kind?(b.height??b.bitrateKbps??0)-(a.height??a.bitrateKbps??0):a.kind==="video"?-1:1));
  return {title:"Chromatic currents",source:"VIDdow Originals",creator:"An original audiovisual study by VIDdow",duration:video.duration??manifest.duration,thumbnail:"/media/chromatic-poster.jpg",preview:"/media/chromatic.mp4",formats,demo:true};
}
export function sampleAsset(id:string) { const asset=sampleAssets.find(a=>a.filename===id&&(a.mimeType.startsWith("video/")||a.mimeType.startsWith("audio/")));if(!asset)throw new MediaError("INVALID_REQUEST","This format isn’t available for the sample.",400);return asset; }

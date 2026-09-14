import { providerConfigured } from "@/lib/media/server";
import { sampleAssets } from "@/lib/media/providers/sample";
export function GET() { return Response.json({providerReady:providerConfigured(),sampleReady:sampleAssets.length>0},{headers:{"Cache-Control":"no-store"}}); }

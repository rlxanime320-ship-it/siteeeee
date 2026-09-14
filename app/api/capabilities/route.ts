import { getConfig, providerConfigured } from "@/lib/media/server";
import { sampleAssets } from "@/lib/media/providers/sample";

function safeProviderHost(value?: string) {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return "invalid-url";
  }
}

export function GET() {
  const config = getConfig();
  return Response.json(
    {
      providerReady: providerConfigured(),
      sampleReady: sampleAssets.length > 0,
      diagnostics: {
        providerUrlPresent: Boolean(config.providerUrl),
        providerTokenPresent: Boolean(config.providerToken),
        providerHost: safeProviderHost(config.providerUrl),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

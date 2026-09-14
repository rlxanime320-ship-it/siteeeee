import { MediaError, PLATFORMS } from "./types";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const knownHosts = new Set<string>(PLATFORMS.flatMap(p => [...p.hosts]));

/** User URLs are sent as data to an administrator-configured provider, never fetched by this Worker. */
export function validateSourceUrl(value: string, requestOrigin: string, additionalHosts: string[] = []) {
  if (value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) throw new MediaError("INVALID_URL", "Paste a complete public HTTPS media link without spaces.");
  let url: URL;
  try { url = new URL(value); } catch { throw new MediaError("INVALID_URL", "Paste a complete media URL, including https://."); }
  if (url.origin === requestOrigin && url.pathname === "/media/chromatic.mp4" && !url.search && !url.hash && !url.username && !url.password) return { url, demo: true };
  if (url.protocol !== "https:" || url.username || url.password || url.port || /[:\[\]]/.test(url.hostname) || /^\d+(\.\d+)*$/.test(url.hostname)) throw new MediaError("INVALID_URL", "Use a public HTTPS media link. Local addresses, credentials, and custom ports aren’t supported.");
  if (!knownHosts.has(url.hostname) && !additionalHosts.includes(url.hostname)) throw new MediaError("UNSUPPORTED_SOURCE", "This source isn’t supported. Try a public link from YouTube, TikTok, Instagram, Facebook, X, or Vimeo, or explore the sample.");
  // URL fragments are client-side navigation, never provider instructions.
  url.hash = "";
  return { url, demo: false };
}

export function cleanText(value: string, max = 300) { return value.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max); }
export function safeFilename(value: string) { return cleanText(value, 100).replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "") || "viddow-media"; }
export function safeAssetUrl(value: string | undefined, origins: string[]) {
  if (!value) return undefined;
  try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.port || !origins.includes(url.origin)) return undefined; return url.href; } catch { return undefined; }
}

export async function boundedJson(request: Request, limit = 12_000): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new MediaError("INVALID_REQUEST", "Send a JSON request.", 415);
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new MediaError("INVALID_REQUEST", "This request must come from VIDdow.", 403);
  return readBoundedJson(request.body, limit);
}
export async function readBoundedJson(body: ReadableStream<Uint8Array> | null, limit: number): Promise<unknown> {
  if (!body) throw new MediaError("INVALID_REQUEST", "A JSON request is required.");
  const reader = body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new MediaError("INVALID_REQUEST", "This request is too large.", 413); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new MediaError("INVALID_REQUEST", "The request contains invalid JSON."); }
}

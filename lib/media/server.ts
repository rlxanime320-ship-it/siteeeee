import { env } from "cloudflare:workers";
import { ZodError } from "zod";
import { MediaError } from "./types";
import { UUID } from "./security";

export type ServerConfig = { providerUrl?: string; providerToken?: string; assetOrigins: string[]; additionalHosts: string[]; allowLocalProvider: boolean };
export function getConfig(): ServerConfig {
  const runtime = env as unknown as Record<string, unknown>;
  const read = (key: string) => typeof runtime[key] === "string" ? runtime[key] as string : process.env[key];
  return { providerUrl: read("MEDIA_PROVIDER_URL"), providerToken: read("MEDIA_PROVIDER_TOKEN"), assetOrigins: (read("MEDIA_ASSET_ORIGINS") ?? "").split(",").map(s=>s.trim()).filter(Boolean), additionalHosts: (read("MEDIA_ADDITIONAL_HOSTS") ?? "").split(",").map(s=>s.trim()).filter(Boolean), allowLocalProvider: read("MEDIA_PROVIDER_ALLOW_LOCAL") === "1" };
}
export function providerConfigured() { const config = getConfig(); if (!config.providerToken || !config.providerUrl) return false; try { const u = new URL(config.providerUrl); const local = config.allowLocalProvider && u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost"); if (local) return !u.username && !u.password && /^\d+$/.test(u.port || "80"); return u.protocol === "https:" && !u.username && !u.password && !u.port && !/^(localhost|.*\.localhost|.*\.local)$/.test(u.hostname) && !/[\d]:|^\d|[\[\]:]/.test(u.hostname); } catch { return false; } }
export function getDatabase(): D1Database {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new MediaError("NETWORK_ERROR", "The media workspace is starting up. Please try again shortly.", 503, true);
  return db;
}
export interface ApiContext { request: Request; db: D1Database; scope: string; }
let lastCleanup = 0;
async function digest(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,"0")).join(""); }
export async function withApi(request: Request, category: "analyze" | "prepare" | "poll" | "download", handler: (context: ApiContext) => Promise<Response>) {
  let sessionCookie: string | undefined;
  try {
    const db = getDatabase();
    const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)viddow_session=([^;]+)/)?.[1];
    const session = cookie && UUID.test(cookie) ? cookie : crypto.randomUUID();
    if (session !== cookie) sessionCookie = `viddow_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
    const scope = await digest(session);
    // Sites strips/injects authenticated user headers. CF-Connecting-IP is edge owned.
    const principal = request.headers.get("oai-authenticated-user-id") ?? request.headers.get("cf-connecting-ip") ?? "local-preview";
    const limit = category === "analyze" ? 12 : category === "prepare" ? 20 : category === "download" ? 30 : 90;
    const minute = Math.floor(Date.now()/60_000);
    const key = await digest(`${principal}:${category}:${minute}`);
    const counter = await db.prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count").bind(key, (minute+2)*60_000).first<{count:number}>();
    if (!counter || counter.count > limit) throw new MediaError("RATE_LIMITED", "A few too many requests. Give it a minute, then try again.", 429, true);
    if (Date.now()-lastCleanup > 60_000) {
      const now = Date.now();
      await db.batch([
        db.prepare("DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at < ? LIMIT 200)").bind(now),
        db.prepare("DELETE FROM media_jobs WHERE id IN (SELECT id FROM media_jobs WHERE expires_at < ? LIMIT 200)").bind(now),
        db.prepare("DELETE FROM media_analyses WHERE id IN (SELECT id FROM media_analyses WHERE expires_at < ? LIMIT 200)").bind(now),
      ]);
      lastCleanup=now;
    }
    const response = await handler({ request, db, scope });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    if(sessionCookie) response.headers.append("Set-Cookie",sessionCookie);
    return response;
  } catch (error) {
    const issue = error instanceof MediaError ? error : error instanceof ZodError ? new MediaError("INVALID_REQUEST", "The media request contains invalid values.") : new MediaError("NETWORK_ERROR", "The media service is temporarily unavailable. Please try again.", 503, true);
    if (!(error instanceof MediaError || error instanceof ZodError)) console.error("VIDdow request failed", error instanceof Error ? error.name : "Unknown error");
    const headers: Record<string,string> = { "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" };
    if(sessionCookie) headers["Set-Cookie"]=sessionCookie;
    if(issue.status===429) headers["Retry-After"]="60";
    return Response.json({error:{code:issue.code,message:issue.message,retryable:issue.retryable}}, {status:issue.status,headers});
  }
}

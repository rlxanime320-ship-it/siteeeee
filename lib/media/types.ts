import { z } from "zod";

export const formatSchema = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum(["video", "audio"]),
  container: z.enum(["mp4", "webm", "mov", "mp3", "m4a", "aac", "wav", "opus"]),
  codec: z.string().max(80).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().max(1000).optional(),
  bitrateKbps: z.number().positive().optional(),
  bytes: z.number().int().positive().optional(),
  estimated: z.boolean().optional(),
  original: z.boolean().default(false),
});
export type MediaFormat = z.infer<typeof formatSchema>;
export const analysisSchema = z.object({
  id: z.string().min(1).max(8192),
  title: z.string().min(1).max(300),
  source: z.string().min(1).max(80),
  thumbnail: z.string().max(2048).optional(),
  preview: z.string().max(2048).optional(),
  duration: z.number().nonnegative().optional(),
  creator: z.string().max(160).optional(),
  formats: z.array(formatSchema).min(1).max(80),
  expiresAt: z.string().datetime(),
  demo: z.boolean().default(false),
});
export type MediaAnalysis = z.infer<typeof analysisSchema>;
export const jobSchema = z.object({
  id: z.string().min(1).max(8192),
  state: z.enum(["queued", "processing", "ready", "failed"]),
  progress: z.number().min(0).max(100).optional(),
  phase: z.string().max(160).optional(),
  downloadUrl: z.string().max(10000).optional(),
  error: z.string().max(300).optional(),
  expiresAt: z.string().datetime().optional(),
});
export type MediaJob = z.infer<typeof jobSchema>;
export type ApiErrorCode = "INVALID_URL" | "UNSUPPORTED_SOURCE" | "PROVIDER_UNAVAILABLE" | "PRIVATE_MEDIA" | "MEDIA_UNAVAILABLE" | "NETWORK_ERROR" | "CONVERSION_ERROR" | "RATE_LIMITED" | "EXPIRED" | "INVALID_REQUEST";
export class MediaError extends Error {
  constructor(public code: ApiErrorCode, message: string, public status = 400, public retryable = false) {
    super(message); this.name = "MediaError";
  }
}
export const PLATFORMS = [
  { name: "YouTube", hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"] },
  { name: "TikTok", hosts: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"] },
  { name: "Instagram", hosts: ["instagram.com", "www.instagram.com"] },
  { name: "Facebook", hosts: ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch"] },
  { name: "X / Twitter", hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"] },
  { name: "Vimeo", hosts: ["vimeo.com", "www.vimeo.com", "player.vimeo.com"] },
] as const;
export function detectPlatform(value: string): string | undefined {
  try { const host = new URL(value).hostname.toLowerCase(); return PLATFORMS.find((p) => (p.hosts as readonly string[]).includes(host))?.name; } catch { return undefined; }
}
export function formatBytes(bytes?: number, estimated = false) {
  if (!bytes) return "Size varies";
  const amount = bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
  return `${estimated ? "~" : ""}${amount}`;
}
export function durationLabel(seconds?: number) {
  if (seconds === undefined) return "Duration unavailable";
  const total = Math.floor(seconds); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

import { analysisSchema, jobSchema, MediaError, type ApiErrorCode, type MediaAnalysis, type MediaJob } from "./types";

export async function apiRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(35_000) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new MediaError("NETWORK_ERROR", "The connection took too long. Check your network and try again.", 503, true);
  }
  const data = await response.json().catch(() => null) as { error?: { code?: ApiErrorCode; message?: string; retryable?: boolean } } | null;
  if (!response.ok || !data) throw new MediaError((data?.error?.code as ApiErrorCode) ?? "NETWORK_ERROR", data?.error?.message ?? "We couldn’t reach the media service. Please try again.", response.status, data?.error?.retryable ?? true);
  return data as T;
}
export async function analyzeMedia(url: string, signal?: AbortSignal): Promise<MediaAnalysis> {
  return analysisSchema.parse(await apiRequest("/api/analyze", { url }, signal));
}
export async function prepareMedia(analysisId: string, formatId: string, signal?: AbortSignal): Promise<MediaJob> {
  return jobSchema.parse(await apiRequest("/api/prepare", { analysisId, formatId }, signal));
}
export async function readJob(id: string, signal?: AbortSignal): Promise<MediaJob> {
  return jobSchema.parse(await apiRequest(`/api/jobs/${encodeURIComponent(id)}`, undefined, signal));
}


"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeMedia, prepareMedia, readJob } from "@/lib/media/client";
import { MediaError, type MediaAnalysis, type MediaJob } from "@/lib/media/types";

export function useMediaController() {
  const [analysis, setAnalysis] = useState<MediaAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [job, setJob] = useState<MediaJob | null>(null);
  const [error, setError] = useState<MediaError | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const analyze = useCallback(async (url: string) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setAnalyzing(true); setPreparing(false); setError(null); setAnalysis(null); setJob(null);
    try {
      const result = await analyzeMedia(url, controller.signal);
      if (!controller.signal.aborted) setAnalysis(result);
      return result;
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof MediaError ? e : new MediaError("NETWORK_ERROR", "The media service returned an unexpected response. Please try again.", 502, true));
    } finally { if (!controller.signal.aborted) setAnalyzing(false); }
  }, []);
  const prepare = useCallback(async (formatId: string) => {
    if (!analysis) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setError(null); setJob(null); setPreparing(true);
    try {
      let next = await prepareMedia(analysis.id, formatId, controller.signal);
      const deadline = Date.now() + 10 * 60_000;
      setJob(next);
      while (next.state === "queued" || next.state === "processing") {
        if (Date.now() > deadline) throw new MediaError("CONVERSION_ERROR", "This export is taking longer than expected. Try preparing it again.", 504, true);
        await new Promise<void>((resolve, reject) => { const onAbort = () => { clearTimeout(timer); reject(controller.signal.reason); }; const timer = setTimeout(() => { controller.signal.removeEventListener("abort", onAbort); resolve(); }, 1800); controller.signal.addEventListener("abort", onAbort, { once: true }); });
        controller.signal.throwIfAborted(); next = await readJob(next.id, controller.signal); setJob(next);
      }
      if (next.state === "failed") throw new MediaError("CONVERSION_ERROR", next.error ?? "This export couldn’t be prepared. Try a different format.", 502, true);
      if (next.state === "ready" && !next.downloadUrl) throw new MediaError("CONVERSION_ERROR", "The export is missing its download link. Please try again.", 502, true);
      return next;
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof MediaError ? e : new MediaError("NETWORK_ERROR", "We lost the connection while preparing your file. Please try again.", 503, true)); }
    finally { if (!controller.signal.aborted) setPreparing(false); }
  }, [analysis]);
  const resetJob = useCallback(() => { request.current?.abort(); setPreparing(false); setJob(null); setError(null); }, []);
  const reset = useCallback(() => { request.current?.abort(); setAnalysis(null); setJob(null); setError(null); setPreparing(false); setAnalyzing(false); }, []);
  return { analysis, analyzing, preparing, job, error, analyze, prepare, reset, resetJob };
}

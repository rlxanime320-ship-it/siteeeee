"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import type { SceneState } from "./scene-runtime";

export function MediaScene({ phase, mode, reduced }: SceneState) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof import("./scene-runtime").createScene> | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ phase, mode, reduced });
  latest.current = { phase, mode, reduced };
  useEffect(() => {
    let cancelled = false;
    import("./scene-runtime").then(({ createScene }) => {
      if (cancelled || !host.current) return;
      try {
        controller.current = createScene(host.current, latest.current, () => setFailed(true));
        setReady(true);
      } catch { setFailed(true); }
    }).catch(() => setFailed(true));
    return () => { cancelled = true; controller.current?.dispose(); controller.current = null; };
  }, []);
  useEffect(() => { controller.current?.update({ phase, mode, reduced }); }, [phase, mode, reduced]);
  return <div className={`media-scene ${ready && !failed ? "scene-ready" : ""} phase-${phase}`} aria-hidden="true">
    <div className="scene-halo" />
    {(!ready || failed) && <div className="scene-fallback"><div className="fallback-frame"><Play size={68} fill="currentColor" strokeWidth={1}/></div></div>}
    <div className="scene-canvas" ref={host} style={{ visibility: failed ? "hidden" : "visible" }} />
    <div className="scene-coordinate coordinate-left"><span>V / D — 001</span><i/>MEDIA CORE</div>
    <div className="scene-coordinate coordinate-right"><span>{mode === "audio" ? "AUDIO SPECTRUM" : "SOURCE INTEGRITY"}</span><i/>{phase === "analyzing" ? "READING STREAM" : phase === "error" ? "AWAITING SOURCE" : "EVERY DETAIL, INTACT"}</div>
  </div>;
}

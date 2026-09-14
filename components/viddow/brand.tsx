import type { ReactNode } from "react";
export function Wordmark({ small = false }: { small?: boolean }) {
  return <span className={`wordmark ${small ? "wordmark-small" : ""}`} aria-label="VIDdow">
    <svg viewBox="0 0 34 37" fill="none" aria-hidden="true"><path d="M2 4h8l9 20 5-11h8L19 36z" fill="currentColor"/><path className="logo-stream" d="m19 1 4 8h-8z" fill="#ad91ff"/></svg>
    <span aria-hidden="true">ID<span className="wordmark-light">dow</span><span className="wordmark-point">.</span></span>
  </span>;
}
export function PlatformIcon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    YouTube: <><rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor"/><path d="m10 9 6 3-6 3z" fill="var(--icon-cutout, #15131f)"/></>,
    TikTok: <path d="M15 2h3c.3 2.4 1.6 4 4 4.3v3.2a9 9 0 0 1-4-1.2v7.4a6.2 6.2 0 1 1-6.3-6.2v3.2a3 3 0 1 0 3.3 3z" fill="currentColor"/>,
    Instagram: <><rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/></>,
    Facebook: <path d="M14 22v-9h3l.5-3H14V8c0-1 .3-1.5 1.7-1.5H18V3.2A20 20 0 0 0 15 3c-3 0-5 1.8-5 5v2H7v3h3v9z" fill="currentColor"/>,
    "X / Twitter": <path d="M4 3h5l4.5 6L19 3h2l-6.5 7.5L22 21h-5l-5-7-6 7H3l7.5-8.5zM7 5l11 14h1L8 5z" fill="currentColor"/>,
    Vimeo: <path d="M2 8.5 3.4 10l2-1c1 0 1.5 4 2.2 6.5 1 4 2 6 4 6 3 0 10-9 10.4-14.5.5-5-6-5-8 0 2-1 3 0 2 2-2 4-3 6-4 6-.8 0-1.5-5-2-8C9.3 1.5 6 4 2 8.5" fill="currentColor"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">{paths[name] ?? <path d="m8 5-6 7 6 7m8-14 6 7-6 7m-2-16-4 18" stroke="currentColor" strokeWidth="1.5"/>}</svg>;
}

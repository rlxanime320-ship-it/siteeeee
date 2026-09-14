"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, AudioLines, Check, CircleCheck, Film, Layers3, ShieldCheck, Sparkles } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatBytes, type MediaAnalysis, type MediaFormat, type MediaJob } from "@/lib/media/types";

function QualityCard({ format, selected, onSelect, disabled }: { format: MediaFormat; selected: boolean; onSelect: () => void; disabled: boolean }) {
  return <button type="button" className={`quality-card ${selected ? "selected" : ""} ${format.original ? "original" : ""}`} onClick={onSelect} aria-pressed={selected} disabled={disabled}>
    <span className="quality-radio">{selected && <Check size={13}/>}</span>
    <span className="quality-main"><strong>{format.original ? <><Sparkles size={17}/>Original quality</> : format.kind === "audio" ? format.bitrateKbps ? `${Number(format.bitrateKbps.toFixed(1))} kbps` : format.container.toUpperCase() : format.height ? `${format.height}p` : format.container.toUpperCase()}{format.original && <span className="source-badge">SOURCE</span>}</strong>
      <span>{format.original ? "Best available source · every detail preserved" : format.kind === "video" ? `${format.width && format.height ? `${format.width} × ${format.height}` : "Source resolution"}${format.fps ? ` · ${Number(format.fps.toFixed(2))} FPS` : ""}` : `${format.container.toUpperCase()}${format.codec ? ` · ${format.codec}` : ""}`}</span>
    </span>
    <span className="quality-end"><span>{format.container.toUpperCase()}{format.fps && format.original ? ` · ${Number(format.fps.toFixed(2))} FPS` : ""}</span><span>{formatBytes(format.bytes, format.estimated)}</span></span>
  </button>;
}

export function FormatSelector({ analysis, mode, onMode, preparing, job, onPrepare, onChange }: { analysis: MediaAnalysis; mode: "video" | "audio"; onMode: (mode: "video" | "audio") => void; preparing: boolean; job: MediaJob | null; onPrepare: (id: string) => void; onChange: () => void }) {
  const [selected, setSelected] = useState(analysis.formats.find(f=>f.kind===mode)?.id ?? analysis.formats[0].id);
  const [container, setContainer] = useState("mp3");
  const audio = analysis.formats.filter(f=>f.kind === "audio").sort((a,b)=> (["mp3","m4a","aac","wav","opus"].indexOf(a.container)-["mp3","m4a","aac","wav","opus"].indexOf(b.container)) || (b.bitrateKbps??0)-(a.bitrateKbps??0));
  const containers = [...new Set(audio.map(f=>f.container))];
  const selectedFormat = analysis.formats.find(f=>f.id===selected);
  useEffect(() => { const first=mode==="audio"?audio[0]:analysis.formats.find(f=>f.kind===mode);setSelected(first?.id??"");if(first?.kind==="audio")setContainer(first.container);onChange(); }, [analysis.id, mode]); // Selection belongs to the current source and mode.
  const choose = (format: MediaFormat) => { setSelected(format.id); onChange(); };
  return <div className="format-selector">
    <Tabs value={mode} onValueChange={(v)=>onMode(v as "video"|"audio")}>
      <div className="format-header"><TabsList className="media-tabs" aria-label="Export type"><TabsTrigger value="video"><Film size={16}/>Video</TabsTrigger><TabsTrigger value="audio"><AudioLines size={17}/>Audio</TabsTrigger></TabsList><span className="available-label"><Layers3 size={14}/>{analysis.formats.filter(f=>f.kind===mode).length} available formats</span></div>
      <TabsContent value="video" className="format-content"><motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="quality-list">{analysis.formats.filter(f=>f.kind==="video").map(format=><QualityCard key={format.id} format={format} selected={selected===format.id} onSelect={()=>choose(format)} disabled={preparing}/>)}{!analysis.formats.some(f=>f.kind==="video") && <p className="empty-formats">This source only contains audio.</p>}</motion.div></TabsContent>
      <TabsContent value="audio" className="format-content"><motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
        {audio.length ? <><div className="audio-formats" role="group" aria-label="Audio container">{containers.map(c=><button key={c} aria-pressed={(containers.includes(container as MediaFormat["container"])?container:containers[0])===c} disabled={preparing} onClick={()=>{setContainer(c);const f=audio.find(a=>a.container===c);if(f)choose(f);}}>{c.toUpperCase()}</button>)}</div><div className="quality-list">{audio.filter(f=>f.container===(containers.includes(container as MediaFormat["container"])?container:containers[0])).map(format=><QualityCard key={format.id} format={format} selected={selected===format.id} onSelect={()=>choose(format)} disabled={preparing}/>)}</div></> : <div className="empty-formats"><AudioLines size={28}/><strong>No audio export is available</strong><p>This source has no supported audio stream. Its original video is still available.</p></div>}
      </motion.div></TabsContent>
    </Tabs>
    <div className="download-action"><div className="download-caption"><ShieldCheck size={16}/><span>{selectedFormat ? `${selectedFormat.container.toUpperCase()} · ${formatBytes(selectedFormat.bytes, selectedFormat.estimated)}` : "Choose an available format"}</span></div>
      {job?.state === "ready" && job.downloadUrl ? <a href={job.downloadUrl} download className="primary-button download-button ready"><CircleCheck size={19}/>Ready — save file<ArrowDown size={18}/></a> : <button className="primary-button download-button" onClick={()=>selectedFormat&&onPrepare(selectedFormat.id)} disabled={preparing || !selectedFormat || selectedFormat.kind!==mode}>{preparing ? <><span className="preparing-bars" aria-hidden="true"><i/><i/><i/></span>Preparing download…</> : <><ArrowDown size={19}/>Download {mode === "video" ? "video" : "audio"}<span className="button-key">↵</span></>}</button>}
    </div>
    <AnimatePresence>{(preparing || job?.state === "ready") && <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:"auto"}} exit={{opacity:0,height:0}} className="download-status" role="status">{job?.state === "ready" ? "Your file is ready. Save it to your device using the button above." : <>{job?.phase ?? (job?.state === "queued" ? "Your export is in the queue." : "Preparing your selected format.")}{job?.progress !== undefined && <><progress max={100} value={job.progress}/><span>{Math.round(job.progress)}%</span></>}</>}</motion.div>}</AnimatePresence>
  </div>;
}


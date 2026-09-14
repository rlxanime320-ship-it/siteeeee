"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowDownToLine, ArrowRight, AudioLines, Check, ChevronRight, CircleAlert, Clipboard, Command, Film, Globe2, Layers3, Link2, MoveUpRight, Orbit, Pause, Play, Plus, RotateCcw, ShieldCheck, Sparkles, X, Zap } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Wordmark, PlatformIcon } from "./brand";
import { MediaScene } from "./media-scene";
import { FormatSelector } from "./format-selector";
import { useMediaController } from "./use-media-controller";
import { detectPlatform, durationLabel, PLATFORMS, type MediaAnalysis } from "@/lib/media/types";

const steps = ["Analyzing source", "Reading media streams", "Detecting available qualities", "Preparing formats"];
const questions = [
  ["What can I download with VIDdow?", "VIDdow is designed for public media you own or have permission to download. YouTube, TikTok, Instagram, Facebook, X, and Vimeo links are recognized. Platform downloads become available when the deployment’s media provider is connected. The VIDdow original sample is available right now."],
  ["Will my video keep its original quality?", "Choose Original quality to preserve the best source stream exposed by the provider. Resolution, frame rate, codec, and file size come from the actual source. VIDdow never invents higher resolutions or frame rates, and does not upscale a video and call it original."],
  ["Can I save just the audio?", "Yes, when an audio stream or a real conversion is available. Switch to Audio to see supported formats and bitrates. MP3, M4A, AAC, WAV, and OPUS only appear when the media provider can produce them. A higher output bitrate cannot restore detail missing from the source."],
  ["Why is a link unavailable?", "A video may be private, removed, region-restricted, or unsupported by the connected provider. VIDdow does not bypass authentication, access restrictions, or DRM. If you see a connection message, use the sample or try again after the platform service is connected."],
  ["Are my links and downloads stored?", "This interface has no link history or user accounts. Sample files are permanent app-owned assets; sample download links expire after 30 minutes. A connected provider is responsible for processing storage and must delete temporary files when its jobs expire. Browser downloads stay on your device."],
];

function AnalysisSequence({ reduced }: { reduced: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(()=>{const id=setInterval(()=>setStep(s=>Math.min(s+1,steps.length-1)),1200);return()=>clearInterval(id);},[]);
  return <motion.div className="analysis-sequence" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} role="status" aria-live="polite"><div className="analysis-signal" aria-hidden="true">{Array.from({length:19},(_,i)=><i key={i} style={{height:`${8+Math.sin(i*.7)**2*24}px`,animationDelay:`${i*40}ms`,animationPlayState:reduced?"paused":"running"}}/>)}</div><span>{steps[step]}<span className="analysis-dots">…</span></span><div className="analysis-stages" aria-hidden="true">{steps.map((s,i)=><i key={s} className={i<=step?"active":""}/>)}</div></motion.div>;
}

function MediaPreview({ analysis }: { analysis: MediaAnalysis }) {
  const [playing, setPlaying] = useState(false);
  const best=analysis.formats.find(f=>f.kind==="video"&&f.original)??analysis.formats.find(f=>f.kind==="video");
  const canPlay=Boolean(analysis.preview&&!playing);
  return <div className="media-preview"><div className="thumbnail-shell" onClick={canPlay?()=>setPlaying(true):undefined} onKeyDown={canPlay?e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setPlaying(true);}}:undefined} role={canPlay?"button":undefined} tabIndex={canPlay?0:undefined} aria-label={canPlay?`Play preview of ${analysis.title}`:undefined}>
    {playing && analysis.preview ? <video src={analysis.preview} controls autoPlay playsInline poster={analysis.thumbnail} aria-label={analysis.title}/> : <>{analysis.thumbnail ? <img src={analysis.thumbnail} alt={`Preview of ${analysis.title}`} loading="lazy"/> : <div className="thumbnail-empty"><Film size={44}/></div>}{analysis.preview && <button className="preview-play" onClick={()=>setPlaying(true)} aria-label="Play media preview"><Play fill="currentColor" size={23}/></button>}<span className="duration-badge">{durationLabel(analysis.duration)}</span></>}
    </div><div className="media-metadata"><span className="source-label">{analysis.demo ? <Orbit size={14}/> : <PlatformIcon name={analysis.source} size={16}/>} {analysis.source}{analysis.demo&&<span className="sample-badge">ORIGINAL SAMPLE</span>}</span><h2>{analysis.title}</h2><p>{analysis.creator ?? "Public media"}</p><div className="metadata-chips">{best?.width&&best.height&&<span><Film size={13}/>{best.width} × {best.height}</span>}{best?.fps&&<span><Zap size={13}/>{Number(best.fps.toFixed(2))} FPS</span>}{best?.codec&&<span>{best.codec}</span>}</div></div></div>;
}

function SupportedPlatforms({ providerReady, trySample }: { providerReady: boolean; trySample: () => void }) {
  return <section className="supported-section section-shell" id="supported-sites"><div className="section-eyebrow"><span>01 / CONNECTED POSSIBILITIES</span><Globe2 size={15}/></div><div className="section-heading"><h2>All your worlds.<br/><span>One destination.</span></h2><p>From the big screen to the short scroll.<br/>Bring your media together.</p></div>
    <div className="platform-track">{PLATFORMS.map((p,i)=><Tooltip key={p.name}><TooltipTrigger asChild><a href="#downloader" className={`platform-token token-${i}`} aria-label={`${p.name}. ${providerReady ? "Provider connected; availability depends on the source" : "Media provider connection required"}`}><span className="platform-glass"><PlatformIcon name={p.name} size={31}/><span className="token-reflection"/></span><span>{p.name==="X / Twitter"?"X / Twitter":p.name}</span></a></TooltipTrigger><TooltipContent>{providerReady?"Public media · subject to source availability":"Platform provider connection required"}</TooltipContent></Tooltip>)}<button className="platform-token token-more" onClick={trySample}><span className="platform-glass"><Plus size={28}/></span><span>Try a sample</span></button></div>
    <div className="platform-note"><span className={`connection-indicator ${providerReady?"connected":""}`}/>{providerReady?"Media provider connected. Availability varies by source.":"Platform-ready. Connect a media provider to enable live links."}<a href="#faq">Learn more<MoveUpRight size={12}/></a></div>
  </section>;
}

function HowItWorks() {
  const items=[{title:"Find it. Paste it.",text:"Copy a public media link and drop it into the console.",Icon:Link2},{title:"Make it your format.",text:"Choose the real source quality, or take just the audio.",Icon:Layers3},{title:"Take it with you.",text:"Prepare your file. Save it. Keep the moments that matter.",Icon:ArrowDownToLine}];
  return <section className="how-section section-shell" id="how-it-works"><div className="section-eyebrow"><span>02 / LESS FRICTION. MORE FLOW.</span><ArrowRight size={16}/></div><div className="section-heading"><h2>Three steps.<br/><span>Then it’s yours.</span></h2><p>No maze of menus.<br/>Just a straight line to your media.</p></div><div className="steps-grid">{items.map(({title,text,Icon},i)=><motion.article className={`step-card step-${i}`} key={title} initial={{opacity:0,y:24}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:.3}} transition={{delay:i*.08,duration:.5}}><div className="step-visual" aria-hidden="true"><span className="step-number">0{i+1}</span><div className="step-icon-stage"><span/><span/><Icon size={33} strokeWidth={1.4}/>{i===2&&<div className="data-rain"><i/><i/><i/></div>}</div><span className="step-connector"/></div><h3>{title}</h3><p>{text}</p></motion.article>)}</div></section>;
}

export function VIDdowApp() {
  const media=useMediaController();
  const [url,setUrl]=useState("");
  const [mode,setMode]=useState<"video"|"audio">("video");
  const [calm,setCalm]=useState(false);
  const systemReduced=useReducedMotion();
  const [mounted,setMounted]=useState(false);
  const reduced=Boolean((mounted&&systemReduced)||calm);
  const [scanned,setScanned]=useState(false);
  const [clipboardMessage,setClipboardMessage]=useState("");
  const [providerReady,setProviderReady]=useState(false);
  const [scrolled,setScrolled]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  const results=useRef<HTMLDivElement>(null);
  const scanTimer=useRef<ReturnType<typeof setTimeout> | null>(null);
  const platform=detectPlatform(url);
  const youtubeTemporarilyUnavailable=platform==="YouTube"&&Boolean(media.error)&&["PRIVATE_MEDIA","MEDIA_UNAVAILABLE","CONVERSION_ERROR"].includes(media.error!.code);
  const phase=media.analyzing?"analyzing":media.preparing?"downloading":media.error?"error":media.analysis?"results":"idle";
  useEffect(()=>{setMounted(true);try{setCalm(localStorage.getItem("viddow-calm")==="true");}catch{}fetch("/api/capabilities").then(r=>r.json() as Promise<{providerReady:boolean}>).then(d=>setProviderReady(d.providerReady===true)).catch(()=>{});const scroll=()=>setScrolled(window.scrollY>25);scroll();window.addEventListener("scroll",scroll,{passive:true});return()=>{window.removeEventListener("scroll",scroll);if(scanTimer.current)clearTimeout(scanTimer.current);};},[]);
  useEffect(()=>{if(media.analysis){setMode(media.analysis.formats.some(f=>f.kind==="video")?"video":"audio");setTimeout(()=>results.current?.scrollIntoView({behavior:reduced?"instant":"smooth",block:"center"}),120);}},[media.analysis,reduced]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();input.current?.focus();input.current?.scrollIntoView({behavior:reduced?"instant":"smooth",block:"center"});}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[reduced]);
  function scan(){setScanned(false);requestAnimationFrame(()=>setScanned(true));if(scanTimer.current)clearTimeout(scanTimer.current);scanTimer.current=setTimeout(()=>setScanned(false),900);}
  function submit(e:FormEvent){e.preventDefault();setClipboardMessage("");void media.analyze(url.trim());}
  async function paste(){try{const value=await navigator.clipboard.readText();setUrl(value.trim());scan();input.current?.focus();}catch{setClipboardMessage("Use Ctrl+V or ⌘V to paste your link into the field.");input.current?.focus();}}
  function trySample(){const value=`${window.location.origin}/media/chromatic.mp4`;setUrl(value);scan();setMenuOpen(false);void media.analyze(value);}
  function toggleCalm(){const value=!calm;setCalm(value);try{localStorage.setItem("viddow-calm",String(value));}catch{}}
  // The browser tool invokes the exact same analysis action as the visible form.
  useEffect(()=>{type Context={registerTool:(tool:unknown,options:{signal:AbortSignal})=>void|Promise<void>};const context=(document as Document&{modelContext?:Context}).modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();try{void Promise.resolve(context.registerTool({name:"analyze_media",title:"Analyze media",description:"Analyze an authorized public media URL and display its real available formats. Does not prepare or download a file.",inputSchema:{type:"object",properties:{url:{type:"string"}},required:["url"],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async(value:unknown)=>{if(!value||typeof value!=="object"||!("url"in value)||typeof value.url!=="string"||value.url.length>2048)throw new Error("A valid media URL is required.");setUrl(value.url);const result=await media.analyze(value.url);if(!result)throw new Error("Analysis failed. See the visible error for details.");return {title:result.title,source:result.source,formats:result.formats};}},{signal:lifecycle.signal})).catch(()=>{});}catch{}return()=>lifecycle.abort();},[media.analyze]);
  return <MotionConfig reducedMotion={reduced?"always":"never"}><TooltipProvider delayDuration={180}><div className={`viddow-app ${reduced?"calm-mode":""}`}>
    <a href="#media-url" className="skip-link">Skip to downloader</a>
    <header className={`site-nav ${scrolled?"is-scrolled":""}`}><a href="#downloader" className="brand-link" aria-label="VIDdow home" onClick={()=>setMenuOpen(false)}><Wordmark/></a><nav aria-label="Main navigation" className={menuOpen?"nav-links open":"nav-links"}>{[["Downloader","downloader"],["Supported Sites","supported-sites"],["How It Works","how-it-works"],["FAQ","faq"]].map(([label,id],i)=><a key={id} className={i===0?"nav-active":""} href={`#${id}`} onClick={()=>setMenuOpen(false)}>{label}</a>)}</nav><div className="nav-actions"><Tooltip><TooltipTrigger asChild><button className="visual-mode" onClick={toggleCalm} aria-pressed={calm} aria-label={calm?"Enable ambient motion":"Reduce ambient motion"}>{reduced?<Pause size={15}/>:<Orbit size={17}/>}<span>{reduced?"Calm mode":"Full experience"}</span></button></TooltipTrigger><TooltipContent>Adjust ambient motion. System preferences are always respected.</TooltipContent></Tooltip><button className="mobile-menu" aria-label={menuOpen?"Close navigation":"Open navigation"} aria-expanded={menuOpen} onClick={()=>setMenuOpen(!menuOpen)}>{menuOpen?<X size={20}/>:<span><i/><i/></span>}</button></div></header>
    <main>
      <section className={`hero ${media.analysis?"has-results":""}`} id="downloader"><div className="hero-grid" aria-hidden="true"/><div className="hero-toplight" aria-hidden="true"/>
        <motion.div className="hero-intro" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:.7}}><div className="hero-eyebrow"><span className="tiny-spectrum"><i/><i/><i/><i/></span>YOUR MEDIA. IN ITS ELEMENT.</div><h1>Beyond the <span>stream.</span></h1><p>Keep the moments. Keep the quality.<br className="mobile-break"/> Make them yours.</p></motion.div>
        <MediaScene phase={phase} mode={mode} reduced={reduced}/>
        <div className="scene-flags" aria-hidden="true"><span><span className="flag-diamond"/>SOURCE → POSSIBILITIES</span><span><i/>DESIGNED TO PRESERVE</span></div>
        <div className="console-area"><div className={`url-console ${scanned?"is-scanning":""} ${media.analyzing?"is-analyzing":""}`}><div className="console-label"><span><Link2 size={13}/>THE LINK IS THE BEGINNING</span><span className="console-index">INPUT / 01</span></div><form onSubmit={submit} className="url-form"><div className="input-wrap"><Link2 className="input-link" size={21}/><label htmlFor="media-url" className="sr-only">Public media URL</label><input id="media-url" ref={input} value={url} onChange={e=>setUrl(e.target.value)} onPaste={scan} placeholder="Paste a video link…" autoComplete="off" spellCheck={false} inputMode="url" required maxLength={2048} aria-describedby="url-help" disabled={media.analyzing}/>{platform&&<span className="detected-platform" title={platform}><PlatformIcon name={platform} size={18}/></span>}<Tooltip><TooltipTrigger asChild><button type="button" className="paste-button" onClick={paste} aria-label="Paste from clipboard" disabled={media.analyzing}><Clipboard size={18}/></button></TooltipTrigger><TooltipContent>Paste link</TooltipContent></Tooltip></div><button className="primary-button analyze-button" type="submit" disabled={media.analyzing}>{media.analyzing?"Analyzing…":"Analyze"}{media.analyzing?<span className="mini-scan"/>:<ArrowRight size={19}/>}</button></form><div className="console-shine"/></div>
          <div className="console-helper" id="url-help"><span><ShieldCheck size={14}/>Public links. Your content or permission.</span><button onClick={trySample} disabled={media.analyzing}>Try a sample<ArrowRight size={13}/></button></div>
          {clipboardMessage&&<p role="status" className="clipboard-message">{clipboardMessage}</p>}
          <AnimatePresence mode="wait">{media.analyzing&&<AnalysisSequence key="analysis" reduced={reduced}/>}</AnimatePresence>
          <AnimatePresence>{media.error&&<motion.div className="error-card" key="error" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0}} role="alert"><CircleAlert size={21}/><div><h3>{youtubeTemporarilyUnavailable?"YouTube is temporarily unavailable":media.error.code==="PROVIDER_UNAVAILABLE"?"This source isn’t connected yet":media.error.code==="INVALID_URL"?"That link needs another look":media.error.code==="PRIVATE_MEDIA"?"This media isn’t public":"We couldn’t finish this one"}</h3><p>{youtubeTemporarilyUnavailable?"YouTube is currently rejecting server-side requests from VIDdow’s media provider. TikTok and Facebook remain available.":media.error.message}</p><div className="error-actions">{media.error.code==="PROVIDER_UNAVAILABLE"?<button onClick={trySample}>Explore the working sample<ArrowRight size={14}/></button>:<button onClick={()=>media.analysis?media.resetJob():void media.analyze(url)}><RotateCcw size={13}/>{media.analysis?"Try another format":"Try again"}</button>}<button onClick={()=>{media.reset();input.current?.focus();}}>Change link</button></div></div><button className="dismiss-error" onClick={media.analysis?media.resetJob:media.reset} aria-label="Dismiss error"><X size={16}/></button></motion.div>}</AnimatePresence>
        </div>
        <AnimatePresence>{media.analysis&&<motion.div className="results-panel" ref={results} key={media.analysis.id} initial={{opacity:0,y:35,rotateX:5}} animate={{opacity:1,y:0,rotateX:0}} exit={{opacity:0,y:20}} transition={{type:"spring",stiffness:130,damping:22}}><div className="result-topline"><span><Check size={14}/>SOURCE ANALYZED</span><button onClick={()=>{media.reset();setUrl("");input.current?.focus();}}><Plus size={14}/>New link</button></div><MediaPreview analysis={media.analysis}/><FormatSelector analysis={media.analysis} mode={mode} onMode={setMode} preparing={media.preparing} job={media.job} onPrepare={media.prepare} onChange={media.resetJob}/></motion.div>}</AnimatePresence>
        {!media.analysis&&!media.analyzing&&<div className="hero-benefits"><span><Sparkles size={16}/>Source quality, preserved</span><i/><span><AudioLines size={17}/>Video & audio</span><i/><span><Zap size={16}/>Nothing to install</span></div>}
        <div className="hero-bottom"><span>GOOD MEDIA SHOULDN’T STAY IN ONE PLACE.</span><a href="#supported-sites" aria-label="Explore supported platforms"><ArrowDown size={17}/></a><span className="scroll-label">SCROLL TO EXPLORE</span></div>
      </section>
      <SupportedPlatforms providerReady={providerReady} trySample={trySample}/>
      <section className="quality-manifesto section-shell"><div className="manifesto-orbit" aria-hidden="true"><Orbit size={102} strokeWidth={.55}/><Sparkles size={25}/></div><div><span className="section-eyebrow">NOT A PIXEL OUT OF PLACE.</span><h2>Original means <em>original.</em></h2><p>Actual resolution. Actual frame rate. The best your source has to offer.<br/>No invented quality. No detail left behind.</p></div><span className="manifesto-seal"><ShieldCheck size={24}/><span>SOURCE<br/>INTEGRITY</span></span></section>
      <HowItWorks/>
      <section className="faq-section section-shell" id="faq"><div className="faq-heading"><span className="section-eyebrow">03 / THE FINER DETAILS</span><h2>A little clarity.</h2><p>Good questions.<br/>Straight answers.</p><span className="faq-mark" aria-hidden="true">?</span></div><Accordion type="single" collapsible className="faq-list">{questions.map(([q,a],i)=><AccordionItem value={`faq-${i}`} key={q}><AccordionTrigger>{q}</AccordionTrigger><AccordionContent>{a}</AccordionContent></AccordionItem>)}</Accordion></section>
    </main>
    <footer className="site-footer section-shell"><div className="footer-main"><a href="#downloader" aria-label="VIDdow home"><Wordmark small/></a><span>A new perspective on your media.</span><a href="#downloader">Back to the stream<MoveUpRight size={15}/></a></div><div className="footer-bottom"><span>© {new Date().getFullYear()} VIDdow</span><p>Made for media you own or have permission to use. Respect creators.</p><span className="footer-signal"><i/><i/><i/><i/><i/></span></div></footer>
  </div></TooltipProvider></MotionConfig>;
}


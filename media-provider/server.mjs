import { createServer } from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";

const HOST = process.env.VIDDOW_PROVIDER_HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const PORT = Number.parseInt(process.env.PORT || process.env.VIDDOW_PROVIDER_PORT || "8788", 10);
const TOKEN = process.env.VIDDOW_PROVIDER_TOKEN || process.env.MEDIA_PROVIDER_TOKEN || "viddow-local-development";
const YTDLP_OVERRIDE = process.env.YTDLP_PATH?.trim();
const FFMPEG_OVERRIDE = process.env.FFMPEG_PATH?.trim();
const MAX_FILE_BYTES = 2_000_000_000;
const ANALYSIS_TTL_MS = 35 * 60_000;
const JOB_TTL_MS = 35 * 60_000;
const MAX_JSON_BYTES = 32_000;
const MAX_TOOL_OUTPUT = 24 * 1024 * 1024;
const TMP_ROOT = path.join(os.tmpdir(), "viddow-provider");

if (!["127.0.0.1", "localhost", "::1"].includes(HOST) && TOKEN === "viddow-local-development") {
  throw new Error("Set VIDDOW_PROVIDER_TOKEN before binding the media provider to a non-loopback interface.");
}

const SUPPORTED_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
  "instagram.com", "www.instagram.com",
  "facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch",
  "x.com", "www.x.com", "twitter.com", "www.twitter.com",
  "vimeo.com", "www.vimeo.com", "player.vimeo.com",
]);

const analyses = new Map();
const jobs = new Map();
const idempotency = new Map();
let resolvedYtDlp;
let ytDlpProbe;

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function providerError(res, status, code, message) {
  json(res, status, { error: { code, message } });
}

function authorized(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(TOKEN);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function cleanText(value, max = 300) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max);
}

function supportedUrl(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || /[:\[\]]/.test(url.hostname) || /^\d+(\.\d+)*$/.test(url.hostname)) return null;
    if (!SUPPORTED_HOSTS.has(url.hostname.toLowerCase())) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function safeRemoteAssetUrl(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 16_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(":")) return null;
    return url.href;
  } catch {
    return null;
  }
}

function safeRemoteHeaders(...values) {
  const allowed = new Set(["user-agent", "referer", "origin", "accept", "accept-language"]);
  const headers = {};
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    for (const [name, raw] of Object.entries(value)) {
      const key = String(name).toLowerCase();
      if (!allowed.has(key) || typeof raw !== "string" || raw.length > 2048 || /[\r\n]/.test(raw)) continue;
      headers[key] = raw;
    }
  }
  return headers;
}

function selectThumbnail(info) {
  const candidates = [
    ...(Array.isArray(info.thumbnails) ? [...info.thumbnails].reverse().map(item => item?.url) : []),
    info.thumbnail,
  ];
  for (const value of candidates) {
    const url = safeRemoteAssetUrl(value);
    if (url) return { url, headers: safeRemoteHeaders(info.http_headers), mime: "image/jpeg" };
  }
  return undefined;
}

function selectPreview(info) {
  const rawFormats = Array.isArray(info.formats) ? info.formats : [];
  const candidates = rawFormats.filter(format => {
    if (!hasVideo(format) || !hasAudio(format)) return false;
    if (!safeRemoteAssetUrl(format.url)) return false;
    const protocol = String(format.protocol || "").toLowerCase();
    if (protocol.includes("m3u8") || protocol.includes("dash")) return false;
    return true;
  });
  candidates.sort((a, b) => {
    const ah = number(a.height) || 0, bh = number(b.height) || 0;
    const aPreferred = ah > 0 && ah <= 720 ? 1 : 0;
    const bPreferred = bh > 0 && bh <= 720 ? 1 : 0;
    return bPreferred - aPreferred || (bPreferred ? bh - ah : ah - bh) || (number(b.tbr) || 0) - (number(a.tbr) || 0);
  });
  const format = candidates[0];
  if (!format) return undefined;
  const url = safeRemoteAssetUrl(format.url);
  if (!url) return undefined;
  const ext = String(format.ext || "").toLowerCase();
  const mime = ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime" : "video/mp4";
  return { url, headers: safeRemoteHeaders(info.http_headers, format.http_headers), mime };
}

async function proxyRemoteAsset(req, res, asset, kind) {
  if (!asset?.url) return providerError(res, 404, "MEDIA_UNAVAILABLE", "This preview is unavailable.");
  const headers = new Headers(asset.headers || {});
  const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set("range", range);
  let response;
  try {
    response = await fetch(asset.url, { headers, redirect: "follow", signal: AbortSignal.timeout(45_000) });
  } catch {
    return providerError(res, 502, "MEDIA_UNAVAILABLE", "The source preview could not be loaded.");
  }
  if (!(response.ok || response.status === 206) || !response.body) {
    await response.body?.cancel();
    return providerError(res, response.status === 403 ? 403 : 502, "MEDIA_UNAVAILABLE", "The source preview could not be loaded.");
  }
  const responseType = response.headers.get("content-type")?.split(";")[0]?.trim();
  const contentType = responseType && (kind === "thumbnail" ? responseType.startsWith("image/") : responseType.startsWith("video/")) ? responseType : asset.mime;
  const out = {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=120",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": response.headers.get("accept-ranges") || "bytes",
  };
  for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = response.headers.get(name);
    if (value) out[name.split("-").map(part => part[0].toUpperCase()+part.slice(1)).join("-")] = value;
  }
  res.writeHead(response.status, out);
  Readable.fromWeb(response.body).on("error", () => res.destroy()).pipe(res);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON request."), { status: 400 });
  }
}

function run(command, args, { timeout = 60_000, maxOutput = MAX_TOOL_OUTPUT, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let carry = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const append = (target, chunk) => {
      if (target.length + chunk.length > maxOutput) throw Object.assign(new Error("Media tool produced too much output."), { code: "OUTPUT_LIMIT" });
      return Buffer.concat([target, chunk]);
    };
    child.stdout.on("data", chunk => {
      try {
        stdout = append(stdout, chunk);
        if (onLine) {
          carry += chunk.toString("utf8");
          const lines = carry.split(/\r?\n/);
          carry = lines.pop() || "";
          for (const line of lines) onLine(line);
        }
      } catch (error) {
        child.kill();
        finish(error);
      }
    });
    child.stderr.on("data", chunk => {
      try { stderr = append(stderr, chunk); }
      catch (error) { child.kill(); finish(error); }
    });
    child.on("error", error => finish(error));
    child.on("close", code => {
      if (onLine && carry) onLine(carry);
      const result = { code: code ?? 1, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") };
      if (code === 0) finish(null, result);
      else finish(Object.assign(new Error(result.stderr || result.stdout || `Process exited with code ${code}`), { processResult: result }));
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(Object.assign(new Error("Media tool timed out."), { code: "TIMEOUT" }));
    }, timeout);
  });
}

async function probe(command, prefix = []) {
  try {
    const result = await run(command, [...prefix, "--version"], { timeout: 8_000, maxOutput: 256_000 });
    return result.stdout.trim() || result.stderr.trim() ? { command, prefix } : null;
  } catch {
    return null;
  }
}

async function findYtDlp() {
  if (resolvedYtDlp) return resolvedYtDlp;
  if (ytDlpProbe) return ytDlpProbe;
  ytDlpProbe = (async () => {
    const candidates = [];
    if (YTDLP_OVERRIDE) candidates.push({ command: YTDLP_OVERRIDE, prefix: [] });
    candidates.push({ command: process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp", prefix: [] });
    if (process.platform === "win32") candidates.push({ command: "yt-dlp", prefix: [] }, { command: "py", prefix: ["-m", "yt_dlp"] });
    candidates.push({ command: process.platform === "win32" ? "python" : "python3", prefix: ["-m", "yt_dlp"] });
    candidates.push({ command: "python", prefix: ["-m", "yt_dlp"] });
    for (const candidate of candidates) {
      const found = await probe(candidate.command, candidate.prefix);
      if (found) {
        resolvedYtDlp = found;
        return found;
      }
    }
    return null;
  })();
  const result = await ytDlpProbe;
  ytDlpProbe = undefined;
  return result;
}

async function runYtDlp(args, options = {}) {
  const tool = await findYtDlp();
  if (!tool) throw Object.assign(new Error("yt-dlp is not installed or not available on PATH."), { code: "YTDLP_MISSING" });
  const ffmpeg = FFMPEG_OVERRIDE ? ["--ffmpeg-location", FFMPEG_OVERRIDE] : [];
  // The Render image already uses Node 22. Current yt-dlp releases can use it
  // for YouTube's external JS challenge solver when the EJS package is installed.
  const jsRuntime = ["--js-runtimes", "node"];
  return run(tool.command, [...tool.prefix, "--ignore-config", ...jsRuntime, ...ffmpeg, ...args], options);
}

function platformName(info) {
  const value = `${info.extractor_key || ""} ${info.extractor || ""}`.toLowerCase();
  if (value.includes("youtube")) return "YouTube";
  if (value.includes("tiktok")) return "TikTok";
  if (value.includes("instagram")) return "Instagram";
  if (value.includes("facebook")) return "Facebook";
  if (value.includes("twitter") || value.includes(" x")) return "X / Twitter";
  if (value.includes("vimeo")) return "Vimeo";
  return cleanText(info.extractor_key || info.extractor || "Public media", 80) || "Public media";
}

function number(value) {
  return Number.isFinite(value) && value > 0 ? Number(value) : undefined;
}

function approximateBytes(format, duration, extraAudio) {
  const exact = number(format.filesize);
  if (exact) return { bytes: Math.round(exact + (number(extraAudio?.filesize) || 0)), estimated: Boolean(extraAudio && !number(extraAudio.filesize)) };
  const approximate = number(format.filesize_approx);
  if (approximate) return { bytes: Math.round(approximate + (number(extraAudio?.filesize_approx) || number(extraAudio?.filesize) || 0)), estimated: true };
  const videoRate = number(format.tbr) || number(format.vbr);
  const audioRate = number(extraAudio?.abr) || number(extraAudio?.tbr) || 0;
  if (duration && (videoRate || audioRate)) return { bytes: Math.round(((videoRate || 0) + audioRate) * 1000 * duration / 8), estimated: true };
  return {};
}

function audioBytes(kbps, duration) {
  if (!kbps || !duration) return {};
  return { bytes: Math.round(kbps * 1000 * duration / 8), estimated: true };
}

function codecLabel(format) {
  const codec = cleanText(format.vcodec || "", 80);
  if (!codec || codec === "none") return undefined;
  if (/^avc1|h264/i.test(codec)) return "H.264";
  if (/^hev1|^hvc1|hevc|h265/i.test(codec)) return "HEVC";
  if (/^vp9/i.test(codec)) return "VP9";
  if (/^av01|av1/i.test(codec)) return "AV1";
  return codec;
}

function normalizedContainer(format) {
  const ext = String(format.ext || "").toLowerCase();
  if (ext === "webm") return "webm";
  if (ext === "mov") return "mov";
  return "mp4";
}

function hasVideo(format) { return format && format.vcodec && format.vcodec !== "none"; }
function hasAudio(format) { return format && format.acodec && format.acodec !== "none"; }

function makeVideoSelection(format, audioFormats) {
  const container = normalizedContainer(format);
  if (hasAudio(format)) return { selector: String(format.format_id), mergeContainer: container };
  const compatible = audioFormats.find(audio => {
    const ext = String(audio.ext || "").toLowerCase();
    if (container === "webm") return ext === "webm" || /opus|vorbis/i.test(String(audio.acodec || ""));
    return ext === "m4a" || ext === "mp4" || /aac|mp4a/i.test(String(audio.acodec || ""));
  }) || audioFormats[0];
  if (!compatible?.format_id) return { selector: String(format.format_id), mergeContainer: container };
  return { selector: `${format.format_id}+${compatible.format_id}`, mergeContainer: container, extraAudio: compatible };
}

function buildFormats(info) {
  const duration = number(info.duration);
  const rawFormats = Array.isArray(info.formats) ? info.formats : [];
  const videos = rawFormats.filter(f => hasVideo(f) && number(f.height) && f.format_id !== undefined && f.format_id !== null).sort((a, b) =>
    (number(b.height) || 0) - (number(a.height) || 0) ||
    (number(b.fps) || 0) - (number(a.fps) || 0) ||
    (number(b.tbr) || 0) - (number(a.tbr) || 0)
  );
  const audios = rawFormats.filter(f => hasAudio(f) && !hasVideo(f)).sort((a, b) =>
    (number(b.abr) || number(b.tbr) || 0) - (number(a.abr) || number(a.tbr) || 0)
  );
  const formats = [];
  const mapping = new Map();

  const seen = new Set();
  const selectedVideos = [];
  for (const format of videos) {
    const key = `${Math.round(number(format.height) || 0)}:${Math.round(number(format.fps) || 0)}:${normalizedContainer(format)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selectedVideos.push(format);
    if (selectedVideos.length >= 18) break;
  }

  if (selectedVideos.length) {
    const source = selectedVideos[0];
    const selection = makeVideoSelection(source, audios);
    const size = approximateBytes(source, duration, selection.extraAudio);
    const sourceFormat = {
      id: "video-original",
      kind: "video",
      container: selection.mergeContainer,
      codec: codecLabel(source),
      width: number(source.width) ? Math.round(source.width) : undefined,
      height: number(source.height) ? Math.round(source.height) : undefined,
      fps: number(source.fps),
      ...size,
      original: true,
    };
    formats.push(sourceFormat);
    mapping.set(sourceFormat.id, { kind: "video", ...selection });

    let index = 0;
    for (const format of selectedVideos.slice(1)) {
      const selectionItem = makeVideoSelection(format, audios);
      const sizeItem = approximateBytes(format, duration, selectionItem.extraAudio);
      const value = {
        id: `video-${++index}`,
        kind: "video",
        container: selectionItem.mergeContainer,
        codec: codecLabel(format),
        width: number(format.width) ? Math.round(format.width) : undefined,
        height: number(format.height) ? Math.round(format.height) : undefined,
        fps: number(format.fps),
        ...sizeItem,
        original: false,
      };
      formats.push(value);
      mapping.set(value.id, { kind: "video", ...selectionItem });
    }
  } else if (hasVideo(info)) {
    const container = normalizedContainer(info);
    const value = {
      id: "video-original",
      kind: "video",
      container,
      codec: codecLabel(info),
      width: number(info.width) ? Math.round(info.width) : undefined,
      height: number(info.height) ? Math.round(info.height) : undefined,
      fps: number(info.fps),
      original: true,
    };
    formats.push(value);
    mapping.set(value.id, { kind: "video", selector: "bestvideo+bestaudio/best", mergeContainer: container });
  }

  const sourceHasAudio = audios.length > 0 || hasAudio(info) || rawFormats.some(hasAudio);
  if (sourceHasAudio) {
    const audioProfiles = [
      ["mp3", 320], ["mp3", 256], ["mp3", 192], ["mp3", 160], ["mp3", 128],
      ["m4a", 256], ["m4a", 192], ["m4a", 128],
      ["aac", 256], ["aac", 192], ["aac", 128],
      ["opus", 192], ["opus", 160], ["opus", 128],
      ["wav", undefined],
    ];
    for (const [container, bitrate] of audioProfiles) {
      const id = bitrate ? `audio-${container}-${bitrate}` : `audio-${container}`;
      const size = bitrate ? audioBytes(bitrate, duration) : audioBytes(1411, duration);
      formats.push({
        id,
        kind: "audio",
        container,
        codec: container === "mp3" ? "MP3" : container === "m4a" ? "AAC" : container.toUpperCase(),
        ...(bitrate ? { bitrateKbps: bitrate } : {}),
        ...size,
        original: false,
      });
      mapping.set(id, { kind: "audio", audioFormat: container, bitrate });
    }
  }

  return { formats: formats.slice(0, 80), mapping };
}

function classifyYtDlpError(error) {
  if (error?.code === "YTDLP_MISSING") return { status: 503, code: "PROVIDER_UNAVAILABLE", message: "The media engine is installed in VIDdow, but yt-dlp is missing on this computer. Install yt-dlp and restart VIDdow." };
  if (error?.code === "TIMEOUT") return { status: 504, code: "MEDIA_UNAVAILABLE", message: "The source took too long to respond. Please try again." };
  const text = `${error?.message || ""}\n${error?.processResult?.stderr || ""}`.toLowerCase();
  if (/private|login required|sign in|members[- ]only|authentication required|cookies/.test(text)) return { status: 403, code: "PRIVATE_MEDIA", message: "This media requires access that VIDdow does not use. Try a public, unrestricted source." };
  if (/unsupported url|no suitable extractor/.test(text)) return { status: 400, code: "UNSUPPORTED_SOURCE", message: "This public link is not supported by the installed media engine." };
  if (/video unavailable|not available|removed|deleted|404/.test(text)) return { status: 404, code: "MEDIA_UNAVAILABLE", message: "This media is unavailable from its source." };
  return { status: 502, code: "MEDIA_UNAVAILABLE", message: "The source could not be processed. It may be unavailable or temporarily blocking requests." };
}


function providerDiagnostic(error, sourceUrl) {
  const raw = `${error?.message || ""}\n${error?.processResult?.stderr || ""}\n${error?.processResult?.stdout || ""}`.trim();
  const source = sourceUrl?.href || "";
  return raw
    .replaceAll(source, "[source-url]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/[\r\n]+/g, " | ")
    .slice(-3500);
}

async function analyze(url) {
  const result = await runYtDlp([
    "--no-playlist",
    "--skip-download",
    "--dump-single-json",
    "--no-warnings",
    "--socket-timeout", "20",
    "--retries", "2",
    "--fragment-retries", "2",
    "--", url.href,
  ], { timeout: 75_000 });
  const info = JSON.parse(result.stdout);
  if (!info || typeof info !== "object") throw new Error("The media engine returned invalid metadata.");
  const { formats, mapping } = buildFormats(info);
  if (!formats.length) throw new Error("The source does not contain a supported audio or video stream.");
  const reference = randomBytes(18).toString("hex");
  const thumbnail = selectThumbnail(info);
  const preview = selectPreview(info);
  analyses.set(reference, { url: url.href, mapping, thumbnail, preview, expiresAt: Date.now() + ANALYSIS_TTL_MS });
  return {
    id: reference,
    title: cleanText(info.title, 300) || "Untitled media",
    source: platformName(info),
    duration: number(info.duration),
    creator: cleanText(info.uploader || info.channel || info.creator || info.artist || "", 160) || undefined,
    thumbnailAvailable: Boolean(thumbnail),
    previewAvailable: Boolean(preview),
    formats,
  };
}

async function runDownloadJob(job, analysis, selection) {
  job.state = "processing";
  job.phase = selection.kind === "audio" ? "Extracting and converting audio" : "Preparing the selected video stream";
  try {
    await fs.mkdir(job.dir, { recursive: true });
    const outputTemplate = path.join(job.dir, "viddow.%(ext)s");
    const common = [
      "--no-playlist",
      "--no-warnings",
      "--newline",
      "--socket-timeout", "25",
      "--retries", "3",
      "--fragment-retries", "3",
      "--max-filesize", "1900M",
      "--no-mtime",
      "-o", outputTemplate,
    ];
    const progressArgs = ["--progress-template", "download:VIDDOW_PROGRESS:%(progress._percent_str)s"];
    const onLine = line => {
      const match = line.match(/^VIDDOW_PROGRESS:\s*([\d.]+)%/);
      if (match) job.progress = Math.max(0, Math.min(99, Number(match[1])));
    };
    if (selection.kind === "audio") {
      const args = [
        ...common,
        "-f", "bestaudio/best",
        "-x",
        "--audio-format", selection.audioFormat,
        ...(selection.bitrate ? ["--audio-quality", `${selection.bitrate}K`] : []),
        ...progressArgs,
        "--", analysis.url,
      ];
      await runYtDlp(args, { timeout: 20 * 60_000, maxOutput: 6 * 1024 * 1024, onLine });
    } else {
      const args = [
        ...common,
        "-f", selection.selector,
        ...(selection.mergeContainer === "mp4" || selection.mergeContainer === "webm" ? ["--merge-output-format", selection.mergeContainer] : []),
        ...progressArgs,
        "--", analysis.url,
      ];
      await runYtDlp(args, { timeout: 20 * 60_000, maxOutput: 6 * 1024 * 1024, onLine });
    }
    const entries = await fs.readdir(job.dir, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && !/\.(part|ytdl|temp|tmp)$/i.test(entry.name));
    if (!files.length) throw new Error("The media engine completed without creating an export file.");
    const candidates = await Promise.all(files.map(async entry => ({ entry, stat: await fs.stat(path.join(job.dir, entry.name)) })));
    candidates.sort((a, b) => b.stat.size - a.stat.size);
    const chosen = candidates[0];
    if (chosen.stat.size <= 0 || chosen.stat.size > MAX_FILE_BYTES) throw new Error("The prepared export exceeds the supported file size limit.");
    job.file = path.join(job.dir, chosen.entry.name);
    job.bytes = chosen.stat.size;
    job.mime = mimeForFile(chosen.entry.name);
    job.progress = 100;
    job.phase = "Ready";
    job.state = "ready";
  } catch (error) {
    const issue = classifyYtDlpError(error);
    job.state = "failed";
    job.error = issue.message;
    job.phase = "Export failed";
    try { await fs.rm(job.dir, { recursive: true, force: true }); } catch {}
  }
}

function mimeForFile(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".mov": return "video/quicktime";
    case ".mp3": return "audio/mpeg";
    case ".m4a": return "audio/mp4";
    case ".aac": return "audio/aac";
    case ".wav": return "audio/wav";
    case ".opus": return "audio/opus";
    case ".ogg": return "audio/ogg";
    default: return "application/octet-stream";
  }
}

function publicJob(job) {
  return {
    id: job.id,
    state: job.state,
    ...(job.progress !== undefined ? { progress: job.progress } : {}),
    ...(job.phase ? { phase: job.phase } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

async function prepare(analysisId, formatId, idemKey) {
  const analysis = analyses.get(analysisId);
  if (!analysis || analysis.expiresAt <= Date.now()) throw Object.assign(new Error("This analysis has expired. Analyze the link again."), { status: 410, code: "EXPIRED" });
  const selection = analysis.mapping.get(formatId);
  if (!selection) throw Object.assign(new Error("The selected format is not available for this source."), { status: 400, code: "INVALID_REQUEST" });
  if (idemKey && idempotency.has(idemKey)) {
    const existing = jobs.get(idempotency.get(idemKey));
    if (existing && existing.expiresAt > Date.now() && existing.state !== "failed") return existing;
    idempotency.delete(idemKey);
  }
  const id = randomBytes(18).toString("hex");
  const job = {
    id,
    state: "queued",
    phase: "Queued",
    progress: 0,
    dir: path.join(TMP_ROOT, id),
    expiresAt: Date.now() + JOB_TTL_MS,
  };
  jobs.set(id, job);
  if (idemKey) idempotency.set(idemKey, id);
  queueMicrotask(() => void runDownloadJob(job, analysis, selection));
  return job;
}

async function cleanup() {
  const now = Date.now();
  for (const [id, analysis] of analyses) if (analysis.expiresAt <= now) analyses.delete(id);
  for (const [id, job] of jobs) {
    if (job.expiresAt > now) continue;
    jobs.delete(id);
    try { await fs.rm(job.dir, { recursive: true, force: true }); } catch {}
  }
  for (const [key, id] of idempotency) if (!jobs.has(id)) idempotency.delete(key);
}

await fs.mkdir(TMP_ROOT, { recursive: true });
setInterval(() => void cleanup(), 60_000).unref();

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (requestUrl.pathname === "/health") {
      const ytDlp = await findYtDlp();
      return json(res, 200, { ok: Boolean(ytDlp), engine: ytDlp ? "yt-dlp" : "missing", supported: ["YouTube", "TikTok", "Instagram", "Facebook", "X / Twitter", "Vimeo"] });
    }
    if (!authorized(req)) return providerError(res, 401, "UNAUTHORIZED", "Invalid media provider token.");

    if (req.method === "POST" && requestUrl.pathname === "/analyze") {
      const body = await readJsonBody(req);
      const url = supportedUrl(body?.url);
      if (!url) return providerError(res, 400, "UNSUPPORTED_SOURCE", "Use a public HTTPS link from YouTube, TikTok, Instagram, Facebook, X, or Vimeo.");
      console.log(`[VIDdow media provider] analyze start host=${url.hostname}`);
      try {
        const result = await analyze(url);
        console.log(`[VIDdow media provider] analyze ok host=${url.hostname} source=${result.source} formats=${result.formats.length}`);
        return json(res, 200, result);
      }
      catch (error) {
        const issue = classifyYtDlpError(error);
        console.error(`[VIDdow media provider] analyze failed host=${url.hostname} status=${issue.status} code=${issue.code} :: ${providerDiagnostic(error, url)}`);
        return providerError(res, issue.status, issue.code, issue.message);
      }
    }

    if (req.method === "POST" && requestUrl.pathname === "/prepare") {
      const body = await readJsonBody(req);
      if (!body || typeof body.analysisId !== "string" || typeof body.formatId !== "string") return providerError(res, 400, "INVALID_REQUEST", "analysisId and formatId are required.");
      try {
        const job = await prepare(body.analysisId, body.formatId, cleanText(req.headers["idempotency-key"] || "", 160));
        return json(res, 200, publicJob(job));
      } catch (error) {
        return providerError(res, error.status || 400, error.code || "INVALID_REQUEST", cleanText(error.message, 300));
      }
    }

    const assetMatch = requestUrl.pathname.match(/^\/asset\/([a-zA-Z0-9_-]+)\/(thumbnail|preview)$/);
    if (req.method === "GET" && assetMatch) {
      const analysis = analyses.get(assetMatch[1]);
      if (!analysis || analysis.expiresAt <= Date.now()) return providerError(res, 404, "EXPIRED", "This preview has expired. Analyze the link again.");
      const kind = assetMatch[2];
      return proxyRemoteAsset(req, res, kind === "thumbnail" ? analysis.thumbnail : analysis.preview, kind);
    }

    const jobMatch = requestUrl.pathname.match(/^\/jobs\/([a-zA-Z0-9_-]+)$/);
    if (req.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job || job.expiresAt <= Date.now()) return providerError(res, 404, "EXPIRED", "This export has expired.");
      return json(res, 200, publicJob(job));
    }

    const downloadMatch = requestUrl.pathname.match(/^\/download\/([a-zA-Z0-9_-]+)$/);
    if (req.method === "GET" && downloadMatch) {
      const job = jobs.get(downloadMatch[1]);
      if (!job || job.expiresAt <= Date.now()) return providerError(res, 404, "EXPIRED", "This export has expired.");
      if (job.state !== "ready" || !job.file) return providerError(res, 409, "CONVERSION_ERROR", "This export is not ready yet.");
      const stat = await fs.stat(job.file).catch(() => null);
      if (!stat?.isFile()) return providerError(res, 404, "MEDIA_UNAVAILABLE", "The prepared file is no longer available.");
      res.writeHead(200, {
        "Content-Type": job.mime || mimeForFile(job.file),
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${path.basename(job.file).replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return createReadStream(job.file).pipe(res);
    }

    providerError(res, 404, "NOT_FOUND", "Media provider route not found.");
  } catch (error) {
    console.error("VIDdow provider request failed:", error instanceof Error ? error.message : error);
    if (!res.headersSent) providerError(res, error?.status || 500, "PROVIDER_ERROR", "The media provider could not complete this request.");
    else res.destroy();
  }
});

server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
server.listen(PORT, HOST, () => {
  console.log(`[VIDdow media provider] listening on http://${HOST}:${PORT}`);
  console.log("[VIDdow media provider] public authorized media only; no cookies, private-media access, or DRM bypass is used.");
  void findYtDlp().then(tool => {
    if (tool) console.log(`[VIDdow media provider] yt-dlp ready via ${tool.command}`);
    else console.warn("[VIDdow media provider] yt-dlp was not found. Install yt-dlp or set YTDLP_PATH, then restart VIDdow.");
  });
});

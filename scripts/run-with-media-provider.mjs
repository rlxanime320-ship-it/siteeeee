import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const mode = process.argv[2] || "dev";
if (!new Set(["dev", "start"]).has(mode)) throw new Error("Expected dev or start.");

const root = fileURLToPath(new URL("../", import.meta.url));
const port = process.env.VIDDOW_PROVIDER_PORT || "8788";
const host = process.env.VIDDOW_PROVIDER_HOST || "127.0.0.1";
const token = process.env.VIDDOW_PROVIDER_TOKEN || "viddow-local-development";
const providerUrl = process.env.MEDIA_PROVIDER_URL || `http://${host}:${port}`;
const providerToken = process.env.MEDIA_PROVIDER_TOKEN || token;
const environment = {
  ...process.env,
  VIDDOW_PROVIDER_HOST: host,
  VIDDOW_PROVIDER_PORT: port,
  VIDDOW_PROVIDER_TOKEN: token,
  MEDIA_PROVIDER_URL: providerUrl,
  MEDIA_PROVIDER_TOKEN: providerToken,
  MEDIA_PROVIDER_ALLOW_LOCAL: providerUrl.startsWith("http://127.0.0.1:") || providerUrl.startsWith("http://localhost:") ? "1" : process.env.MEDIA_PROVIDER_ALLOW_LOCAL,
};

const provider = spawn(process.execPath, [path.join(root, "media-provider", "server.mjs")], {
  cwd: root,
  env: environment,
  stdio: "inherit",
  windowsHide: true,
});

const siteArgs = mode === "dev"
  ? [path.join(root, "scripts", "run-framework.mjs"), "dev", ...process.argv.slice(3)]
  : ["--import", path.join(root, "scripts", "sites-env.mjs"), path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--config", path.join(root, "dist", "server", "wrangler.json"), "--local", "--persist-to", path.join(root, ".wrangler", "state"), "--ip", "127.0.0.1", "--inspector-port", "0", ...process.argv.slice(3)];

const site = spawn(process.execPath, siteArgs, {
  cwd: root,
  env: environment,
  stdio: "inherit",
  windowsHide: true,
});

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try { site.kill(); } catch {}
  try { provider.kill(); } catch {}
  setTimeout(() => process.exit(code), 50).unref();
}

provider.on("exit", code => {
  if (!closing && code && code !== 0) console.error(`[VIDdow] media provider exited with code ${code}; the site will stay open but live downloads will be unavailable.`);
});
site.on("exit", code => shutdown(code ?? 0));
process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

// Deterministic trailer capture for demo/hero.html.
//
// Drives hero.html?capture through its fixed beat sheet ONE frame at a time in
// headless Chrome (fixed dt — no wall-clock, fully reproducible), screenshots each
// composited frame (GL canvas + DOM captions/receipts), then assembles them with
// ffmpeg into an H.264 MP4. Same input → identical output.
//
// Usage:
//   node demo/capture/record.mjs [--w 1920] [--h 1080] [--n 400000] [--dur 24]
//                                [--fps 60] [--clean] [--out out/trailer.mp4] [--keep]
//
// Needs: ffmpeg on PATH, and puppeteer (local `npm i puppeteer` or a global install),
// plus a Chrome/Chromium (auto-detected, or set CHROME_PATH).

import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = resolve(HERE, "../..");                 // helix-noise repo root (served)
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes("--" + k);
const W = +opt("w", 1920), H = +opt("h", 1080), N = +opt("n", 400000);
const DUR = +opt("dur", 33), FPS = +opt("fps", 60);
const CLEAN = has("clean"), KEEP = has("keep"), SW = has("sw"), PNG = has("png");
const OUT = resolve(HERE, opt("out", "out/trailer.mp4"));
const FRAMES = resolve(HERE, "frames");
const EXT = PNG ? "png" : "jpg";                     // jpg screenshots encode far faster than png

// Real GPU by default (SwiftShader is ~1000× slower); --sw forces software.
const gpuArgs = SW
  ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  : ["--ignore-gpu-blocklist", "--enable-gpu", ...(process.platform === "darwin" ? ["--use-angle=metal"] : [])];

// ---- resolve puppeteer: local first, then global ----------------------------
async function loadPuppeteer() {
  try { return (await import("puppeteer")).default; } catch {}
  const groot = execSync("npm root -g").toString().trim();
  const p = join(groot, "puppeteer/lib/esm/puppeteer/puppeteer.js");
  if (existsSync(p)) return (await import(pathToFileURL(p).href)).default;
  throw new Error("puppeteer not found (npm i puppeteer, or install it globally)");
}
function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return cands.find((c) => existsSync(c));   // undefined → let puppeteer decide
}

// ---- tiny static server (correct MIME for ES modules) -----------------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".css": "text/css", ".map": "application/json", ".wasm": "application/wasm" };
function serve() {
  const srv = createServer(async (req, res) => {
    try {
      const p = resolve(ROOT, "." + decodeURIComponent(req.url.split("?")[0]));
      if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const data = await readFile(p);
      res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" });
      res.end(data);
    } catch { res.writeHead(404).end("not found"); }
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, port: srv.address().port })));
}

// ---- main -------------------------------------------------------------------
const puppeteer = await loadPuppeteer();
const exe = findChrome();
const { srv, port } = await serve();
rmSync(FRAMES, { recursive: true, force: true }); mkdirSync(FRAMES, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });

const url = `http://127.0.0.1:${port}/demo/hero.html?capture=1&n=${N}&dur=${DUR}&fps=${FPS}${CLEAN ? "&clean=1" : ""}`;
console.log(`[capture] ${W}×${H} · ${N.toLocaleString()} streaklets · ${DUR}s @ ${FPS}fps → ${OUT}`);
console.log(`[capture] ${url}`);

const browser = await puppeteer.launch({
  headless: true, executablePath: exe, protocolTimeout: 120000,
  args: [...gpuArgs, "--no-sandbox", "--disable-gpu-sandbox", "--disable-dev-shm-usage", `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("[page error]", e.message));
await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction("window.__cap && window.__cap.TOTAL > 0", { timeout: 30000 });

const total = await page.evaluate("window.__cap.TOTAL");
const paint = () => page.evaluate(() => new Promise((res) => {   // wait one paint, but never stall
  let done = false; requestAnimationFrame(() => { done = true; res(); }); setTimeout(() => { if (!done) res(); }, 60);
}));
const shotOpts = PNG ? { type: "png" } : { type: "jpeg", quality: 95 };
async function shoot(path) {                                     // transient CDP errors → retry
  for (let a = 0; a < 3; a++) {
    try { await page.screenshot({ path, ...shotOpts }); return; }
    catch (e) { if (a === 2) throw e; await new Promise((r) => setTimeout(r, 150)); }
  }
}
const rend = await page.evaluate(() => { const g = document.createElement("canvas").getContext("webgl2"); const d = g && g.getExtension("WEBGL_debug_renderer_info"); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : "unknown"; });
console.log(`[capture] renderer: ${rend}`);
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  await page.evaluate((k) => window.__cap.frame(k), i);
  await paint();
  await shoot(join(FRAMES, `f_${String(i).padStart(5, "0")}.${EXT}`));
  if (i % 30 === 0 || i === total - 1) {
    const pct = (((i + 1) / total) * 100).toFixed(0);
    process.stdout.write(`\r[capture] frame ${i + 1}/${total} (${pct}%)   `);
  }
}
process.stdout.write(`\n[capture] ${total} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
await browser.close();
srv.close();

// ---- assemble ---------------------------------------------------------------
console.log("[ffmpeg] encoding H.264 …");
await new Promise((res, rej) => {
  const ff = spawn("ffmpeg", ["-y", "-framerate", String(FPS),
    "-i", join(FRAMES, `f_%05d.${EXT}`),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow",
    "-movflags", "+faststart", OUT], { stdio: ["ignore", "ignore", "inherit"] });
  ff.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg exit " + c))));
});
if (!KEEP) rmSync(FRAMES, { recursive: true, force: true });
console.log(`[done] ${OUT}`);

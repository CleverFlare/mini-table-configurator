// Records the demo videos for the motion graphics explainer: the desktop view
// recoloring the sweater, and the mobile view tapping "Install app". Writes
// 60 fps ProRes masters, H.264 previews and a JSON of every pointer action to
// recordings/, so a cursor can be animated to match in post.
//
// Frames are captured one at a time on a controlled clock, however long a 4K
// screenshot takes: Playwright's fake clock steps requestAnimationFrame,
// timers and performance.now exactly 1/60 s per frame, and CSS animations
// are paused and moved to the same time. Uses the Chromium build that this
// playwright-core version installs (`bunx playwright install chromium`).
//
// Usage: bun run record-demo

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";

const ROOT = path.resolve(import.meta.dir, "..");
const OUT = path.join(ROOT, "recordings");
const FPS = 60;
const FRAME_MS = 1000 / FPS;
const PREVIEW_PORT = 4180;
const APP_URL = `http://localhost:${PREVIEW_PORT}/`;

type Point = { x: number; y: number };

type View = {
  name: "desktop" | "mobile";
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
  userAgent?: string;
  // Width of the H.264 preview, in pixels.
  previewWidth: number;
};

// Runs before the app's scripts.
function initPage() {
  // Headless Chromium's WebGPU on Linux fails to compile the floor shadow's
  // pipeline, which takes the sweater down with it; the WebGL 2 backend
  // renders the same materials.
  Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined });
  // Chrome may offer installation on its own once the service worker is
  // active; that event is dropped, so the install button only appears when
  // the recording asks for it.
  window.addEventListener(
    "beforeinstallprompt",
    (event) => {
      if (event.isTrusted) event.stopImmediatePropagation();
    },
    true,
  );
}

// Pauses every CSS animation and transition and moves it to the recording's
// time, one frame at a time. Runs in the page once the fake clock is in.
function installCssStepper() {
  let now = 0;
  const started = new WeakMap<Animation, number>();
  (window as unknown as { stepCss: (ms: number) => void }).stepCss = (ms) => {
    now += ms;
    for (const animation of document.getAnimations()) {
      if (!started.has(animation)) {
        started.set(animation, now - Number(animation.currentTime ?? 0));
        animation.pause();
      }
      const time = now - started.get(animation)!;
      const end = Number(animation.effect?.getComputedTiming().endTime ?? Infinity);
      // Finishing, rather than parking at the end, settles `finished`.
      if (Number.isFinite(end) && time >= end) animation.finish();
      else animation.currentTime = time;
    }
  };
}

class Recording {
  private frameCount = 0;
  private ffmpeg: ChildProcess | null = null;
  readonly events: object[] = [];

  private constructor(
    private page: Page,
    private cdp: CDPSession,
    readonly view: View,
  ) {}

  static async open(browser: Browser, view: View) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: view.scale,
      isMobile: view.mobile,
      hasTouch: view.mobile,
      userAgent: view.userAgent,
    });
    await context.addInitScript(initPage);
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(`${view.name}: ${error.message}`));
    return new Recording(page, await context.newCDPSession(page), view);
  }

  // Loads the app on the real clock until it's fully ready: the loading
  // overlay has come and gone, and the service worker has finished
  // precaching, so its background downloads can't affect the recording.
  async load() {
    await this.page.goto(APP_URL);
    await this.page.waitForSelector(".fixed.inset-0.z-60", { timeout: 15_000 }).catch(() => {});
    await this.page.waitForFunction(
      async () =>
        !!document.querySelector("canvas") &&
        !document.querySelector(".fixed.inset-0.z-60") &&
        !!(await navigator.serviceWorker.getRegistration())?.active,
      null,
      { timeout: 60_000, polling: 250 },
    );
    // A moment more for anything still settling.
    await this.page.waitForTimeout(1500);
  }

  evaluate<T>(fn: () => T) {
    return this.page.evaluate(fn);
  }

  // From here on, time only moves when a frame is captured.
  async startRecording() {
    await this.page.clock.install();
    await this.page.evaluate(installCssStepper);
    // A few frames, so the first captured one shows a settled page.
    for (let i = 0; i < 5; i++) await this.advance();
    const { name, previewWidth } = this.view;
    const bt709 = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"];
    this.ffmpeg = spawn(
      "ffmpeg",
      [
        "-y", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
        // Master: ProRes 422 HQ.
        "-vf", "scale=out_color_matrix=bt709:out_range=tv",
        "-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0", "-pix_fmt", "yuv422p10le",
        ...bt709, path.join(OUT, `${name}.mov`),
        // Preview: H.264.
        "-vf", `scale=${previewWidth}:-2:flags=lanczos:out_color_matrix=bt709:out_range=tv`,
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
        ...bt709, "-movflags", "+faststart", path.join(OUT, `${name}.mp4`),
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
  }

  private async advance() {
    await this.page.clock.runFor(FRAME_MS);
    await this.page.evaluate((ms) => (window as unknown as { stepCss: (ms: number) => void }).stepCss(ms), FRAME_MS);
  }

  // Advances one frame and captures it.
  async frame() {
    await this.advance();
    const png = await this.page.screenshot({ type: "png" });
    if (this.frameCount === 0) this.checkSize(png);
    const stdin = this.ffmpeg!.stdin!;
    if (!stdin.write(png)) await once(stdin, "drain");
    this.frameCount++;
  }

  private checkSize(png: Buffer) {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const { view } = this;
    if (width !== view.width * view.scale || height !== view.height * view.scale) {
      throw new Error(`${view.name}: frames are ${width}×${height}, expected ${view.width * view.scale}×${view.height * view.scale}`);
    }
  }

  async hold(seconds: number) {
    for (let i = 0; i < Math.round(seconds * FPS); i++) await this.frame();
  }

  // Where and when, in the video's pixels and as fractions of the frame. An
  // action lands in the next captured frame, which is `frame`.
  private at({ x, y }: Point) {
    const { width, height, scale } = this.view;
    return {
      frame: this.frameCount,
      time: Number((this.frameCount / FPS).toFixed(4)),
      x: Math.round(x * scale),
      y: Math.round(y * scale),
      nx: Number((x / width).toFixed(5)),
      ny: Number((y / height).toFixed(5)),
    };
  }

  private released() {
    return { releasedFrame: this.frameCount, releasedTime: Number((this.frameCount / FPS).toFixed(4)) };
  }

  async box(selector: string) {
    const box = await this.page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`${this.view.name}: nothing visible matches ${selector}`);
    return box;
  }

  async center(selector: string): Promise<Point> {
    const { x, y, width, height } = await this.box(selector);
    return { x: x + width / 2, y: y + height / 2 };
  }

  // The pointer arrives here, hovering whatever is under it. The cursor in
  // post can travel any way it likes, as long as it lands here at this time.
  async moveTo(label: string, point: Point) {
    await this.page.mouse.move(point.x, point.y);
    this.events.push({ type: "move", label, ...this.at(point) });
  }

  // Hovers the target for a moment, then presses and releases it.
  async click(label: string, selector: string, { hover = 0.4, press = 0.1 } = {}) {
    const point = await this.center(selector);
    await this.moveTo(label, point);
    await this.hold(hover);
    await this.page.mouse.down();
    const pressed = this.at(point);
    await this.hold(press);
    await this.page.mouse.up();
    this.events.push({ type: "click", label, ...pressed, ...this.released() });
    await this.frame();
  }

  // Presses at `from`, moves to `to` with ease-in-out, one step per frame,
  // and releases. The event holds the pointer's position for every frame.
  async drag(label: string, from: Point, to: Point, seconds: number) {
    await this.moveTo(label, from);
    await this.hold(0.3);
    await this.page.mouse.down();
    const pressed = this.at(from);
    await this.frame();
    const path = [];
    const steps = Math.round(seconds * FPS);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const point = { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
      await this.page.mouse.move(point.x, point.y);
      path.push(this.at(point));
      await this.frame();
    }
    await this.page.mouse.up();
    this.events.push({ type: "drag", label, pressed, released: this.at(to), path });
    await this.frame();
  }

  // A finger held down for a moment, then lifted.
  async tap(label: string, selector: string, { press = 0.15 } = {}) {
    const point = await this.center(selector);
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    const pressed = this.at(point);
    await this.hold(press);
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    this.events.push({ type: "tap", label, ...pressed, ...this.released() });
    await this.frame();
  }

  async finish() {
    this.ffmpeg!.stdin!.end();
    await once(this.ffmpeg!, "exit");
    await this.page.context().close();
    const { name, width, height, scale } = this.view;
    writeFileSync(
      path.join(OUT, `${name}.events.json`),
      JSON.stringify(
        {
          video: `${name}.mov`,
          fps: FPS,
          width: width * scale,
          height: height * scale,
          // CSS pixels map to video pixels at this factor.
          deviceScaleFactor: scale,
          frames: this.frameCount,
          durationSeconds: Number((this.frameCount / FPS).toFixed(4)),
          events: this.events,
        },
        null,
        2,
      ),
    );
    console.log(`${name}: ${this.frameCount} frames, ${(this.frameCount / FPS).toFixed(2)} s`);
  }
}

// --- Storyboards -------------------------------------------------------------

const swatch = (label: string) => `[data-slot="color-picker-swatch-item"][aria-label="${label}"]`;
const part = (label: string) => `[data-slot="toggle-group-item"][aria-label="${label}"]`;

async function recordDesktop(browser: Browser) {
  const recording = await Recording.open(browser, {
    name: "desktop",
    width: 1920,
    height: 1080,
    scale: 2,
    mobile: false,
    previewWidth: 1920,
  });
  await recording.load();
  await recording.startRecording();
  // Park the pointer in empty space, so nothing starts out hovered.
  await recording.moveTo("Start", { x: 960, y: 1060 });

  await recording.hold(1);
  await recording.click("Bordeaux swatch", swatch("Bordeaux"));
  await recording.hold(1.3);
  await recording.click("Sleeves part", part("Sleeves"));
  await recording.hold(0.4);
  await recording.click("Camel swatch", swatch("Camel"));
  await recording.hold(1.3);
  await recording.click("Hood part", part("Hood"));
  await recording.hold(0.4);
  await recording.click("Forest swatch", swatch("Forest"));
  await recording.hold(1.3);

  // Drag the picker's handle toward a brighter, richer green.
  const thumb = await recording.center('[data-slot="color-picker-area-thumb"]');
  const area = await recording.box('[data-slot="color-picker-area"]');
  const target = { x: area.x + area.width * 0.7, y: area.y + area.height * 0.38 };
  await recording.drag("Custom color handle", thumb, target, 1.2);
  await recording.hold(1);

  // A slow orbit of about 40°, gliding out on the controls' damping.
  const canvas = await recording.box("canvas");
  const from = { x: canvas.x + canvas.width * 0.42, y: canvas.y + canvas.height * 0.55 };
  await recording.drag("Orbit", from, { x: from.x + canvas.height / 9, y: from.y }, 0.9);
  await recording.hold(2.5);

  await recording.finish();
}

async function recordMobile(browser: Browser) {
  const recording = await Recording.open(browser, {
    name: "mobile",
    width: 390,
    height: 844,
    scale: 3,
    mobile: true,
    // An Android Chrome phone: where an install button would appear.
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    previewWidth: 1170,
  });
  await recording.load();
  // Offer installation, as Chrome would. The choice never resolves, so the
  // button stays on screen after the tap, behind the dialog added in post.
  await recording.evaluate(() => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: () => Promise.resolve(),
      userChoice: new Promise(() => {}),
    });
    window.dispatchEvent(event);
  });
  await recording.startRecording();

  await recording.hold(1.5);
  await recording.tap("Install app button", 'button:has-text("Install app")');
  await recording.hold(2);

  await recording.finish();
}

// --- Main --------------------------------------------------------------------

async function waitForUrl(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function run(command: string, args: string[]) {
  const child = spawn(command, args, { cwd: ROOT, stdio: "inherit" });
  return new Promise<void>((resolve, reject) =>
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)))),
  );
}

mkdirSync(OUT, { recursive: true });
await run("bun", ["run", "build"]);
const preview = spawn("bunx", ["vite", "preview", "--port", String(PREVIEW_PORT), "--strictPort"], {
  cwd: ROOT,
  stdio: "ignore",
});
try {
  await waitForUrl(APP_URL);
  // Render on the GPU; the software fallback is far too slow at 4K.
  const browser = await chromium.launch({
    args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"],
  });
  try {
    await recordDesktop(browser);
    await recordMobile(browser);
  } finally {
    await browser.close();
  }

  // App icons, for the install animation in post.
  mkdirSync(path.join(OUT, "icons"), { recursive: true });
  for (const icon of ["pwa-192x192.png", "pwa-512x512.png", "apple-touch-icon-180x180.png"]) {
    copyFileSync(path.join(ROOT, "public", icon), path.join(OUT, "icons", icon));
  }
  console.log(`Done: ${OUT}`);
} finally {
  preview.kill();
}

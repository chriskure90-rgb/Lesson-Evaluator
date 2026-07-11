import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// pdf-parse wraps pdfjs-dist, whose Node ("legacy") build needs two things
// Vercel's serverless bundler (@vercel/nft) doesn't reliably trace, because
// pdfjs-dist deliberately hides both behind indirection to keep browser
// bundlers (webpack/vite) from doing the wrong thing with them:
//
//   1. @napi-rs/canvas, required via `process.getBuiltinModule("module")
//      .createRequire(...)` to polyfill DOMMatrix/ImageData/Path2D onto
//      globalThis. If missing, pdfjs-dist just warns and leaves the globals
//      unset — the actual crash ("ReferenceError: DOMMatrix is not
//      defined") only happens later, the first time parsing code uses one.
//
//   2. pdf.worker.mjs, loaded via `import(this.workerSrc)` with
//      `/*webpackIgnore: true*/ /*@vite-ignore*/` comments specifically so
//      browser bundlers leave it as a runtime dynamic import — but that
//      also means @vercel/nft can't statically resolve it, so it's absent
//      from the deployed function ("Setting up fake worker failed: Cannot
//      find module .../pdf.worker.mjs") unless something else references it.
//
// Both are fixed the same way: reference them explicitly with literal
// specifiers in OUR code (which @vercel/nft *can* trace), before pdf-parse
// ever touches pdfjs-dist. Call ensurePdfEnvironmentReady() once per process,
// before constructing any PDFParse instance. vercel.json's `includeFiles`
// is the belt-and-suspenders backstop in case tracing still misses the
// worker file.
let ready = false;

export async function ensurePdfEnvironmentReady() {
  if (ready) return;

  // 1. Canvas polyfills (DOMMatrix / ImageData / Path2D)
  try {
    const canvas = await import("@napi-rs/canvas");
    if (!globalThis.DOMMatrix) globalThis.DOMMatrix = canvas.DOMMatrix;
    if (!globalThis.ImageData) globalThis.ImageData = canvas.ImageData;
    if (!globalThis.Path2D) globalThis.Path2D = canvas.Path2D;
    console.log("[pdf-node-setup] @napi-rs/canvas polyfills installed:", {
      DOMMatrix: !!globalThis.DOMMatrix,
      ImageData: !!globalThis.ImageData,
      Path2D: !!globalThis.Path2D,
    });
  } catch (err) {
    console.error("[pdf-node-setup] failed to load @napi-rs/canvas for polyfills:", err?.message);
  }

  // 2. Worker path — resolve pdf.worker.mjs to an absolute file:// URL and
  // set it on the same pdfjs-dist module instance pdf-parse uses internally
  // (Node's module cache guarantees it's the same singleton), so pdfjs-dist's
  // own fake-worker loader (`GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs"`,
  // a relative specifier resolved against pdf.mjs's own location) sees ours
  // already set — an absolute file:// URL — and uses that instead.
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const require = createRequire(import.meta.url);
    const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    console.log("[pdf-node-setup] pdf.js worker configured:", pdfjsLib.GlobalWorkerOptions.workerSrc);
  } catch (err) {
    console.error("[pdf-node-setup] failed to configure pdf.js worker:", err?.message);
  }

  ready = true;
}

/**
 * Shared canvas export — PNG and animated GIF, with a preview of what you are
 * about to save.
 *
 * Owner feedback, 2026-08-18: "in every interactive tool or element which can be
 * exported as a gif, 80% of those don't even have an export button. and the only
 * tool which has export gif button, the gif isn't even visible on screen what is
 * about to be exported."
 *
 * Both halves of that are addressed here rather than per component, because
 * per-component was how it went wrong: the export code lived inside Driftfield,
 * so the six generative engines — every one of which draws to a canvas and is
 * the exact thing someone would want as a wallpaper — shipped with no way to
 * save anything at all.
 *
 * Two ways in, because the engines genuinely differ:
 *
 * - `attachCanvasExport()` records a LIVE canvas. It needs to know nothing about
 *   how the thing is drawn, which is what makes it adoptable by an animation
 *   loop that was never written with exporting in mind. The ceiling is honest
 *   and stated in the UI: it captures at the canvas's own pixel size, so asking
 *   for 2x scales pixels up rather than rendering more detail.
 * - `renderExport()` takes a resolution-independent draw function and renders
 *   offscreen at any size. Driftfield's patterns are written this way, so its
 *   PNG really is a 2560x1440 render and not an upscaled preview.
 *
 * Nothing downloads on its own. Encoding returns a Blob and the caller shows it
 * — an animated GIF that lands in the downloads folder unseen is the failure the
 * feedback above describes.
 */

import { GIFEncoder, quantize, applyPalette } from 'gifenc'

export interface ExportSize {
  id: string
  label: string
  w: number
  h: number
}

/**
 * Resolution presets, widened from the original four.
 *
 * The old list had one entry per device shape and no way to say a number, so
 * "give me a 4K desktop background" and "give me something small enough to
 * attach" were both unavailable. Custom is a real option, not a preset in
 * disguise — see `parseCustomSize`.
 */
export const EXPORT_SIZES: ExportSize[] = [
  { id: 'phone', label: 'Phone · 1080×2340', w: 1080, h: 2340 },
  { id: 'phone-hi', label: 'Phone (large) · 1440×3120', w: 1440, h: 3120 },
  { id: 'tablet', label: 'Tablet · 1668×2388', w: 1668, h: 2388 },
  { id: 'desktop', label: 'Desktop · 2560×1440', w: 2560, h: 1440 },
  { id: 'uhd', label: 'Desktop 4K · 3840×2160', w: 3840, h: 2160 },
  { id: 'hd', label: 'HD · 1920×1080', w: 1920, h: 1080 },
  { id: 'square', label: 'Square · 2048×2048', w: 2048, h: 2048 },
  { id: 'square-sm', label: 'Square (small) · 1080×1080', w: 1080, h: 1080 },
  { id: 'story', label: 'Story · 1080×1920', w: 1080, h: 1920 },
  { id: 'ultrawide', label: 'Ultrawide · 3440×1440', w: 3440, h: 1440 },
]

/** Beyond this a single canvas allocation starts failing on phones. */
export const EXPORT_MAX_EDGE = 8192
/** Total pixels, which is the constraint that actually bites: 8192² is 268MB at 4 bytes each. */
export const EXPORT_MAX_PIXELS = 40_000_000

export interface SizeError {
  ok: false
  reason: string
}
export type SizeResult = { ok: true; w: number; h: number } | SizeError

/**
 * Validate a user-typed resolution.
 *
 * Bounded in both dimensions AND in total pixels. Checking only the edges would
 * pass 8000×8000, which is 256 million pixels and a tab crash — the same
 * one-sided-bound trap AGENTS.md describes for the Type Trial validator, in a
 * different costume.
 */
export function parseCustomSize(rawW: unknown, rawH: unknown): SizeResult {
  const w = Math.round(Number(rawW))
  const h = Math.round(Number(rawH))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16) {
    return { ok: false, reason: 'Width and height must both be at least 16 pixels.' }
  }
  if (w > EXPORT_MAX_EDGE || h > EXPORT_MAX_EDGE) {
    return { ok: false, reason: `Neither side may exceed ${EXPORT_MAX_EDGE}px.` }
  }
  if (w * h > EXPORT_MAX_PIXELS) {
    return {
      ok: false,
      reason: `${w}×${h} is ${(w * h / 1e6).toFixed(0)} megapixels — over the ${EXPORT_MAX_PIXELS / 1e6} MP ceiling that keeps this from crashing the tab.`,
    }
  }
  return { ok: true, w, h }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoke on the next frame, not immediately: Safari has not finished reading
  // the blob when click() returns and produces a zero-byte file.
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Render a resolution-independent draw function into an offscreen canvas. */
export function renderExport(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, phase: number) => void,
  w: number,
  h: number,
  phase = 0,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D context for the export canvas.')
  draw(ctx, w, h, phase)
  return canvas
}

export interface GifOptions {
  width: number
  height: number
  frames?: number
  /** Milliseconds per frame. 83ms ≈ 12fps, which GIF's centisecond clock rounds cleanly. */
  delay?: number
  onProgress?: (done: number, total: number) => void
}

/**
 * Encode frames into an animated GIF and return the Blob.
 *
 * Deliberately does NOT download. The caller shows the result first — that is
 * the whole point of this module's existence.
 *
 * `quantize` runs per frame rather than once for the whole animation. A single
 * shared palette is smaller and faster, and it visibly bands on exactly the
 * content these engines produce: smooth gradients drifting through hue over the
 * loop. Per-frame palettes cost bytes and keep the gradients clean.
 */
export async function encodeGif(
  drawFrame: (ctx: CanvasRenderingContext2D, w: number, h: number, frame: number, total: number) => void | Promise<void>,
  options: GifOptions,
): Promise<Blob> {
  const { width, height, frames = 24, delay = 83, onProgress } = options
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not get a 2D context for the GIF canvas.')

  const gif = GIFEncoder()
  for (let frame = 0; frame < frames; frame++) {
    ctx.clearRect(0, 0, width, height)
    await drawFrame(ctx, width, height, frame, frames)
    const { data } = ctx.getImageData(0, 0, width, height)
    const palette = quantize(data, 256)
    const indexed = applyPalette(data, palette)
    gif.writeFrame(indexed, width, height, { palette, delay, repeat: 0 })
    onProgress?.(frame + 1, frames)
    // Yield so the progress text repaints; a synchronous 24-frame encode locks
    // the tab and looks like a hang on the exact devices this is capped for.
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  gif.finish()
  const bytes = gif.bytes()
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'image/gif',
  })
}

/* ─────────────────  live-canvas capture, for the engines  ───────────────── */

export interface LiveExportOptions {
  /** File-name stem, e.g. "murmuration". */
  name: string
  /** Seconds of animation to record into the GIF. */
  seconds?: number
  /** Frames to capture across those seconds. */
  frames?: number
  /** Longest GIF edge. Capped low on purpose — a full-resolution GIF is enormous. */
  maxGifEdge?: number
}

/**
 * Give any live canvas an export bar: PNG now, GIF recorded from what is
 * actually on screen, both previewed before saving.
 *
 * This exists so an engine does not have to be rewritten to be exportable. It
 * reads pixels off the canvas that is already animating, which means:
 *
 * - It works with any render loop, including ones using WebGL or drawing from
 *   worker output, provided the context was created with `preserveDrawingBuffer`
 *   where that applies to 2D-vs-WebGL.
 * - It cannot invent detail. A 900px-wide canvas exported "at 2x" is a 1800px
 *   upscale of 900px of information, and the UI says so rather than implying a
 *   bigger number means a better picture.
 */
export function attachCanvasExport(
  host: Element,
  getCanvas: () => HTMLCanvasElement | null,
  options: LiveExportOptions,
): HTMLElement {
  const { name, seconds = 2, frames = 24, maxGifEdge = 640 } = options

  const bar = document.createElement('div')
  bar.dataset.type = 'canvas-export'
  bar.innerHTML = `
    <div data-type="cx-actions">
      <label>Scale
        <select data-cx="scale">
          <option value="1">1× — as drawn</option>
          <option value="2">2× — upscaled</option>
          <option value="3">3× — upscaled</option>
        </select>
      </label>
      <button data-cx="png" type="button">Save image</button>
      <button data-cx="gif" type="button">Make a GIF</button>
      <span data-type="cx-status" role="status" aria-live="polite"></span>
    </div>
    <div data-type="cx-preview" hidden>
      <p data-type="cx-preview-label"></p>
      <img data-cx="preview" alt="Preview of the file about to be saved" />
      <div data-type="cx-preview-actions">
        <button data-cx="save" type="button">Save it</button>
        <button data-cx="discard" type="button">Discard</button>
      </div>
    </div>
  `
  host.append(bar)

  const status = bar.querySelector('[data-type="cx-status"]') as HTMLElement
  const preview = bar.querySelector('[data-type="cx-preview"]') as HTMLElement
  const previewImg = bar.querySelector('[data-cx="preview"]') as HTMLImageElement
  const previewLabel = bar.querySelector('[data-type="cx-preview-label"]') as HTMLElement
  const scaleSelect = bar.querySelector('[data-cx="scale"]') as HTMLSelectElement

  let pending: { blob: Blob; filename: string; url: string } | null = null

  const clearPending = () => {
    if (pending) URL.revokeObjectURL(pending.url)
    pending = null
    preview.hidden = true
    previewImg.removeAttribute('src')
  }

  const show = (blob: Blob, filename: string, note: string) => {
    clearPending()
    const url = URL.createObjectURL(blob)
    pending = { blob, filename, url }
    previewImg.src = url
    previewLabel.textContent = `${note} · ${formatBytes(blob.size)}`
    preview.hidden = false
    status.textContent = ''
  }

  bar.querySelector('[data-cx="png"]')!.addEventListener('click', () => {
    const source = getCanvas()
    if (!source) return
    const scale = Number(scaleSelect.value) || 1
    const w = source.width * scale
    const h = source.height * scale
    const check = parseCustomSize(w, h)
    if (!check.ok) {
      status.textContent = check.reason
      return
    }
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const ctx = out.getContext('2d')!
    // Nearest-neighbour would be sharper for pixel art and worse for everything
    // these engines draw, which is all curves and gradients.
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, w, h)
    out.toBlob(blob => {
      if (!blob) {
        status.textContent = 'Could not read the canvas.'
        return
      }
      show(blob, `${name}-${w}x${h}.png`, scale === 1
        ? `PNG · ${w}×${h}`
        : `PNG · ${w}×${h}, upscaled from ${source.width}×${source.height} — no extra detail`)
    }, 'image/png')
  })

  bar.querySelector('[data-cx="gif"]')!.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement
    const source = getCanvas()
    if (!source) return
    button.disabled = true
    clearPending()
    try {
      // Fit inside maxGifEdge, preserving aspect. A GIF of a 2560px canvas is
      // hundreds of megabytes and will not open on a phone.
      const ratio = Math.min(1, maxGifEdge / Math.max(source.width, source.height))
      const w = Math.max(2, Math.round(source.width * ratio))
      const h = Math.max(2, Math.round(source.height * ratio))
      const gap = (seconds * 1000) / frames

      const blob = await encodeGif(
        async (ctx, width, height) => {
          const live = getCanvas()
          if (live) ctx.drawImage(live, 0, 0, width, height)
          // Wait real time between grabs — this is a RECORDING of a running
          // animation, not a re-render at computed phases. The engine owns its
          // own clock and this deliberately does not reach into it.
          await new Promise(resolve => setTimeout(resolve, gap))
        },
        {
          width: w,
          height: h,
          frames,
          delay: Math.round(gap),
          onProgress: (done, total) => {
            status.textContent = `Recording frame ${done}/${total}…`
          },
        },
      )
      show(blob, `${name}-${w}x${h}.gif`, `GIF · ${w}×${h} · ${frames} frames · ${seconds}s loop`)
    } catch {
      status.textContent = 'GIF export failed.'
    } finally {
      button.disabled = false
    }
  })

  bar.querySelector('[data-cx="save"]')!.addEventListener('click', () => {
    if (!pending) return
    downloadBlob(pending.blob, pending.filename)
    status.textContent = `Saved ${pending.filename}`
    clearPending()
  })

  bar.querySelector('[data-cx="discard"]')!.addEventListener('click', clearPending)

  return bar
}

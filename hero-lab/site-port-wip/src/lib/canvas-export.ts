/**
 * Shared canvas export — PNG and animated GIF, with a preview of what you are
 * about to save.
 *
 * Owner feedback, 2026-08-18: "in every interactive tool or element which can be
 * exported as a gif, 80% of those don't even have an export button. and the only
 * tool which has export gif button, the gif isn't even visible on screen what is
 * about to be exported."
 *
 * What was actually there, on checking: all six generative engines DID have a
 * one-line `toDataURL` "Download PNG", and the Driftfield shell had a second one
 * that did the same thing to the same canvas. What none of them had was a GIF —
 * for engines whose entire point is that they MOVE — or any choice of
 * resolution, or any sight of the file before it landed in the downloads folder.
 *
 * That is addressed here rather than per component, because per-component is how
 * it drifted: seven copies of the same two lines, no two quite alike, and the
 * capability everyone actually wanted in none of them.
 *
 * Three ways in, because the engines genuinely differ:
 *
 * - `attachCanvasExport()` records a LIVE canvas. It needs to know nothing about
 *   how the thing is drawn, which is what makes it adoptable by an animation
 *   loop that was never written with exporting in mind. The ceiling is honest
 *   and stated in the UI: it captures at the canvas's own pixel size, so asking
 *   for 2x scales pixels up rather than rendering more detail.
 * - `renderExport()` takes a resolution-independent draw function and renders
 *   offscreen at any size. Driftfield's patterns are written this way, so its
 *   PNG really is a 2560x1440 render and not an upscaled preview.
 * - `attachCanvasExport({ animation })` takes frames the engine renders ON
 *   PURPOSE (see `AnimationSource`). Live capture assumes the canvas is already
 *   moving on its own clock; Deep Shore only redraws when you touch it, and each
 *   of its frames can cost a second of arithmetic, so filming it produced "a
 *   still frame at a video's file size" — a caveat the page had to print next to
 *   the button. An engine that knows what its own animation IS renders it here
 *   and gets the same encode, preview and save flow.
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
  /** Palette size. Fewer colours quantize faster and shrink the file. */
  colors?: number
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
  const { width, height, frames = 24, delay = 83, colors = 128, onProgress } = options
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
    // `rgb444` buckets colour into 4 bits per channel before clustering. It is
    // several times faster than the default and the difference is invisible on
    // what these engines draw — 128 colours out of a 12-bit space is still more
    // than the eye separates in a dark gradient. At 256 colours in full RGB a
    // 640px frame took ~0.65s to quantize, so a 24-frame GIF spent 16 seconds
    // looking like a hung tab.
    const palette = quantize(data, colors, { format: 'rgb444' })
    const indexed = applyPalette(data, palette, 'rgb444')
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

/**
 * Escaped even though today's only callers pass literals from their own source.
 * Per AGENTS.md: attribute quoting is a property of the call site and will
 * eventually change, so `'` goes too.
 */
function escapeText(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Frames an engine rendered deliberately, plus how to play them back. */
export interface AnimationFrames {
  ok: true
  /** In order, all at the requested size. The last is held (see the GIF button). */
  frames: ImageData[]
  /** Milliseconds per frame. */
  delay: number
  /** One line describing the file, shown beside the preview. */
  note: string
}

/** Why there is nothing to record. Shown verbatim, so write it for a visitor. */
export interface AnimationRefusal {
  ok: false
  reason: string
}

/**
 * A deterministic frame source, for an engine that can render its own animation
 * rather than be filmed.
 *
 * Live capture (below) is the right tool for an engine that is already animating
 * on its own clock. It is the WRONG tool for one that only redraws when you touch
 * it, or whose frames each cost a second to compute: sampling that in real time
 * produces a time-lapse of an interaction, or a still. Such an engine renders its
 * frames here instead, at its own pace, and gets the same encode / preview / save
 * flow — including, crucially, the look-before-you-save step this module exists
 * for.
 *
 * `cancelled()` is polled by the engine between frames: a deep render is long
 * enough that the visitor must be able to stop it.
 */
export interface AnimationSource {
  /** Button label, e.g. "Record the dive". */
  label: string
  title?: string
  /** Inserted into the filename, e.g. "dive" → `deep-shore-dive-480x298.gif`. */
  suffix?: string
  render: (
    w: number,
    h: number,
    report: (done: number, total: number) => void,
    cancelled: () => boolean,
  ) => Promise<AnimationFrames | AnimationRefusal>
  /** Frames of the final frame appended so a looping GIF reads as arriving. */
  hold?: number
}

export interface LiveExportOptions {
  /** File-name stem, e.g. "murmuration". */
  name: string
  /** Seconds of animation to record into the GIF. */
  seconds?: number
  /** Frames to capture across those seconds. */
  frames?: number
  /** Longest GIF edge. Capped low on purpose — a full-resolution GIF is enormous. */
  maxGifEdge?: number
  /**
   * Offer the live-capture GIF button. Default true.
   *
   * Set false where filming the canvas is known to produce a worse artifact than
   * the `animation` source below — leaving both buttons up would mean shipping a
   * control whose own help text has to warn you off it.
   */
  liveGif?: boolean
  /** A deterministic alternative to filming the canvas. */
  animation?: AnimationSource
}

/**
 * The export bars on the page, each with the function that drops its unsaved
 * preview.
 *
 * ONE pair of document listeners serves all of them, registered the first time
 * a bar is attached and never again — the module is evaluated once per session,
 * because the client router keeps the module cache. `attachCanvasExport` used to
 * add its own `astro:before-swap` listener on every call and never remove it,
 * and seven engines call it, again on every reconnect: each in-site navigation
 * to a page with a canvas left one more document listener behind, holding its
 * bar, its preview image and everything its closure reached, for the rest of the
 * session. The registry is bounded by the bars actually on the page — a bar
 * whose host has gone leaves it at the next swap or the next attach.
 */
const liveBars = new Map<HTMLElement, () => void>()
let swapHooked = false

function trackBar(bar: HTMLElement, clearPending: () => void): void {
  // A bar whose engine unmounted without a navigation (an embed removed in
  // place) is let go here, preview revoked, rather than waiting for a swap.
  for (const [b, clear] of liveBars) {
    if (!b.isConnected) {
      clear()
      liveBars.delete(b)
    }
  }
  liveBars.set(bar, clearPending)
  if (swapHooked) return
  swapHooked = true
  // A preview the visitor never saved or discarded holds an object URL until
  // the document goes away — and on the /learnings lane the document does NOT
  // go away, because those pages run the client router and navigate by swapping
  // it. Generate a GIF, click through to another article, and the blob was
  // pinned for the rest of the session. The tools and games lanes pass
  // `clientRouter={false}` and so always got a full reload, which is why this
  // only ever leaked in one place. Revoking on the swap costs nothing when
  // there is no pending preview.
  document.addEventListener('astro:before-swap', () => {
    for (const clear of liveBars.values()) clear()
  })
  // The swap has replaced the page: every bar it did not carry across is gone.
  document.addEventListener('astro:after-swap', () => {
    for (const b of liveBars.keys()) if (!b.isConnected) liveBars.delete(b)
  })
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
  // 20 frames over 2s is 10fps — enough for these slow drifting motions, and the
  // frame count is what the encode time is linear in. 480px rather than 640 for
  // the same reason: quantize cost scales with pixels, and a GIF wallpaper is
  // not something anyone views at full resolution.
  const { name, seconds = 2, frames = 20, maxGifEdge = 480, liveGif = true, animation } = options

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
      ${liveGif ? '<button data-cx="gif" type="button">Make a GIF</button>' : ''}
      ${animation
        ? `<button data-cx="anim" type="button"${animation.title ? ` title="${escapeAttr(animation.title)}"` : ''}>${escapeText(animation.label)}</button>`
        : ''}
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

  /**
   * The canvas, but only once the engine has actually sized it.
   *
   * A `<canvas>` with no width/height attributes has a 300x150 backing store
   * regardless of how big its layout box is, and these engines size themselves
   * on a ResizeObserver a frame or two after mount. Exporting in that window
   * silently produces a 300x150 file that looks fine in the preview and is
   * useless as a wallpaper — which is exactly what happened the first time this
   * was tested. So: if the backing store is still at the default while the
   * element is laid out much wider, it is not ready yet.
   */
  const readyCanvas = (): HTMLCanvasElement | null => {
    const canvas = getCanvas()
    if (!canvas) return null
    const box = canvas.getBoundingClientRect()
    if (canvas.width === 300 && canvas.height === 150 && box.width > 320) return null
    return canvas
  }

  const clearPending = () => {
    if (pending) URL.revokeObjectURL(pending.url)
    pending = null
    preview.hidden = true
    previewImg.removeAttribute('src')
  }

  // Swapping the page revokes an unsaved preview — through the one shared pair
  // of listeners, never a new one per bar (see `trackBar`).
  trackBar(bar, clearPending)

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
    const source = readyCanvas()
    if (!source) {
      status.textContent = 'Still drawing — try again in a moment.'
      return
    }
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

  /** Fit inside maxGifEdge, preserving aspect. A GIF of a 2560px canvas is
   *  hundreds of megabytes and will not open on a phone. */
  const gifSize = (source: HTMLCanvasElement): [number, number] => {
    const ratio = Math.min(1, maxGifEdge / Math.max(source.width, source.height))
    return [Math.max(2, Math.round(source.width * ratio)), Math.max(2, Math.round(source.height * ratio))]
  }

  bar.querySelector('[data-cx="gif"]')?.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement
    const source = readyCanvas()
    if (!source) {
      status.textContent = 'Still drawing — try again in a moment.'
      return
    }
    button.disabled = true
    clearPending()
    try {
      const [w, h] = gifSize(source)
      const gap = (seconds * 1000) / frames

      // Two phases, and they are kept separate on purpose.
      //
      // Interleaving them — grab a frame, quantize it, grab the next — made the
      // "recording" take as long as the encoding, which is over a second per
      // frame on a busy simulation. So a 2-second loop was sampled across 20+
      // real seconds and came out as a time-lapse rather than the motion the
      // user was watching. It also meant the progress line said "Recording
      // 5/20" while it was in fact encoding, which is the kind of small lie
      // that makes a slow thing feel broken.
      //
      // Now: capture 20 frames over a real 2 seconds (a drawImage each, cheap),
      // then encode them back to back with a progress line that says so.
      const captured: ImageData[] = []
      const scratch = document.createElement('canvas')
      scratch.width = w
      scratch.height = h
      const sctx = scratch.getContext('2d', { willReadFrequently: true })!
      for (let i = 0; i < frames; i++) {
        const live = readyCanvas()
        if (live) sctx.drawImage(live, 0, 0, w, h)
        captured.push(sctx.getImageData(0, 0, w, h))
        status.textContent = `Recording ${((i + 1) / frames * seconds).toFixed(1)}s of ${seconds}s…`
        await new Promise(resolve => setTimeout(resolve, gap))
      }

      const blob = await encodeGif(
        (ctx, _width, _height, frame) => { ctx.putImageData(captured[frame], 0, 0) },
        {
          width: w,
          height: h,
          frames,
          delay: Math.round(gap),
          onProgress: (done, total) => {
            status.textContent = `Encoding frame ${done}/${total}…`
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

  /* ── the deterministic path: frames the engine renders on purpose ── */
  if (animation) {
    const animButton = bar.querySelector('[data-cx="anim"]') as HTMLButtonElement
    let running = false
    let stop = false
    animButton.addEventListener('click', async () => {
      // A second click on a running render is a stop, not a second render. The
      // frames of a deep dive cost a second each, so this cannot be a control
      // the visitor is merely locked out of while it works.
      if (running) {
        stop = true
        status.textContent = 'Stopping…'
        return
      }
      const source = readyCanvas()
      if (!source) {
        status.textContent = 'Still drawing — try again in a moment.'
        return
      }
      running = true
      stop = false
      const label = animButton.textContent
      animButton.textContent = 'Stop'
      clearPending()
      try {
        const [w, h] = gifSize(source)
        const plan = await animation.render(
          w,
          h,
          (done, total) => { status.textContent = `Rendering frame ${done}/${total}…` },
          () => stop,
        )
        if (!plan.ok) {
          status.textContent = plan.reason
          return
        }
        if (plan.frames.length === 0) {
          status.textContent = 'Nothing was rendered.'
          return
        }
        // Held frames reuse the last ImageData rather than rendering it again —
        // the point is a pause at the destination, and a repeat pass of the most
        // expensive frame in the dive is the last thing this should cost.
        const hold = Math.max(0, Math.min(30, Math.round(animation.hold ?? 0)))
        const total = plan.frames.length + hold
        const blob = await encodeGif(
          (ctx, _width, _height, frame) => {
            ctx.putImageData(plan.frames[Math.min(frame, plan.frames.length - 1)], 0, 0)
          },
          {
            width: w,
            height: h,
            frames: total,
            delay: plan.delay,
            onProgress: (done, count) => { status.textContent = `Encoding frame ${done}/${count}…` },
          },
        )
        const stem = animation.suffix ? `${name}-${animation.suffix}` : name
        show(blob, `${stem}-${w}x${h}.gif`, plan.note)
      } catch {
        status.textContent = 'Recording failed.'
      } finally {
        running = false
        stop = false
        animButton.textContent = label
      }
    })
  }

  bar.querySelector('[data-cx="save"]')!.addEventListener('click', () => {
    if (!pending) return
    downloadBlob(pending.blob, pending.filename)
    status.textContent = `Saved ${pending.filename}`
    clearPending()
  })

  bar.querySelector('[data-cx="discard"]')!.addEventListener('click', clearPending)

  return bar
}

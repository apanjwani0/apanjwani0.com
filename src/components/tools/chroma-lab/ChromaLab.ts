/**
 * Chroma Lab — a colour converter + WCAG contrast checker.
 *
 * Two self-contained tools, all client-side, no dependencies:
 *   1. A live colour CONVERTER — a swatch + native picker plus editable HEX,
 *      RGB, HSL and alpha fields that all stay in sync (edit any one and the
 *      others update, without rewriting the field under your cursor). Emits the
 *      colour in six copy-able formats — HEX, HEX+alpha, rgb()/rgba(), hsl()/
 *      hsla(), HSV and CMYK — and a strip of clickable colour harmonies
 *      (complementary / analogous / triadic) plus a tint→shade scale.
 *   2. A WCAG CONTRAST checker — pick a foreground and background colour, see a
 *      live text sample and the exact contrast ratio, and get pass/fail badges
 *      for AA / AAA at normal and large text sizes plus non-text UI components.
 *
 * Mounts as a WebComponent so it survives Astro's client-side View Transitions
 * (see the astro:page-load wiring in tools/[slug].astro). All module-level names
 * are cl-/CL_-prefixed because tool component files share one global script scope.
 */

import { flashLabel } from '../../../lib/flash'

interface ClRGB { r: number; g: number; b: number }   // channels 0–255 (ints)
interface ClHSL { h: number; s: number; l: number }   // h 0–360, s/l 0–100

const CL_LS_COLOR = 'chroma-lab:color:v1'   // the converter colour "#rrggbb|alpha"
const CL_LS_FG = 'chroma-lab:fg:v1'
const CL_LS_BG = 'chroma-lab:bg:v1'

const CL_DEFAULT_COLOR = '#6a5bd0'   // the site accent — a friendly default
const CL_DEFAULT_FG = '#dde6f2'
const CL_DEFAULT_BG = '#05070c'

// ── Pure colour maths (no DOM) ───────────────────────────────────────────────

function clClamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n
}

function clRound(n: number): number { return Math.round(n) }

/** Parse #rgb / #rgba / #rrggbb / #rrggbbaa (with or without the #). */
function clParseHex(input: string): { rgb: ClRGB; a: number } | null {
  let s = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(s)) return null
  if (s.length === 3 || s.length === 4) {
    s = s.split('').map(c => c + c).join('')
  }
  if (s.length !== 6 && s.length !== 8) return null
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1
  return { rgb: { r, g, b }, a }
}

function clHex2(n: number): string {
  return clClamp(clRound(n), 0, 255).toString(16).padStart(2, '0')
}

function clRgbToHex(rgb: ClRGB): string {
  return `#${clHex2(rgb.r)}${clHex2(rgb.g)}${clHex2(rgb.b)}`
}

function clRgbToHexA(rgb: ClRGB, a: number): string {
  return `${clRgbToHex(rgb)}${clHex2(clClamp(a, 0, 1) * 255)}`
}

function clRgbToHsl(rgb: ClRGB): ClHSL {
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return { h, s: s * 100, l: l * 100 }
}

function clHslToRgb(hsl: ClHSL): ClRGB {
  const h = ((hsl.h % 360) + 360) % 360
  const s = clClamp(hsl.s, 0, 100) / 100
  const l = clClamp(hsl.l, 0, 100) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  return { r: clRound((r + m) * 255), g: clRound((g + m) * 255), b: clRound((b + m) * 255) }
}

function clRgbToHsv(rgb: ClRGB): { h: number; s: number; v: number } {
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h, s: s * 100, v: max * 100 }
}

function clRgbToCmyk(rgb: ClRGB): { c: number; m: number; y: number; k: number } {
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255
  const k = 1 - Math.max(r, g, b)
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 }
  const c = (1 - r - k) / (1 - k)
  const m = (1 - g - k) / (1 - k)
  const y = (1 - b - k) / (1 - k)
  return { c: c * 100, m: m * 100, y: y * 100, k: k * 100 }
}

/** WCAG 2.x relative luminance of an sRGB colour. */
function clLuminance(rgb: ClRGB): number {
  const lin = (c: number) => {
    const cs = c / 255
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b)
}

/** WCAG contrast ratio between two opaque colours (1–21). */
function clContrast(a: ClRGB, b: ClRGB): number {
  const la = clLuminance(a), lb = clLuminance(b)
  const hi = Math.max(la, lb), lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** Mix two colours by ratio t (0 = a, 1 = b). */
function clMix(a: ClRGB, b: ClRGB, t: number): ClRGB {
  return {
    r: clRound(a.r + (b.r - a.r) * t),
    g: clRound(a.g + (b.g - a.g) * t),
    b: clRound(a.b + (b.b - a.b) * t),
  }
}

function clRotateHue(rgb: ClRGB, deg: number): ClRGB {
  const hsl = clRgbToHsl(rgb)
  return clHslToRgb({ h: hsl.h + deg, s: hsl.s, l: hsl.l })
}

function clRandomRgb(): ClRGB {
  return {
    r: Math.floor(Math.random() * 256),
    g: Math.floor(Math.random() * 256),
    b: Math.floor(Math.random() * 256),
  }
}

function clFmt(n: number): string {
  // Trim to at most 1 decimal, drop a trailing .0.
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

function clEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── The WebComponent ─────────────────────────────────────────────────────────

class ChromaLabTool extends HTMLElement {
  private rgb: ClRGB = { r: 106, g: 91, b: 208 }
  private alpha = 1
  private fg: ClRGB = { r: 221, g: 230, b: 242 }
  private bg: ClRGB = { r: 5, g: 7, b: 12 }
  private statusEl!: HTMLElement

  private onKeydown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); this.randomColor() }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); this.swapContrast() }
  }

  connectedCallback() {
    this.loadState()

    this.innerHTML = `
      <div data-type="tool-page" data-tool="chroma-lab">
        <div data-type="tool-header">
          <h1>Chroma Lab</h1>
          <p>Convert a colour between HEX, RGB, HSL, HSV and CMYK, explore its harmonies, and check any foreground/background pair against the WCAG AA and AAA contrast thresholds. Everything runs in your browser — press <kbd>R</kbd> for a random colour, <kbd>S</kbd> to swap the contrast pair.</p>
        </div>

        <div data-group="toolbar">
          <button data-action="random" type="button">Random colour (R)</button>
          <button data-action="reset" type="button">Reset</button>
        </div>

        <section data-type="cl-card" data-card="convert" aria-labelledby="cl-conv-h">
          <h2 id="cl-conv-h">Colour converter</h2>
          <div data-type="cl-convert">
            <div data-type="cl-preview-wrap">
              <div data-type="cl-swatch-big" data-swatch aria-hidden="true"></div>
              <label data-type="cl-field cl-picker">
                <span>Pick</span>
                <input data-input="picker" type="color" aria-label="Colour picker" value="${clRgbToHex(this.rgb)}" />
              </label>
            </div>
            <div data-type="cl-fields">
              <label data-type="cl-field"><span>HEX</span>
                <input data-input="hex" type="text" spellcheck="false" autocomplete="off" inputmode="text" aria-label="Hex colour" />
              </label>
              <div data-type="cl-triple" role="group" aria-label="RGB channels">
                <label data-type="cl-field cl-mini"><span>R</span>
                  <input data-input="r" type="number" min="0" max="255" step="1" aria-label="Red 0 to 255" />
                </label>
                <label data-type="cl-field cl-mini"><span>G</span>
                  <input data-input="g" type="number" min="0" max="255" step="1" aria-label="Green 0 to 255" />
                </label>
                <label data-type="cl-field cl-mini"><span>B</span>
                  <input data-input="b" type="number" min="0" max="255" step="1" aria-label="Blue 0 to 255" />
                </label>
              </div>
              <div data-type="cl-triple" role="group" aria-label="HSL channels">
                <label data-type="cl-field cl-mini"><span>H</span>
                  <input data-input="h" type="number" min="0" max="360" step="1" aria-label="Hue 0 to 360" />
                </label>
                <label data-type="cl-field cl-mini"><span>S</span>
                  <input data-input="s" type="number" min="0" max="100" step="1" aria-label="Saturation 0 to 100" />
                </label>
                <label data-type="cl-field cl-mini"><span>L</span>
                  <input data-input="l" type="number" min="0" max="100" step="1" aria-label="Lightness 0 to 100" />
                </label>
              </div>
              <label data-type="cl-field cl-alpha"><span>Alpha</span>
                <input data-input="alpha" type="range" min="0" max="100" step="1" aria-label="Alpha 0 to 100 percent" />
                <output data-out="alpha">100%</output>
              </label>
            </div>
          </div>

          <dl data-type="cl-formats" aria-label="Colour in every format"></dl>

          <div data-type="cl-harmony-block">
            <h3>Harmonies</h3>
            <div data-type="cl-harmonies" aria-label="Colour harmonies — click to load"></div>
            <h3>Tints &amp; shades</h3>
            <div data-type="cl-scale" aria-label="Tints and shades — click to load"></div>
          </div>
        </section>

        <section data-type="cl-card" data-card="contrast" aria-labelledby="cl-con-h">
          <h2 id="cl-con-h">WCAG contrast checker</h2>
          <div data-type="cl-contrast-inputs">
            <div data-type="cl-cinput" data-role="fg">
              <label data-type="cl-field"><span>Text</span>
                <input data-input="fg-hex" type="text" spellcheck="false" autocomplete="off" aria-label="Text (foreground) hex colour" />
              </label>
              <input data-input="fg-picker" type="color" aria-label="Text colour picker" />
              <button data-action="use-fg" type="button" title="Load the converter colour as the text colour">← use current</button>
            </div>
            <button data-action="swap" type="button" data-type="cl-swap" title="Swap text and background (S)" aria-label="Swap text and background colours">⇅ swap</button>
            <div data-type="cl-cinput" data-role="bg">
              <label data-type="cl-field"><span>Background</span>
                <input data-input="bg-hex" type="text" spellcheck="false" autocomplete="off" aria-label="Background hex colour" />
              </label>
              <input data-input="bg-picker" type="color" aria-label="Background colour picker" />
              <button data-action="use-bg" type="button" title="Load the converter colour as the background">← use current</button>
            </div>
          </div>

          <div data-type="cl-contrast-preview" data-preview>
            <p data-size="normal">The quick brown fox jumps over the lazy dog. <strong>Normal 16px text.</strong></p>
            <p data-size="large">Large text — 24px, or 19px bold.</p>
            <p data-size="huge">Aa</p>
          </div>

          <div data-type="cl-contrast-result">
            <div data-type="cl-ratio">
              <output data-out="ratio" aria-live="polite">—</output>
              <span data-type="cl-ratio-label">contrast ratio</span>
            </div>
            <div data-type="cl-badges" aria-label="WCAG conformance"></div>
          </div>
        </section>

        <details data-type="cl-explainer">
          <summary>How contrast ratios &amp; WCAG levels work</summary>
          <p>The <strong>contrast ratio</strong> compares the relative luminance of two colours and runs from 1:1 (identical) to 21:1 (pure black on pure white). WCAG 2 sets minimum ratios so text stays legible for people with low vision or colour-vision deficiencies.</p>
          <p><strong>AA</strong> — the level most organisations target — needs <strong>4.5:1</strong> for normal text and <strong>3:1</strong> for large text (≥ 24px, or ≥ 18.66px bold). <strong>AAA</strong> is stricter: <strong>7:1</strong> normal and <strong>4.5:1</strong> large. Non-text UI (icons, input borders, focus rings) needs <strong>3:1</strong> against what's adjacent.</p>
          <p>Contrast is defined for opaque colours, so this checker ignores alpha on the foreground and background. Your colours and settings are remembered in your browser, and nothing is uploaded.</p>
        </details>

        <div data-type="cl-statusbar"><span data-type="cl-status" aria-live="polite"></span></div>
      </div>
    `

    this.statusEl = this.q('[data-type="cl-status"]')

    this.addEventListener('input', this.onInput)
    this.addEventListener('click', this.onClick)
    this.addEventListener('keydown', this.onKeydown)

    this.syncConverterFields()
    this.renderFormats()
    this.renderHarmonies()
    this.syncContrastFields()
    this.renderContrast()
  }

  disconnectedCallback() {
    this.removeEventListener('input', this.onInput)
    this.removeEventListener('click', this.onClick)
    this.removeEventListener('keydown', this.onKeydown)
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.querySelector(sel) as T
  }

  // ── input handling ─────────────────────────────────────────────────────────

  private onInput = (e: Event) => {
    const el = e.target as HTMLInputElement
    const key = el.dataset.input
    if (!key) return

    if (key === 'hex') { this.fromHexField(el); return }
    if (key === 'picker') { this.setColor(clParseHex(el.value)!.rgb, this.alpha, 'picker'); return }
    if (key === 'r' || key === 'g' || key === 'b') { this.fromRgbFields(key); return }
    if (key === 'h' || key === 's' || key === 'l') { this.fromHslFields(key); return }
    if (key === 'alpha') { this.alpha = clClamp(Number(el.value) / 100, 0, 1); this.afterColorChange('alpha'); return }

    if (key === 'fg-hex') { this.fromContrastHex('fg', el); return }
    if (key === 'bg-hex') { this.fromContrastHex('bg', el); return }
    if (key === 'fg-picker') { this.fg = clParseHex(el.value)!.rgb; this.afterContrastChange('fg-picker'); return }
    if (key === 'bg-picker') { this.bg = clParseHex(el.value)!.rgb; this.afterContrastChange('bg-picker'); return }
  }

  private onClick = (e: Event) => {
    const btn = (e.target as HTMLElement).closest('[data-action], [data-load]') as HTMLElement | null
    if (!btn) return
    const load = btn.getAttribute('data-load')
    if (load) {
      const p = clParseHex(load)
      if (p) { this.setColor(p.rgb, 1, ''); this.setStatus(`Loaded ${clRgbToHex(p.rgb)}.`) }
      return
    }
    const action = btn.getAttribute('data-action')
    if (action === 'random') this.randomColor()
    else if (action === 'reset') this.resetAll()
    else if (action === 'swap') this.swapContrast()
    else if (action === 'use-fg') { this.fg = { ...this.rgb }; this.afterContrastChange('') ; this.setStatus('Loaded the converter colour as the text colour.') }
    else if (action === 'use-bg') { this.bg = { ...this.rgb }; this.afterContrastChange(''); this.setStatus('Loaded the converter colour as the background.') }
    else if (action === 'copy') this.copyText(btn as HTMLButtonElement)
  }

  // ── converter model ─────────────────────────────────────────────────────────

  private fromHexField(el: HTMLInputElement) {
    const parsed = clParseHex(el.value)
    if (!parsed) { el.setAttribute('data-invalid', ''); el.setAttribute('aria-invalid', 'true'); this.setStatus('Not a valid hex colour.'); return }
    el.removeAttribute('data-invalid')
    el.removeAttribute('aria-invalid')
    this.rgb = parsed.rgb
    this.alpha = parsed.a
    this.afterColorChange('hex')
  }

  private fromRgbFields(source: string) {
    const r = this.numOr('r', this.rgb.r)
    const g = this.numOr('g', this.rgb.g)
    const b = this.numOr('b', this.rgb.b)
    this.rgb = { r: clClamp(r, 0, 255), g: clClamp(g, 0, 255), b: clClamp(b, 0, 255) }
    this.afterColorChange(source)
  }

  private fromHslFields(source: string) {
    const cur = clRgbToHsl(this.rgb)
    const h = this.numOr('h', cur.h)
    const s = this.numOr('s', cur.s)
    const l = this.numOr('l', cur.l)
    this.rgb = clHslToRgb({ h: clClamp(h, 0, 360), s: clClamp(s, 0, 100), l: clClamp(l, 0, 100) })
    this.afterColorChange(source)
  }

  private numOr(input: string, fallback: number): number {
    const el = this.q<HTMLInputElement>(`[data-input="${input}"]`)
    const v = Number(el.value)
    return el.value.trim() === '' || Number.isNaN(v) ? fallback : v
  }

  private setColor(rgb: ClRGB, alpha: number, source: string) {
    this.rgb = rgb
    this.alpha = alpha
    this.afterColorChange(source)
  }

  private afterColorChange(source: string) {
    this.syncConverterFields(source)
    this.renderFormats()
    this.renderHarmonies()
    this.persist()
  }

  /** Write every converter field except the one being edited (so the caret is
      never yanked). Pass '' to write all of them. */
  private syncConverterFields(source = '') {
    const hex = clRgbToHex(this.rgb)
    const hsl = clRgbToHsl(this.rgb)
    const set = (k: string, v: string) => {
      if (k === source) return
      const el = this.querySelector(`[data-input="${k}"]`) as HTMLInputElement | null
      if (el && el.value !== v) el.value = v
    }
    if (source !== 'hex') { const h = this.q<HTMLInputElement>('[data-input="hex"]'); h.value = hex; h.removeAttribute('data-invalid'); h.removeAttribute('aria-invalid') }
    set('picker', hex)
    set('r', String(this.rgb.r)); set('g', String(this.rgb.g)); set('b', String(this.rgb.b))
    set('h', String(clRound(hsl.h))); set('s', String(clRound(hsl.s))); set('l', String(clRound(hsl.l)))
    if (source !== 'alpha') { this.q<HTMLInputElement>('[data-input="alpha"]').value = String(clRound(this.alpha * 100)) }
    this.q('[data-out="alpha"]').textContent = `${clRound(this.alpha * 100)}%`

    const sw = this.q('[data-swatch]')
    sw.style.setProperty('--cl-swatch', this.alpha < 1
      ? `rgba(${this.rgb.r}, ${this.rgb.g}, ${this.rgb.b}, ${clFmt(this.alpha)})`
      : hex)
  }

  private renderFormats() {
    const { r, g, b } = this.rgb
    const hsl = clRgbToHsl(this.rgb)
    const hsv = clRgbToHsv(this.rgb)
    const cmyk = clRgbToCmyk(this.rgb)
    const a = clFmt(this.alpha)
    const rows: { k: string; v: string }[] = [
      { k: 'HEX', v: clRgbToHex(this.rgb) },
      { k: 'HEX + alpha', v: clRgbToHexA(this.rgb, this.alpha) },
      { k: 'RGB', v: this.alpha < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})` },
      { k: 'HSL', v: this.alpha < 1
        ? `hsla(${clRound(hsl.h)}, ${clRound(hsl.s)}%, ${clRound(hsl.l)}%, ${a})`
        : `hsl(${clRound(hsl.h)}, ${clRound(hsl.s)}%, ${clRound(hsl.l)}%)` },
      { k: 'HSV', v: `hsv(${clRound(hsv.h)}, ${clRound(hsv.s)}%, ${clRound(hsv.v)}%)` },
      { k: 'CMYK', v: `cmyk(${clRound(cmyk.c)}%, ${clRound(cmyk.m)}%, ${clRound(cmyk.y)}%, ${clRound(cmyk.k)}%)` },
    ]
    this.q('[data-type="cl-formats"]').innerHTML = rows.map(row => `
      <div data-type="cl-fmt-row">
        <dt>${clEsc(row.k)}</dt>
        <dd>
          <span data-type="cl-fmt-val">${clEsc(row.v)}</span>
          <button data-action="copy" data-copy="${clEsc(row.v)}" type="button" aria-label="Copy ${clEsc(row.k)} value">Copy</button>
        </dd>
      </div>`).join('')
  }

  private renderHarmonies() {
    const harmonies: { label: string; rgb: ClRGB }[] = [
      { label: 'Base', rgb: this.rgb },
      { label: 'Complementary', rgb: clRotateHue(this.rgb, 180) },
      { label: 'Analogous −30°', rgb: clRotateHue(this.rgb, -30) },
      { label: 'Analogous +30°', rgb: clRotateHue(this.rgb, 30) },
      { label: 'Triadic +120°', rgb: clRotateHue(this.rgb, 120) },
      { label: 'Triadic +240°', rgb: clRotateHue(this.rgb, 240) },
    ]
    this.q('[data-type="cl-harmonies"]').innerHTML = harmonies.map(h => this.swatchButton(h.rgb, h.label)).join('')

    const white: ClRGB = { r: 255, g: 255, b: 255 }
    const black: ClRGB = { r: 0, g: 0, b: 0 }
    const steps: ClRGB[] = [
      clMix(this.rgb, white, 0.6),
      clMix(this.rgb, white, 0.4),
      clMix(this.rgb, white, 0.2),
      this.rgb,
      clMix(this.rgb, black, 0.2),
      clMix(this.rgb, black, 0.4),
      clMix(this.rgb, black, 0.6),
    ]
    this.q('[data-type="cl-scale"]').innerHTML = steps
      .map((c, i) => this.swatchButton(c, i === 3 ? 'Base colour' : `${clRgbToHex(c)}`, i === 3))
      .join('')
  }

  private swatchButton(rgb: ClRGB, label: string, isBase = false): string {
    const hex = clRgbToHex(rgb)
    return `<button data-load="${hex}" type="button" data-type="cl-swatch"${isBase ? ' data-base' : ''}
      style="--cl-swatch: ${hex}" title="${clEsc(label)} — ${hex}" aria-label="Load ${clEsc(label)} ${hex}">
      <span data-type="cl-swatch-hex">${hex}</span>
    </button>`
  }

  // ── contrast model ───────────────────────────────────────────────────────────

  private fromContrastHex(role: 'fg' | 'bg', el: HTMLInputElement) {
    const parsed = clParseHex(el.value)
    if (!parsed) { el.setAttribute('data-invalid', ''); el.setAttribute('aria-invalid', 'true'); return }
    el.removeAttribute('data-invalid')
    el.removeAttribute('aria-invalid')
    if (role === 'fg') this.fg = parsed.rgb; else this.bg = parsed.rgb
    this.afterContrastChange(`${role}-hex`)
  }

  private afterContrastChange(source: string) {
    this.syncContrastFields(source)
    this.renderContrast()
    this.persist()
  }

  private syncContrastFields(source = '') {
    const fgHex = clRgbToHex(this.fg)
    const bgHex = clRgbToHex(this.bg)
    if (source !== 'fg-hex') { const el = this.q<HTMLInputElement>('[data-input="fg-hex"]'); el.value = fgHex; el.removeAttribute('data-invalid'); el.removeAttribute('aria-invalid') }
    if (source !== 'bg-hex') { const el = this.q<HTMLInputElement>('[data-input="bg-hex"]'); el.value = bgHex; el.removeAttribute('data-invalid'); el.removeAttribute('aria-invalid') }
    this.q<HTMLInputElement>('[data-input="fg-picker"]').value = fgHex
    this.q<HTMLInputElement>('[data-input="bg-picker"]').value = bgHex

    const preview = this.q('[data-preview]')
    preview.style.setProperty('--cl-fg', fgHex)
    preview.style.setProperty('--cl-bg', bgHex)
  }

  private renderContrast() {
    const ratio = clContrast(this.fg, this.bg)
    this.q('[data-out="ratio"]').textContent = `${ratio.toFixed(2)}:1`

    const checks: { label: string; min: number; note: string }[] = [
      { label: 'AA — normal text', min: 4.5, note: '≥ 4.5:1' },
      { label: 'AA — large text', min: 3, note: '≥ 3:1' },
      { label: 'AAA — normal text', min: 7, note: '≥ 7:1' },
      { label: 'AAA — large text', min: 4.5, note: '≥ 4.5:1' },
      { label: 'UI components / graphics', min: 3, note: '≥ 3:1' },
    ]
    this.q('[data-type="cl-badges"]').innerHTML = checks.map(c => {
      const pass = ratio >= c.min
      return `<div data-type="cl-badge" data-pass="${pass}">
        <span data-type="cl-badge-mark" aria-hidden="true">${pass ? '✓' : '✕'}</span>
        <span data-type="cl-badge-label">${clEsc(c.label)}<small>${clEsc(c.note)}</small></span>
        <span data-type="cl-badge-verdict">${pass ? 'Pass' : 'Fail'}</span>
      </div>`
    }).join('')
  }

  private swapContrast() {
    const t = this.fg; this.fg = this.bg; this.bg = t
    this.afterContrastChange('')
    this.setStatus('Swapped text and background.')
  }

  // ── toolbar actions ──────────────────────────────────────────────────────────

  private randomColor() {
    this.setColor(clRandomRgb(), 1, '')
    this.setStatus(`Random colour — ${clRgbToHex(this.rgb)}.`)
  }

  private resetAll() {
    const c = clParseHex(CL_DEFAULT_COLOR)!
    this.rgb = c.rgb; this.alpha = 1
    this.fg = clParseHex(CL_DEFAULT_FG)!.rgb
    this.bg = clParseHex(CL_DEFAULT_BG)!.rgb
    this.syncConverterFields(); this.renderFormats(); this.renderHarmonies()
    this.syncContrastFields(); this.renderContrast(); this.persist()
    this.setStatus('Reset to defaults.')
  }

  private async copyText(btn: HTMLButtonElement) {
    const text = btn.getAttribute('data-copy') ?? ''
    if (!text) { this.setStatus('Nothing to copy.'); return }
    try {
      await navigator.clipboard.writeText(text)
      this.flash(btn, 'Copied!')
      this.setStatus(`Copied ${text}`)
    } catch {
      this.flash(btn, 'Failed')
      this.setStatus('Copy failed — clipboard access was blocked.')
    }
  }

  private flash(btn: HTMLButtonElement, label: string) {
    flashLabel(btn, label, 1100)
  }

  private setStatus(label: string) {
    if (this.statusEl) this.statusEl.textContent = label
  }

  // ── persistence ──────────────────────────────────────────────────────────────

  private persist() {
    this.writeLS(CL_LS_COLOR, `${clRgbToHex(this.rgb)}|${clFmt(this.alpha)}`)
    this.writeLS(CL_LS_FG, clRgbToHex(this.fg))
    this.writeLS(CL_LS_BG, clRgbToHex(this.bg))
  }

  private loadState() {
    const color = this.readLS(CL_LS_COLOR)
    if (color) {
      const [hex, a] = color.split('|')
      const p = clParseHex(hex ?? '')
      const alpha = Number(a)
      if (p) { this.rgb = p.rgb; this.alpha = Number.isFinite(alpha) ? clClamp(alpha, 0, 1) : 1 }
    }
    const fg = clParseHex(this.readLS(CL_LS_FG) ?? '')
    if (fg) this.fg = fg.rgb
    const bg = clParseHex(this.readLS(CL_LS_BG) ?? '')
    if (bg) this.bg = bg.rgb
  }

  private readLS(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  private writeLS(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore quota / private-mode */ }
  }
}

if (!customElements.get('chroma-lab-tool')) {
  customElements.define('chroma-lab-tool', ChromaLabTool)
}

export {}

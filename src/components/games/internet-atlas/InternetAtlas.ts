/**
 * Internet Atlas — the figure for /learnings/how-the-internet-works.
 *
 * Eight stops on the trip a page makes, each with a legend saying what the stop
 * is, what it does here, and what happens when it goes wrong. The views and
 * every claim in them live in ./atlas.ts, so `security:smoke` can test them
 * without a browser. This file is the DOM and the clock.
 *
 * ponytail: the same clock as DiagramAtlas.ts (pinned views, playback that
 * follows visibility, a reader's pause remembered, reduced motion honoured),
 * copied rather than shared; fold both into one engine if a third figure
 * arrives. Inline SVG for the same reason as there: the labels must be
 * selectable, searchable and readable by a screen reader.
 */

import { INTERNET_VIEWS, internetView, type InternetView } from './atlas'

/** Beat length. Long enough to read the caption, short enough to feel like motion. */
const BEAT_MS = 2100

/** The same arrowheads as the Diagram Atlas, which diagram-atlas.css points at. */
const DEFS = `
  <defs>
    <marker id="at-head" viewBox="0 0 10 10" refX="9" refY="5"
      markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" data-head="off"/>
    </marker>
    <marker id="at-head-on" viewBox="0 0 10 10" refX="9" refY="5"
      markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" data-head="on"/>
    </marker>
  </defs>`

class InternetAtlasFigure extends HTMLElement {
  private view: InternetView = INTERNET_VIEWS[0]
  private step = 0
  private timer = 0
  private playing = false
  // The article carries nine of these, so playback follows visibility, and a
  // deliberate pause is remembered when the reader scrolls back.
  private visible = false
  private pausedByReader = false
  private io?: IntersectionObserver

  private stage!: HTMLElement
  private caption!: HTMLElement
  private panel!: HTMLElement
  private playBtn!: HTMLButtonElement

  connectedCallback() {
    // `data-view` pins one stop and drops the picker: the line above the figure
    // has already said which stop it is. An unknown name shows the picker.
    const pinned = INTERNET_VIEWS.find(v => v.id === this.getAttribute('data-view'))

    this.innerHTML = `
      <div data-type="at-figure"${pinned ? ' data-pinned' : ''}>
        ${pinned ? '' : `<div data-type="at-ask" role="group" aria-label="The stop you want to see">
          ${INTERNET_VIEWS.map(
            (v, i) => `<button type="button" data-view="${v.id}" aria-pressed="${i === 0}">${v.question}</button>`,
          ).join('')}
        </div>`}
        <div data-type="at-stage" tabindex="0" role="region" aria-label="Diagram"></div>
        <p data-type="at-caption" aria-live="polite"></p>
        <div data-type="at-transport" role="group" aria-label="Playback">
          <button type="button" data-action="play" aria-pressed="false">Play</button>
          <button type="button" data-action="step">Step</button>
        </div>
        <dl data-type="at-panel"></dl>
      </div>`

    this.stage = this.querySelector('[data-type="at-stage"]') as HTMLElement
    this.caption = this.querySelector('[data-type="at-caption"]') as HTMLElement
    this.panel = this.querySelector('[data-type="at-panel"]') as HTMLElement
    this.playBtn = this.querySelector('[data-action="play"]') as HTMLButtonElement

    this.addEventListener('click', this.onClick)
    this.select((pinned ?? INTERNET_VIEWS[0]).id)

    // The last entry is the latest: a quick scroll can queue both crossings.
    this.io = new IntersectionObserver((entries) => {
      this.visible = entries[entries.length - 1].isIntersecting
      if (this.visible) this.autoplay()
      else this.pause()
    })
    this.io.observe(this)
  }

  disconnectedCallback() {
    this.pause()
    this.io?.disconnect()
    this.removeEventListener('click', this.onClick)
  }

  private onClick = (e: Event) => {
    const btn = (e.target as HTMLElement | null)?.closest('button')
    if (!btn) return
    const viewId = btn.getAttribute('data-view')
    if (viewId) {
      this.select(viewId)
      return
    }
    // A caption the reader asked for is read out; autoplay turns that off.
    if (btn.dataset.action) this.caption.setAttribute('aria-live', 'polite')
    if (btn.dataset.action === 'play') {
      this.pausedByReader = this.playing
      this.playing ? this.pause() : this.play()
    }
    if (btn.dataset.action === 'step') {
      this.pausedByReader = true
      this.pause()
      this.advance()
    }
  }

  private select(id: string) {
    this.pausedByReader = false
    this.pause()
    this.view = internetView(id)
    this.step = 0

    for (const b of this.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === this.view.id))
    }

    const token = this.view.steps.some(s => s.token) ? `<g data-token="1"><circle r="10"/></g>` : ''
    this.stage.innerHTML =
      `<svg viewBox="0 0 680 364" role="img" aria-label="${this.view.title}: ${this.view.question}">` +
      `${DEFS}${this.view.svg}${token}</svg>`

    this.panel.innerHTML =
      `<dt>Stop</dt><dd data-field="title">${this.view.title}</dd>` +
      `<dt>What it is</dt><dd>${this.view.what}</dd>` +
      `<dt>What it does here</dt><dd>${this.view.does}</dd>` +
      `<dt>If it goes wrong</dt><dd data-field="blind">${this.view.breaks}</dd>`

    this.render()
    this.autoplay()
  }

  /** Start only if it would be seen and is wanted. */
  private autoplay() {
    if (!this.visible || this.pausedByReader) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // A caption that changes by itself every beat would talk over the page.
    this.caption.setAttribute('aria-live', 'off')
    this.play()
  }

  private play() {
    this.playing = true
    this.playBtn.textContent = 'Pause'
    this.playBtn.setAttribute('aria-pressed', 'true')
    clearInterval(this.timer)
    this.timer = window.setInterval(() => this.advance(), BEAT_MS)
  }

  private pause() {
    this.playing = false
    clearInterval(this.timer)
    this.timer = 0
    if (this.playBtn) {
      this.playBtn.textContent = 'Play'
      this.playBtn.setAttribute('aria-pressed', 'false')
    }
  }

  /** Next beat, wrapping, so a reader can watch it again. */
  private advance() {
    this.step = (this.step + 1) % this.view.steps.length
    this.render()
  }

  private render() {
    const beat = this.view.steps[this.step]
    const svg = this.stage.querySelector('svg')
    if (!beat || !svg) return
    for (const lit of svg.querySelectorAll('[data-on]')) lit.removeAttribute('data-on')
    for (const id of beat.on) svg.querySelector(`#${id}`)?.setAttribute('data-on', '1')
    const token = svg.querySelector<SVGElement>('[data-token="1"]')
    if (token) {
      token.style.opacity = beat.token ? '1' : '0'
      // px in an SVG resolve to user units, so atlas.ts stays in viewBox coordinates.
      if (beat.token) token.style.transform = `translate(${beat.token[0]}px, ${beat.token[1]}px)`
    }
    this.caption.textContent = beat.say
  }
}

if (!customElements.get('internet-atlas-figure')) {
  customElements.define('internet-atlas-figure', InternetAtlasFigure)
}

export {}

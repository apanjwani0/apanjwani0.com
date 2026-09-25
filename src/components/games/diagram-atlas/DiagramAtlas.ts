/**
 * Diagram Atlas — the figure for /learnings/how-to-think-on-paper.
 *
 * One scenario, seven notations, and a legend that names what each picture
 * cannot answer. The view data — including every claim about what a node and an
 * arrow MEAN in each family — lives in ./atlas.ts so `security:smoke` can hold
 * it to a legend without a browser. This file is the DOM and the clock.
 *
 * Deliberately not canvas. Every other engine on this site is a canvas toy
 * because it draws a simulation; this one draws seven diagrams whose text has to
 * be selectable, searchable and readable by a screen reader, so it is inline
 * SVG. The trade is that the diagrams are authored as markup rather than painted
 * per frame — which is also why they cost nothing to animate.
 *
 * The animation is one clock driving a `data-on` attribute across all seven
 * views rather than seven bespoke animations: a step names the ids that light up
 * and, where a view has a control token, where the token sits. The two
 * structural views (class, ER) carry ZERO steps on purpose — a class diagram has
 * no time axis, so moving a token along one would be a lie about the notation,
 * and the panel says so instead. See ./atlas.ts.
 */

import { ATLAS_VIEWS, atlasView, type AtlasView } from './atlas'

/** Beat length. Long enough to read the caption, short enough to feel like motion. */
const BEAT_MS = 1900

/** One arrowhead per line style, doubled for the lit state — see diagram-atlas.css. */
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

class DiagramAtlasFigure extends HTMLElement {
  private view: AtlasView = ATLAS_VIEWS[0]
  private step = 0
  private timer = 0
  private playing = false
  /* An article in the house format carries eight of these, five of which
     animate. Autoplaying on connect therefore started five setIntervals at
     once, all of them running forever whether or not they were anywhere near
     the viewport — on a page whose job is to be read. So playback follows
     visibility, and `paused` remembers a deliberate pause so scrolling back to
     a figure the reader stopped does not restart it behind them. */
  private visible = false
  private pausedByReader = false
  private io?: IntersectionObserver

  private stage!: HTMLElement
  private caption!: HTMLElement
  private panel!: HTMLElement
  private playBtn!: HTMLButtonElement
  private transport!: HTMLElement

  connectedCallback() {
    /* Pinned mode. An article carries a figure every few lines (the house
       format — docs/plans/learnings-voice.md), and at that size the reader has
       already been told which notation they are looking at by the line above
       it, so seven question buttons over every figure is seven copies of a
       control answering a question the prose just answered. `data-view` drops
       the picker and shows that one view; the full component, with the picker,
       is what a bare `{{embed}}` still renders.

       An unknown name falls back to the picker rather than throwing — a typo in
       config costs the pinning, never the figure. */
    const asked = this.getAttribute('data-view')
    const pinned = ATLAS_VIEWS.find(v => v.id === asked)

    this.innerHTML = `
      <div data-type="at-figure"${pinned ? ' data-pinned' : ''}>
        ${pinned ? '' : `<div data-type="at-ask" role="group" aria-label="The question you are asking">
          ${ATLAS_VIEWS.map(
            (v, i) =>
              `<button type="button" data-view="${v.id}" aria-pressed="${i === 0}">${v.question}</button>`,
          ).join('')}
        </div>`}
        <div data-type="at-stage" tabindex="0"></div>
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
    this.transport = this.querySelector('[data-type="at-transport"]') as HTMLElement
    this.playBtn = this.querySelector('[data-action="play"]') as HTMLButtonElement

    this.addEventListener('click', this.onClick)
    this.select((pinned ?? ATLAS_VIEWS[0]).id)

    this.io = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting
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

  /** Switch notation. The scenario does not change — only the picture of it does. */
  private select(id: string) {
    this.pausedByReader = false
    this.pause()
    this.view = atlasView(id)
    this.step = 0

    for (const b of this.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === this.view.id))
    }

    const animated = this.view.steps.length > 0
    const token = animated && this.view.steps.some(s => s.token)
      ? `<g data-token="1"><circle r="10"/></g>`
      : ''
    const token2 = animated && this.view.steps.some(s => s.token2)
      ? `<g data-token="2"><circle r="10"/></g>`
      : ''

    this.stage.innerHTML =
      `<svg viewBox="0 0 680 364" role="img" ` +
      `aria-label="${this.view.notation}: the same order, drawn to answer — ${this.view.question}">` +
      `${DEFS}${this.view.svg}${token}${token2}</svg>`

    this.panel.innerHTML =
      `<dt>Notation</dt><dd>${this.view.notation}</dd>` +
      `<dt>A node is</dt><dd>${this.view.node}</dd>` +
      `<dt>An arrow says</dt><dd data-field="arrow">${this.view.arrow}</dd>` +
      `<dt>Cannot tell you</dt><dd data-field="blind">${this.view.blind}</dd>`

    // A structural diagram has nothing to play. Hiding the transport is more
    // honest than offering a button that would animate a picture with no time in
    // it — and it is the one moment the figure teaches by refusing.
    this.transport.hidden = !animated
    if (animated) {
      this.render()
      this.autoplay()
    } else {
      this.caption.textContent =
        'Nothing moves here, and nothing should: every line on this one is true at every instant.'
    }
  }

  /** Start only if it would be seen, wanted, and is not a still diagram. */
  private autoplay() {
    if (!this.visible || this.pausedByReader) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    this.play()
  }

  private play() {
    if (!this.view.steps.length) return
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

  /** Next beat, wrapping. A figure a reader can only watch once is a worse figure. */
  private advance() {
    this.step = (this.step + 1) % this.view.steps.length
    this.render()
  }

  private render() {
    const beat = this.view.steps[this.step]
    if (!beat) return

    const svg = this.stage.querySelector('svg')
    if (!svg) return

    for (const lit of svg.querySelectorAll('[data-on]')) lit.removeAttribute('data-on')
    for (const id of beat.on) svg.querySelector(`#${id}`)?.setAttribute('data-on', '1')

    this.place(svg, '1', beat.token)
    this.place(svg, '2', beat.token2)
    this.caption.textContent = beat.say
  }

  /**
   * Move a control token. `style.transform` and not the `transform` attribute:
   * the CSS property is what carries the transition, and px in an SVG resolve to
   * user units, so the numbers in atlas.ts stay viewBox coordinates.
   */
  private place(svg: SVGElement, which: string, at: [number, number] | undefined) {
    const el = svg.querySelector<SVGElement>(`[data-token="${which}"]`)
    if (!el) return
    if (!at) {
      el.style.opacity = '0'
      return
    }
    el.style.opacity = '1'
    el.style.transform = `translate(${at[0]}px, ${at[1]}px)`
  }
}

if (!customElements.get('diagram-atlas-figure')) {
  customElements.define('diagram-atlas-figure', DiagramAtlasFigure)
}

export {}

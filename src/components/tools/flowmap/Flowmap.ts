/**
 * Flowmap — a canvas for thinking on.
 *
 * Two ways in, which is the whole design:
 *
 *   1. Paste structure you already have — a mermaid flowchart, or an indented
 *      outline — and it lays itself out. Hand-placing thirty nodes is the part
 *      that stops people drawing the diagram at all.
 *   2. Then rearrange, add and connect by hand, because a generated layout is a
 *      starting point and never the finished thought.
 *
 * The page is canvas-first: one command bar, a source drawer that is open while
 * the board is empty and folds away after a draw, the board at full width, and
 * a floating toolbar for whatever is selected. Controls come from the shared
 * kit (`data-kit`, src/styles/controls.css).
 *
 * Rendering is Cytoscape.js, which is ~400KB and therefore **lazy-loaded here
 * and nowhere else** — it is imported inside connectedCallback, so no other page
 * on the site pays for it. Hand-rolling pan/zoom, force layout and edge routing
 * would have been far more code than the dependency costs.
 *
 * State outlives the tab twice over: locally in localStorage, and shareably in
 * the URL fragment, which is kept current as you edit (never the query string —
 * a fragment is not sent to the server and never reaches an access log).
 *
 * All module-level names are tr-/FM_-prefixed: tool component files share one
 * global script scope.
 */

import {
  GRAPH_SHAPES,
  GRAPH_TONES,
  decodeGraph,
  encodeGraph,
  isGraphShape,
  isGraphTone,
  parseGraphText,
  toMermaid,
  type Graph,
  type GraphShape,
  type GraphTone,
} from '../../../lib/graph-text'
import { tidyTree } from '../../../lib/graph-layout'

const FM_STORE = 'flowmap:v1'
/** View preferences (arrangement, direction), kept apart from the graph so a
 *  saved board stays the shape `decodeGraph` reads. */
const FM_VIEW_STORE = 'flowmap:view:v1'

/** How many steps back the board remembers. Deep enough that "undo until it
 *  looks right" always works, shallow enough that the snapshots stay small. */
const FM_HISTORY_MAX = 50

/** Model shape -> the Cytoscape shape that draws it. Kept here rather than in
 *  the shared module: the vocabulary is the site's, the rendering is this
 *  renderer's, and swapping renderer should not rewrite the saved graphs. */
const FM_SHAPE_CY: Record<GraphShape, string> = {
  rounded: 'round-rectangle',
  rect: 'rectangle',
  diamond: 'diamond',
  pill: 'ellipse',
}

const FM_SHAPE_LABEL: Record<GraphShape, string> = {
  rounded: 'Step',
  rect: 'Box',
  diamond: 'Decision',
  pill: 'Start / end',
}

/** The shape buttons draw their shape rather than name it: four words would
 *  not fit the floating toolbar on a phone. The name is the label and title. */
const FM_SHAPE_ICON: Record<GraphShape, string> = {
  rounded: '<rect x="2" y="4" width="14" height="10" rx="3"/>',
  rect: '<rect x="2" y="4" width="14" height="10"/>',
  diamond: '<path d="M9 2 16 9 9 16 2 9Z"/>',
  pill: '<rect x="1.5" y="5" width="15" height="8" rx="4"/>',
}

const FM_TONE_LABEL: Record<GraphTone, string> = {
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  violet: 'Violet',
}

/** One step of the history. Positions are part of the state — undoing a drag
 *  has to put the node back, and undoing an auto-arrange has to put every node
 *  back. */
interface TrSnapshot {
  graph: Graph
  positions: Record<string, { x: number; y: number }>
}

type TrLayout = 'flow' | 'grid' | 'force'
type TrDirection = 'TB' | 'LR'

/**
 * `nodeDimensionsIncludeLabels` is the important one and it is off by default:
 * without it Cytoscape lays out using the node's box and ignores the text
 * spilling out of it, so a graph of word-labelled nodes comes out overlapping
 * itself in the top-left corner. Everything else here is spacing tuned around
 * that.
 */
const FM_BASE = { fit: true, padding: 40, animate: true, nodeDimensionsIncludeLabels: true }

const FM_LAYOUTS: Record<TrLayout, any> = {
  // Positions come from tidyTree; Cytoscape only animates to them.
  flow: { ...FM_BASE, name: 'preset', animationDuration: 250 },
  grid: { ...FM_BASE, name: 'grid', avoidOverlap: true, avoidOverlapPadding: 12, animationDuration: 250 },
  force: { ...FM_BASE, name: 'cose', animationDuration: 400, nodeRepulsion: 12000, idealEdgeLength: 120, nodeOverlap: 20 },
}

const FM_SAMPLE = `- Ship the learnings section
  - Write the articles
    - Conway
    - Turing
  - Wire the embeds
  - Generate the share cards
- Merge the engines into Driftfield
  - Six mode routes
  - Redirect the old game URLs
- Rewrite projects`

/** How long a status message stays before the line falls back to the counts. */
const FM_MESSAGE_MS = 4000

/** Read CSS custom properties so the graph follows the site theme rather than
 *  hardcoding a palette Cytoscape would then own. */
function trToken(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value || fallback
}

function trPlural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

class FlowmapTool extends HTMLElement {
  private cy: any = null
  private ro: ResizeObserver | null = null
  private abort: AbortController | null = null
  private graph: Graph = { nodes: [], edges: [] }
  private layout: TrLayout = 'flow'
  private direction: TrDirection = 'TB'
  private connectFrom: string | null = null
  /** Arrow-key nudges inside this window collapse into one history step. */
  private lastNudge = 0
  private seq = 0
  private history: TrSnapshot[] = []
  private future: TrSnapshot[] = []
  /** Captured on grab, pushed on drop — so a click that moves nothing does not
   *  spend a history step. */
  private pendingDrag: TrSnapshot | null = null
  /** Re-fit on resize only while the visitor has not zoomed or panned: a fit
   *  that undoes their zoom whenever the page reflows is worse than none. */
  private autoFit = true
  private lastPointer = ''
  private hashTimer = 0
  private messageTimer = 0

  async connectedCallback() {
    const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
    const mod = mac ? '⌘' : 'Ctrl'
    this.innerHTML = `
      <div data-type="tool-page" data-tool="flowmap" data-kit>
        <div data-type="tool-header">
          <h1>Flowmap</h1>
          <p>Paste an outline or a mermaid flowchart and it draws itself. Move things around, then share it as a link, an image or mermaid.</p>
        </div>

        <div data-type="fm-bar" role="toolbar" aria-label="Diagram">
          <div data-type="toolbar">
            <button data-action="source" type="button" aria-pressed="false" aria-controls="fm-source">Source</button>
            <button data-action="add" type="button" title="Add a node (N). With a node selected, adds its child">Add node <kbd>N</kbd></button>
            <button data-action="connect" type="button" aria-pressed="false" title="Connect the selected node to another (C)" disabled>Connect <kbd>C</kbd></button>
          </div>
          <div data-type="toolbar">
            <div data-type="segmented" role="group" aria-label="Arrange">
              <button data-layout="flow" type="button" aria-pressed="false" title="Arrange as a flow">Flow</button>
              <button data-layout="grid" type="button" aria-pressed="false" title="Arrange in a grid">Grid</button>
              <button data-layout="force" type="button" aria-pressed="false" title="Arrange by connections">Force</button>
            </div>
            <div data-type="segmented" role="group" aria-label="Direction">
              <button data-dir="TB" data-icon type="button" aria-pressed="false" aria-label="Top to bottom" title="Top to bottom">${this.arrow('down')}</button>
              <button data-dir="LR" data-icon type="button" aria-pressed="false" aria-label="Left to right" title="Left to right">${this.arrow('right')}</button>
            </div>
          </div>
          <div data-type="toolbar" data-slot="end">
            <input data-field="search" type="search" placeholder="Find a node" aria-label="Find a node" />
            <button data-action="undo" data-icon data-variant="ghost" type="button" aria-label="Undo" title="Undo (${mod}+Z)" disabled>${this.arrow('undo')}</button>
            <button data-action="redo" data-icon data-variant="ghost" type="button" aria-label="Redo" title="Redo (${mod}+Shift+Z)" disabled>${this.arrow('redo')}</button>
            <details data-type="menu">
              <summary>Export ${this.arrow('chevron')}</summary>
              <div role="menu" aria-label="Export">
                <button data-action="copy-link" role="menuitem" type="button">Copy link</button>
                <button data-action="copy-mermaid" role="menuitem" type="button">Copy as Mermaid</button>
                <div role="separator"></div>
                <button data-action="png" data-scale="2" role="menuitem" type="button">Save PNG <span>2×</span></button>
                <button data-action="png" data-scale="4" role="menuitem" type="button">Save PNG, large <span>4×</span></button>
              </div>
            </details>
          </div>
        </div>

        <div data-type="fm-workspace" data-source="closed">
          <section data-type="fm-source" id="fm-source" aria-labelledby="fm-source-label" hidden>
            <label data-type="fm-source-field">
              <span data-type="section-label" id="fm-source-label">Source</span>
              <textarea data-field="import" spellcheck="false"
                placeholder="- An outline&#10;  - nests into a tree&#10;&#10;…or mermaid:&#10;A[Start] --> B{Decide}"></textarea>
            </label>
            <div data-type="toolbar">
              <button data-action="import" data-variant="primary" type="button" title="Draw (${mod}+Enter)">Draw <kbd>${mod} ↵</kbd></button>
              <button data-action="sample" type="button">Sample</button>
            </div>
            <p data-type="fm-help">Drawing replaces the board; undo brings it back. An outline nests by indenting two spaces. Mermaid reads <code>A --> B</code>, <code>A[Label]</code> and <code>B{Decision}</code>.</p>
          </section>

          <div data-type="fm-stage">
            <div data-type="fm-board" tabindex="0" role="application"
                 aria-label="Diagram board. Tab steps through nodes, arrows nudge, Enter renames, N adds, C connects, F fits, Delete removes, Escape leaves the board">
              <div data-type="fm-canvas"></div>
            </div>

            <div data-type="fm-empty" hidden>
              <div>
                <p data-type="fm-empty-title">An empty board</p>
                <p>Paste an outline or a mermaid flowchart into Source, or start from the sample and change it.</p>
                <div data-type="toolbar">
                  <button data-action="sample-draw" type="button">Draw the sample</button>
                  <button data-action="open-source" type="button">Open Source</button>
                </div>
                <p data-type="fm-empty-hint">Or add a node with <kbd>N</kbd>, or double-click the board.</p>
              </div>
            </div>

            <div data-type="fm-selection" role="toolbar" aria-label="Selection" hidden></div>

            <p data-type="fm-banner" role="status" hidden>
              <span data-type="fm-banner-text"></span>
              <button data-action="cancel-connect" data-variant="ghost" type="button">Cancel <kbd>Esc</kbd></button>
            </p>

            <div data-type="fm-zoom">
              <div data-type="segmented" role="group" aria-label="Zoom">
                <button data-action="zoom-out" data-icon type="button" aria-label="Zoom out" title="Zoom out">${this.arrow('minus')}</button>
                <button data-action="zoom-fit" data-icon type="button" aria-label="Fit to view" title="Fit to view (F)">${this.arrow('fit')}</button>
                <button data-action="zoom-in" data-icon type="button" aria-label="Zoom in" title="Zoom in">${this.arrow('plus')}</button>
              </div>
            </div>
          </div>
        </div>

        <p data-type="status-line">
          <span data-type="fm-count"></span>
          <span data-type="fm-message" role="status" aria-live="polite"></span>
        </p>
      </div>
    `

    this.restore()
    this.abort = new AbortController()
    // Cytoscape is the heavy part and only this page needs it.
    const cytoscape = (await import('cytoscape')).default
    if (!this.isConnected) return
    this.initCanvas(cytoscape)
    this.wire()
    this.setSource(this.graph.nodes.length === 0)
    this.sync({ animate: false })
    // The labels are drawn to a canvas in the site's serif, which may still be
    // loading; redraw once it is here.
    void document.fonts?.ready.then(() => this.cy?.style().update())
  }

  disconnectedCallback() {
    this.abort?.abort()
    this.abort = null
    clearTimeout(this.hashTimer)
    clearTimeout(this.messageTimer)
    // Before destroy(): the observer fires on the teardown reflow otherwise, and
    // its callback would touch a half-destroyed instance.
    this.ro?.disconnect()
    this.ro = null
    this.cy?.destroy()
    this.cy = null
  }

  /** Small stroke icons, drawn in the text colour. */
  private arrow(kind: 'down' | 'right' | 'undo' | 'redo' | 'minus' | 'plus' | 'fit' | 'chevron'): string {
    const paths: Record<typeof kind, string> = {
      down: 'M9 3v12M4 10l5 5 5-5',
      right: 'M3 9h12M10 4l5 5-5 5',
      undo: 'M7 4 3 8l4 4M3 8h8a4 4 0 0 1 0 8H8',
      redo: 'M11 4l4 4-4 4M15 8H7a4 4 0 0 0 0 8h3',
      minus: 'M4 9h10',
      plus: 'M4 9h10M9 4v10',
      fit: 'M3 7V3h4M11 3h4v4M15 11v4h-4M7 15H3v-4',
      chevron: 'M5 7l4 4 4-4',
    }
    return `<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[kind]}"/></svg>`
  }

  private restore() {
    try {
      const view = JSON.parse(localStorage.getItem(FM_VIEW_STORE) ?? 'null')
      if (view && ['flow', 'grid', 'force'].includes(view.layout)) this.layout = view.layout
      if (view && ['TB', 'LR'].includes(view.direction)) this.direction = view.direction
    } catch {
      // Defaults are fine.
    }
    // A shared link wins over local state: someone following a link means to see
    // that board, not whatever they last had open.
    const hash = location.hash.startsWith('#g=') ? location.hash.slice(3) : ''
    if (hash) {
      const shared = decodeGraph(hash)
      if (shared) {
        this.graph = shared
        this.seq = shared.nodes.length
        return
      }
    }
    try {
      const saved = JSON.parse(localStorage.getItem(FM_STORE) ?? 'null')
      if (saved && Array.isArray(saved.nodes) && Array.isArray(saved.edges)) {
        this.graph = saved
        this.seq = saved.nodes.length
      }
    } catch {
      // Corrupt storage degrades to an empty board, never a broken tool.
    }
  }

  private persist() {
    try {
      localStorage.setItem(FM_STORE, JSON.stringify(this.graph))
      localStorage.setItem(FM_VIEW_STORE, JSON.stringify({ layout: this.layout, direction: this.direction }))
    } catch {
      // Quota or private mode. Everything still works for this session.
    }
    // The address bar always holds the board, so reload, Back and a copied URL
    // all agree. Debounced: encoding on every arrow-key nudge is wasted work.
    // replaceState, never pushState: an edit is not a page to go back to.
    clearTimeout(this.hashTimer)
    this.hashTimer = window.setTimeout(() => {
      const bare = `${location.pathname}${location.search}`
      history.replaceState(history.state, '', this.graph.nodes.length ? `${bare}#g=${encodeGraph(this.graph)}` : bare)
    }, 400)
    this.renderCount()
  }

  /* ── History ───────────────────────────────────────────────────────────
   * Undo is the feature whose absence makes a diagram editor feel like a toy:
   * without it every experiment is a commitment, so people stop experimenting.
   * Snapshots are whole-graph copies rather than a command log — the graph is
   * a few KB and a copy is honest, where an inverse-operation log is a second
   * implementation of every edit and drifts from the first one.
   */

  private snapshot(): TrSnapshot {
    const positions: Record<string, { x: number; y: number }> = {}
    this.cy?.nodes().forEach((n: any) => { positions[n.id()] = { ...n.position() } })
    return { graph: structuredClone(this.graph), positions }
  }

  private pushSnapshot(snap: TrSnapshot) {
    this.history.push(snap)
    if (this.history.length > FM_HISTORY_MAX) this.history.shift()
    // Any new edit abandons the redo branch; keeping it would let redo apply a
    // change to a board it was never taken from.
    this.future.length = 0
    this.markHistory()
  }

  /** Call BEFORE mutating, so the stack holds the state to come back to. */
  private commit() {
    this.pushSnapshot(this.snapshot())
  }

  private travel(from: TrSnapshot[], to: TrSnapshot[]) {
    const target = from.pop()
    if (!target) return
    to.push(this.snapshot())
    this.graph = structuredClone(target.graph)
    this.seq = Math.max(this.seq, this.graph.nodes.length)
    this.sync({ positions: target.positions })
    this.markHistory()
  }

  private markHistory() {
    const undo = this.querySelector('[data-action="undo"]') as HTMLButtonElement | null
    const redo = this.querySelector('[data-action="redo"]') as HTMLButtonElement | null
    if (undo) undo.disabled = this.history.length === 0
    if (redo) redo.disabled = this.future.length === 0
  }

  private initCanvas(cytoscape: any) {
    const host = this.querySelector('[data-type="fm-canvas"]') as HTMLElement
    const text = trToken(this, '--color-text', '#e8e8e8')
    const muted = trToken(this, '--color-muted', '#8a8a8a')
    const border = trToken(this, '--color-border', '#394255')
    const accent = trToken(this, '--color-accent', '#7c6cf0')
    const accentSoft = trToken(this, '--color-accent-soft', '#1a1733')
    const surface = trToken(this, '--color-surface-2', '#141a26')
    const bg = trToken(this, '--color-surface', '#0b0f18')
    // The diagram is read, so its labels are the reading face; edge labels are
    // annotations and take the interface face.
    const serif = trToken(this, '--font-serif', 'Georgia, serif')
    const mono = trToken(this, '--font-mono', 'monospace')
    const tones = Object.fromEntries(GRAPH_TONES.map(name => [name, trToken(this, `--tone-${name}`, muted)])) as Record<GraphTone, string>

    this.cy = cytoscape({
      container: host,
      // Labels come from user text and are drawn to a canvas by Cytoscape, so
      // there is no HTML parsing here — and the selection toolbar sets user
      // text with .value and textContent, because that one is real DOM.
      style: [
        {
          selector: 'node',
          style: {
            'background-color': surface,
            'border-color': border,
            'border-width': 1,
            label: 'data(label)',
            color: text,
            'font-family': serif,
            'font-size': 14,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '160px',
            shape: 'round-rectangle',
            width: 'label',
            height: 'label',
            padding: '12px',
          },
        },
        // Shape is read from node DATA, never from a style string built out of
        // it — the value came through decodeGraph's allowlist and stays a token.
        ...GRAPH_SHAPES.map(name => ({
          selector: `node[kind = "${name}"]`,
          style: { shape: FM_SHAPE_CY[name] },
        })),
        { selector: 'node[kind = "diamond"]', style: { padding: '22px' } },
        // A tone is the border plus a faint tint of it, so the label keeps the
        // text colour it is contrast-checked against. Names map to theme tokens.
        ...GRAPH_TONES.map(name => ({
          selector: `node[tone = "${name}"]`,
          style: {
            'border-color': tones[name],
            'border-width': 1.5,
            'background-color': tones[name],
            'background-opacity': 0.16,
          },
        })),
        { selector: 'node:selected', style: { 'border-color': accent, 'border-width': 2.5 } },
        { selector: 'node:selected[!tone]', style: { 'background-color': accentSoft } },
        { selector: 'node.fm-source', style: { 'border-color': accent, 'border-width': 2, 'border-style': 'dashed' } },
        { selector: 'node.dimmed', style: { opacity: 0.25 } },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': muted,
            'target-arrow-color': muted,
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.9,
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-family': mono,
            'font-size': 11,
            color: muted,
            'text-background-color': bg,
            'text-background-opacity': 1,
            'text-background-padding': '3px',
          },
        },
        { selector: 'edge:selected', style: { width: 2.5, 'line-color': accent, 'target-arrow-color': accent, color: text } },
        { selector: 'edge.dimmed', style: { opacity: 0.15 } },
      ],
      elements: this.toElements(),
      layout: { name: 'preset' },
      wheelSensitivity: 0.2,
      minZoom: 0.15,
      maxZoom: 3,
    })

    this.cy.on('select unselect', () => this.renderSelection())
    // Grab captures the pre-drag board; drop pushes it. A click that moves
    // nothing never reaches dragfree, so it costs no history step.
    this.cy.on('grab', 'node', () => { this.pendingDrag = this.snapshot() })
    this.cy.on('dragfree', 'node', () => {
      if (this.pendingDrag) { this.pushSnapshot(this.pendingDrag); this.pendingDrag = null }
      this.persist()
    })
    this.cy.on('tap', (event: any) => {
      if (!this.connectFrom) return
      const target = event.target
      if (target === this.cy || !target.isNode?.()) { this.endConnect('Connection cancelled.'); return }
      if (target.id() === this.connectFrom) return
      this.connect(this.connectFrom, target.id())
    })
    this.cy.on('dbltap', (event: any) => {
      if (event.target === this.cy) {
        // Not on touch: a double tap is how a phone zooms, and a pan that
        // starts with a tap made nodes by accident.
        if (this.lastPointer === 'touch') return
        this.addNode(event.position)
      } else if (event.target.isNode?.()) {
        this.focusLabel()
      }
    })
    this.cy.on('scrollzoom pinchzoom dragpan', () => { this.autoFit = false })
    // Keep the floating toolbar beside its selection as the view or the node
    // moves; one placement per frame.
    let placing = 0
    this.cy.on('viewport position', () => {
      if (placing) return
      placing = requestAnimationFrame(() => { placing = 0; this.placeSelection() })
    })

    // Cytoscape caches its container's size at init and never re-reads it, so
    // any later change to that box — the window resizing, the source drawer
    // opening or closing — leaves the renderer drawing to the OLD dimensions.
    this.ro = new ResizeObserver(() => {
      if (!this.cy) return
      this.cy.resize()
      if (this.autoFit) this.fit(false)
    })
    this.ro.observe(host)
  }

  private toElements() {
    return [
      ...this.graph.nodes.map(n => ({ data: { id: n.id, label: n.label, kind: n.shape ?? 'rounded', ...(n.tone ? { tone: n.tone } : {}) } })),
      ...this.graph.edges.map(e => ({ data: { id: e.id, source: e.source, target: e.target, label: e.label ?? '' } })),
    ]
  }

  /** The arrangement as Cytoscape options. Flow is a tidy tree measured from
   *  the drawn nodes (src/lib/graph-layout.ts), in the chosen direction. */
  private layoutOptions() {
    if (this.layout !== 'flow') return FM_LAYOUTS[this.layout]
    const ids = this.cy.nodes().map((n: any) => n.id())
    const at = tidyTree(ids, this.graph.edges, id => {
      const n = this.cy.getElementById(id)
      return { w: n.outerWidth(), h: n.outerHeight() }
    }, this.direction)
    return { ...FM_LAYOUTS.flow, positions: (n: any) => at[n.id()] }
  }

  private fit(animate = true) {
    if (!this.cy || !this.cy.nodes().length) return
    this.autoFit = true
    if (animate) this.cy.animate({ fit: { eles: this.cy.elements(), padding: 40 } }, { duration: 200 })
    else this.cy.fit(undefined, 40)
    if (animate) return
    // A two-node board fitted to a wide canvas comes out absurdly large…
    if (this.cy.zoom() > 1.4) { this.cy.zoom(1.4); this.cy.center() }
    // …and a wide one fitted to a phone comes out unreadable. Below this the
    // labels are smaller than 8px, so stay readable and start at the top of
    // the diagram; the rest is a pan away.
    if (this.cy.zoom() < 0.6) {
      const box = this.cy.elements().boundingBox()
      this.cy.zoom(0.6)
      const firstRoot = this.cy.nodes().roots().first()
      const cx = this.direction === 'LR' || !firstRoot.length ? box.x1 * 0.6 - 24 : firstRoot.position().x * 0.6 - this.cy.width() / 2
      this.cy.pan({ x: -cx, y: -box.y1 * 0.6 + 24 })
    }
  }

  private say(text: string) {
    const el = this.querySelector('[data-type="fm-message"]') as HTMLElement | null
    if (!el) return
    el.textContent = text
    clearTimeout(this.messageTimer)
    this.messageTimer = window.setTimeout(() => { el.textContent = '' }, FM_MESSAGE_MS)
  }

  private renderCount(matches?: number) {
    const el = this.querySelector('[data-type="fm-count"]') as HTMLElement | null
    if (!el) return
    const { nodes, edges } = this.graph
    const total = `${trPlural(nodes.length, 'node')} · ${trPlural(edges.length, 'edge')}`
    el.textContent = matches === undefined ? total : `${matches} of ${trPlural(nodes.length, 'node')} match`
    const empty = this.querySelector('[data-type="fm-empty"]') as HTMLElement | null
    if (empty) empty.hidden = nodes.length > 0
  }

  private setSource(open: boolean) {
    const panel = this.querySelector('[data-type="fm-source"]') as HTMLElement
    const workspace = this.querySelector('[data-type="fm-workspace"]') as HTMLElement
    panel.hidden = !open
    workspace.dataset.source = open ? 'open' : 'closed'
    this.querySelector('[data-action="source"]')?.setAttribute('aria-pressed', String(open))
  }

  private draw(text: string) {
    if (!text.trim()) {
      this.say('Paste an outline or a flowchart first.')
      return
    }
    const parsed = parseGraphText(text)
    if (!parsed.nodes.length) {
      this.say('Nothing recognisable in there. Try one item per line, or A --> B.')
      return
    }
    this.commit()
    this.graph = parsed
    this.seq = parsed.nodes.length
    this.sync()
    this.setSource(false)
    this.say(`Drew ${trPlural(parsed.nodes.length, 'node')} and ${trPlural(parsed.edges.length, 'edge')}.`)
  }

  /** Add a node. With one node selected (and no position given) the new one is
   *  its child: connected from it and placed after it in the flow's direction,
   *  so an outline can be grown on the board one key at a time. */
  private addNode(position?: { x: number; y: number }) {
    this.commit()
    const id = `n${this.seq++}_${Date.now().toString(36)}`
    const parent = position ? null : this.cy.nodes(':selected')
    const from = parent && parent.length === 1 ? parent : null
    this.graph.nodes.push({ id, label: 'New node' })
    if (from) {
      this.graph.edges.push({ id: `e${this.graph.edges.length}_${Date.now().toString(36)}`, source: from.id(), target: id })
      const at = from.position()
      const siblings = from.outgoers('node').length
      position = this.direction === 'LR'
        ? { x: at.x + 200, y: at.y + siblings * 70 }
        : { x: at.x + siblings * 170, y: at.y + 110 }
    }
    if (!position) {
      // The middle of what is on screen, nudged off any node already there.
      const ext = this.cy.extent()
      position = { x: (ext.x1 + ext.x2) / 2, y: (ext.y1 + ext.y2) / 2 }
      while (!from && this.cy.nodes().some((n: any) => Math.abs(n.position().x - position!.x) < 40 && Math.abs(n.position().y - position!.y) < 30)) {
        position = { x: position.x + 30, y: position.y + 30 }
      }
    }
    this.sync({ relayout: false, place: { id, at: position } })
    this.cy.elements().unselect()
    this.cy.getElementById(id).select()
    this.focusLabel()
  }

  private connect(source: string, target: string) {
    this.commit()
    const id = `e${this.graph.edges.length}_${Date.now().toString(36)}`
    this.graph.edges.push({ id, source, target })
    this.endConnect()
    this.sync({ relayout: false })
    this.cy.elements().unselect()
    this.cy.getElementById(id).select()
    this.say('Connected. Give the edge a label above, or leave it bare.')
  }

  private startConnect() {
    const selected = this.cy.nodes(':selected')
    if (selected.length !== 1) return
    this.connectFrom = selected.id()
    selected.addClass('fm-source')
    this.querySelector('[data-action="connect"]')?.setAttribute('aria-pressed', 'true')
    const banner = this.querySelector('[data-type="fm-banner"]') as HTMLElement
    ;(banner.querySelector('[data-type="fm-banner-text"]') as HTMLElement).textContent =
      `From “${selected.data('label')}”: click the node it leads to.`
    banner.hidden = false
  }

  private endConnect(message?: string) {
    if (!this.connectFrom) return
    this.cy?.getElementById(this.connectFrom).removeClass('fm-source')
    this.connectFrom = null
    this.querySelector('[data-action="connect"]')?.setAttribute('aria-pressed', 'false')
    ;(this.querySelector('[data-type="fm-banner"]') as HTMLElement).hidden = true
    if (message) this.say(message)
  }

  private deleteSelected() {
    const selected = this.cy.elements(':selected')
    if (!selected.length) return
    this.commit()
    const nodeIds = new Set(selected.nodes().map((n: any) => n.id()))
    const edgeIds = new Set(selected.edges().map((e: any) => e.id()))
    this.graph.nodes = this.graph.nodes.filter(n => !nodeIds.has(n.id))
    // Drop a deleted node's edges too, or the next render references nodes that
    // are gone.
    this.graph.edges = this.graph.edges.filter(e => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target))
    this.endConnect()
    this.sync({ relayout: false })
    const n = nodeIds.size
    const m = edgeIds.size
    this.say(`Deleted ${[n ? trPlural(n, 'node') : '', m ? trPlural(m, 'edge') : ''].filter(Boolean).join(' and ')}. Undo brings ${n + m === 1 ? 'it' : 'them'} back.`)
  }

  private focusLabel() {
    const input = this.querySelector('[data-type="fm-selection"] input') as HTMLInputElement | null
    if (!input) return
    input.focus()
    input.select()
  }

  private markView() {
    for (const button of this.querySelectorAll('[data-layout]')) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-layout') === this.layout))
    }
    for (const button of this.querySelectorAll<HTMLButtonElement>('[data-dir]')) {
      button.setAttribute('aria-pressed', String(button.dataset.dir === this.direction))
      // Only a flow has a direction; a grid or a force layout has no "down".
      button.disabled = this.layout !== 'flow'
    }
  }

  private arrange() {
    // Auto-arrange is an undoable step, not a destructive one: hand-placed
    // positions are in the snapshot and come back on undo.
    this.commit()
    this.applyLayout()
    this.markView()
    this.persist()
  }

  private wire() {
    const signal = this.abort!.signal
    const importBox = this.querySelector('[data-field="import"]') as HTMLTextAreaElement
    const search = this.querySelector('[data-field="search"]') as HTMLInputElement
    const board = this.querySelector('[data-type="fm-board"]') as HTMLElement
    const menu = this.querySelector('details[data-type="menu"]') as HTMLDetailsElement
    const on = (action: string, run: (button: HTMLButtonElement) => void) => {
      for (const button of this.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`)) {
        button.addEventListener('click', () => run(button))
      }
    }

    on('source', () => {
      const open = this.querySelector('[data-type="fm-source"]')!.hasAttribute('hidden')
      this.setSource(open)
      if (open) importBox.focus()
    })
    on('open-source', () => { this.setSource(true); importBox.focus() })
    on('import', () => this.draw(importBox.value))
    importBox.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        this.draw(importBox.value)
      }
    })
    // The sample draws at once: a first visit should end in a diagram after one
    // click, not in a filled text box and a second instruction.
    const drawSample = () => { importBox.value = FM_SAMPLE; this.draw(FM_SAMPLE) }
    on('sample', drawSample)
    on('sample-draw', drawSample)

    for (const button of this.querySelectorAll<HTMLButtonElement>('[data-layout]')) {
      button.addEventListener('click', () => {
        this.layout = button.dataset.layout as TrLayout
        this.arrange()
      })
    }
    for (const button of this.querySelectorAll<HTMLButtonElement>('[data-dir]')) {
      button.addEventListener('click', () => {
        this.direction = button.dataset.dir as TrDirection
        this.arrange()
      })
    }

    search.addEventListener('input', () => {
      const term = search.value.trim().toLowerCase()
      if (!term) {
        this.cy.elements().removeClass('dimmed')
        this.renderCount()
        return
      }
      const matches = this.cy.nodes().filter((n: any) => String(n.data('label')).toLowerCase().includes(term))
      this.cy.elements().addClass('dimmed')
      matches.removeClass('dimmed')
      matches.connectedEdges().removeClass('dimmed')
      this.renderCount(matches.length)
    })
    search.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return
      // Enter takes you to the matches, so a find on a big board ends on screen.
      const matches = this.cy.nodes().not('.dimmed')
      if (!matches.length || matches.length === this.cy.nodes().length) return
      this.autoFit = false
      this.cy.animate({ fit: { eles: matches, padding: 80 } }, { duration: 200 })
    })

    on('add', () => this.addNode())
    on('connect', () => (this.connectFrom ? this.endConnect('Connection cancelled.') : this.startConnect()))
    on('cancel-connect', () => { this.endConnect('Connection cancelled.'); board.focus() })
    on('undo', () => this.travel(this.history, this.future))
    on('redo', () => this.travel(this.future, this.history))
    on('zoom-in', () => { this.autoFit = false; this.cy.zoom({ level: this.cy.zoom() * 1.2, renderedPosition: this.centre() }) })
    on('zoom-out', () => { this.autoFit = false; this.cy.zoom({ level: this.cy.zoom() / 1.2, renderedPosition: this.centre() }) })
    on('zoom-fit', () => this.fit())

    on('copy-link', () => {
      menu.open = false
      const url = `${location.origin}${location.pathname}#g=${encodeGraph(this.graph)}`
      history.replaceState(history.state, '', url)
      void navigator.clipboard?.writeText(url)
        .then(() => this.say('Link copied. The whole board is in it.'))
        .catch(() => this.say('Copy failed. The address bar has the link.'))
    })
    on('copy-mermaid', () => {
      menu.open = false
      const text = toMermaid(this.graph).replace(/^flowchart TD/, `flowchart ${this.direction === 'LR' ? 'LR' : 'TD'}`)
      void navigator.clipboard?.writeText(text)
        .then(() => this.say('Mermaid copied.'))
        .catch(() => this.say('Copy failed.'))
    })
    on('png', async button => {
      menu.open = false
      if (!this.graph.nodes.length) { this.say('Nothing to save yet.'); return }
      // The whole diagram, not the visible part of the canvas: Cytoscape
      // re-renders it at the chosen scale, so the large one is sharp, not an
      // upscale. Saved through the shared download helper.
      const { downloadBlob, formatBytes, EXPORT_MAX_EDGE } = await import('../../../lib/canvas-export')
      const blob: Blob = this.cy.png({
        output: 'blob',
        full: true,
        scale: Number(button.dataset.scale) || 2,
        maxWidth: EXPORT_MAX_EDGE,
        maxHeight: EXPORT_MAX_EDGE,
        bg: trToken(this, '--color-bg', '#05070c'),
      })
      downloadBlob(blob, 'flowmap.png')
      this.say(`Saved flowmap.png (${formatBytes(blob.size)}).`)
    })

    // The menu closes on a click outside it or on Escape, like any menu.
    document.addEventListener('click', event => {
      if (menu.open && !menu.contains(event.target as Node)) menu.open = false
    }, { signal })
    menu.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false
        ;(menu.querySelector('summary') as HTMLElement).focus()
      }
    })

    // Escape ends a connection from anywhere in the tool, not only the board:
    // after clicking Connect, focus is on that button.
    this.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !this.connectFrom || board.contains(event.target as Node)) return
      this.endConnect('Connection cancelled.')
    })

    // A click on the board gives it focus, so the keys below work for mouse
    // users too, not only after a Tab.
    board.addEventListener('pointerdown', (event: PointerEvent) => {
      this.lastPointer = event.pointerType
      board.focus({ preventScroll: true })
    })

    // Every pointer action needs a keyboard path. The board is one focusable
    // widget (role="application") rather than a tab stop per node: a 200-node
    // diagram would otherwise put 200 stops in the page's tab order. Escape
    // hands focus back, so keyboard users are never trapped in here.
    board.addEventListener('keydown', (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (meta && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) this.travel(this.future, this.history)
        else this.travel(this.history, this.future)
        return
      }
      if (meta && key === 'y') {
        event.preventDefault()
        this.travel(this.future, this.history)
        return
      }
      if (meta || event.altKey) return
      if (event.key === 'Escape') {
        if (this.connectFrom) this.endConnect('Connection cancelled.')
        else if (this.cy.elements(':selected').length) this.cy.elements().unselect()
        else board.blur()
        return
      }
      if (key === 'n') { event.preventDefault(); this.addNode(); return }
      if (key === 'f') { event.preventDefault(); this.fit(); return }
      if (key === 'c') {
        event.preventDefault()
        if (this.connectFrom) this.endConnect('Connection cancelled.')
        else this.startConnect()
        return
      }

      if (event.key === 'Tab') {
        const nodes = this.cy.nodes()
        if (!nodes.length) return
        event.preventDefault()
        const ids = nodes.map((n: any) => n.id())
        const current = this.cy.nodes(':selected').first()
        const at = current.length ? ids.indexOf(current.id()) : -1
        const next = ids[(at + (event.shiftKey ? -1 : 1) + ids.length + 1) % ids.length]
        this.cy.elements().unselect()
        const target = this.cy.getElementById(next)
        target.select()
        if (this.connectFrom) return
        this.cy.animate({ center: { eles: target } }, { duration: 150 })
        return
      }

      if (event.key === 'Enter' && this.connectFrom) {
        event.preventDefault()
        const target = this.cy.nodes(':selected').first()
        if (target.length && target.id() !== this.connectFrom) this.connect(this.connectFrom, target.id())
        return
      }

      const selected = this.cy.elements(':selected')
      if (!selected.length) return

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        this.deleteSelected()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        this.focusLabel()
        return
      }

      const nodes = selected.nodes()
      const step = event.shiftKey ? 24 : 8
      const delta: Record<string, { x: number; y: number }> = {
        ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
        ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      }
      const move = delta[event.key]
      if (!move || !nodes.length) return
      event.preventDefault()
      const now = Date.now()
      if (now - this.lastNudge > 600) this.commit()
      this.lastNudge = now
      nodes.forEach((n: any) => n.position({ x: n.position().x + move.x, y: n.position().y + move.y }))
      this.persist()
    })
  }

  /** On a wide board the selection toolbar floats beside what is selected, so
   *  it never covers a part of the diagram you are not working on; on a narrow
   *  one it docks to the bottom edge, where a thumb is (CSS, `data-dock`). */
  private placeSelection() {
    const bar = this.querySelector('[data-type="fm-selection"]') as HTMLElement | null
    if (!bar || bar.hidden || !this.cy) return
    const stage = bar.parentElement as HTMLElement
    const docked = stage.clientWidth < 640
    bar.toggleAttribute('data-dock', docked)
    if (docked) { bar.style.removeProperty('left'); bar.style.removeProperty('top'); return }
    const box = this.cy.elements(':selected').renderedBoundingBox()
    const gap = 12
    const w = bar.offsetWidth
    const h = bar.offsetHeight
    const x = Math.min(Math.max(gap, (box.x1 + box.x2) / 2 - w / 2), stage.clientWidth - w - gap)
    const above = box.y1 - h - gap
    const y = above >= gap ? above : Math.min(box.y2 + gap, stage.clientHeight - h - gap)
    bar.style.left = `${Math.round(x)}px`
    bar.style.top = `${Math.round(Math.max(gap, y))}px`
  }

  private centre() {
    return { x: this.cy.width() / 2, y: this.cy.height() / 2 }
  }

  private applyLayout(animate = true) {
    // Flow measures each node's drawn size, so this runs after the elements
    // are in the canvas.
    if (!this.cy || this.graph.nodes.length === 0) return
    const run = this.cy.layout({ ...this.layoutOptions(), animate })
    // cose settles asynchronously and its own `fit` runs against the pre-settled
    // extent, so re-fit once it reports done or the graph ends up off-centre.
    run.one('layoutstop', () => this.fit(false))
    run.run()
  }

  /** Push the model into the canvas. `relayout: false` keeps hand-placed
   *  positions when the change was a single add/delete/connect. */
  private sync(options: {
    relayout?: boolean
    animate?: boolean
    positions?: Record<string, { x: number; y: number }>
    place?: { id: string; at: { x: number; y: number } }
  } = {}) {
    if (!this.cy) return
    // Restoring a snapshot supplies its own positions, and that always wins:
    // undo has to put things back where they were, not re-run a layout.
    const { positions: given, place } = options
    const relayout = given ? false : (options.relayout ?? true)
    const positions = new Map<string, { x: number; y: number }>()
    if (given) {
      for (const [id, at] of Object.entries(given)) positions.set(id, at)
    } else if (!relayout) {
      this.cy.nodes().forEach((n: any) => positions.set(n.id(), { ...n.position() }))
    }
    if (place) positions.set(place.id, place.at)
    // Selection survives a re-render, so an edit does not drop what you were
    // working on.
    const selected = new Set(this.cy.elements(':selected').map((e: any) => e.id()))
    this.cy.elements().remove()
    this.cy.add(this.toElements())
    this.cy.elements().filter((e: any) => selected.has(e.id())).select()
    if (relayout) {
      this.applyLayout(options.animate ?? true)
    } else {
      this.cy.nodes().forEach((n: any) => {
        const saved = positions.get(n.id())
        if (saved) n.position(saved)
      })
      // A node with nowhere to be (a redo past a layout) lands at (0,0) on top
      // of everything; lay out only those. FM_BASE, not a bare grid: without
      // nodeDimensionsIncludeLabels this one layout packs word-labelled nodes
      // by their boxes and overlaps them.
      const unplaced = this.cy.nodes().filter((n: any) => !positions.has(n.id()))
      if (unplaced.length) {
        unplaced.layout({ ...FM_BASE, name: 'grid', fit: false, animate: false, boundingBox: this.cy.extent() }).run()
      }
    }
    this.markView()
    this.renderSelection()
    this.persist()
  }

  /** The floating toolbar: what you can do to what is selected. */
  private renderSelection() {
    const bar = this.querySelector('[data-type="fm-selection"]') as HTMLElement | null
    if (!bar || !this.cy) return
    const selected = this.cy.elements(':selected')
    const nodes = selected.nodes()
    const connect = this.querySelector('[data-action="connect"]') as HTMLButtonElement | null
    if (connect) connect.disabled = !this.connectFrom && nodes.length !== 1
    // While connecting, the toolbar would cover the board the visitor is
    // pointing at; the banner says what is going on instead.
    if (!selected.length || this.connectFrom) {
      bar.hidden = true
      bar.replaceChildren()
      return
    }

    const button = (text: string, run: () => void, variant?: string) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = text
      if (variant) b.dataset.variant = variant
      b.addEventListener('click', run)
      return b
    }
    const remove = button('Delete', () => this.deleteSelected(), 'danger')
    remove.title = 'Delete (Del)'

    if (selected.length > 1) {
      const count = document.createElement('span')
      count.dataset.type = 'fm-selection-count'
      count.textContent = `${selected.length} selected`
      bar.replaceChildren(count, remove)
      bar.hidden = false
      this.placeSelection()
      return
    }

    const element = selected[0]
    const id = element.id()
    const isNode = element.isNode()
    const entry: { label?: string } | undefined = isNode
      ? this.graph.nodes.find(n => n.id === id)
      : this.graph.edges.find(e => e.id === id)

    const input = document.createElement('input')
    input.type = 'text'
    input.setAttribute('aria-label', isNode ? 'Node label' : 'Edge label')
    input.placeholder = isNode ? 'Label' : 'Label this edge'
    // .value, not innerHTML — this is user text going back into the DOM.
    input.value = entry?.label ?? ''
    // One history step per editing burst. Committing per keystroke would make
    // undo walk back letter by letter, which is not what anyone means by undo.
    let bursting = false
    input.addEventListener('focus', () => { bursting = false })
    input.addEventListener('input', () => {
      if (!entry) return
      if (!bursting) { this.commit(); bursting = true }
      entry.label = input.value
      element.data('label', input.value)
      this.persist()
    })
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault()
        ;(this.querySelector('[data-type="fm-board"]') as HTMLElement).focus({ preventScroll: true })
      }
    })

    if (!isNode) {
      const reverse = button('Reverse', () => {
        const edge = this.graph.edges.find(e => e.id === id)
        if (!edge) return
        this.commit()
        ;[edge.source, edge.target] = [edge.target, edge.source]
        this.sync({ relayout: false })
      })
      reverse.title = 'Point the arrow the other way'
      bar.replaceChildren(input, reverse, remove)
      bar.hidden = false
      this.placeSelection()
      return
    }

    // Shape is meaning in a flow diagram — a diamond reads as a decision before
    // anyone has read the label. Offered as a fixed set, not a free field.
    const shapes = document.createElement('div')
    shapes.dataset.type = 'segmented'
    shapes.setAttribute('role', 'group')
    shapes.setAttribute('aria-label', 'Shape')
    const node = this.graph.nodes.find(n => n.id === id)
    const current: GraphShape = isGraphShape(node?.shape) ? node!.shape! : 'rounded'
    for (const name of GRAPH_SHAPES) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.icon = ''
      b.setAttribute('aria-label', FM_SHAPE_LABEL[name])
      b.title = FM_SHAPE_LABEL[name]
      b.setAttribute('aria-pressed', String(name === current))
      b.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${FM_SHAPE_ICON[name]}</svg>`
      b.addEventListener('click', () => {
        if (!node || node.shape === name) return
        this.commit()
        node.shape = name
        element.data('kind', name)
        this.persist()
        this.renderSelection()
      })
      shapes.append(b)
    }

    const tones = document.createElement('div')
    tones.dataset.type = 'fm-tones'
    tones.setAttribute('role', 'group')
    tones.setAttribute('aria-label', 'Colour')
    const currentTone: GraphTone | undefined = isGraphTone(node?.tone) ? node!.tone : undefined
    for (const name of [undefined, ...GRAPH_TONES] as (GraphTone | undefined)[]) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.icon = ''
      b.dataset.tone = name ?? 'none'
      const label = name ? FM_TONE_LABEL[name] : 'No colour'
      b.setAttribute('aria-label', label)
      b.title = label
      b.setAttribute('aria-pressed', String(name === currentTone))
      // A real element, not ::before: the base layer's title tooltip owns a
      // button's pseudo-elements.
      const dot = document.createElement('span')
      dot.dataset.type = 'fm-swatch'
      dot.setAttribute('aria-hidden', 'true')
      b.append(dot)
      b.addEventListener('click', () => {
        if (!node || node.tone === name) return
        this.commit()
        if (name) node.tone = name
        else delete node.tone
        if (name) element.data('tone', name)
        else element.removeData('tone')
        this.persist()
        this.renderSelection()
      })
      tones.append(b)
    }

    bar.replaceChildren(input, shapes, tones, remove)
    bar.hidden = false
    this.placeSelection()
  }
}

if (!customElements.get('flowmap-tool')) {
  customElements.define('flowmap-tool', FlowmapTool)
}

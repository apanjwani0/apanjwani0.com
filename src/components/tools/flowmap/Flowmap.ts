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
 * Rendering is Cytoscape.js, which is ~400KB and therefore **lazy-loaded here
 * and nowhere else** — it is imported inside connectedCallback, so no other page
 * on the site pays for it. Hand-rolling pan/zoom, force layout and edge routing
 * would have been far more code than the dependency costs.
 *
 * State outlives the tab twice over: locally in localStorage, and shareably in
 * the URL fragment (never the query string — a fragment is not sent to the
 * server and never reaches an access log).
 *
 * All module-level names are tr-/FM_-prefixed: tool component files share one
 * global script scope.
 */

import {
  GRAPH_SHAPES,
  decodeGraph,
  encodeGraph,
  isGraphShape,
  parseGraphText,
  toMermaid,
  type Graph,
  type GraphShape,
} from '../../../lib/graph-text'

const FM_STORE = 'flowmap:v1'

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

/** A point the board can be restored to: the model plus where things sit.
 *  Positions are part of the state — undoing a drag has to put the node back,
 *  and undoing an auto-arrange has to put every node back. */
interface TrSnapshot {
  graph: Graph
  positions: Record<string, { x: number; y: number }>
}

type TrLayout = 'flow' | 'grid' | 'force'

/**
 * `nodeDimensionsIncludeLabels` is the important one and it is off by default:
 * without it Cytoscape lays out using the node's box and ignores the text
 * spilling out of it, so a graph of word-labelled nodes comes out overlapping
 * itself in the top-left corner. Everything else here is spacing tuned around
 * that.
 */
const FM_BASE = { fit: true, padding: 40, animate: true, nodeDimensionsIncludeLabels: true }

const FM_LAYOUTS: Record<TrLayout, any> = {
  flow: { ...FM_BASE, name: 'breadthfirst', directed: true, spacingFactor: 1.3, avoidOverlap: true, animationDuration: 250 },
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

/** Read CSS custom properties so the graph follows the site theme rather than
 *  hardcoding a palette Cytoscape would then own. */
function trToken(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value || fallback
}

class FlowmapTool extends HTMLElement {
  private cy: any = null
  private ro: ResizeObserver | null = null
  private graph: Graph = { nodes: [], edges: [] }
  private layout: TrLayout = 'flow'
  private connectFrom: string | null = null
  /** Arrow-key nudges inside this window collapse into one history step. */
  private lastNudge = 0
  private seq = 0
  private history: TrSnapshot[] = []
  private future: TrSnapshot[] = []
  /** Captured on grab, pushed on drop — so a click that moves nothing does not
   *  spend a history step. */
  private pendingDrag: TrSnapshot | null = null

  async connectedCallback() {
    this.innerHTML = `
      <div data-type="tool-page" data-tool="flowmap">
        <div data-type="fm-header">
          <div data-type="fm-titlebar">
            <h1>Flowmap</h1>
            <span data-type="fm-badge">a canvas for thinking on</span>
          </div>
          <p>Paste an outline or a mermaid flowchart and it draws itself. Then move things around.</p>
        </div>

        <div data-type="fm-body">
          <aside data-type="fm-rail">
            <section>
              <h2>Paste structure</h2>
              <textarea data-field="import" rows="8" spellcheck="false"
                placeholder="- An outline&#10;  - nests into a tree&#10;&#10;…or:&#10;A[Start] --> B[Next]"></textarea>
              <div data-type="fm-rail-actions">
                <button data-action="import" type="button">Draw it</button>
                <button data-action="sample" type="button">Sample</button>
              </div>
              <p data-type="fm-import-note" role="status"></p>
            </section>

            <section>
              <h2>Layout</h2>
              <div data-type="fm-layouts">
                <button data-layout="flow" type="button">Flow</button>
                <button data-layout="grid" type="button">Grid</button>
                <button data-layout="force" type="button">Force</button>
              </div>
            </section>

            <section>
              <h2>Find</h2>
              <input data-field="search" type="search" placeholder="filter nodes…" aria-label="Filter nodes" />
            </section>

            <section>
              <h2>Edit</h2>
              <div data-type="fm-rail-actions">
                <button data-action="add" type="button">Add node</button>
                <button data-action="connect" type="button">Connect…</button>
                <button data-action="delete" type="button">Delete</button>
              </div>
              <div data-type="fm-rail-actions">
                <button data-action="undo" type="button" disabled>Undo</button>
                <button data-action="redo" type="button" disabled>Redo</button>
              </div>
              <p data-type="fm-hint">Click a node to select. Double-click the background to add one there.</p>
              <p data-type="fm-keys">Focus the board and use <kbd>Tab</kbd> to step through nodes, arrows to nudge, <kbd>Enter</kbd> to rename, <kbd>Delete</kbd> to remove, <kbd>Esc</kbd> to leave.</p>
            </section>

            <section>
              <h2>Share</h2>
              <div data-type="fm-rail-actions">
                <button data-action="copy-link" type="button">Copy link</button>
                <button data-action="copy-mermaid" type="button">Copy as Mermaid</button>
                <button data-action="png" type="button">PNG</button>
              </div>
              <p data-type="fm-share-note" role="status"></p>
            </section>
          </aside>

          <div data-type="fm-canvas-wrap" tabindex="0" role="application"
               aria-label="Diagram board — Tab steps through nodes, arrows nudge, Enter renames, Delete removes, Escape leaves the board">
            <div data-type="fm-canvas"></div>
            <div data-type="fm-zoom">
              <button data-action="zoom-in" type="button" aria-label="Zoom in">+</button>
              <button data-action="zoom-out" type="button" aria-label="Zoom out">&minus;</button>
              <button data-action="zoom-fit" type="button" aria-label="Fit to view">&#9633;</button>
            </div>
          </div>

          <aside data-type="fm-detail">
            <h2>Selected</h2>
            <div data-type="fm-detail-body"><p data-type="fm-empty">Nothing selected.</p></div>
          </aside>
        </div>
      </div>
    `

    this.restore()
    // Cytoscape is the heavy part and only this page needs it.
    const cytoscape = (await import('cytoscape')).default
    this.initCanvas(cytoscape)
    this.wire()
    this.sync()
  }

  disconnectedCallback() {
    // Before destroy(): the observer fires on the teardown reflow otherwise, and
    // its callback would touch a half-destroyed instance.
    this.ro?.disconnect()
    this.ro = null
    this.cy?.destroy()
    this.cy = null
  }

  private restore() {
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
    } catch {
      // Quota or private mode. Everything still works for this session.
    }
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
    const accent = trToken(this, '--color-accent', '#7c6cf0')
    const surface = trToken(this, '--color-surface', '#1b1b1e')

    this.cy = cytoscape({
      container: host,
      // Labels come from user text and are drawn to a canvas by Cytoscape, so
      // there is no HTML parsing here — but the detail panel below still uses
      // textContent, because that one is real DOM.
      style: [
        {
          selector: 'node',
          style: {
            'background-color': surface,
            'border-color': muted,
            'border-width': 1,
            label: 'data(label)',
            color: text,
            'font-size': 12,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '140px',
            shape: 'round-rectangle',
            width: 'label',
            height: 'label',
            padding: '10px',
          },
        },
        // Shape is read from node DATA, never from a style string built out of
        // it — the value came through decodeGraph's allowlist and stays a token.
        ...GRAPH_SHAPES.map(name => ({
          selector: `node[kind = "${name}"]`,
          style: { shape: FM_SHAPE_CY[name] },
        })),
        { selector: 'node:selected', style: { 'border-color': accent, 'border-width': 2 } },
        { selector: 'node.dimmed', style: { opacity: 0.25 } },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': muted,
            'target-arrow-color': muted,
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 10,
            color: muted,
            'text-background-color': surface,
            'text-background-opacity': 1,
            'text-background-padding': '2px',
          },
        },
        { selector: 'edge.dimmed', style: { opacity: 0.15 } },
      ],
      elements: this.toElements(),
      layout: FM_LAYOUTS[this.layout],
      wheelSensitivity: 0.2,
    })

    this.cy.on('select unselect', 'node', () => this.renderDetail())
    // Grab captures the pre-drag board; drop pushes it. A click that moves
    // nothing never reaches dragfree, so it costs no history step.
    this.cy.on('grab', 'node', () => { this.pendingDrag = this.snapshot() })
    this.cy.on('dragfree', 'node', () => {
      if (this.pendingDrag) { this.pushSnapshot(this.pendingDrag); this.pendingDrag = null }
      this.persist()
    })
    this.cy.on('tap', 'node', (event: any) => {
      if (!this.connectFrom) return
      const target = event.target.id()
      if (target !== this.connectFrom) {
        this.commit()
        this.graph.edges.push({ id: `e${this.graph.edges.length}_${Date.now()}`, source: this.connectFrom, target })
        this.sync({ relayout: false })
      }
      this.connectFrom = null
      this.setNote('fm-hint', 'Click a node to select. Double-click the background to add one there.')
    })
    this.cy.on('dbltap', (event: any) => {
      if (event.target !== this.cy) return
      this.addNode(event.position)
    })

    // Cytoscape caches its container's size at init and never re-reads it, so
    // any later change to that box — the window resizing, the rails reflowing
    // when the detail panel fills, the three-column grid collapsing at 64rem —
    // leaves the renderer drawing to the OLD dimensions. The visible symptom is
    // a graph painted outside its own border, which is what shipped. Every other
    // canvas component here already observes its container; this one did not.
    this.ro = new ResizeObserver(() => {
      if (!this.cy) return
      this.cy.resize()
      this.cy.fit(undefined, 40)
    })
    this.ro.observe(host)
  }

  private toElements() {
    return [
      ...this.graph.nodes.map(n => ({ data: { id: n.id, label: n.label, kind: n.shape ?? 'rounded' } })),
      ...this.graph.edges.map(e => ({ data: { id: e.id, source: e.source, target: e.target, label: e.label ?? '' } })),
    ]
  }

  private setNote(type: string, text: string) {
    const el = this.querySelector(`[data-type="${type}"]`) as HTMLElement | null
    if (el) el.textContent = text
  }

  private addNode(position?: { x: number; y: number }) {
    this.commit()
    const id = `n${this.seq++}_${Date.now().toString(36)}`
    this.graph.nodes.push({ id, label: 'New node' })
    this.sync({ relayout: false })
    const added = this.cy.getElementById(id)
    if (position) added.position(position)
    this.cy.elements().unselect()
    added.select()
  }

  private wire() {
    const importBox = this.querySelector('[data-field="import"]') as HTMLTextAreaElement
    const search = this.querySelector('[data-field="search"]') as HTMLInputElement

    this.querySelector('[data-action="import"]')?.addEventListener('click', () => {
      const text = importBox.value
      if (!text.trim()) {
        this.setNote('fm-import-note', 'Paste an outline or a flowchart first.')
        return
      }
      const parsed = parseGraphText(text)
      if (!parsed.nodes.length) {
        this.setNote('fm-import-note', 'Nothing recognisable in there.')
        return
      }
      this.commit()
      this.graph = parsed
      this.seq = parsed.nodes.length
      this.sync()
      this.setNote('fm-import-note', `Drew ${parsed.nodes.length} nodes and ${parsed.edges.length} edges.`)
    })

    this.querySelector('[data-action="sample"]')?.addEventListener('click', () => {
      importBox.value = FM_SAMPLE
      this.setNote('fm-import-note', 'Sample loaded — press "Draw it".')
    })

    for (const button of this.querySelectorAll('[data-layout]')) {
      button.addEventListener('click', () => {
        // Auto-arrange is an undoable step, not a destructive one: hand-placed
        // positions are in the snapshot and come back on undo.
        this.commit()
        this.layout = button.getAttribute('data-layout') as TrLayout
        this.applyLayout()
        this.markLayout()
      })
    }

    search.addEventListener('input', () => {
      const term = search.value.trim().toLowerCase()
      if (!term) {
        this.cy.elements().removeClass('dimmed')
        return
      }
      const matches = this.cy.nodes().filter((n: any) => String(n.data('label')).toLowerCase().includes(term))
      this.cy.elements().addClass('dimmed')
      matches.removeClass('dimmed')
      matches.connectedEdges().removeClass('dimmed')
    })

    this.querySelector('[data-action="add"]')?.addEventListener('click', () => this.addNode())

    this.querySelector('[data-action="connect"]')?.addEventListener('click', () => {
      const selected = this.cy.nodes(':selected')
      if (selected.length !== 1) {
        this.setNote('fm-hint', 'Select exactly one node first, then press Connect and click its target.')
        return
      }
      this.connectFrom = selected.id()
      this.setNote('fm-hint', `Connecting from "${selected.data('label')}" — now click the target node.`)
    })

    this.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
      const selected = this.cy.nodes(':selected')
      if (!selected.length) return
      this.commit()
      const ids = new Set(selected.map((n: any) => n.id()))
      this.graph.nodes = this.graph.nodes.filter(n => !ids.has(n.id))
      // Drop the edges too, or the next render references nodes that are gone.
      this.graph.edges = this.graph.edges.filter(e => !ids.has(e.source) && !ids.has(e.target))
      this.sync({ relayout: false })
    })

    this.querySelector('[data-action="copy-link"]')?.addEventListener('click', () => {
      const url = `${location.origin}${location.pathname}#g=${encodeGraph(this.graph)}`
      history.replaceState(null, '', `#g=${encodeGraph(this.graph)}`)
      void navigator.clipboard?.writeText(url)
        .then(() => this.setNote('fm-share-note', 'Link copied — the whole board is in it.'))
        .catch(() => this.setNote('fm-share-note', 'Copy failed; the URL bar has the link.'))
    })

    this.querySelector('[data-action="copy-mermaid"]')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(toMermaid(this.graph))
        .then(() => this.setNote('fm-share-note', 'Mermaid copied.'))
        .catch(() => this.setNote('fm-share-note', 'Copy failed.'))
    })

    this.querySelector('[data-action="png"]')?.addEventListener('click', () => {
      const uri = this.cy.png({ full: true, scale: 2, bg: trToken(this, '--color-bg', '#101012') })
      const link = document.createElement('a')
      link.href = uri
      link.download = 'flowmap.png'
      link.click()
    })

    this.querySelector('[data-action="undo"]')?.addEventListener('click', () => this.travel(this.history, this.future))
    this.querySelector('[data-action="redo"]')?.addEventListener('click', () => this.travel(this.future, this.history))

    // Every pointer action needs a keyboard path. The board is one focusable
    // widget (role="application") rather than a tab stop per node: a 200-node
    // diagram would otherwise put 200 stops in the page's tab order. Escape
    // hands focus back, so keyboard users are never trapped in here.
    const board = this.querySelector('[data-type="fm-canvas-wrap"]') as HTMLElement
    board.addEventListener('keydown', (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) this.travel(this.future, this.history)
        else this.travel(this.history, this.future)
        return
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        this.travel(this.future, this.history)
        return
      }
      if (event.key === 'Escape') { board.blur(); return }

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
        this.cy.animate({ center: { eles: target } }, { duration: 150 })
        return
      }

      const selected = this.cy.nodes(':selected')
      if (!selected.length) return

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        ;(this.querySelector('[data-action="delete"]') as HTMLButtonElement)?.click()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        ;(this.querySelector('[data-type="fm-detail-body"] input') as HTMLInputElement)?.focus()
        return
      }

      const step = event.shiftKey ? 24 : 8
      const delta: Record<string, { x: number; y: number }> = {
        ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
        ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      }
      const move = delta[event.key]
      if (!move) return
      event.preventDefault()
      const now = Date.now()
      if (now - this.lastNudge > 600) this.commit()
      this.lastNudge = now
      selected.forEach((n: any) => n.position({ x: n.position().x + move.x, y: n.position().y + move.y }))
      this.persist()
    })

    this.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => this.cy.zoom(this.cy.zoom() * 1.2))
    this.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => this.cy.zoom(this.cy.zoom() / 1.2))
    this.querySelector('[data-action="zoom-fit"]')?.addEventListener('click', () => this.cy.fit(undefined, 30))
  }

  private markLayout() {
    for (const button of this.querySelectorAll('[data-layout]')) {
      button.toggleAttribute('data-active', button.getAttribute('data-layout') === this.layout)
    }
  }

  private applyLayout() {
    if (!this.cy || this.graph.nodes.length === 0) return
    const run = this.cy.layout(FM_LAYOUTS[this.layout])
    // cose settles asynchronously and its own `fit` runs against the pre-settled
    // extent, so re-fit once it reports done or the graph ends up off-centre.
    run.one('layoutstop', () => this.cy?.fit(undefined, 40))
    run.run()
  }

  /** Push the model into the canvas. `relayout: false` keeps hand-placed
   *  positions when the change was a single add/delete/connect. */
  private sync(options: { relayout?: boolean; positions?: Record<string, { x: number; y: number }> } = {}) {
    if (!this.cy) return
    // Restoring a snapshot supplies its own positions, and that always wins:
    // undo has to put things back where they were, not re-run a layout.
    const { positions: given } = options
    const relayout = given ? false : (options.relayout ?? true)
    const positions = new Map<string, { x: number; y: number }>()
    if (given) {
      for (const [id, at] of Object.entries(given)) positions.set(id, at)
    } else if (!relayout) {
      this.cy.nodes().forEach((n: any) => positions.set(n.id(), { ...n.position() }))
    }
    this.cy.elements().remove()
    this.cy.add(this.toElements())
    if (relayout) {
      this.applyLayout()
    } else {
      this.cy.nodes().forEach((n: any) => {
        const saved = positions.get(n.id())
        if (saved) n.position(saved)
      })
      // A node added without a position lands at (0,0) on top of everything;
      // only lay out when something genuinely has nowhere to be.
      const unplaced = this.cy.nodes().filter((n: any) => !positions.has(n.id()) && n.position().x === 0)
      // FM_BASE, not a bare grid: nodeDimensionsIncludeLabels is off by default,
      // and without it this one layout packs word-labelled nodes by their boxes
      // and overlaps them — the exact failure the constant exists to prevent.
      if (unplaced.length) {
        unplaced.layout({ ...FM_BASE, name: 'grid', fit: false, animate: false, boundingBox: this.cy.extent() }).run()
      }
    }
    this.markLayout()
    this.renderDetail()
    this.persist()
  }

  private renderDetail() {
    const body = this.querySelector('[data-type="fm-detail-body"]') as HTMLElement
    const selected = this.cy?.nodes(':selected')
    if (!selected || selected.length !== 1) {
      const empty = document.createElement('p')
      empty.dataset.type = 'fm-empty'
      empty.textContent = selected?.length ? `${selected.length} nodes selected.` : 'Nothing selected.'
      body.replaceChildren(empty)
      return
    }

    const node = selected[0]
    const id = node.id()

    const label = document.createElement('label')
    label.dataset.type = 'fm-field'
    const caption = document.createElement('span')
    caption.textContent = 'Label'
    const input = document.createElement('input')
    input.type = 'text'
    // .value, not innerHTML — this is user text going back into the DOM.
    input.value = String(node.data('label'))
    // One history step per editing burst. Committing per keystroke would make
    // undo walk back letter by letter, which is not what anyone means by undo.
    let bursting = false
    input.addEventListener('focus', () => { bursting = false })
    input.addEventListener('blur', () => { bursting = false })
    input.addEventListener('input', () => {
      const entry = this.graph.nodes.find(n => n.id === id)
      if (!entry) return
      if (!bursting) { this.commit(); bursting = true }
      entry.label = input.value
      node.data('label', input.value)
      this.persist()
    })
    label.append(caption, input)

    // Shape is meaning in a flow diagram — a diamond reads as a decision before
    // anyone has read the label. Offered as a fixed set, not a free field.
    const shapeWrap = document.createElement('div')
    shapeWrap.dataset.type = 'fm-shapes'
    const shapeCaption = document.createElement('span')
    shapeCaption.textContent = 'Shape'
    shapeWrap.append(shapeCaption)
    const entryNow = this.graph.nodes.find(n => n.id === id)
    const currentShape: GraphShape = isGraphShape(entryNow?.shape) ? entryNow!.shape! : 'rounded'
    for (const name of GRAPH_SHAPES) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = FM_SHAPE_LABEL[name]
      button.toggleAttribute('data-active', name === currentShape)
      button.setAttribute('aria-pressed', String(name === currentShape))
      button.addEventListener('click', () => {
        const entry = this.graph.nodes.find(n => n.id === id)
        if (!entry || entry.shape === name) return
        this.commit()
        entry.shape = name
        node.data('kind', name)
        this.persist()
        this.renderDetail()
      })
      shapeWrap.append(button)
    }

    const heading = document.createElement('h3')
    heading.textContent = 'Connections'
    const list = document.createElement('ul')
    list.dataset.type = 'fm-connections'
    const edges = this.graph.edges.filter(e => e.source === id || e.target === id)
    if (!edges.length) {
      const li = document.createElement('li')
      li.textContent = 'None yet.'
      list.append(li)
    }
    for (const edge of edges) {
      const otherId = edge.source === id ? edge.target : edge.source
      const other = this.graph.nodes.find(n => n.id === otherId)
      const li = document.createElement('li')
      const direction = document.createElement('span')
      direction.textContent = edge.source === id ? '→' : '←'
      const name = document.createElement('button')
      name.type = 'button'
      name.textContent = other?.label ?? otherId
      name.addEventListener('click', () => {
        this.cy.elements().unselect()
        const target = this.cy.getElementById(otherId)
        target.select()
        this.cy.animate({ center: { eles: target } }, { duration: 200 })
      })
      li.append(direction, name)
      list.append(li)
    }

    body.replaceChildren(label, shapeWrap, heading, list)
  }
}

if (!customElements.get('flowmap-tool')) {
  customElements.define('flowmap-tool', FlowmapTool)
}

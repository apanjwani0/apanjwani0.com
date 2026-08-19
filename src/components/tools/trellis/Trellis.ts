/**
 * Trellis — a canvas for thinking on.
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
 * All module-level names are tr-/TR_-prefixed: tool component files share one
 * global script scope.
 */

import {
  decodeGraph,
  encodeGraph,
  parseGraphText,
  toMermaid,
  type Graph,
} from '../../../lib/graph-text'

const TR_STORE = 'trellis:v1'

type TrLayout = 'flow' | 'grid' | 'force'

/**
 * `nodeDimensionsIncludeLabels` is the important one and it is off by default:
 * without it Cytoscape lays out using the node's box and ignores the text
 * spilling out of it, so a graph of word-labelled nodes comes out overlapping
 * itself in the top-left corner. Everything else here is spacing tuned around
 * that.
 */
const TR_BASE = { fit: true, padding: 40, animate: true, nodeDimensionsIncludeLabels: true }

const TR_LAYOUTS: Record<TrLayout, any> = {
  flow: { ...TR_BASE, name: 'breadthfirst', directed: true, spacingFactor: 1.3, avoidOverlap: true, animationDuration: 250 },
  grid: { ...TR_BASE, name: 'grid', avoidOverlap: true, avoidOverlapPadding: 12, animationDuration: 250 },
  force: { ...TR_BASE, name: 'cose', animationDuration: 400, nodeRepulsion: 12000, idealEdgeLength: 120, nodeOverlap: 20 },
}

const TR_SAMPLE = `- Ship the learnings section
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

class TrellisTool extends HTMLElement {
  private cy: any = null
  private graph: Graph = { nodes: [], edges: [] }
  private layout: TrLayout = 'flow'
  private connectFrom: string | null = null
  private seq = 0

  async connectedCallback() {
    this.innerHTML = `
      <div data-type="tr-tool">
        <div data-type="tr-header">
          <div data-type="tr-titlebar">
            <h1>Trellis</h1>
            <span data-type="tr-badge">a canvas for thinking on</span>
          </div>
          <p>Paste an outline or a mermaid flowchart and it draws itself. Then move things around.</p>
        </div>

        <div data-type="tr-body">
          <aside data-type="tr-rail">
            <section>
              <h2>Paste structure</h2>
              <textarea data-field="import" rows="8" spellcheck="false"
                placeholder="- An outline&#10;  - nests into a tree&#10;&#10;…or:&#10;A[Start] --> B[Next]"></textarea>
              <div data-type="tr-rail-actions">
                <button data-action="import" type="button">Draw it</button>
                <button data-action="sample" type="button">Sample</button>
              </div>
              <p data-type="tr-import-note" role="status"></p>
            </section>

            <section>
              <h2>Layout</h2>
              <div data-type="tr-layouts">
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
              <div data-type="tr-rail-actions">
                <button data-action="add" type="button">Add node</button>
                <button data-action="connect" type="button">Connect…</button>
                <button data-action="delete" type="button">Delete</button>
              </div>
              <p data-type="tr-hint">Click a node to select. Double-click the background to add one there.</p>
            </section>

            <section>
              <h2>Share</h2>
              <div data-type="tr-rail-actions">
                <button data-action="copy-link" type="button">Copy link</button>
                <button data-action="copy-mermaid" type="button">Copy as Mermaid</button>
                <button data-action="png" type="button">PNG</button>
              </div>
              <p data-type="tr-share-note" role="status"></p>
            </section>
          </aside>

          <div data-type="tr-canvas-wrap">
            <div data-type="tr-canvas"></div>
            <div data-type="tr-zoom">
              <button data-action="zoom-in" type="button" aria-label="Zoom in">+</button>
              <button data-action="zoom-out" type="button" aria-label="Zoom out">&minus;</button>
              <button data-action="zoom-fit" type="button" aria-label="Fit to view">&#9633;</button>
            </div>
          </div>

          <aside data-type="tr-detail">
            <h2>Selected</h2>
            <div data-type="tr-detail-body"><p data-type="tr-empty">Nothing selected.</p></div>
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
      const saved = JSON.parse(localStorage.getItem(TR_STORE) ?? 'null')
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
      localStorage.setItem(TR_STORE, JSON.stringify(this.graph))
    } catch {
      // Quota or private mode. Everything still works for this session.
    }
  }

  private initCanvas(cytoscape: any) {
    const host = this.querySelector('[data-type="tr-canvas"]') as HTMLElement
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
      layout: TR_LAYOUTS[this.layout],
      wheelSensitivity: 0.2,
    })

    this.cy.on('select unselect', 'node', () => this.renderDetail())
    this.cy.on('tap', 'node', (event: any) => {
      if (!this.connectFrom) return
      const target = event.target.id()
      if (target !== this.connectFrom) {
        this.graph.edges.push({ id: `e${this.graph.edges.length}_${Date.now()}`, source: this.connectFrom, target })
        this.sync({ relayout: false })
      }
      this.connectFrom = null
      this.setNote('tr-hint', 'Click a node to select. Double-click the background to add one there.')
    })
    this.cy.on('dbltap', (event: any) => {
      if (event.target !== this.cy) return
      this.addNode(event.position)
    })
  }

  private toElements() {
    return [
      ...this.graph.nodes.map(n => ({ data: { id: n.id, label: n.label } })),
      ...this.graph.edges.map(e => ({ data: { id: e.id, source: e.source, target: e.target, label: e.label ?? '' } })),
    ]
  }

  private setNote(type: string, text: string) {
    const el = this.querySelector(`[data-type="${type}"]`) as HTMLElement | null
    if (el) el.textContent = text
  }

  private addNode(position?: { x: number; y: number }) {
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
        this.setNote('tr-import-note', 'Paste an outline or a flowchart first.')
        return
      }
      const parsed = parseGraphText(text)
      if (!parsed.nodes.length) {
        this.setNote('tr-import-note', 'Nothing recognisable in there.')
        return
      }
      this.graph = parsed
      this.seq = parsed.nodes.length
      this.sync()
      this.setNote('tr-import-note', `Drew ${parsed.nodes.length} nodes and ${parsed.edges.length} edges.`)
    })

    this.querySelector('[data-action="sample"]')?.addEventListener('click', () => {
      importBox.value = TR_SAMPLE
      this.setNote('tr-import-note', 'Sample loaded — press "Draw it".')
    })

    for (const button of this.querySelectorAll('[data-layout]')) {
      button.addEventListener('click', () => {
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
        this.setNote('tr-hint', 'Select exactly one node first, then press Connect and click its target.')
        return
      }
      this.connectFrom = selected.id()
      this.setNote('tr-hint', `Connecting from "${selected.data('label')}" — now click the target node.`)
    })

    this.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
      const selected = this.cy.nodes(':selected')
      if (!selected.length) return
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
        .then(() => this.setNote('tr-share-note', 'Link copied — the whole board is in it.'))
        .catch(() => this.setNote('tr-share-note', 'Copy failed; the URL bar has the link.'))
    })

    this.querySelector('[data-action="copy-mermaid"]')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(toMermaid(this.graph))
        .then(() => this.setNote('tr-share-note', 'Mermaid copied.'))
        .catch(() => this.setNote('tr-share-note', 'Copy failed.'))
    })

    this.querySelector('[data-action="png"]')?.addEventListener('click', () => {
      const uri = this.cy.png({ full: true, scale: 2, bg: trToken(this, '--color-bg', '#101012') })
      const link = document.createElement('a')
      link.href = uri
      link.download = 'trellis.png'
      link.click()
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
    const run = this.cy.layout(TR_LAYOUTS[this.layout])
    // cose settles asynchronously and its own `fit` runs against the pre-settled
    // extent, so re-fit once it reports done or the graph ends up off-centre.
    run.one('layoutstop', () => this.cy?.fit(undefined, 40))
    run.run()
  }

  /** Push the model into the canvas. `relayout: false` keeps hand-placed
   *  positions when the change was a single add/delete/connect. */
  private sync(options: { relayout?: boolean } = {}) {
    if (!this.cy) return
    const { relayout = true } = options
    const positions = new Map<string, { x: number; y: number }>()
    if (!relayout) {
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
      if (unplaced.length) unplaced.layout({ name: 'grid', fit: false, boundingBox: this.cy.extent() }).run()
    }
    this.markLayout()
    this.renderDetail()
    this.persist()
  }

  private renderDetail() {
    const body = this.querySelector('[data-type="tr-detail-body"]') as HTMLElement
    const selected = this.cy?.nodes(':selected')
    if (!selected || selected.length !== 1) {
      const empty = document.createElement('p')
      empty.dataset.type = 'tr-empty'
      empty.textContent = selected?.length ? `${selected.length} nodes selected.` : 'Nothing selected.'
      body.replaceChildren(empty)
      return
    }

    const node = selected[0]
    const id = node.id()

    const label = document.createElement('label')
    label.dataset.type = 'tr-field'
    const caption = document.createElement('span')
    caption.textContent = 'Label'
    const input = document.createElement('input')
    input.type = 'text'
    // .value, not innerHTML — this is user text going back into the DOM.
    input.value = String(node.data('label'))
    input.addEventListener('input', () => {
      const entry = this.graph.nodes.find(n => n.id === id)
      if (!entry) return
      entry.label = input.value
      node.data('label', input.value)
      this.persist()
    })
    label.append(caption, input)

    const heading = document.createElement('h3')
    heading.textContent = 'Connections'
    const list = document.createElement('ul')
    list.dataset.type = 'tr-connections'
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

    body.replaceChildren(label, heading, list)
  }
}

if (!customElements.get('trellis-tool')) {
  customElements.define('trellis-tool', TrellisTool)
}

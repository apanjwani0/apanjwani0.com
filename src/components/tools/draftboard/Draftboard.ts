import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { helpSections } from './help-content'
import { parseHeadings, parseMarkdownOutline, type Graph } from '../../../lib/graph-text'
import { flashLabel } from '../../../lib/flash'

const STORAGE_KEY = 'draftboard-draft'
const MAP_MODE_KEY = 'draftboard-map-mode'

type MdMapMode = 'headings' | 'outline'

/** Cytoscape layout options. `nodeDimensionsIncludeLabels` is off by default and
 *  without it word-labelled nodes lay out on top of each other — see AGENTS.md. */
const MD_MAP_LAYOUT = {
  name: 'breadthfirst',
  directed: true,
  fit: true,
  padding: 30,
  spacingFactor: 1.25,
  avoidOverlap: true,
  nodeDimensionsIncludeLabels: true,
  animate: false,
}

class DraftboardTool extends HTMLElement {
  private cy: any = null
  private mapMode: MdMapMode = 'headings'
  private mapTimer: number | undefined

  connectedCallback() {
    const helpHtml = helpSections.map(s => `
      <div data-type="help-group">
        <h4>${s.title}</h4>
        ${s.entries.map(e => `
          <div data-type="help-row">
            <code>${e.syntax}</code>
            <span>${e.result}</span>
          </div>
        `).join('')}
      </div>
    `).join('')

    this.innerHTML = `
      <div data-type="tool-page" data-tool="draftboard">
        <div data-type="tool-header">
          <h1>Draftboard</h1>
          <p>Write and export markdown. Clean editor, no distractions.</p>
        </div>
        <div data-type="draftboard">
          <div data-type="md-view-bar">
            <button data-view="edit" title="Editor only">Edit</button>
            <button data-view="split" title="Side by side">Split</button>
            <button data-view="preview" title="Preview only">Preview</button>
            <button data-view="map" title="Structure map">Map</button>
          </div>
          <div data-type="md-panes">
            <textarea data-type="md-input" placeholder="Start writing markdown..."></textarea>
            <div data-type="md-preview"></div>
            <div data-type="md-map">
              <div data-type="md-map-bar">
                <button data-map-mode="headings">Headings</button>
                <button data-map-mode="outline">Outline</button>
                <span data-type="md-map-note"></span>
              </div>
              <div data-type="md-map-canvas"></div>
            </div>
          </div>
          <div data-type="md-actions-bar">
            <div data-group="editor">
              <button data-action="clear" title="Clear editor">Clear</button>
              <button data-action="copy" title="Copy markdown">Copy</button>
              <button data-action="help" title="Syntax reference">Help</button>
            </div>
            <div data-group="export">
              <button data-action="export-menu" title="Export options">Export</button>
              <div data-type="export-options">
                <button data-export="md" title="Download .md">.md</button>
                <button data-export="txt" title="Download .txt">.txt</button>
                <button data-export="pdf" title="Export PDF">PDF</button>
                <button data-export="image" title="Export as image">IMG</button>
              </div>
            </div>
          </div>
          <div data-type="md-help" hidden>
            <div data-type="help-header">
              <h3>Syntax Reference</h3>
              <button data-action="close-help" title="Close">&times;</button>
            </div>
            <div data-type="help-grid">${helpHtml}</div>
          </div>
        </div>
      </div>
    `

    const input = this.querySelector<HTMLTextAreaElement>('[data-type="md-input"]')!

    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      input.value = saved
    }

    input.addEventListener('input', () => {
      localStorage.setItem(STORAGE_KEY, input.value)
      this.updatePreview()
      this.scheduleMap()
    })

    this.querySelector('[data-type="md-map-bar"]')!
      .addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-map-mode]')
        if (!btn?.dataset.mapMode) return
        this.mapMode = btn.dataset.mapMode as MdMapMode
        localStorage.setItem(MAP_MODE_KEY, this.mapMode)
        this.renderMap()
      })

    this.querySelector('[data-type="md-view-bar"]')!
      .addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-view]')
        if (btn?.dataset.view) this.setView(btn.dataset.view)
      })

    this.querySelector('[data-type="md-actions-bar"]')!
      .addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-export]')
        if (!btn) return
        if (btn.dataset.action === 'export-menu') {
          this.toggleExportMenu()
        } else if (btn.dataset.action) {
          this.handleAction(btn.dataset.action)
        }
        if (btn.dataset.export) {
          this.handleExport(btn.dataset.export)
          this.toggleExportMenu(false)
        }
      })

    document.addEventListener('click', (e) => {
      const exportGroup = this.querySelector('[data-group="export"]')
      if (exportGroup && !exportGroup.contains(e.target as Node)) {
        this.toggleExportMenu(false)
      }
    })

    this.querySelector('[data-action="close-help"]')!
      .addEventListener('click', () => this.toggleHelp(false))

    const savedMode = localStorage.getItem(MAP_MODE_KEY)
    if (savedMode === 'headings' || savedMode === 'outline') this.mapMode = savedMode

    const defaultView = window.innerWidth <= 600 ? 'edit' : 'split'
    this.setView(defaultView)
    this.updatePreview()
  }

  disconnectedCallback() {
    clearTimeout(this.mapTimer)
    this.cy?.destroy()
    this.cy = null
  }

  /** Rebuild the map after typing stops. Re-laying out a graph on every
   *  keystroke is both wasted work and visually unusable. */
  private scheduleMap() {
    if (!this.cy) return
    clearTimeout(this.mapTimer)
    this.mapTimer = window.setTimeout(() => this.renderMap(), 400)
  }

  private currentGraph(): Graph {
    const input = this.querySelector<HTMLTextAreaElement>('[data-type="md-input"]')!
    return this.mapMode === 'headings'
      ? parseHeadings(input.value)
      : parseMarkdownOutline(input.value)
  }

  /** Put the caret on `line` and scroll it into view. The map's only job is
   *  navigation — it never writes back into the document. */
  private jumpTo(line: number) {
    // Leave the map first. The textarea is display:none in map view, and a
    // hidden textarea cannot take focus or report a scroll height — so jumping
    // without switching lands the caret somewhere the reader cannot see, which
    // reads as the click having done nothing.
    this.setView(window.innerWidth <= 600 ? 'edit' : 'split')

    const input = this.querySelector<HTMLTextAreaElement>('[data-type="md-input"]')!
    const lines = input.value.split('\n')
    const start = lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0)
    input.focus()
    input.setSelectionRange(start, start + (lines[line]?.length ?? 0))
    // Approximate: scroll so the target sits near the top of the textarea.
    const lineHeight = input.scrollHeight / Math.max(lines.length, 1)
    input.scrollTop = Math.max(0, line * lineHeight - lineHeight * 2)
  }

  /** Cytoscape is ~400KB, so it loads only when the Map view is first opened —
   *  someone who never presses Map never downloads it. */
  private async ensureMap() {
    if (this.cy) return
    const host = this.querySelector<HTMLElement>('[data-type="md-map-canvas"]')!
    const cytoscape = (await import('cytoscape')).default
    const token = (name: string, fallback: string) =>
      getComputedStyle(this).getPropertyValue(name).trim() || fallback
    const muted = token('--color-muted', '#8a8a8a')
    const surface = token('--color-surface', '#1b1b1e')

    this.cy = cytoscape({
      container: host,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': surface,
            'border-color': muted,
            'border-width': 1,
            label: 'data(label)',
            color: token('--color-text', '#e8e8e8'),
            'font-size': 12,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '160px',
            shape: 'round-rectangle',
            width: 'label',
            height: 'label',
            padding: '9px',
          },
        },
        { selector: 'node:selected', style: { 'border-color': token('--color-accent', '#7c6cf0'), 'border-width': 2 } },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': muted,
            'target-arrow-color': muted,
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
          },
        },
      ],
      wheelSensitivity: 0.2,
    })

    this.cy.on('tap', 'node', (event: any) => {
      const line = event.target.data('line')
      if (typeof line === 'number') this.jumpTo(line)
    })
  }

  private renderMap() {
    if (!this.cy) return
    const graph = this.currentGraph()
    const note = this.querySelector<HTMLElement>('[data-type="md-map-note"]')!

    for (const button of this.querySelectorAll<HTMLElement>('[data-map-mode]')) {
      button.toggleAttribute('data-active', button.dataset.mapMode === this.mapMode)
    }

    this.cy.elements().remove()
    if (!graph.nodes.length) {
      note.textContent = this.mapMode === 'headings'
        ? 'No headings yet — add a "# Heading" to see the shape of the document.'
        : 'No list items yet — add a bulleted list to see it as a map.'
      return
    }
    note.textContent = `${graph.nodes.length} nodes · click one to jump there`
    this.cy.add([
      ...graph.nodes.map(n => ({ data: { id: n.id, label: n.label, line: n.line } })),
      ...graph.edges.map(e => ({ data: { id: e.id, source: e.source, target: e.target } })),
    ])
    this.cy.layout(MD_MAP_LAYOUT).run()
  }

  private updatePreview() {
    const input = this.querySelector<HTMLTextAreaElement>('[data-type="md-input"]')!
    const preview = this.querySelector<HTMLDivElement>('[data-type="md-preview"]')!
    preview.innerHTML = DOMPurify.sanitize(marked.parse(input.value) as string)
  }

  private handleAction(action: string) {
    const input = this.querySelector<HTMLTextAreaElement>('[data-type="md-input"]')!

    switch (action) {
      case 'clear':
        input.value = ''
        localStorage.removeItem(STORAGE_KEY)
        this.updatePreview()
        this.renderMap()
        break
      case 'copy':
        navigator.clipboard.writeText(input.value).then(() => {
          flashLabel(this.querySelector<HTMLButtonElement>('[data-action="copy"]'), 'Copied', 1500)
        })
        break
      case 'help':
        this.toggleHelp()
        break
    }
  }

  private toggleExportMenu(force?: boolean) {
    const options = this.querySelector<HTMLElement>('[data-type="export-options"]')!
    const show = force !== undefined ? force : !options.hasAttribute('data-open')
    options.toggleAttribute('data-open', show)
  }

  private setView(mode: string) {
    const panes = this.querySelector<HTMLElement>('[data-type="md-panes"]')!
    panes.setAttribute('data-view', mode)

    this.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(btn => {
      btn.toggleAttribute('data-active', btn.dataset.view === mode)
    })

    // Build the map lazily, and only once the pane is actually visible —
    // Cytoscape measures its container, and a display:none container measures
    // zero, which produces an empty canvas that never recovers.
    if (mode === 'map') {
      void this.ensureMap().then(() => {
        this.cy?.resize()
        this.renderMap()
      })
    }
  }

  private toggleHelp(force?: boolean) {
    const help = this.querySelector<HTMLElement>('[data-type="md-help"]')!
    help.hidden = force !== undefined ? !force : !help.hidden
  }

  private handleExport(format: string) {
    const input = this.querySelector<HTMLTextAreaElement>('[data-type="md-input"]')!
    const preview = this.querySelector<HTMLDivElement>('[data-type="md-preview"]')!

    switch (format) {
      case 'md':    return this.downloadBlob(input.value, 'document.md', 'text/markdown')
      case 'txt':   return this.downloadBlob(input.value, 'document.txt', 'text/plain')
      case 'pdf':   return this.exportPdf(preview)
      case 'image': return this.exportImage(preview)
    }
  }

  private downloadBlob(content: string, filename: string, mime: string) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    Object.assign(document.createElement('a'), { href: url, download: filename }).click()
    URL.revokeObjectURL(url)
  }

  private exportPdf(preview: HTMLElement) {
    const win = window.open('', '_blank')!
    win.document.title = 'Document'
    const style = win.document.createElement('style')
    style.textContent = `
      body { font-family: Georgia, serif; max-width: 700px; margin: 2rem auto; line-height: 1.7; color: #111; }
      h1, h2, h3 { line-height: 1.3; }
      pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; border-radius: 4px; }
      code { font-family: monospace; background: #f4f4f4; padding: 0.1em 0.3em; border-radius: 2px; }
      pre code { background: none; padding: 0; }
      blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 1rem; color: #555; }
      details { margin: 0.5rem 0; }
      summary { cursor: pointer; font-weight: 600; }
      details[open] summary { margin-bottom: 0.5rem; }
    `
    win.document.head.appendChild(style)
    win.document.body.innerHTML = DOMPurify.sanitize(preview.innerHTML)
    win.print()
  }

  private async exportImage(preview: HTMLElement) {
    const btn = this.querySelector<HTMLButtonElement>('[data-export="image"]')!
    btn.disabled = true
    btn.textContent = '...'

    try {
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(preview, { backgroundColor: '#ffffff', scale: 2 })
      canvas.toBlob(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        Object.assign(document.createElement('a'), { href: url, download: 'document.png' }).click()
        URL.revokeObjectURL(url)
      })
    } finally {
      btn.disabled = false
      btn.textContent = 'IMG'
    }
  }
}

customElements.define('draftboard-tool', DraftboardTool)

export {}

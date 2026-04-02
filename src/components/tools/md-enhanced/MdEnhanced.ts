import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { helpSections } from './help-content'

const STORAGE_KEY = 'md-enhanced-draft'

class MdEnhancedTool extends HTMLElement {
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
      <div data-type="tool-page">
        <div data-type="tool-header">
          <h1>MD Enhanced</h1>
          <p>Write and export markdown. Clean editor, no distractions.</p>
        </div>
        <div data-type="md-enhanced">
          <div data-type="md-actions-bar">
            <div data-group="editor">
              <button data-action="clear" title="Clear editor">Clear</button>
              <button data-action="copy" title="Copy markdown">Copy</button>
              <button data-action="help" title="Syntax reference">Help</button>
            </div>
            <div data-group="export">
              <button data-export="md" title="Download .md">.md</button>
              <button data-export="txt" title="Download .txt">.txt</button>
              <button data-export="pdf" title="Export PDF">PDF</button>
              <button data-export="image" title="Export as image">IMG</button>
            </div>
          </div>
          <div data-type="md-panes">
            <textarea data-type="md-input" placeholder="Start writing markdown..."></textarea>
            <div data-type="md-preview"></div>
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
    })

    this.querySelector('[data-type="md-actions-bar"]')!
      .addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-export]')
        if (!btn) return
        if (btn.dataset.action) this.handleAction(btn.dataset.action)
        if (btn.dataset.export) this.handleExport(btn.dataset.export)
      })

    this.querySelector('[data-action="close-help"]')!
      .addEventListener('click', () => this.toggleHelp(false))

    this.updatePreview()
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
        break
      case 'copy':
        navigator.clipboard.writeText(input.value).then(() => {
          const btn = this.querySelector<HTMLButtonElement>('[data-action="copy"]')!
          const original = btn.textContent
          btn.textContent = 'Copied'
          setTimeout(() => { btn.textContent = original }, 1500)
        })
        break
      case 'help':
        this.toggleHelp()
        break
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

customElements.define('md-enhanced-tool', MdEnhancedTool)

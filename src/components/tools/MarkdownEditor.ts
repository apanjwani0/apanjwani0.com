import { marked } from 'marked'
import DOMPurify from 'dompurify'
import './markdown-editor.css'

class MarkdownEditorTool extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div data-type="md-editor">
        <div data-type="md-panes">
          <textarea data-type="md-input" placeholder="# Hello

Start writing markdown here...

- **Bold**, _italic_, \`code\`
- [Links](https://example.com)
- > Blockquotes"></textarea>
          <div data-type="md-preview"></div>
        </div>
        <div data-type="md-actions">
          <button data-export="md">Download .md</button>
          <button data-export="txt">Download .txt</button>
          <button data-export="pdf">Export PDF</button>
          <button data-export="image">Export Image</button>
        </div>
      </div>
    `

    this.querySelector<HTMLTextAreaElement>('[data-type="md-input"]')!
      .addEventListener('input', () => this.updatePreview())

    this.querySelector('[data-type="md-actions"]')!
      .addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-export]')
        if (btn?.dataset.export) this.handleExport(btn.dataset.export)
      })

    this.updatePreview()
  }

  private updatePreview() {
    const input = this.querySelector<HTMLTextAreaElement>('[data-type="md-input"]')!
    const preview = this.querySelector<HTMLDivElement>('[data-type="md-preview"]')!
    preview.innerHTML = DOMPurify.sanitize(marked.parse(input.value) as string)
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
    `
    win.document.head.appendChild(style)
    win.document.body.innerHTML = DOMPurify.sanitize(preview.innerHTML)
    win.print()
  }

  private async exportImage(preview: HTMLElement) {
    const btn = this.querySelector<HTMLButtonElement>('[data-export="image"]')!
    btn.disabled = true
    btn.textContent = 'Generating...'

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
      btn.textContent = 'Export Image'
    }
  }
}

customElements.define('markdown-editor-tool', MarkdownEditorTool)

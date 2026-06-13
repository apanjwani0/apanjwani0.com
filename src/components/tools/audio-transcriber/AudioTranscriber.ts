const MIC_SVG = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="1" width="6" height="11" rx="3"/>
  <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
  <line x1="12" y1="19" x2="12" y2="23"/>
  <line x1="8" y1="23" x2="16" y2="23"/>
</svg>`

const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'pt-BR', label: 'Portuguese' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'zh-CN', label: 'Chinese' },
]

class AudioTranscriberTool extends HTMLElement {
  private recognition: any = null
  private isRecording = false
  private finalTranscript = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private seconds = 0

  connectedCallback() {
    const langOptions = LANGUAGES.map(l =>
      `<option value="${l.code}">${l.label}</option>`
    ).join('')

    this.innerHTML = `
      <div data-type="tool-page">
        <div data-type="tool-header">
          <h1>Audio Transcriber</h1>
          <p>Real-time speech-to-text in your browser. No data leaves your device.</p>
        </div>
      <div data-type="audio-transcriber">
        <div data-type="at-unsupported" hidden>
          <p>Speech recognition is not supported in this browser. Try Chrome or Edge.</p>
        </div>
        <div data-type="at-main">
          <div data-type="at-controls">
            <select data-type="at-language">${langOptions}</select>
            <span data-type="at-status">Ready</span>
            <span data-type="at-duration" hidden>00:00</span>
          </div>
          <div data-type="at-mic-area">
            <button data-type="at-mic" data-recording="false" title="Start recording">
              ${MIC_SVG}
            </button>
          </div>
          <div data-type="at-output">
            <div data-type="at-transcript" data-placeholder="Transcript will appear here..."></div>
          </div>
          <div data-type="at-actions">
            <button data-action="copy">Copy</button>
            <button data-action="clear">Clear</button>
            <button data-action="download">.txt</button>
          </div>
        </div>
      </div>
      </div>
    `

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      this.querySelector<HTMLElement>('[data-type="at-unsupported"]')!.hidden = false
      this.querySelector<HTMLElement>('[data-type="at-main"]')!.hidden = true
      return
    }

    this.recognition = new SpeechRecognition()
    this.recognition.continuous = true
    this.recognition.interimResults = true
    this.recognition.lang = 'en-US'

    this.recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          this.finalTranscript += transcript + ' '
        } else {
          interim += transcript
        }
      }
      this.renderTranscript(interim)
    }

    this.recognition.onerror = (event: any) => {
      const status = this.querySelector<HTMLElement>('[data-type="at-status"]')!
      switch (event.error) {
        case 'not-allowed':
          status.textContent = 'Microphone permission denied'
          break
        case 'no-speech':
          status.textContent = 'No speech detected'
          break
        case 'network':
          status.textContent = 'Network error'
          break
        default:
          status.textContent = `Error: ${event.error}`
      }
      this.stopRecording()
    }

    this.recognition.onend = () => {
      if (this.isRecording) {
        // Continuous mode: restart if user hasn't explicitly stopped
        this.recognition.start()
      }
    }

    // Mic button
    this.querySelector('[data-type="at-mic"]')!
      .addEventListener('click', () => this.toggleRecording())

    // Language selector
    this.querySelector<HTMLSelectElement>('[data-type="at-language"]')!
      .addEventListener('change', (e) => {
        this.recognition.lang = (e.target as HTMLSelectElement).value
        if (this.isRecording) {
          this.recognition.stop()
          // onend handler will restart with new lang
        }
      })

    // Actions
    this.querySelector('[data-type="at-actions"]')!
      .addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')
        if (!btn) return
        switch (btn.dataset.action) {
          case 'copy':
            navigator.clipboard.writeText(this.finalTranscript.trim()).then(() => {
              btn.textContent = 'Copied'
              setTimeout(() => { btn.textContent = 'Copy' }, 1500)
            })
            break
          case 'clear':
            this.finalTranscript = ''
            this.renderTranscript('')
            break
          case 'download':
            this.downloadText()
            break
        }
      })
  }

  private toggleRecording() {
    if (this.isRecording) {
      this.stopRecording()
    } else {
      this.startRecording()
    }
  }

  private startRecording() {
    this.isRecording = true
    this.recognition.start()

    const mic = this.querySelector<HTMLElement>('[data-type="at-mic"]')!
    const status = this.querySelector<HTMLElement>('[data-type="at-status"]')!
    const duration = this.querySelector<HTMLElement>('[data-type="at-duration"]')!

    mic.setAttribute('data-recording', 'true')
    mic.title = 'Stop recording'
    status.textContent = 'Listening...'
    duration.hidden = false

    this.seconds = 0
    this.timer = setInterval(() => {
      this.seconds++
      const m = String(Math.floor(this.seconds / 60)).padStart(2, '0')
      const s = String(this.seconds % 60).padStart(2, '0')
      duration.textContent = `${m}:${s}`
    }, 1000)
  }

  private stopRecording() {
    this.isRecording = false
    this.recognition.stop()

    const mic = this.querySelector<HTMLElement>('[data-type="at-mic"]')!
    const status = this.querySelector<HTMLElement>('[data-type="at-status"]')!

    mic.setAttribute('data-recording', 'false')
    mic.title = 'Start recording'
    status.textContent = 'Stopped'

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private renderTranscript(interim: string) {
    const el = this.querySelector<HTMLElement>('[data-type="at-transcript"]')!
    const finalHtml = this.finalTranscript
      ? `<span data-type="at-final">${this.escapeHtml(this.finalTranscript)}</span>`
      : ''
    const interimHtml = interim
      ? `<span data-type="at-interim">${this.escapeHtml(interim)}</span>`
      : ''
    el.innerHTML = finalHtml + interimHtml
  }

  private escapeHtml(text: string) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  private downloadText() {
    const text = this.finalTranscript.trim()
    if (!text) return
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    Object.assign(document.createElement('a'), { href: url, download: 'transcript.txt' }).click()
    URL.revokeObjectURL(url)
  }
}

customElements.define('audio-transcriber-tool', AudioTranscriberTool)

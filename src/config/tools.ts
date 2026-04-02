export type ToolStatus = 'live' | 'wip' | 'external' | 'disabled'

export interface Tool {
  slug: string
  title: string
  description: string
  status: ToolStatus
  href?: string  // required when status === 'external'
  seoTitle?: string
  metaDescription?: string
  intro?: string
}

export const tools: Tool[] = [
  {
    slug: 'md-enhanced',
    title: 'MD Enhanced',
    description: 'Markdown editor with live preview and multi-format export.',
    status: 'live',
    seoTitle: 'MD Enhanced — Free Online Markdown Editor with Live Preview',
    metaDescription: 'Write markdown with instant live preview, then export to PDF, image, or plain text. No login, no tracking — runs entirely in your browser.',
    intro: 'A browser-based markdown editor with real-time preview. Write in markdown on the left, see the formatted result on the right. Export your work as PDF, PNG image, raw markdown, or plain text — all processed locally in your browser with no server uploads.',
  },
  {
    slug: 'audio-transcriber',
    title: 'Audio Transcriber',
    description: 'Real-time speech-to-text using your browser microphone.',
    status: 'disabled',
    seoTitle: 'Audio Transcriber — Free Browser Speech-to-Text',
    metaDescription: 'Transcribe speech to text in real time using your browser microphone. No uploads, no API keys — powered by the Web Speech API.',
    intro: 'Real-time speech-to-text transcription that runs entirely in your browser. Click the mic, speak, and watch your words appear. Supports multiple languages and lets you copy or download the transcript as a text file.',
  },
]

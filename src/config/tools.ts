export type ToolStatus = 'live' | 'wip' | 'external'

export interface Tool {
  slug: string
  title: string
  description: string
  status: ToolStatus
  href?: string  // required when status === 'external'
}

export const tools: Tool[] = [
  {
    slug: 'markdown-editor',
    title: 'Markdown Editor',
    description: 'Write markdown and export as .md, .txt, PDF, or image.',
    status: 'live',
  },
]

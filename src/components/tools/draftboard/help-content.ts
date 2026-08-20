export interface HelpEntry {
  syntax: string
  result: string
}

export interface HelpSection {
  title: string
  entries: HelpEntry[]
}

export const helpSections: HelpSection[] = [
  {
    title: 'Text',
    entries: [
      { syntax: '**bold**', result: 'bold' },
      { syntax: '*italic*', result: 'italic' },
      { syntax: '`code`', result: 'code' },
      { syntax: '~~strike~~', result: 'strikethrough' },
    ],
  },
  {
    title: 'Structure',
    entries: [
      { syntax: '# Heading 1', result: 'h1' },
      { syntax: '## Heading 2', result: 'h2' },
      { syntax: '- item', result: 'bullet list' },
      { syntax: '1. item', result: 'numbered list' },
      { syntax: '> quote', result: 'blockquote' },
      { syntax: '---', result: 'horizontal rule' },
    ],
  },
  {
    title: 'Content',
    entries: [
      { syntax: '[text](url)', result: 'link' },
      { syntax: '![alt](url)', result: 'image' },
      { syntax: '```lang', result: 'code block' },
    ],
  },
]

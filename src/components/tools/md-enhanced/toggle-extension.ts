import type { TokenizerAndRendererExtension } from 'marked'

export const toggleExtension: TokenizerAndRendererExtension = {
  name: 'toggle',
  level: 'block',

  start(src: string) {
    return src.match(/^>\+\s/m)?.index
  },

  tokenizer(src: string) {
    const rule = /^>\+\s+(.+)\n([\s\S]*?)(?=\n>\+\s|\n#{1,6}\s|$)/
    const match = rule.exec(src)
    if (match) {
      const token = {
        type: 'toggle',
        raw: match[0],
        heading: match[1].trim(),
        body: match[2].trim(),
        tokens: [] as any[],
      }
      this.lexer.blockTokens(token.body, token.tokens)
      return token
    }
  },

  renderer(token) {
    const body = this.parser.parse(token.tokens!)
    return `<details><summary>${token['heading']}</summary>${body}</details>\n`
  },
}

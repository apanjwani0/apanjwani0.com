/**
 * Text ⇄ graph, for Trellis.
 *
 * Two input dialects, auto-detected, because the tool has two jobs and they want
 * different notations:
 *
 *   mermaid  — `A[Label] --> B`, for diagrams you already have written down
 *              somewhere. Round-trips with the Mermaid export, so a graph can
 *              leave and come back.
 *   outline  — indentation, for mind-mapping, where the thing you have is a
 *              nested list and drawing the edges by hand is the tedious part.
 *
 * Kept out of the component so it can be asserted without a DOM — parsers are
 * where the bugs are, and a parser with no test is a parser that silently starts
 * dropping edges.
 */

export interface GraphNode {
  id: string
  label: string
  /** 0-based source line, when the node came from a document. Lets a map act as
   *  a navigator — click a node, jump the editor there. */
  line?: number
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type GraphDialect = 'mermaid' | 'outline'

/**
 * Which dialect a blob of text is written in.
 *
 * An explicit `flowchart`/`graph` header or any arrow wins; everything else is
 * treated as an outline, because an outline has no required syntax at all and
 * so cannot be positively identified — only defaulted to.
 */
export function detectDialect(text: string): GraphDialect {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.some(l => /^(flowchart|graph)\b/i.test(l))) return 'mermaid'
  if (lines.some(l => /(-->|---|-\.->|==>)/.test(l))) return 'mermaid'
  return 'outline'
}

/** Node ids are used as CSS-ish selectors by the renderer, so keep them tame. */
function safeId(raw: string, fallback: number): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || `n${fallback}`
}

/**
 * Parse the subset of mermaid flowchart syntax people actually write:
 *
 *   A --> B
 *   A[Label] --> B(Other)
 *   A -->|edge label| B
 *   A -.-> B, A ==> B, A --- B
 *
 * Anything it does not understand is skipped rather than thrown on: a diagram
 * with one unsupported line should still draw the other twenty.
 */
export function parseMermaid(text: string): Graph {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  let counter = 0

  // `A`, `A[Label]`, `A(Label)`, `A{Label}`, `A((Label))` → id + optional label.
  const nodeRe = /^([A-Za-z0-9_-]+)\s*(?:\[\[?([^\]]*)\]?\]|\(\(?([^)]*)\)?\)|\{([^}]*)\})?$/

  const touch = (raw: string): string | null => {
    const match = nodeRe.exec(raw.trim())
    if (!match) return null
    const id = safeId(match[1], counter++)
    const label = (match[2] ?? match[3] ?? match[4] ?? '').trim() || match[1]
    // First label wins: a node is usually declared with its text once and then
    // referenced bare, and letting the bare reference overwrite it would blank
    // the label depending on line order.
    if (!nodes.has(id)) nodes.set(id, { id, label })
    else if (match[2] ?? match[3] ?? match[4]) nodes.set(id, { id, label })
    return id
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('%%')) continue
    if (/^(flowchart|graph|subgraph|end|classDef|class|style|direction)\b/i.test(line)) continue

    // Split on any arrow, capturing an optional |label| between the arrow and
    // the target.
    const arrow = /\s*(?:-->|---|-\.->|-\.-|==>|===)\s*(?:\|([^|]*)\|)?\s*/
    const parts = line.split(arrow)
    if (parts.length < 3) {
      // A bare node declaration on its own line still creates the node.
      touch(line)
      continue
    }

    // split() with one capture group yields [a, label, b, label, c, …].
    for (let i = 0; i + 2 < parts.length; i += 2) {
      const source = touch(parts[i])
      const target = touch(parts[i + 2])
      const label = parts[i + 1]?.trim()
      if (!source || !target) continue
      edges.push({ id: `e${edges.length}`, source, target, ...(label ? { label } : {}) })
    }
  }

  return { nodes: [...nodes.values()], edges }
}

/**
 * Parse an indented outline into a tree.
 *
 * Indentation is measured in columns with a tab counting as one level, and each
 * line is joined to the nearest shallower line above it. List markers (`-`, `*`,
 * `+`, `1.`) are stripped so a markdown list pastes in unmodified — which is the
 * point, since that is the form these usually already exist in.
 */
export function parseOutline(text: string): Graph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  /** Stack of [indent, nodeId] for the ancestors of the current line. */
  const stack: Array<{ indent: number; id: string }> = []

  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim()) continue
    const expanded = rawLine.replace(/\t/g, '  ')
    const indent = expanded.length - expanded.trimStart().length
    const label = expanded.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '').trim()
    if (!label) continue

    const id = safeId(`${label}_${nodes.length}`, nodes.length)
    nodes.push({ id, label })

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) edges.push({ id: `e${edges.length}`, source: parent.id, target: id })
    stack.push({ indent, id })
  }

  return { nodes, edges }
}

/**
 * Blank out fenced code blocks, keeping the line count intact.
 *
 * A markdown document's code blocks are full of `#` comments and `-` flags, and
 * without this every shell snippet turns into a branch of the map. Lines are
 * replaced rather than removed so the `line` numbers still point at the right
 * place in the original text.
 */
function blankFencedCode(lines: string[]): string[] {
  let fence: string | null = null
  return lines.map(line => {
    const match = /^\s*(```+|~~~+)/.exec(line)
    if (match) {
      const marker = match[1][0]
      if (fence === null) { fence = marker; return '' }
      if (fence === marker) { fence = null; return '' }
    }
    return fence === null ? line : ''
  })
}

/**
 * A markdown document's heading tree: `#` → `##` → `###` becomes parent → child.
 *
 * This is the shape of the argument rather than its content, which is the thing
 * a long-form editor otherwise gives you no view of. Each node carries its
 * source line so the map can scroll the editor to it.
 *
 * A heading that skips a level (an `###` directly under an `#`) attaches to the
 * nearest shallower heading rather than being dropped — real documents skip
 * levels, and a map that silently loses those sections is worse than one that
 * shows a slightly flatter tree than the author intended.
 */
export function parseHeadings(markdown: string): Graph {
  const lines = blankFencedCode(markdown.split('\n'))
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const stack: Array<{ level: number; id: string }> = []

  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) return
    const level = match[1].length
    const label = match[2].trim()
    if (!label) return

    const id = safeId(`h${index}_${label}`, index)
    nodes.push({ id, label, line: index })

    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) edges.push({ id: `e${edges.length}`, source: parent.id, target: id })
    stack.push({ level, id })
  })

  return { nodes, edges }
}

/** The list structure of a markdown document — outline parsing, with code
 *  blocks blanked first so a snippet's flags do not become branches. */
export function parseMarkdownOutline(markdown: string): Graph {
  const lines = blankFencedCode(markdown.split('\n'))
  const kept: string[] = []
  const lineNumbers: number[] = []
  lines.forEach((line, index) => {
    if (/^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line)) {
      kept.push(line)
      lineNumbers.push(index)
    }
  })
  const graph = parseOutline(kept.join('\n'))
  graph.nodes.forEach((node, i) => { node.line = lineNumbers[i] })
  return graph
}

export function parseGraphText(text: string, dialect?: GraphDialect): Graph {
  const chosen = dialect ?? detectDialect(text)
  return chosen === 'mermaid' ? parseMermaid(text) : parseOutline(text)
}

/** Mermaid needs labels with syntax characters quoted, or the diagram breaks. */
function mermaidLabel(label: string): string {
  return /["[\]{}()|>]/.test(label) ? `["${label.replace(/"/g, "'")}"]` : `[${label}]`
}

/** Serialise back to mermaid, so a graph built by hand can leave the tool. */
export function toMermaid(graph: Graph): string {
  const lines = ['flowchart TD']
  const linked = new Set<string>()
  for (const edge of graph.edges) {
    linked.add(edge.source)
    linked.add(edge.target)
  }
  for (const node of graph.nodes) {
    // Unconnected nodes would vanish from a pure edge list, so declare them.
    if (!linked.has(node.id)) lines.push(`  ${node.id}${mermaidLabel(node.label)}`)
  }
  const labelOf = (id: string) => {
    const node = graph.nodes.find(n => n.id === id)
    return node ? `${id}${mermaidLabel(node.label)}` : id
  }
  const declared = new Set<string>()
  for (const edge of graph.edges) {
    const source = declared.has(edge.source) ? edge.source : (declared.add(edge.source), labelOf(edge.source))
    const target = declared.has(edge.target) ? edge.target : (declared.add(edge.target), labelOf(edge.target))
    const mid = edge.label ? `-->|${edge.label.replace(/\|/g, '/')}|` : '-->'
    lines.push(`  ${source} ${mid} ${target}`)
  }
  return lines.join('\n')
}

/**
 * Graph ⇄ URL fragment, so a board can be sent to someone.
 *
 * The fragment and not the query string: a fragment is never sent to the server
 * and never lands in an access log, and the whole tool is otherwise local-only.
 * Encoded through UTF-8 bytes before base64 because a label can be any script,
 * and raw btoa throws on anything above U+00FF.
 */
export function encodeGraph(graph: Graph): string {
  const json = JSON.stringify({ n: graph.nodes, e: graph.edges })
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeGraph(encoded: string): Graph | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(parsed?.n) || !Array.isArray(parsed?.e)) return null
    // Re-validate rather than trust: this came out of a URL someone else wrote.
    const nodes: GraphNode[] = parsed.n
      .filter((n: any) => n && typeof n.id === 'string' && typeof n.label === 'string')
      .map((n: any) => ({ id: n.id, label: n.label }))
    const ids = new Set(nodes.map(n => n.id))
    const edges: GraphEdge[] = parsed.e
      .filter((e: any) => e && typeof e.id === 'string' && ids.has(e.source) && ids.has(e.target))
      .map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        ...(typeof e.label === 'string' ? { label: e.label } : {}),
      }))
    return { nodes, edges }
  } catch {
    return null
  }
}

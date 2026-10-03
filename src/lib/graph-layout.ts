/**
 * Layout for node-and-edge diagrams that Cytoscape's built-ins draw badly.
 * Flowmap's "Flow" arrangement reads it.
 */

/**
 * A tidy tree: every parent centred over its own children, ranks evenly
 * spaced, in either direction. Cytoscape's breadthfirst spreads each rank
 * across the whole width, so a grandchild lands under the middle of the
 * diagram rather than under its parent, which is not how anyone draws a flow.
 *
 * A node with two parents is placed under the first one found (the other edge
 * still draws), and a cycle is entered at the first node in source order.
 * Pure (sizes come in through `size`), so the smoke test runs it.
 */
export function tidyTree(
  ids: string[],
  edges: { source: string; target: string }[],
  size: (id: string) => { w: number; h: number },
  direction: 'TB' | 'LR',
  gap = { sibling: 36, rank: 80 },
): Record<string, { x: number; y: number }> {
  const out = new Map<string, string[]>()
  const indegree = new Map<string, number>(ids.map(id => [id, 0]))
  for (const e of edges) {
    if (!indegree.has(e.source) || !indegree.has(e.target) || e.source === e.target) continue
    out.set(e.source, [...(out.get(e.source) ?? []), e.target])
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
  }
  // Spanning forest, breadth first, so a node sits at its shallowest depth.
  const children = new Map<string, string[]>()
  const depth = new Map<string, number>()
  const roots: string[] = []
  const grow = (root: string) => {
    roots.push(root)
    depth.set(root, 0)
    const queue = [root]
    while (queue.length) {
      const at = queue.shift()!
      for (const next of out.get(at) ?? []) {
        if (depth.has(next)) continue
        depth.set(next, depth.get(at)! + 1)
        children.set(at, [...(children.get(at) ?? []), next])
        queue.push(next)
      }
    }
  }
  for (const id of ids) if (indegree.get(id) === 0 && !depth.has(id)) grow(id)
  for (const id of ids) if (!depth.has(id)) grow(id)

  // Breadth runs across a rank (x when top-down), extent along the flow.
  const breadth = (id: string) => (direction === 'TB' ? size(id).w : size(id).h)
  const extent = (id: string) => (direction === 'TB' ? size(id).h : size(id).w)
  const rankExtent: number[] = []
  for (const id of ids) {
    const d = depth.get(id)!
    rankExtent[d] = Math.max(rankExtent[d] ?? 0, extent(id))
  }
  const rankAt: number[] = []
  let along = 0
  for (let d = 0; d < rankExtent.length; d++) {
    rankAt[d] = along + rankExtent[d] / 2
    along += rankExtent[d] + gap.rank
  }

  const span = new Map<string, number>()
  const measure = (id: string): number => {
    const kids = children.get(id) ?? []
    const own = breadth(id)
    const total = kids.reduce((sum, k) => sum + measure(k), 0) + gap.sibling * Math.max(0, kids.length - 1)
    const width = Math.max(own, total)
    span.set(id, width)
    return width
  }
  const across = new Map<string, number>()
  const place = (id: string, start: number) => {
    const width = span.get(id)!
    across.set(id, start + width / 2)
    const kids = children.get(id) ?? []
    const total = kids.reduce((sum, k) => sum + span.get(k)!, 0) + gap.sibling * Math.max(0, kids.length - 1)
    let cursor = start + (width - total) / 2
    for (const k of kids) {
      place(k, cursor)
      cursor += span.get(k)! + gap.sibling
    }
    // Over the middle of its first and last child, which is where the eye
    // expects it when the children differ in size; kept inside its own span so
    // it cannot reach a neighbour's.
    if (kids.length) {
      const own = breadth(id)
      const mid = (across.get(kids[0])! + across.get(kids[kids.length - 1])!) / 2
      across.set(id, Math.min(Math.max(mid, start + own / 2), start + width - own / 2))
    }
  }
  let cursor = 0
  for (const root of roots) {
    const width = measure(root)
    place(root, cursor)
    cursor += width + gap.sibling * 2
  }

  const positions: Record<string, { x: number; y: number }> = {}
  for (const id of ids) {
    const a = across.get(id)!
    const b = rankAt[depth.get(id)!]
    positions[id] = direction === 'TB' ? { x: a, y: b } : { x: b, y: a }
  }
  return positions
}

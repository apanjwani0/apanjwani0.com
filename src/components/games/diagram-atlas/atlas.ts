/**
 * Diagram Atlas — one system, drawn seven ways.
 *
 * The figure for `/learnings/how-to-think-on-paper`. The article's claim is
 * Larkin & Simon's: a diagram and a paragraph can carry identical information
 * and still cost different amounts to USE, because a picture is cheap only for
 * the question its layout already groups for. That claim is unprovable in prose
 * — the reader has to watch one unchanged scenario become seven pictures and
 * find that each one has gone blind to what the last one showed.
 *
 * The scenario never changes: an order is placed, stock is reserved, the card is
 * charged, a receipt goes out, and the charge can fail. Every view below draws
 * those same facts.
 *
 * Why the view data lives HERE and not in the component, per AGENTS.md ("a
 * tool's claims live in a module, not in the component"): each view asserts
 * something checkable about a notation — what a node is, what the arrow means,
 * and which question the picture cannot answer. Those are the article's teaching
 * payload, and a claim buried in a DOM handler cannot be tested. `security:smoke`
 * imports this module and holds every view to a legend, and holds the article's
 * number word ("seven") to ATLAS_VIEWS.length, so an eighth notation cannot ship
 * while the prose still says seven. Same family as the SERVER_TOOLS badge and
 * the Maze Weaver article's recomputed maze counts.
 *
 * Geometry note: every number here is a viewBox user unit, not a pixel and not a
 * typographic size — the SVG scales as one object, so a design token would be
 * the wrong unit for a coordinate. Colours and strokes come from tokens, in
 * diagram-atlas.css.
 */

/** One beat of a view's animation. */
export interface AtlasStep {
  /** Element ids that light up on this beat. */
  on: string[]
  /** What is happening, in the reader's words. Shown under the figure. */
  say: string
  /** Where the control token sits, in user units. Omitted for views with no token. */
  token?: [number, number]
  /** A second token — the whole point of the fork in the activity view. */
  token2?: [number, number]
}

export interface AtlasView {
  /** Stable id: the value of the control's `data-view`. */
  id: string
  /** The question in plain words. This is the button label, deliberately not the notation's name. */
  question: string
  /** What the notation is called. */
  notation: string
  /** What a node means in this family. */
  node: string
  /** What an arrow means here — said as a verb, which is the article's portable test. */
  arrow: string
  /** The question this picture CANNOT answer. The teaching payload. */
  blind: string
  /** SVG body, no wrapper. Ids referenced by `steps`. */
  svg: string
  /**
   * Animation beats. Deliberately EMPTY for the two structural families: a class
   * diagram and an ER diagram have no time axis, so a moving token would be a
   * lie about the notation. The component says so instead of animating.
   */
  steps: AtlasStep[]
}

/* ── SVG helpers. Terse on purpose: seven hand-written diagrams is the
      alternative, and it is four hundred lines longer. ── */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Centred label, one line per entry. */
function label(cx: number, cy: number, lines: string[], kind = 'label'): string {
  const dy = (lines.length - 1) * 8
  const spans = lines
    .map((l, i) => `<tspan x="${cx}" y="${cy - dy + i * 16}">${esc(l)}</tspan>`)
    .join('')
  return `<text data-text="${kind}" text-anchor="middle">${spans}</text>`
}

interface BoxOpts {
  id?: string
  x: number
  y: number
  w: number
  h: number
  text: string | string[]
  /** Styling hook: step | terminal | state | type | table | process | actor | lane. */
  kind?: string
  r?: number
}

function box(o: BoxOpts): string {
  const lines = Array.isArray(o.text) ? o.text : [o.text]
  const id = o.id ? ` id="${o.id}"` : ''
  const r = o.r ?? 6
  return (
    `<g${id} data-node="${o.kind ?? 'step'}">` +
    `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${r}"/>` +
    label(o.x + o.w / 2, o.y + o.h / 2, lines) +
    `</g>`
  )
}

function diamond(o: { id?: string; cx: number; cy: number; rx: number; ry: number; text: string }): string {
  const id = o.id ? ` id="${o.id}"` : ''
  const pts = `${o.cx},${o.cy - o.ry} ${o.cx + o.rx},${o.cy} ${o.cx},${o.cy + o.ry} ${o.cx - o.rx},${o.cy}`
  return (
    `<g${id} data-node="decision">` +
    `<polygon points="${pts}"/>` +
    label(o.cx, o.cy, [o.text]) +
    `</g>`
  )
}

interface EdgeOpts {
  id?: string
  d: string
  /** The arrow's verb, drawn on the line. */
  text?: string
  /** Where the label sits. */
  tx?: number
  ty?: number
  /** A reply, a dependency, a "not a call" — drawn dashed. */
  dashed?: boolean
  /** No arrowhead: an association line in a structural diagram is not directed. */
  plain?: boolean
}

function edge(o: EdgeOpts): string {
  const id = o.id ? ` id="${o.id}"` : ''
  const attrs = [
    o.dashed ? ' data-dash="1"' : '',
    o.plain ? ' data-plain="1"' : '',
  ].join('')
  const lab =
    o.text !== undefined && o.tx !== undefined && o.ty !== undefined
      ? label(o.tx, o.ty, [o.text], 'edge-label')
      : ''
  return `<g${id} data-edge="1"${attrs}><path d="${o.d}"/>${lab}</g>`
}

/** A fork or join bar. An activity diagram's whole claim to concurrency. */
function bar(id: string, x: number, y1: number, y2: number): string {
  return `<g id="${id}" data-node="bar"><rect x="${x}" y="${y1}" width="7" height="${y2 - y1}" rx="3"/></g>`
}

/* ══ 1. Flowchart ══ */

const FLOW = [
  box({ id: 'f1', x: 60, y: 14, w: 160, h: 34, text: 'Order placed', kind: 'terminal', r: 17 }),
  box({ id: 'f2', x: 60, y: 70, w: 160, h: 34, text: 'Validate cart' }),
  box({ id: 'f3', x: 60, y: 126, w: 160, h: 34, text: 'Reserve stock' }),
  box({ id: 'f4', x: 60, y: 182, w: 160, h: 34, text: 'Charge card' }),
  diamond({ id: 'f5', cx: 140, cy: 262, rx: 76, ry: 36, text: 'Paid?' }),
  box({ id: 'f6', x: 60, y: 316, w: 160, h: 34, text: 'Send receipt' }),
  box({ id: 'f7', x: 400, y: 245, w: 170, h: 34, text: 'Release stock' }),
  box({ id: 'f8', x: 400, y: 316, w: 170, h: 34, text: 'Order failed', kind: 'terminal', r: 17 }),
  edge({ id: 'fe1', d: 'M140 48 V70' }),
  edge({ id: 'fe2', d: 'M140 104 V126' }),
  edge({ id: 'fe3', d: 'M140 160 V182' }),
  edge({ id: 'fe4', d: 'M140 216 V226' }),
  edge({ id: 'fe5', d: 'M140 298 V316', text: 'yes', tx: 166, ty: 309 }),
  edge({ id: 'fe6', d: 'M216 262 H400 V245', text: 'no', tx: 300, ty: 251 }),
  edge({ id: 'fe7', d: 'M485 279 V316' }),
].join('')

/* ══ 2. Activity, with swimlanes ══ */

const LANES = [
  { name: 'Shop', y: 16 },
  { name: 'Payments', y: 132 },
  { name: 'Warehouse', y: 248 },
]

const ACT = [
  ...LANES.map(
    l =>
      `<g data-node="lane"><rect x="16" y="${l.y}" width="648" height="104" rx="4"/></g>` +
      `<text data-text="lane" x="26" y="${l.y + 18}">${esc(l.name)}</text>`,
  ),
  box({ id: 'a1', x: 110, y: 46, w: 130, h: 40, text: 'Order placed', kind: 'terminal', r: 20 }),
  bar('afork', 286, 40, 340),
  box({ id: 'a2', x: 330, y: 162, w: 140, h: 40, text: 'Charge card' }),
  box({ id: 'a3', x: 330, y: 278, w: 140, h: 40, text: 'Reserve stock' }),
  bar('ajoin', 516, 40, 340),
  box({ id: 'a4', x: 556, y: 46, w: 100, h: 40, text: 'Receipt', kind: 'terminal', r: 20 }),
  edge({ id: 'ae1', d: 'M240 66 H286' }),
  edge({ id: 'ae2', d: 'M293 182 H330' }),
  edge({ id: 'ae3', d: 'M293 298 H330' }),
  edge({ id: 'ae4', d: 'M470 182 H516' }),
  edge({ id: 'ae5', d: 'M470 298 H516' }),
  edge({ id: 'ae6', d: 'M523 66 H556' }),
].join('')

/* ══ 3. Sequence ══ */

const LIFELINES = [
  { id: 'sc', name: 'Customer', x: 74 },
  { id: 'ss', name: 'Shop', x: 250 },
  { id: 'sp', name: 'Payments', x: 436 },
  { id: 'sw', name: 'Warehouse', x: 604 },
]

const SEQ = [
  `<text data-text="axis" x="16" y="70">time</text>`,
  edge({ d: 'M22 84 V318', dashed: true }),
  ...LIFELINES.map(
    l =>
      box({ x: l.x - 62, y: 14, w: 124, h: 32, text: l.name, kind: 'actor' }) +
      `<g data-node="lifeline"><path d="M${l.x} 46 V330"/></g>`,
  ),
  edge({ id: 'q1', d: 'M74 84 H250', text: 'place order', tx: 162, ty: 74 }),
  edge({ id: 'q2', d: 'M250 126 H604', text: 'reserve stock', tx: 427, ty: 116 }),
  edge({ id: 'q3', d: 'M604 168 H250', text: 'reserved', tx: 427, ty: 158, dashed: true }),
  edge({ id: 'q4', d: 'M250 210 H436', text: 'charge card', tx: 343, ty: 200 }),
  edge({ id: 'q5', d: 'M436 252 H250', text: 'authorised', tx: 343, ty: 242, dashed: true }),
  edge({ id: 'q6', d: 'M250 294 H74', text: 'receipt', tx: 162, ty: 284, dashed: true }),
].join('')

/* ══ 4. State machine ══ */

const ST = [
  `<g id="t0" data-node="initial"><circle cx="34" cy="62" r="9"/></g>`,
  box({ id: 't1', x: 66, y: 40, w: 116, h: 44, text: 'draft', kind: 'state', r: 22 }),
  box({ id: 't2', x: 240, y: 40, w: 116, h: 44, text: 'pending', kind: 'state', r: 22 }),
  box({ id: 't3', x: 414, y: 40, w: 116, h: 44, text: 'paid', kind: 'state', r: 22 }),
  box({ id: 't4', x: 552, y: 190, w: 116, h: 44, text: 'shipped', kind: 'state', r: 22 }),
  box({ id: 't5', x: 240, y: 260, w: 116, h: 44, text: 'failed', kind: 'state', r: 22 }),
  box({ id: 't6', x: 414, y: 190, w: 116, h: 44, text: 'refunded', kind: 'state', r: 22 }),
  edge({ id: 'te0', d: 'M43 62 H66' }),
  edge({ id: 'te1', d: 'M182 62 H240', text: 'submit', tx: 211, ty: 50 }),
  edge({ id: 'te2', d: 'M356 62 H414', text: 'authorised', tx: 385, ty: 50 }),
  edge({ id: 'te3', d: 'M530 62 H610 V190', text: 'dispatch', tx: 578, ty: 52 }),
  edge({ id: 'te4', d: 'M283 84 V260', text: 'declined', tx: 246, ty: 176 }),
  edge({ id: 'te5', d: 'M313 260 V84', text: 'retry', tx: 344, ty: 176 }),
  edge({ id: 'te6', d: 'M472 84 V190', text: 'refund', tx: 505, ty: 140 }),
].join('')

/* ══ 5. Class ══ */

/** A type box: a name bar over its fields. Nothing about it moves. */
function typeBox(id: string, x: number, y: number, w: number, name: string, fields: string[]): string {
  const h = 34 + fields.length * 19 + 8
  const rows = fields
    .map((f, i) => `<text data-text="field" x="${x + 12}" y="${y + 52 + i * 19}">${esc(f)}</text>`)
    .join('')
  return (
    `<g id="${id}" data-node="type">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>` +
    `<path data-node="divider" d="M${x} ${y + 30} H${x + w}"/>` +
    `<text data-text="typename" text-anchor="middle" x="${x + w / 2}" y="${y + 20}">${esc(name)}</text>` +
    rows +
    `</g>`
  )
}

const CLS = [
  typeBox('c1', 60, 30, 190, 'Order', ['id: OrderId', 'placedAt: Instant', 'total: Money']),
  typeBox('c2', 60, 232, 190, 'LineItem', ['sku: Sku', 'qty: int']),
  typeBox('c3', 430, 30, 200, 'Payment', ['provider: string', 'amount: Money', 'status: Status']),
  typeBox('c4', 430, 232, 200, 'Customer', ['email: Email']),
  edge({ d: 'M155 145 V232', plain: true, text: '1..*', tx: 183, ty: 192 }),
  `<g data-node="aggregate"><polygon points="155,137 163,147 155,157 147,147"/></g>`,
  edge({ d: 'M250 85 H430', plain: true, text: '0..1', tx: 340, ty: 75 }),
  edge({ d: 'M530 232 V145', plain: true, text: 'places 1..*', tx: 578, ty: 192 }),
].join('')

/* ══ 6. Deployment ══ */

/** A dashed machine boundary with the thing that runs inside it. */
function machine(id: string, x: number, y: number, w: number, h: number, name: string, inner: string[]): string {
  const body = inner
    .map((t, i) => box({ x: x + 14, y: y + 40 + i * 52, w: w - 28, h: 40, text: t, kind: 'process' }))
    .join('')
  return (
    `<g id="${id}" data-node="machine">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>` +
    `<text data-text="machine" x="${x + 14}" y="${y + 24}">${esc(name)}</text>` +
    body +
    `</g>`
  )
}

const DEP = [
  machine('d1', 20, 96, 150, 100, 'device', ['browser']),
  machine('d2', 200, 96, 150, 100, 'Cloudflare', ['edge cache']),
  machine('d3', 380, 40, 170, 212, 'OCI VM · Docker', ['node server', 'postgres']),
  machine('d4', 580, 96, 90, 100, 'provider', ['payments']),
  edge({ id: 'de1', d: 'M170 146 H200', text: 'https', tx: 185, ty: 132 }),
  edge({ id: 'de2', d: 'M350 146 H394', text: 'https', tx: 372, ty: 132 }),
  edge({ id: 'de3', d: 'M465 176 V192', text: '5432', tx: 497, ty: 188 }),
  edge({ id: 'de4', d: 'M550 156 H580', text: 'https', tx: 565, ty: 142 }),
].join('')

/* ══ 7. Entity-relationship ══ */

/** Crow's foot at the many end, a bar at the one end. Cardinality is the whole content. */
function table(id: string, x: number, y: number, w: number, name: string, cols: string[]): string {
  const h = 32 + cols.length * 19 + 8
  const rows = cols
    .map((c, i) => `<text data-text="field" x="${x + 12}" y="${y + 50 + i * 19}">${esc(c)}</text>`)
    .join('')
  return (
    `<g id="${id}" data-node="table">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>` +
    `<path data-node="divider" d="M${x} ${y + 28} H${x + w}"/>` +
    `<text data-text="typename" x="${x + 12}" y="${y + 19}">${esc(name)}</text>` +
    rows +
    `</g>`
  )
}

const ER = [
  table('r1', 30, 34, 170, 'customer', ['id  PK', 'email']),
  table('r2', 262, 34, 170, 'order', ['id  PK', 'customer_id  FK', 'status']),
  table('r3', 262, 224, 170, 'line_item', ['order_id  FK', 'sku', 'qty']),
  table('r4', 494, 34, 176, 'payment', ['order_id  FK', 'amount']),
  edge({ d: 'M200 80 H262', plain: true, text: '1 · N', tx: 231, ty: 68 }),
  edge({ d: 'M347 129 V224', plain: true, text: '1 · N', tx: 375, ty: 180 }),
  edge({ d: 'M432 80 H494', plain: true, text: '1 · 1', tx: 463, ty: 68 }),
].join('')

/**
 * The seven views, in the order the article's table lists them.
 *
 * The article says "seven"; `security:smoke` reads that number word out of the
 * prose and compares it to this array's length, so the two cannot drift.
 */
export const ATLAS_VIEWS: readonly AtlasView[] = [
  {
    id: 'flow',
    question: 'In what order do the steps go?',
    notation: 'Flowchart',
    node: 'a step, or a decision when it is a diamond',
    arrow: '…then',
    blind: 'Who does any of this, and what could be happening at the same time. One thread of control is all a flowchart can hold.',
    svg: FLOW,
    steps: [
      { on: ['f1'], say: 'Control starts in one place.', token: [42, 31] },
      { on: ['fe1', 'f2'], say: 'The arrow means "then". Nothing else.', token: [42, 87] },
      { on: ['fe2', 'f3'], say: 'Reserve the stock.', token: [42, 143] },
      { on: ['fe3', 'f4'], say: 'Charge the card.', token: [42, 199] },
      { on: ['fe4', 'f5'], say: 'A diamond is the only branch this notation has.', token: [42, 262] },
      { on: ['fe6', 'f7'], say: 'Declined — take the other exit and undo the reservation.', token: [382, 262] },
      { on: ['fe7', 'f8'], say: 'One walk, one outcome. Run it again for the other.', token: [382, 333] },
    ],
  },
  {
    id: 'activity',
    question: 'What happens at once, and who does it?',
    notation: 'Activity diagram, with swimlanes',
    node: 'a step, placed in the lane of whoever performs it',
    arrow: '…then, but a bar may split it',
    blind: 'The exact order of messages between the actors. Two things being parallel is precisely the claim that their order is not fixed.',
    svg: ACT,
    steps: [
      { on: ['a1'], say: 'The lane says who: the shop takes the order.', token: [96, 66] },
      { on: ['ae1', 'afork'], say: 'A fork bar. This is what a flowchart cannot draw.', token: [289, 66] },
      {
        on: ['ae2', 'ae3', 'a2', 'a3'],
        say: 'Two tokens now. Charging and reserving happen together.',
        token: [316, 182],
        token2: [316, 298],
      },
      {
        on: ['ae4', 'ae5', 'ajoin'],
        say: 'The join waits for both. Neither one goes first.',
        token: [519, 182],
        token2: [519, 298],
      },
      { on: ['ae6', 'a4'], say: 'Back to one token, back in the shop lane.', token: [542, 66] },
    ],
  },
  {
    id: 'sequence',
    question: 'Who calls whom, and when?',
    notation: 'Sequence diagram',
    node: 'a participant, with a lifeline hanging below it',
    arrow: '…sends a message to',
    blind: 'Every path but this one. A sequence diagram draws one run, so the decline is a second drawing, not a branch.',
    svg: SEQ,
    steps: [
      { on: ['q1'], say: 'Left to right means nothing here. Downward is time.' },
      { on: ['q2'], say: 'The shop asks the warehouse to hold the goods.' },
      { on: ['q3'], say: 'A dashed arrow is a reply, not a new call.' },
      { on: ['q4'], say: 'Now the provider is asked for the money.' },
      { on: ['q5'], say: 'Authorised.' },
      { on: ['q6'], say: 'Six arrows, in an order you can read off the page.' },
    ],
  },
  {
    id: 'state',
    question: 'What can this order be, right now?',
    notation: 'State machine',
    node: 'a state the order rests in until something arrives',
    arrow: '…on this event, becomes',
    blind: 'Who performs the work, and how long any of it takes. A state machine knows every mode and no duration.',
    svg: ST,
    steps: [
      { on: ['t0', 'te0', 't1'], say: 'Every state machine starts at a filled dot.' },
      { on: ['te1', 't2'], say: 'The label on the arrow is the event, not the step.' },
      { on: ['te4', 't5'], say: 'Declined. The failure is a state, not a path.' },
      { on: ['te5', 't2'], say: 'Retry walks the same arrow backwards. The flowchart had nowhere to put this.' },
      { on: ['te2', 't3'], say: 'Authorised on the second attempt.' },
      { on: ['te6', 't6'], say: 'Refunds reach here too — from paid, never from failed.' },
      { on: ['te3', 't4'], say: 'Six states. The other six diagrams show one of them.' },
    ],
  },
  {
    id: 'class',
    question: 'What is the code made of?',
    notation: 'Class diagram',
    node: 'a type, with its fields',
    arrow: '…owns, or refers to, always',
    blind: 'When anything happens. There is no time axis on the page, which is why reading one top-to-bottom as a sequence of events is the standard mistake with UML.',
    svg: CLS,
    steps: [],
  },
  {
    id: 'deploy',
    question: 'What runs where?',
    notation: 'Deployment diagram',
    node: 'a process, inside the machine that hosts it',
    arrow: '…talks to, over this protocol',
    blind: 'What is inside any of those boxes. Four processes here are the whole of the class diagram and the whole of the schema.',
    svg: DEP,
    steps: [
      { on: ['d1'], say: 'A dashed boundary is a machine, not a step.' },
      { on: ['de1', 'd2'], say: 'The arrow is a network hop. Say it as "talks to".' },
      { on: ['de2', 'd3'], say: 'Into the container on the VM.' },
      { on: ['de3'], say: 'Postgres is on the same machine — the arrow never crosses the boundary.' },
      { on: ['de4', 'd4'], say: 'And out to the provider, which is somebody else’s box entirely.' },
    ],
  },
  {
    id: 'er',
    question: 'How is the data shaped?',
    notation: 'Entity-relationship diagram',
    node: 'a kind of record',
    arrow: '…has how many of',
    blind: 'Anything that happens. A schema is true at every instant, so it can describe an order it cannot place.',
    svg: ER,
    steps: [],
  },
]

/** The view for an id, or the first one. The control cannot select anything else. */
export function atlasView(id: string | null): AtlasView {
  return ATLAS_VIEWS.find(v => v.id === id) ?? ATLAS_VIEWS[0]
}

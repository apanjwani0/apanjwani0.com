/**
 * Internet Atlas — how a web page reaches you, one stop at a time.
 *
 * The figure for `/learnings/how-the-internet-works` (brief:
 * docs/plans/internet-article.md). Each view is one stop on the trip a page
 * makes, from being cut into packets to being drawn on the screen, and its
 * legend says in plain words what the stop is, what it does on this trip, and
 * what happens when it goes wrong.
 *
 * The claims live HERE and not in the component, per AGENTS.md, so
 * `security:smoke` can hold every view to a full legend, every beat to an
 * element that exists, and every token to the viewBox.
 *
 * Geometry is in viewBox user units (680 × 364), like the Diagram Atlas, whose
 * figure vocabulary (`at-*`, `data-node`, `data-edge`) this one shares; the
 * styles are in diagram-atlas.css, plus the few additions in
 * internet-atlas.css. Example addresses come from the ranges reserved for
 * documentation (192.168.x.x at home, 203.0.113.x in public), so no figure
 * shows a real one.
 */

export interface InternetStep {
  /** Element ids that light up on this beat. */
  on: string[]
  /** What is happening, in the reader's words. Shown under the figure. */
  say: string
  /** Where the token sits, in user units, when this beat has one. */
  token?: [number, number]
}

export interface InternetView {
  /** Stable id: the value of `{{embed:id}}` in the article. */
  id: string
  /** The button label in the full figure: a question, in plain words. */
  question: string
  /** The stop's name. */
  title: string
  /** What it is. */
  what: string
  /** What it does on this trip. */
  does: string
  /** What happens when it goes wrong: the teaching payload. */
  breaks: string
  /** SVG body, no wrapper. Ids referenced by `steps`. */
  svg: string
  /** Every view shows movement, so every view has beats. */
  steps: InternetStep[]
}

/* ── SVG helpers, the Diagram Atlas's vocabulary. ponytail: a second copy of
      its four helpers; move both to one module if a third figure needs them. ── */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Centred label, one line per entry. */
function label(cx: number, cy: number, lines: string[], kind = 'label'): string {
  const dy = (lines.length - 1) * 8
  const spans = lines.map((l, i) => `<tspan x="${cx}" y="${cy - dy + i * 16}">${esc(l)}</tspan>`).join('')
  return `<text data-text="${kind}" text-anchor="middle">${spans}</text>`
}

interface BoxOpts { id?: string; x: number; y: number; w: number; h: number; text: string | string[]; kind?: string; r?: number }

function box(o: BoxOpts): string {
  const lines = Array.isArray(o.text) ? o.text : [o.text]
  const id = o.id ? ` id="${o.id}"` : ''
  return (
    `<g${id} data-node="${o.kind ?? 'step'}">` +
    `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${o.r ?? 6}"/>` +
    label(o.x + o.w / 2, o.y + o.h / 2, lines) +
    `</g>`
  )
}

interface EdgeOpts { id?: string; d: string; text?: string; tx?: number; ty?: number; dashed?: boolean; plain?: boolean }

function edge(o: EdgeOpts): string {
  const id = o.id ? ` id="${o.id}"` : ''
  const attrs = (o.dashed ? ' data-dash="1"' : '') + (o.plain ? ' data-plain="1"' : '')
  const lab = o.text !== undefined && o.tx !== undefined && o.ty !== undefined ? label(o.tx, o.ty, [o.text], 'edge-label') : ''
  return `<g${id} data-edge="1"${attrs}><path d="${o.d}"/>${lab}</g>`
}

/** A participant in a sequence: a named box with a dashed lifeline below it. */
function actor(id: string, x: number, lines: string[], w = 112): string {
  return box({ id, x: x - w / 2, y: 12, w, h: 40, text: lines, kind: 'actor' }) +
    `<g data-node="lifeline"><path d="M${x} 52 V352"/></g>`
}

/** A left-aligned line of monospace text that can light up on its own. */
function line(id: string, x: number, y: number, text: string): string {
  return `<g id="${id}" data-node="line"><text data-text="field" x="${x}" y="${y}">${esc(text)}</text></g>`
}

/** A labelled dot: a data centre on the map. */
function site(id: string, x: number, y: number, name: string): string {
  return `<g id="${id}" data-node="site"><circle cx="${x}" cy="${y}" r="7"/>` +
    `<text data-text="field" x="${x + 12}" y="${y + 1}">${esc(name)}</text></g>`
}

/* ══ 1. Packets ══ */

const PACKETS = [
  box({ id: 'pg', x: 24, y: 110, w: 140, h: 144, text: ['the page', 'on the server'] }),
  ...[1, 2, 3, 4, 5, 6].map(n => box({
    id: `p${n}`, x: 228 + ((n - 1) % 2) * 128, y: 56 + Math.floor((n - 1) / 2) * 92, w: 120, h: 64,
    text: [`packet ${n} of 6`, 'to: your device'],
  })),
  box({ id: 'dev', x: 540, y: 110, w: 124, h: 144, text: ['your', 'device'] }),
  edge({ id: 'pe1', d: 'M164 182 H228', text: 'cut up', tx: 196, ty: 170 }),
  edge({ id: 'pe2', d: 'M476 182 H540', text: 'sent', tx: 508, ty: 170 }),
].join('')

/* ══ 2. Addresses ══ */

const ADDRESSES = [
  `<g data-node="lane"><rect x="16" y="20" width="380" height="322" rx="6"/></g>`,
  `<text data-text="lane" x="30" y="42">your home</text>`,
  box({ id: 'hd1', x: 40, y: 64, w: 150, h: 50, text: ['laptop', '192.168.1.2'] }),
  box({ id: 'hd2', x: 40, y: 152, w: 150, h: 50, text: ['phone', '192.168.1.3'] }),
  box({ id: 'hd3', x: 40, y: 240, w: 150, h: 50, text: ['TV', '192.168.1.4'] }),
  box({ id: 'hr', x: 244, y: 152, w: 136, h: 50, text: ['router', '192.168.1.1'] }),
  box({ id: 'hi', x: 500, y: 134, w: 164, h: 86, text: ['the internet', 'sees one address:', '203.0.113.7'] }),
  edge({ id: 'he1', d: 'M190 89 L244 168' }),
  edge({ id: 'he2', d: 'M190 177 H244' }),
  edge({ id: 'he3', d: 'M190 265 L244 186' }),
  edge({ id: 'he4', d: 'M380 177 H500', text: 'public address', tx: 450, ty: 163 }),
].join('')

/* ══ 3. DNS ══ */

const DNS = [
  actor('nb', 62, ['your', 'browser']),
  actor('nr', 198, ['resolver', '(your ISP)']),
  actor('nt', 340, ['root', 'server']),
  actor('nc', 470, ['.com', 'servers']),
  actor('ns', 606, ['name', 'servers']),
  edge({ id: 'n1', d: 'M62 86 H198', text: 'where is apanjwani0.com?', tx: 130, ty: 76 }),
  edge({ id: 'n2', d: 'M198 124 H340', text: 'who looks after .com?', tx: 269, ty: 114 }),
  edge({ id: 'n3', d: 'M340 160 H198', text: 'ask these servers', tx: 269, ty: 150, dashed: true }),
  edge({ id: 'n4', d: 'M198 198 H470', text: 'who looks after apanjwani0.com?', tx: 334, ty: 188 }),
  edge({ id: 'n5', d: 'M470 234 H198', text: 'ask its own servers', tx: 334, ty: 224, dashed: true }),
  edge({ id: 'n6', d: 'M198 272 H606', text: 'what is its IP address?', tx: 402, ty: 262 }),
  edge({ id: 'n7', d: 'M606 308 H198', text: 'this number', tx: 402, ty: 298, dashed: true }),
  edge({ id: 'n8', d: 'M198 344 H62', text: 'found, and remembered', tx: 130, ty: 334, dashed: true }),
].join('')

/* ══ 4. Routes ══ */

const ROUTES = [
  box({ id: 'ri', x: 20, y: 156, w: 124, h: 48, text: 'your ISP', kind: 'machine' }),
  box({ id: 'ra', x: 268, y: 40, w: 144, h: 48, text: 'network A', kind: 'machine' }),
  box({ id: 'rb', x: 196, y: 272, w: 144, h: 48, text: 'network B', kind: 'machine' }),
  box({ id: 'rc', x: 380, y: 272, w: 144, h: 48, text: 'network C', kind: 'machine' }),
  box({ id: 'rcf', x: 536, y: 156, w: 124, h: 48, text: 'Cloudflare', kind: 'machine' }),
  edge({ id: 'r1', d: 'M144 170 L268 72', plain: true }),
  edge({ id: 'r2', d: 'M412 72 L536 170', plain: true }),
  edge({ id: 'r3', d: 'M120 204 L220 272', plain: true }),
  edge({ id: 'r4', d: 'M340 296 H380', plain: true }),
  edge({ id: 'r5', d: 'M500 272 L580 204', plain: true }),
  // The break in the top link: drawn only on the beats that light it.
  `<g id="rx" data-node="cut">${label(474, 121, ['✕ cut'])}</g>`,
].join('')

/* ══ 5. The edge ══ */

const EDGE = [
  `<text data-text="axis" x="16" y="32">one address, answered in hundreds of cities</text>`,
  site('e1', 90, 110, 'New York'),
  site('e2', 250, 80, 'London'),
  site('e3', 330, 112, 'Frankfurt'),
  site('e4', 282, 164, 'Marseille'),
  site('e5', 472, 192, 'Mumbai'),
  site('e6', 590, 244, 'Singapore'),
  box({ id: 'ey', x: 500, y: 290, w: 164, h: 44, text: 'a reader in India' }),
  box({ id: 'eo', x: 24, y: 290, w: 140, h: 44, text: 'the server' }),
  edge({ id: 'ee1', d: 'M560 290 L480 202', text: 'nearest on a map', tx: 600, ty: 262, dashed: true }),
  edge({ id: 'ee2', d: 'M520 300 C430 262, 360 212, 292 172', text: 'nearest on the network', tx: 408, ty: 256 }),
  edge({ id: 'ee3', d: 'M274 172 C230 220, 160 262, 110 290', text: 'only if needed', tx: 196, ty: 222, dashed: true }),
].join('')

/* ══ 6. Handshakes ══ */

const HANDSHAKES = [
  actor('kb', 145, ['your browser'], 150),
  actor('kc', 535, ['Cloudflare'], 150),
  `<text data-text="axis" x="16" y="100">TCP</text>`,
  edge({ id: 'k1', d: 'M145 88 H535', text: 'SYN: can we talk?', tx: 340, ty: 78 }),
  edge({ id: 'k2', d: 'M535 126 H145', text: 'SYN-ACK: yes. Can you hear me?', tx: 340, ty: 116, dashed: true }),
  edge({ id: 'k3', d: 'M145 164 H535', text: 'ACK: yes. Connected.', tx: 340, ty: 154 }),
  `<path data-node="divider" d="M16 188 H664"/>`,
  `<text data-text="axis" x="16" y="224">TLS</text>`,
  edge({ id: 'k4', d: 'M145 222 H535', text: 'hello: I can encrypt these ways', tx: 340, ty: 212 }),
  edge({ id: 'k5', d: 'M535 262 H145', text: 'hello, and my certificate', tx: 340, ty: 252, dashed: true }),
  edge({ id: 'k6', d: 'M145 302 H535', text: 'done: encrypted from here on', tx: 340, ty: 292 }),
].join('')

/* ══ 7. HTTP ══ */

/** A message: a titled card with its lines. */
function card(x: number, y: number, w: number, h: number, name: string): string {
  return `<g data-node="type"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>` +
    `<path data-node="divider" d="M${x} ${y + 30} H${x + w}"/>` +
    `<text data-text="typename" x="${x + 12}" y="${y + 20}">${esc(name)}</text></g>`
}

const HTTP = [
  card(24, 40, 280, 140, 'the request'),
  line('q1', 36, 96, 'GET / HTTP/2'),
  line('q2', 36, 124, 'host: apanjwani0.com'),
  line('q3', 36, 152, 'accept: text/html'),
  card(376, 40, 280, 290, 'the answer'),
  line('s1', 388, 96, 'HTTP/2 200 OK'),
  line('s2', 388, 124, 'content-type: text/html'),
  line('s3', 388, 152, 'cache-control: public'),
  line('s4', 388, 208, '<!doctype html>'),
  line('s5', 388, 236, '<html>'),
  line('s6', 400, 264, '<title>Aman Panjwani</title>'),
  line('s7', 400, 292, '… the rest of the page'),
  edge({ id: 'ha1', d: 'M304 92 H376', text: 'asks', tx: 340, ty: 80 }),
  edge({ id: 'ha2', d: 'M376 136 H304', text: 'answers', tx: 340, ty: 124, dashed: true }),
].join('')

/* ══ 8. Putting it back together ══ */

const ORDER = [
  `<text data-text="axis" x="24" y="40">arrived, in this order</text>`,
  ...[['a1', '1'], ['a3', '3'], ['a2', '2'], ['a5', '5'], ['a6', '6']].map(([id, n], i) =>
    box({ id, x: 24 + i * 70, y: 56, w: 58, h: 44, text: n })),
  box({ id: 'al', x: 374, y: 56, w: 58, h: 44, text: '4?', kind: 'lost' }),
  box({ id: 'sv', x: 556, y: 56, w: 108, h: 44, text: 'the server' }),
  edge({ id: 'rs', d: 'M556 78 H432', text: 'send 4 again', tx: 494, ty: 66, dashed: true }),
  `<text data-text="axis" x="24" y="216">put back in order</text>`,
  ...[1, 2, 3, 4, 5, 6].map(n => box({ id: `s${n}`, x: 24 + (n - 1) * 70, y: 232, w: 58, h: 44, text: String(n) })),
  box({ id: 'pv', x: 500, y: 196, w: 164, h: 116, text: ['the page', 'on your screen'] }),
  edge({ id: 'ep', d: 'M442 254 H500', text: 'draw', tx: 471, ty: 242 }),
].join('')

/** The eight stops, in the order the article visits them. */
export const INTERNET_VIEWS: readonly InternetView[] = [
  {
    id: 'packets',
    question: 'How does a page travel?',
    title: 'Packets',
    what: 'A packet is a small piece of data with a label on it, like an envelope.',
    does: 'Carries one piece of this page from the server to your device.',
    breaks: 'A lost packet is noticed and sent again, so a page never arrives with a hole in it.',
    svg: PACKETS,
    steps: [
      { on: ['pg'], say: 'This page is too big to send in one piece.' },
      { on: ['pe1', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'], say: 'So the server cuts it into small pieces called packets, each about 1,500 bytes or less.' },
      { on: ['p1'], say: 'Every packet carries a label: where it is going, and which piece of the page it is.' },
      { on: ['pe2', 'dev'], say: 'The packets travel separately. Some can be delayed or lost on the way.', token: [508, 182] },
      { on: ['dev'], say: 'Your device uses the numbers to put the page back together.', token: [602, 138] },
    ],
  },
  {
    id: 'addresses',
    question: 'Who has which address?',
    title: 'IP addresses',
    what: 'An IP address is a number that says where a device is on a network, like a postal address.',
    does: 'Your router usually gives each device at home a private address, and all of them share one public address outside.',
    breaks: 'If your router cannot get an address from your ISP, every device at home loses the internet at once.',
    svg: ADDRESSES,
    steps: [
      { on: ['hd1', 'hd2', 'hd3'], say: 'Every device at home gets its own private address from the router.' },
      { on: ['hr'], say: 'Private addresses only work inside your home. Outside, the router speaks for all of them.' },
      { on: ['he1', 'hr'], say: 'When the laptop asks for this page, the request goes to the router first.', token: [217, 128] },
      { on: ['he4', 'hi'], say: 'It leaves with the router’s public address on it, and the router notes who asked.', token: [440, 177] },
      { on: ['he4', 'he1', 'hd1'], say: 'When the answer comes back, the router hands it to the laptop, not the TV.', token: [217, 128] },
    ],
  },
  {
    id: 'dns',
    question: 'How does a name become a number?',
    title: 'DNS',
    what: 'DNS, the Domain Name System, is the internet’s phone book, spread across many servers.',
    does: 'Turns the name apanjwani0.com into the IP address your browser needs to connect.',
    breaks: 'The site cannot be found, even though it is still running, and your browser shows an error like “server not found”.',
    svg: DNS,
    steps: [
      { on: ['n1'], say: 'Your browser asks a resolver, usually run by your ISP: where is apanjwani0.com?' },
      { on: ['n2'], say: 'If the resolver does not know yet, it starts at the top, with a root server.' },
      { on: ['n3'], say: 'The root does not know the answer, but it knows who looks after .com.' },
      { on: ['n4'], say: 'The .com servers know which name servers look after apanjwani0.com.' },
      { on: ['n5'], say: 'So they send the resolver there.' },
      { on: ['n6'], say: 'Those servers hold the answer.' },
      { on: ['n7'], say: 'The IP address comes back to the resolver.' },
      { on: ['n8'], say: 'The resolver keeps the answer for a while, so the next visitor gets it straight away.' },
    ],
  },
  {
    id: 'routes',
    question: 'How does a packet find its way?',
    title: 'Routing',
    what: 'BGP, the Border Gateway Protocol, is how networks tell each other which addresses they can reach.',
    does: 'Chooses the chain of networks your packets cross between your ISP and the website.',
    breaks: 'A network that announces a route it should not sends traffic the wrong way. In February 2008 this took YouTube offline for much of the world for about two hours.',
    svg: ROUTES,
    steps: [
      { on: ['ri'], say: 'Your ISP is one network. The internet is tens of thousands of networks joined together.', token: [82, 144] },
      { on: ['r1', 'ra', 'r2', 'rcf', 'r3', 'rb', 'r4', 'rc', 'r5'], say: 'Each network tells its neighbours which addresses it can reach. This is called BGP.' },
      { on: ['r1', 'ra'], say: 'Your packet takes the best route the networks agreed on…', token: [340, 26] },
      { on: ['r2', 'rcf'], say: '…and arrives at Cloudflare.', token: [598, 142] },
      { on: ['rx', 'r2'], say: 'Now a cable is cut, or a network goes down.', token: [443, 96] },
      { on: ['r3', 'rb'], say: 'Soon the neighbours stop offering that route, and packets go another way.', token: [268, 258] },
      { on: ['r4', 'rc', 'r5', 'rcf'], say: 'It is a longer trip, but the page still arrives.', token: [598, 142] },
    ],
  },
  {
    id: 'edge',
    question: 'Why does a server far away feel close?',
    title: 'The edge',
    what: 'A CDN, or content delivery network, keeps copies of a website in data centres around the world. This site uses Cloudflare’s.',
    does: 'Answers you from a data centre close to you on the network, often without asking the server at all.',
    breaks: 'When a CDN has an outage, every site behind it can fail at the same moment, even though their own servers are fine.',
    svg: EDGE,
    steps: [
      { on: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'], say: 'Cloudflare has data centres in hundreds of cities, and they all answer to the same address.' },
      { on: ['ey'], say: 'So the routes between networks decide which one your request reaches.', token: [486, 312] },
      { on: ['ee1', 'e5'], say: 'You might expect the nearest city on a map.', token: [480, 202] },
      { on: ['ee2', 'e4'], say: 'But from my home in India, this site is usually answered from Marseille. The network decides, not the map.', token: [282, 164] },
      { on: ['e4'], say: 'If Marseille has a recent copy of the page, it answers straight away.', token: [282, 164] },
      { on: ['ee3', 'eo'], say: 'If it does not, it asks the server, and keeps a copy for the next visitor.', token: [178, 312] },
    ],
  },
  {
    id: 'handshakes',
    question: 'How do two computers start talking safely?',
    title: 'Handshakes',
    what: 'TCP sets up a reliable two-way connection. TLS, the S in HTTPS, encrypts it. Over HTTP/3 the two are one handshake.',
    does: 'Your browser and Cloudflare agree to talk, check the site’s certificate, and agree on a secret key.',
    breaks: 'If the certificate does not match the site, your browser stops and shows a warning instead of the page.',
    svg: HANDSHAKES,
    steps: [
      { on: ['k1'], say: 'First TCP. Your browser asks Cloudflare if they can talk. This message is called SYN.' },
      { on: ['k2'], say: 'Cloudflare says yes, and asks the same back. This is SYN-ACK.' },
      { on: ['k3'], say: 'Your browser confirms with ACK. Now there is a reliable connection.' },
      { on: ['k4'], say: 'Then TLS. Your browser says which kinds of encryption it knows.' },
      { on: ['k5'], say: 'Cloudflare picks one and sends its certificate, which proves it speaks for apanjwani0.com.' },
      { on: ['k6'], say: 'They now share a secret key. Everything after this is encrypted.' },
    ],
  },
  {
    id: 'http',
    question: 'What does the browser ask for?',
    title: 'HTTP',
    what: 'HTTP is the language browsers and servers use to ask for pages and to answer.',
    does: 'Carries the request for this page, and the page itself, inside the encrypted connection.',
    breaks: 'The status code says what went wrong: 404 means the page was not found, and 500 means the server had an error.',
    svg: HTTP,
    steps: [
      { on: ['q1'], say: 'Now your browser asks for the page itself. GET means “send me”, and the slash means the home page.' },
      { on: ['q2'], say: 'One server can host many websites, so the request names the one it wants.' },
      { on: ['ha1', 'ha2', 's1'], say: 'The answer starts with a status. 200 means OK. 404 would mean “not found”.' },
      { on: ['s2', 's3'], say: 'Then headers, which describe the answer: what kind of file it is, and whether it may be kept.' },
      { on: ['s4', 's5', 's6', 's7'], say: 'Then the page itself, written in HTML. Your browser turns this into what you see.' },
    ],
  },
  {
    id: 'reassembly',
    question: 'What if packets arrive out of order?',
    title: 'Putting it back together',
    what: 'TCP numbers every packet, so a missing piece is noticed and sent again, and every piece goes back in its place.',
    does: 'Puts this page back together in the right order, and asks again for anything missing.',
    breaks: 'On a bad connection many packets are sent again, so the page is slow, but it still arrives complete.',
    svg: ORDER,
    steps: [
      { on: ['a1', 'a3', 'a2', 'a5', 'a6'], say: 'Packets can arrive in any order, because some are delayed on the way and some are lost.' },
      { on: ['s1', 's2', 's3'], say: 'Your device uses the numbers to put them back in order.' },
      { on: ['al'], say: 'Number 4 never arrived, and your device notices the gap.' },
      { on: ['sv', 'rs', 'al'], say: 'It asks for number 4 again, and the server sends it again.', token: [494, 78] },
      { on: ['s4', 's5', 's6'], say: 'Now nothing is missing, and everything is in order.' },
      { on: ['ep', 'pv'], say: 'Your browser reads the page and draws it on your screen.', token: [582, 214] },
    ],
  },
]

/** The view for an id, or the first one. The control cannot select anything else. */
export function internetView(id: string | null): InternetView {
  return INTERNET_VIEWS.find(v => v.id === id) ?? INTERNET_VIEWS[0]
}

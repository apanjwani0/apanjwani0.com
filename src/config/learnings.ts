/**
 * Learnings — the long-form section.
 *
 * A learning is a blog post that can mount a live component. `embed` names a key
 * in GAME_TAGS (src/lib/games.ts), and the article page mounts that component
 * inline through the same dispatch the games route uses. That is the whole
 * advantage this section has over a newsletter: the simulation being described
 * is running in the page, and it costs no new interactive code.
 *
 * Separate from `blogs` on purpose. Blogs are personal and occasional; these are
 * written to be found, so they carry their own keywords, share cards and
 * indexing predicate.
 */

export interface Learning {
  slug: string
  title: string
  /** Shown on the hub and as the meta description when `metaDescription` is unset. */
  summary: string
  date: string
  /** Markdown. Rendered through src/lib/markdown.ts — never handed to set:html raw. */
  content: string
  /**
   * A GAME_TAGS key. Mounts that component inline, below the intro.
   * Unknown or absent → the article renders as prose, which is a valid article.
   */
  embed?: string
  /** Caption under the embed, explaining what the reader is looking at. */
  embedCaption?: string
  /** Draft when false: no page, no sitemap entry, no card. See isPublishedLearning(). */
  published: boolean
  seoTitle?: string
  metaDescription?: string
  keywords?: string
}

export const learnings: Learning[] = [
  {
    "slug": "how-the-internet-works",
    "title": "How the internet works, one stop at a time",
    "summary": "Press Enter, and a page appears. This is everything that happens in between, one stop at a time: packets, addresses, DNS, routing, Cloudflare, encryption and HTTP.",
    "date": "2026-09-30",
    "content": "On 29 October 1969, at 10:30 at night, a student named Charley Kline sat at a computer at UCLA and started typing \"login\".\n\nEach letter went to a second computer, at SRI in northern California. Kline got as far as \"lo\", and that computer crashed.\n\nSo the first message sent over the network that became the internet was \"lo\". About an hour later, the whole word got through.\n\nToday you make that kind of trip every time you open a page, in well under a second. Here is what happens in between, one stop at a time.\n\n## The page is cut into packets\n\nA page is too big to send in one go. The server cuts it into small pieces called packets.\n\n{{embed:packets}}\n\nEach packet carries a label: where it is going, and which piece of the page it is.\n\n## Every device has an address\n\nThat label uses an IP address. It is a number that says where a device is, like a postal address.\n\n{{embed:addresses}}\n\nAt home, your router usually gives each device a private address. Outside, they all share one public address.\n\n## Finding the address\n\nYour browser has a name, apanjwani0.com, but it needs a number. So first it looks the number up. That is DNS.\n\n{{embed:dns}}\n\n:::note Why 13 root servers\nThere are 13 root server names, lettered a to m. More than 2,000 machines around the world answer to them.\n:::\n\n## Crossing the internet\n\nThe internet is made of tens of thousands of separate networks that agree to carry each other's packets.\n\n{{embed:routes}}\n\nThey tell each other which addresses they can reach, using BGP. When a cable breaks, they find another way.\n\n## The nearest copy\n\nThis site sits behind Cloudflare, which keeps copies of it in data centres in hundreds of cities.\n\n{{embed:edge}}\n\n==Near on the network is not the same as near on a map.== From my home in India, my requests usually land in Marseille.\n\n## Opening a safe connection\n\nBefore asking for anything, your browser and Cloudflare shake hands twice. The first handshake opens a connection. The second agrees on a secret key.\n\n{{embed:handshakes}}\n\nThat second handshake is the S in https.\n\n## Asking for the page\n\nOnly now does your browser ask for the page itself, using HTTP.\n\n{{embed:http}}\n\n## Putting it back together\n\nThe packets come back, not always in order, and sometimes one goes missing.\n\n{{embed:reassembly}}\n\nYour device puts them in order and asks again for anything lost. Then your browser draws the page.\n\nThe whole trip usually takes less than a second. Here is every stop again, in one place:\n\n{{embed}}",
    "embed": "internet-atlas",
    "embedCaption": "Pick a question along the top, then press Play. The last row of each panel says what happens when that stop goes wrong.",
    "published": true,
    "seoTitle": "How the Internet Works: Packets, DNS, Routing and HTTPS, Step by Step",
    "metaDescription": "What happens between pressing Enter and seeing a page: packets, IP addresses, DNS, BGP routing, CDNs, the TCP and TLS handshakes and HTTP, with interactive diagrams.",
    "keywords": "how the internet works, what happens when you open a website, how dns works, what is a packet, what is bgp, tcp handshake, tls handshake, what is a cdn, http request and response"
  },
  {
    "slug": "which-diagram-to-draw",
    "title": "Which diagram should you draw?",
    "summary": "Boxes and arrows, and the four-second test that picks between them. One order drawn seven ways — what each notation is called, what its arrow actually means, and the question each one goes blind to.",
    "date": "2026-09-25",
    "content": "Every engineer draws the same picture. Boxes, arrows, a label on some of them.\n\nThe boxes are usually fine. The arrow is the problem — it can mean seven different things, and most diagrams never say which.\n\n:::key One question, four seconds\nSay your arrow out loud, as a verb. \"…then.\" \"…sends a message to.\" \"…owns, always.\" Finish that sentence and you have picked your diagram. Fail to, and your reader is about to guess.\n:::\n\nOne order — placed, stock reserved, card charged, receipt out — drawn seven ways below. The facts never move. Only the question does.\n\n## \"…then\"\n\n**Flowchart.** The default. A diamond is the only branch it has.\n\n{{embed:flow}}\n\nOne path, start to finish. It cannot show who does the work, or what runs at the same time.\n\n## \"…then, but two at once\"\n\n**Activity diagram.** A bar splits the flow. A lane says who.\n\n{{embed:activity}}\n\nThis is the picture a flowchart cannot draw.\n\n## \"…sends a message to\"\n\n**Sequence diagram.** Left to right means nothing. Downward is time.\n\n{{embed:sequence}}\n\nIt draws one run, so the decline is a second drawing.\n\n## \"…on this event, becomes\"\n\n**State machine.** A node is a thing the order can *be*, not a step it performs.\n\n{{embed:state}}\n\nSix states at once — including the retry the flowchart had nowhere to put.\n\n## \"…owns, always\"\n\n**Class diagram.** The one people mean when they say UML.\n\n{{embed:class}}\n\nNo time axis anywhere on it. Reading one top to bottom as a sequence of events is the standard mistake.\n\n## \"…talks to, over\"\n\n**Deployment diagram.** Processes, and the machines underneath them.\n\n{{embed:deploy}}\n\n## \"…has how many of\"\n\n**Entity-relationship diagram.** Records and their cardinality. The database one.\n\n{{embed:er}}\n\n## Which of these is HLD, which is LLD?\n\nThe labels are informal and teams disagree on them. In practice:\n\n| | A box is | Usually drawn as |\n|---|---|---|\n| **HLD** | a service, a queue, a datastore | container, architecture or deployment diagram |\n| **LLD** | a class, a table, a participant | class, sequence and ER diagrams |\n\nSame notations at both levels. What changes is what a box is allowed to be.\n\n## The two that are not system diagrams\n\n**Mind map.** One centre, branches outward, no cycles — a tree. For emptying your head onto a page.\n\n**Knowledge graph.** Typed nodes, typed edges, no centre, anything may link to anything. For facts that connect to other facts.\n\nNeither one models a system. Both turn up in design reviews anyway.\n\n## Before you draw\n\nPick the question. Say the arrow as a verb. Put both at the top of the picture.\n\nAll seven, with the line under each saying what it has gone blind to:\n\n{{embed}}\n",
    "embed": "diagram-atlas",
    "embedCaption": "Pick a question along the top, then press Play. The last line of each panel is what that picture cannot tell you.",
    "published": true,
    "seoTitle": "Which Diagram Should You Draw? Flowchart, Sequence, Class, State and ER",
    "metaDescription": "Flowchart, activity, sequence, state machine, class, deployment, ER — one order drawn seven ways. What each diagram is called, what its arrow means, and which ones are HLD versus LLD.",
    "keywords": "types of system diagrams, uml diagram types explained, flowchart vs activity diagram, sequence diagram vs flowchart, state machine diagram, class diagram explained, entity relationship diagram, hld vs lld diagram, mind map vs knowledge graph, which diagram should i use, what does an arrow mean in a diagram, system design diagrams"
  }
]

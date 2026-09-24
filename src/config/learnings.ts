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
    "slug": "types-of-system-diagrams",
    "title": "What the arrows mean: sorting out flowcharts, UML and the rest",
    "summary": "In a flowchart an arrow means \"next\". In a class diagram it means \"always true\". In a sequence diagram it is one message at one moment. A single question sorts every diagram family, and the arrow tells you which one you are holding.",
    "date": "2026-09-25",
    "published": true,
    "seoTitle": "Types of System Diagrams — Flowchart vs UML vs Sequence vs ERD",
    "metaDescription": "Flowchart, activity, sequence, state machine, class, ERD and C4 — what each one's nodes and arrows actually mean, and how to pick the right one.",
    "keywords": "types of system diagrams, flowchart vs activity diagram, uml diagram types, sequence diagram vs flowchart, entity relationship diagram, statechart, harel statechart, c4 model, structural vs behavioural diagrams, system design diagrams, software architecture diagrams, which diagram to use",
    "content": "In 1921 Frank and Lillian Gilbreth presented a thing called a process chart to the American Society of Mechanical Engineers. They were efficiency people — Frank had made his name filming bricklayers to find wasted motion — and the chart drew the steps of factory work so you could see which steps did nothing. Boxes for operations, arrows for what followed what.\n\nTwenty-six years later Herman Goldstine and John von Neumann borrowed it for a machine. Their 1947 report *Planning and Coding of Problems for an Electronic Computing Instrument* set out \"flow diagrams\" for programs, so the notation reached computing before most programming languages did.\n\nThe flowchart is older than the software industry, and it was built to answer one question: in what order do the steps happen? Every family invented since answers a different one. A wall of them looks confusing because they are drawn with the same pencil and mean unrelated things.\n\n## The first fork\n\nAsk one thing about a picture: do the shapes on the page coexist, or do they follow one another?\n\nIf they coexist, the diagram is **structural**. It shows what parts the system has and how they are wired. Class, component, deployment, entity-relationship, a C4 container view — freeze the system at any instant and the picture still holds.\n\nIf they follow one another, the diagram is **behavioural**. Something moves through it. Flowchart, activity, sequence, state machine. Remove time and the picture stops meaning anything.\n\nThat one fork does most of the sorting, and the two halves rot differently: a structural diagram goes stale when the code is restructured, a behavioural one when the flow changes — which happens more often and is noticed less.\n\n## What an arrow means\n\nWithin each half, what separates the notations is almost always the arrow. ==An arrow means something different in every diagram family, and most confusion comes from reading one diagram's arrows with another diagram's grammar.==\n\nIn a **flowchart** an arrow means *next*. Control walks along it, one token at a time, and a diamond splits the path.\n\nIn a **sequence diagram** an arrow is a *message* from one participant to another. Participants stand across the top as lifelines and the vertical axis is time, so the story reads downward. Their left-to-right order carries no meaning at all; only the downward order does.\n\nIn a **class diagram** an arrow is a relationship that holds permanently: this type owns that one, this one inherits from that. There is no time axis. Reading one top to bottom as a sequence of events is the most common mistake made with UML.\n\nIn a **state machine** a node is a mode the system rests in, and it stays there until something arrives. The arrow is the event that moves it, labelled with the trigger. David Harel's 1987 paper *Statecharts: A Visual Formalism for Complex Systems* added nesting and concurrency to the idea, and UML's state machine diagrams descend from it.\n\nIn an **entity-relationship diagram** — Peter Chen's, from his 1976 paper in *ACM Transactions on Database Systems* — a box is a kind of record and a line carries cardinality: one customer, many orders. The lines are constraints, and nothing on the page moves.\n\n>> Every diagram is a projection. It keeps one dimension and discards the others, and the whole skill is knowing which one you kept.\n\n## The families, side by side\n\n| Diagram | A node is | An arrow is | Answers |\n|---|---|---|---|\n| Flowchart | a step | control moving to the next step | what happens in what order |\n| Activity | a step, possibly parallel | control, which may fork and rejoin | the same, with concurrency and owners |\n| Sequence | a participant's lifeline | one message, at a moment in time | who calls whom, in what order |\n| State machine | a mode the system sits in | an event that changes the mode | what the system does to inputs, from each state |\n| Class | a type | a permanent relationship | what the code is made of |\n| Component / deployment | a deployable unit or a machine | a dependency or a network link | what runs where, talking to what |\n| Entity-relationship | a kind of record | a cardinality constraint | how the data is shaped |\n| C4 (context → code) | a person, system, container, component | a dependency, labelled | the same system at four zoom levels |\n\n:::warn The pair people mix up\nThese two look nearly identical and are not interchangeable. A flowchart has one thread of control; an activity diagram has fork and join bars, so it can say *these happen at the same time*, and swimlanes, so it can say *who does each step*. Draw a parallel process as a flowchart and the notation quietly forces you to invent an order that does not exist.\n:::\n\n## UML's fourteen\n\nUML exists because three notations were competing. Grady Booch, James Rumbaugh and Ivar Jacobson each had their own method, ended up at Rational Software in the mid-nineties, and merged them; the Object Management Group adopted UML 1.1 in November 1997.\n\nThe current spec defines fourteen diagram types, split seven structural and seven behavioural — the same fork as above, reached independently. Four of the behavioural seven (sequence, communication, timing, interaction overview) group again as *interaction* diagrams: answers to \"who talks to whom\", drawn with different axes.\n\nFour or five of the fourteen carry nearly all real traffic — sequence for a protocol, state machine for anything with modes, class or ERD for the shape of things, a container-level box diagram for the system overall.\n\n:::note Boxes and arrows with no notation at all\nMost architecture diagrams follow no standard, which is defensible. Simon Brown's C4 model, from around 2011, is popular because it keeps the useful part — four fixed zoom levels, context down to code — without a symbol set to learn. Keep one rule from the formal notations: put a legend on it. An unlabelled arrow could mean calls, deploys to, sends events to, or depends on at build time, and a reader cannot recover which.\n:::\n\n:::key Pick the question first\nSay the question out loud before choosing a notation — \"in what order\", \"who calls whom\", \"what modes can this be in\", \"what is it made of\", \"what runs where\". Each has one obvious family and several that will fight you. Choosing the notation first is how a diagram ends up correct and unable to say the thing you drew it for.\n:::"
  }
]

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
    "slug": "how-to-think-on-paper",
    "title": "How to think on paper",
    "summary": "Volunteers picked out photographs they had glimpsed once, days earlier, 83% of the time — but only while the wrong answer looked nothing like the right one. Every diagram you draw is a box with an arrow. Here is one system drawn seven ways, and the four-second habit that picks which.",
    "date": "2026-09-25",
    "content": "Every engineer draws the same picture. Not the same system — the same *picture*: rounded boxes, arrows between them, a label on some of the arrows and none on the rest. It is the default output of thinking about software, and almost nobody stops to say what their arrow means.\n\nIn 1973 a psychologist named Lionel Standing ran a study that reads like an endurance test. Over several days he showed volunteers ten thousand photographs, one at a time, a few seconds each. Nobody was asked to remember anything.\n\nThen he showed them pairs — one photograph from the pile, one they had never seen — and asked which was which. They were right **83%** of the time. Standing worked that back to roughly 8,300 of the ten thousand still in there, from a single glance, days earlier, with no intention of keeping any of it.\n\nTry that with ten thousand sentences.\n\n:::warn The number on the slide is invented\nYou have met the claim that the brain processes images \"60,000 times faster than text\". Follow its citations and they either loop or end at somebody else's deck. No study reports it. Repeating it is how a real result ends up sounding like a sales pitch.\n:::\n\n## The condition on the result\n\nStanding's finding comes with a condition, and the condition is what the slides leave out. The advantage depends on the wrong answer looking nothing like the right one. Show someone a photograph they never saw that is thematically or visually close to one they did, and the accuracy drops — the effect leans on how distinguishable the pictures are, not on some separate high-bandwidth channel into the eye.\n\nWhich is awkward for us, because a box with an arrow leaving it looks exactly like a box with an arrow leaving it.\n\nTen thousand photographs of ten thousand different things are distinguishable without effort. Ten diagrams of one system, all drawn in rectangles, are not. We adopted the one medium the research supports and then took away the property it was relying on.\n\n## Why a picture is cheaper, when it is\n\nJill Larkin and Herbert Simon published the mechanism in *Cognitive Science* in 1987, under a title that gives away its own argument in the parenthesis: \"Why a Diagram is (Sometimes) Worth Ten Thousand Words\". Simon had a Turing Award and a Nobel in economics by then.\n\nTheir claim is that a diagram and a paragraph can carry identical information and still cost different amounts to use. Text makes you hold a piece in your head while you go hunting for whatever connects to it. A diagram puts the connected pieces next to each other, so the next step is a glance instead of a retrieval.\n\n==The saving is in the search — so a picture is cheap only for the question its layout already groups for, and the grouping that makes one question free makes another one expensive.==\n\nThat is why the right diagram feels like the answer was already on the page, and the wrong one feels like homework.\n\n>> Your eye does the work your memory would otherwise have to do. Point it at the wrong arrangement and there is nothing there to find.\n\n## Say the arrow out loud\n\nOne habit makes the choice for you and takes about four seconds. **Say your arrow as a verb.**\n\nIn a flowchart it is *then*. In a sequence diagram, *sends a message to*. In a state machine, *on this event, becomes*. In a class diagram, *owns, always*. In a deployment diagram, *talks to, over*. In an entity-relationship diagram, *has how many of*.\n\nIf you cannot finish that sentence, the picture is not finished either, and your reader is about to guess. A guessed arrow is how a diagram starts answering a question nobody asked.\n\nBelow is one order, drawn seven ways. The facts never move: an order is placed, stock is reserved, the card is charged, a receipt goes out, and the charge can fail. Pick the question you came in with, then read the line at the bottom that says what the picture has gone blind to:\n\n{{embed}}\n\n| You are asking | Draw | It puts side by side |\n|---|---|---|\n| in what order do the steps go | flowchart | each step and the one after it |\n| what happens at once, and who does it | activity diagram | parallel branches, in a lane per actor |\n| who calls whom, and when | sequence diagram | participants across, time downward |\n| what can it be right now | state machine | every state, and each event that leaves it |\n| what is the code made of | class diagram | types and the relations that always hold |\n| what runs where | deployment diagram | processes and the machines under them |\n| how is the data shaped | entity-relationship | records and their cardinality |\n\nSwitching between two of them is more instructive than any row of that table. The flowchart walks one token through one outcome, so the decline is a second drawing. The state machine holds all six states at once and has the retry the flowchart had nowhere to put — and it has no idea who does the work, which the swimlanes answer and it cannot.\n\n## \"I'm a visual person\"\n\nThe instinct after all this is to sort yourself into a type. Pashler, McDaniel, Rohrer and Bjork reviewed the evidence for *Psychological Science in the Public Interest* in 2008 and found no credible support for the popular form of learning styles, where instruction is matched to a learner's preferred mode.\n\nLarkin and Simon's result survives that review, because theirs is a claim about the task. The same engineer wants a sequence diagram on Tuesday for a protocol and a state machine on Wednesday for an order stuck in `pending`. Nothing about the engineer changed on the way.\n\n:::key Three sentences, before you draw anything\nSay the question in ordinary words. Say the arrow as a verb. Put both on the page as a legend. That is what stops a picture being read with somebody else's grammar.\n:::\n\nEvery diagram is a projection. It keeps one dimension of a system and throws the others out, and the skill people call being good at diagrams is knowing which one you just discarded.",
    "embed": "diagram-atlas",
    "embedCaption": "Start on the flowchart and let it run. Then ask what happens at once — the token splits in two, which is the one thing a flowchart cannot draw.",
    "published": true,
    "seoTitle": "How To Think On Paper — Why Diagrams Work, And Which One To Draw",
    "metaDescription": "Standing's picture-memory result carries a condition nobody quotes, and it explains why most architecture diagrams fail. One system drawn seven ways, plus a four-second habit for choosing the notation.",
    "keywords": "how to think on paper, why diagrams work, which diagram should i use, types of system diagrams, flowchart vs activity diagram, sequence diagram vs flowchart, state machine diagram, uml diagram types explained, larkin and simon diagram, picture superiority effect, standing 1973, visual learner myth, learning styles myth, what does an arrow mean in a diagram, system design diagrams"
  }
]

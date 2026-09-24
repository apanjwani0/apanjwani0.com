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
    "summary": "People shown ten thousand photographs once could still pick them out days later. That looks like proof that eyes beat words, and the statistic everyone quotes for it was invented. The real reason a picture helps is more useful, because it decides which one you should draw.",
    "date": "2026-09-25",
    "published": true,
    "seoTitle": "How To Think On Paper — Why Diagrams Work, And Which To Draw",
    "metaDescription": "Nobody holds a whole system in their head. What a diagram actually saves you is searching, not reading time — and that decides which one to draw.",
    "keywords": "how to think on paper, thinking on paper, why diagrams work, external memory, working memory diagrams, picture superiority effect, larkin and simon, types of system diagrams, which diagram should i use, flowchart vs activity diagram, sequence diagram vs flowchart, state machine diagram, visual learner myth, learning styles myth",
    "content": "Nobody holds a whole system in their head. You get a few pieces at a time, and when someone asks what happens if the payment fails, you start again from the top. So you draw it — and which picture you draw depends on why a picture helps at all.\n\nIn 1973 a psychologist named Lionel Standing sat people down in front of ten thousand photographs. One at a time, a few seconds each, spread over days. Nobody was told to memorise anything.\n\nThen he showed them pairs — one picture from the pile, one they had never seen — and asked which was which. On the full ten thousand, people were right about two thirds of the time. After a single glance, days earlier, with no effort to remember.\n\nTry that with ten thousand sentences.\n\n## The conclusion people draw\n\nThe obvious conclusion is that eyes are a faster input than words, and there is even a number attached. You have probably met the claim that the brain processes images \"60,000 times faster than text\", usually on a slide selling something.\n\n:::warn That number is made up\nFollow its citations and they run in a circle or stop at another deck. No study reports it. A round multiplier about cognition with no paper behind it is decoration, and repeating it is how a real effect ends up sounding like a sales pitch.\n:::\n\nThe useful explanation arrived fourteen years after Standing's pictures, from two people asking the opposite question: when does a diagram *fail*? Jill Larkin and Herbert Simon published it in *Cognitive Science* in 1987 under a title that gives away the answer — \"Why a Diagram is (Sometimes) Worth Ten Thousand Words\". Simon had a Turing Award and a Nobel in economics by then. The parenthesis is the whole paper.\n\nTheir argument is that a diagram and a paragraph can carry identical information and still cost different amounts to use. Text makes you hold things in your head while you hunt for the piece that connects to them. A diagram puts the connected pieces next to each other, so the next step is a glance rather than a retrieval.\n\n==A picture helps when it places the things your question needs side by side. It stops helping the moment the question changes, because the grouping that made one question cheap makes a different one expensive.==\n\nThat is why the right diagram feels like the answer was already there, and the wrong one feels like homework.\n\n>> The saving is in the search. Your eye finds what your memory would otherwise have to hold.\n\n## So the question picks the picture\n\nBefore choosing a notation, say what you are asking, out loud, in ordinary words. There are only a handful of questions, and each one has a shape that groups for it.\n\n| You are asking | Draw | Because it puts side by side |\n|---|---|---|\n| in what order do the steps go | flowchart | each step and the one after it |\n| what happens at the same time, and who owns it | activity diagram | parallel branches, and swimlanes per actor |\n| who calls whom, and when | sequence diagram | participants across, time down |\n| what modes can this be in | state machine | each state and every event that leaves it |\n| what is the code made of | class diagram | types and the relationships that always hold |\n| what runs where | deployment / container | processes and the machines under them |\n| how is the data shaped | entity-relationship | records and their cardinality |\n\nRead one row and the pattern shows: the diagram that wins is the one whose layout already answers the question, so your eye does the work instead of your memory.\n\nThe corollary is the failure. A class diagram read top-to-bottom as a sequence of events is the most common mistake made with UML, and it happens because the reader brought a different question to a picture that groups for another one. The boxes are types, the lines hold permanently, and there is no time axis anywhere on the page.\n\n:::warn The pair that look identical\nA flowchart and an activity diagram are drawn almost the same and answer different questions. A flowchart has one thread of control. An activity diagram has fork and join bars, so it can say *these happen at the same time*, and swimlanes, so it can say *who does each step*. Draw a parallel process as a flowchart and the notation quietly makes you invent an order that nobody intended.\n:::\n\n## \"I'm a visual person\" is the wrong question\n\nThe instinct after reading this is to sort yourself — visual thinker, verbal thinker, pick your lane. The evidence does not cooperate. Pashler, McDaniel, Rohrer and Bjork reviewed it for *Psychological Science in the Public Interest* in 2008 and found the popular version of learning styles, where teaching is matched to a learner's preferred mode, has almost no credible support.\n\nWhat does hold is the Larkin and Simon result, and it is about the task rather than the person. The same engineer wants a sequence diagram on Tuesday for a protocol and a state machine on Wednesday for a stuck order. Neither preference changed.\n\n:::key The one habit worth keeping\nSay the question in words before you draw anything, and put a legend on the result. An unlabelled arrow between two boxes could mean calls, deploys to, sends events to, or depends on at build time — and a reader who guesses wrong has been handed a picture that groups for a question they are not asking.\n:::"
  }
]

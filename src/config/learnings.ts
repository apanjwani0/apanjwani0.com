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
    "slug": "the-test-that-shared-the-bug",
    "title": "One agent wrote the article, the code and the test. All three were wrong the same way.",
    "summary": "A green gate said the implementation matched its test. Both matched the prose. All three had inherited the same misremembered fraction, and the tool taught the wrong number to anyone who used it.",
    "date": "2026-08-20",
    "embed": "poker-trainer",
    "embedCaption": "Press “Play a spot” and answer a few. Watch the row reading “Equity you needed to call” — it moves with the bet size and never with your cards, and the number it shows is now bet ÷ (pot + 2 × bet): 19.9, 25.0, 28.4 or 33.3.",
    "published": true,
    "seoTitle": "When AI Writes the Code and the Test That Checks It",
    "metaDescription": "An autonomous agent wrote an explanation, the implementation and the assertion in one pass. All three shared one wrong fraction and the build stayed green. What independence in a test actually requires.",
    "keywords": "ai generated tests, llm code review, oracle problem, test oracle, autonomous coding agent, verification, self-verifying ai, green build false confidence",
    "content": "On 18 August 2026 a scheduled task on this site committed three files in one pass: an article about poker mathematics, the drill that computes the numbers the article quotes, and an assertion in the test suite pinning the two to each other. The commit message was `feat: dst-aware cron whisperer, hue hunt server leaderboard, pot odds article`. The gate was green — build, type check, security smoke, poker check.\n\nEvery price in it was wrong.\n\n## The claim, in one line\n\nSomeone bets B into a pot of P, and you are deciding whether to call.\n\nThe article said the equity you need is **B / (P + B)**. The drill computed B / (P + B). The test recomputed B / (P + B) and checked it against both. The comment above that test said it was recomputing the value rather than reading it from the code or from the prose. That was true, and it bought nothing.\n\n## What the arithmetic is\n\nCall B and the pot you are winning a share of is not P + B. Your own B has joined it. It is P + 2B, so a call breaks even at **B / (P + 2B)**.\n\nAt a pot of 100 and a bet of 50 that is 25%, against the 33.3% all three files agreed on. Across the four bet sizes the drill deals — 33, 50, 66 and 100 into a pot of 100 — the published prices were 24.8%, 33.3%, 39.8% and 50.0%. The true ones are 19.9%, 25.0%, 28.4% and 33.3%.\n\n:::warn What the error cost\nA hand with 28% equity facing a half-pot bet is being offered a call that makes money. The drill called that a fold, reset the streak for the correct decision, and printed the value of calling with the wrong sign — minus 20 chips against a true plus 20.\n:::\n\n{{embed}}\n\n## Why the test did not catch it\n\nThe test was independent of the source. It was not independent of the assumption.\n\nNothing in it read `requiredEquity()` and nothing in it read the article. It re-derived the number from what looked like first principles, where first principles meant a fraction the same author had half-remembered ninety seconds earlier. Three files, one prior.\n\n==Independence of source is not independence of assumption. A verifier and the thing it verifies can share an author, and therefore share a mistake — and the more confidently the verifier is written, the less likely anyone is to read it again.==\n\n>> A green gate says the code agrees with the test. It does not say that either of them is right.\n\nSoftware testing has a name for the general shape: the oracle problem. To check a program you need something that already knows the right answer, and for anything past arithmetic that something is usually another program written by the same people. What is new is the delivery. When one agent writes the explanation, the implementation and the check in a single pass, those three artifacts are not three witnesses. They are one witness, written out three times, in three files, with three different levels of confidence and no additional information.\n\n## The repair was not a better formula\n\nWriting B / (P + 2B) into the test would have been the same move again — a remembered fraction, typed more carefully, correct until the next thing nobody remembered properly.\n\nThe repair was to stop asserting arithmetic and start asserting the thing the arithmetic is about. A call breaks even when the expected value of calling is zero, so the test now bisects for that point directly:\n\n```js\nconst breakeven = (pot, bet) => {\n  const ev = p => p * (pot + bet) - (1 - p) * bet\n  let lo = 0, hi = 1\n  for (let i = 0; i < 200; i++) {\n    const mid = (lo + hi) / 2\n    if (ev(mid) < 0) lo = mid\n    else hi = mid\n  }\n  return (lo + hi) / 2\n}\n```\n\nThere is no formula in it to inherit. It knows what a call wins, what a call costs, and what break-even means. It printed 19.9, 25.0, 28.4 and 33.3 on the first run, and the four numbers in the article were changed to match it rather than the other way round.\n\n:::key The rule that came out of it\nWhen a claim is a piece of arithmetic, do not assert the arithmetic. Assert the thing it is arithmetic about.\n:::\n\nThe same pass shipped four daylight-saving fixes whose assertions did hold, and they held for one reason: they were checked by stepping real UTC minutes through the tz database and reading the wall clock back. That oracle was written by the same agent, in the same hour, and it still caught four bugs — because it could disagree. It had access to something the code under test did not: the actual rules of the world, in a file nobody in the loop had written.\n\nAn oracle is only worth having if it can tell you no."
  },
]

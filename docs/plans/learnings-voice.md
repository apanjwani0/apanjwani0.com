# Learnings — house voice

Written 2026-08-18 after the owner read the first seven articles and said: "full
of bullshit right now. full of ai slop… all the text is just dumped on the
screen. no prioritisation, no highlighting. no emotions in reading… almost none
of the learnings match with the read and the interactive element. and all the
learnings are very same format copy paste. all starts with the interactive
element directly."

Every one of those is a fair reading of what shipped. This file exists so the
next article does not repeat them.

## The four failures, named

**1. One skeleton, seven times.** Every article ran: cold-open hook → potted
history → a section whose heading promised strangeness ("The part that should not
follow", "Why this one stings", "The part the birds got right first") → a closing
section that told the reader what to take away. Once you have read two, you have
read all seven, and the third one's structure is doing no work.

**2. Nothing was emphasised, so nothing was.** Plain paragraphs end to end. A
reader skimming had no purchase; a reader reading had no rhythm. The fix is
partly typographic (done — see below) and partly that ==the writing has to decide
what the one important sentence is==, which the old drafts never did.

**3. The simulation arrived before the reason to care.** The route pinned the
embed between the summary and the prose, so every article opened with a machine
the reader had no reason to touch, and then had to spend its first paragraphs
explaining what they had already scrolled past. It also forced every article into
the same opening move — "play with it above before you read on" — which is most
of why they felt copy-pasted.

**4. It read like it was generated.** Because a lot of it was. The tells are
listed below and they are bannable, not discouraged.

## Hard bans

These are LLM tics. If a sentence matches, rewrite it — do not soften it.

- **The antithesis reflex**: "It is not X. It is Y." / "That is not a footnote, it
  is the opposite." / "This is not about dots." Used once it is a rhetorical
  move; used four times per article it is a verbal habit with no content.
- **Self-announcing significance**: "That is worth pausing on." / "Here is where
  it stops being a graphics trick." / "And this is the part people rarely hear."
  If it is worth pausing on, the sentence itself will do that. Telling the reader
  to be interested is what you do when you are not sure they will be.
- **Editorialising headings**: "Why this one stings", "The part that should not
  follow", "The bit worth taking away". A heading should say what the section is
  about so a skimmer can navigate. These say how to feel about it.
- **The summary section.** Every draft ended with a section explaining what the
  article had meant. Delete it. If the piece worked, it is redundant; if it did
  not, the summary does not save it.
- **Vague authority**: "by many accounts", "it is widely regarded", "people
  have built". Name who, or cut the claim.
- **Filler intensifiers**: "genuinely", "actually", "simply", "quite", "very",
  "really", "essentially", "fundamentally". Almost every instance can be deleted
  with no loss. Delete them.
- **The triple**: three parallel clauses used for rhythm rather than because
  there are three things. "It is stable, adaptive, and leaderless."

## Requirements

**A distinct shape per article.** Assigned individually — reverse chronology, a
timeline with a hole in it, second person, a legal narrative, a tragedy that
leads with the death. Two articles must not be diagrammable the same way. If you
cannot state this article's shape in one sentence, it does not have one.

**A person doing something specific, early.** Not "researchers found" — a named
human, in a place, in a year, with a problem. Conway moving stones on a Go board
by hand. Perlin annoyed at a film. Specificity is where emotion comes from; there
is no other source available in a 900-word piece about an algorithm.

**Facts that can be checked.** Dates, names, publication venues, award years. No
claim goes in that a reader could not verify. Where the record is contested, say
it is contested — the sandpile article was right to note the strong version of
Bak's claim did not hold, and that honesty is worth more than a tidy ending.

**Every article earns its embed at a specific moment.** Put `{{embed}}` on its own
line exactly where the reader will want to touch the thing. That is normally
right after the sentence that makes them curious and before the one that answers
it. The caption is an **instruction**, not a description: "Drop in a glider gun
and watch the population climb forever" beats "The real thing, running here."

**Length: 700–1100 words.** The old ones ran long because the closing summary and
the self-announcing transitions padded them. Cut those and the piece is shorter
and better.

## The marks available

Use them sparingly — a page with six highlights has none.

| Mark | Renders | Use for |
|---|---|---|
| `==text==` | `<mark>` | The one clause a section turns on. At most one or two per article. |
| `>> line` | display-size pull quote | A line worth breaking the column for. At most one per article. |
| `:::key Label` … `:::` | accented callout | The takeaway a skimmer must not miss. |
| `:::note Label` … `:::` | plain callout | Context that would derail the main line — an aside, a caveat, a definition. |
| `:::warn Label` … `:::` | red-accented callout | A common misreading, or a claim that is contested. |
| `{{embed}}` | the interactive figure | Exactly once, at the moment of maximum curiosity. |

`>` is still a real blockquote and means *someone said this*. Do not use it for
emphasis; that is what `>>` is for.

## What good looks like

The test: **could this paragraph appear in any of the other six articles?** If
yes, it is doing no work and it goes. That single question kills most slop,
because slop is by definition the text that is interchangeable.

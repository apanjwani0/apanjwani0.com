# Learnings — house voice

Written 2026-08-18 after the owner read the first seven articles and said: "full
of bullshit right now. full of ai slop… all the text is just dumped on the
screen. no prioritisation, no highlighting. no emotions in reading… almost none
of the learnings match with the read and the interactive element. and all the
learnings are very same format copy paste. all starts with the interactive
element directly."

Every one of those is a fair reading of what shipped. This file exists so the
next article does not repeat them.

## The format (2026-09-25 — supersedes the length rule below)

Read after the owner read the diagrams article: *"it's just very bad, it's not
something I would write myself… you don't have to write some philosophical
shit."* The 2026-08 rules below fixed the prose. They did not fix the **shape**,
and the shape is what was still wrong: a 1,071-word essay whose actual subject —
what these diagrams *are* — was compressed into one table, under three pages of
cognitive-science citation.

**1. It has to read as if the owner handwrote it.** Not essay voice. No
philosophical closing line. No research paper used as the spine of the piece. A
study may appear where it settles a question the reader is already asking; it
may not be the reason the article exists.

**2. The reader must finish knowing more about the subject.** That is the whole
test. For the diagrams piece it meant naming things: what a class diagram is,
what UML actually refers to, what the HLD picture is called and what the LLD one
is called, how a mind map differs from a knowledge graph. If a reader could have
got the same value from the title, the article did not happen.

**3. Short lines.** One idea per line. If a sentence has two clauses joined by a
dash or a semicolon, it is usually two lines.

**4. A visual beat every one to three lines.** A figure, an interaction, a
diagram, a GIF — something to look at. The prose is the connective tissue
between the figures, not the other way round. Write the figure list FIRST, then
write the lines between them.

**5. Budget: aim for 350–550 words of prose.** The instruction was "if your
first draft says a thousand words, make it two hundred". Figures, captions and
tables are not counted against it — they are the article. A piece may run longer
only when the extra length is itself interesting; length is never the goal.

**6. Every article shows its read time**, the way Medium does. Derived from the
content, never typed into config — see `readingTime()` in `src/lib/learnings.ts`.

One constraint that shapes the structure and is **never written on the site**:
build it as if for a reader with ADHD. Short, visual, always something to do
next. It is a design brief, not a topic, and it is not mentioned in copy.

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

**Length: see the budget above (350–550 words of prose).** This used to say
700–1100. That range was set when an article was all prose and one figure; it is
superseded by the format section at the top of this file, which inverts the
ratio. The reasoning survives: the old ones ran long because the closing summary
and the self-announcing transitions padded them.

## The marks available

Use them sparingly — a page with six highlights has none.

| Mark | Renders | Use for |
|---|---|---|
| `==text==` | `<mark>` | The one clause a section turns on. At most one or two per article. |
| `>> line` | display-size pull quote | A line worth breaking the column for. At most one per article. |
| `:::key Label` … `:::` | accented callout | The takeaway a skimmer must not miss. |
| `:::note Label` … `:::` | plain callout | Context that would derail the main line — an aside, a caveat, a definition. |
| `:::warn Label` … `:::` | red-accented callout | A common misreading, or a claim that is contested. |
| `{{embed}}` | the interactive figure, full | The moment of maximum curiosity. |
| `{{embed:view}}` | the same component pinned to one view | The per-section beats. Several per article is the point. |

`>` is still a real blockquote and means *someone said this*. Do not use it for
emphasis; that is what `>>` is for.

## What good looks like

The test: **could this paragraph appear in any of the other six articles?** If
yes, it is doing no work and it goes. That single question kills most slop,
because slop is by definition the text that is interchangeable.

# Flowmap — a shareable, embeddable diagram editor

**Status:** brief, not yet built. Written 19 Aug 2026.
**Slug:** `flowmap` (working name — rename freely, but keep it one word and not "Lab" or "Forge").

You are adding one tool to `portfolio-apanjwani0`. Read `AGENTS.md` in full before writing
code — in particular **"The bar for a new tool or game"** and the **security invariants**
section. The rules there are binding, not advisory.

---

## What it is

A **drag-and-drop diagram editor** — mind maps and flow designs — that lives in the browser,
and a **server-side store** that gives every diagram a permalink and a live image URL other
software can embed.

The visitor drags out nodes, connects them, labels them, arranges them. Then they hit Save
and get back two links: one to keep editing, one that renders the diagram as an image
anywhere a URL can go — a GitHub README, a docs page, a Slack message, a Notion embed.

## Why it clears the bar (read this before proposing a simpler version)

`AGENTS.md:736` — *"a tool must do something a static HTML page cannot"* — and the tool must
clear **at least two** of the four criteria. A pure client-side canvas editor clears **none**
of them and is precisely the "box that transforms things in the browser" that section was
written to stop. Do not build that and call it done.

This brief clears two:

1. **State outlives the tab.** A saved diagram has a permalink the author can send to a
   colleague, reopen next week, or paste into a ticket.
2. **It owns a URL other software talks to.** `GET /api/flowmap/<id>.svg` returns the current
   diagram as an image. Drop that in a README and the picture updates when the author edits
   the map — no re-export, no committed PNG going stale. That is the feature that makes a
   stranger bookmark this, and it is the one that cannot exist without the server the site
   already pays for.

If a decision during the build threatens either of those two, the decision loses.

---

## Hard constraints

From `AGENTS.md`, non-negotiable:

- **Astro + Oat UI only.** No React, Vue, or Svelte. Vanilla TS in the component.
- **Semantic HTML + `data-*` attributes.** Not custom CSS classes.
- **`theme.css` tokens only.** Never a hardcoded colour, font, or size — including inside the
  diagram canvas and inside the server-rendered SVG. The rendered image must look right in
  both light and dark.
- **SSR everywhere:** `prerender = false`.
- **No new top-level page or route** (owner decision, 2026-07-04). This is a component plus a
  config entry surfaced through the existing `/tools/[slug]`. The API routes under
  `src/pages/api/` are the exception — they are where the server half lives.
- **Config only via `src/lib/config.ts`.**
- Follow the existing pattern: a directory under `src/components/tools/`, alongside
  `webhook-inspector` and `trellis`, which are the two closest precedents. Read both first —
  `webhook-inspector` for the server half, `trellis` for canvas interaction.

**Page weight budget: under 250 KB gzipped for the tool page.** Pick any renderer that meets
it — a graph library, hand-rolled SVG, canvas, whatever — and justify the choice in the
commit message. Cytoscape.js is roughly 400 KB on its own and almost certainly busts the
budget; if you want it, prove the number rather than assume it.

**No accounts, no login, no per-visitor cookie.** Type Trial is the precedent: a display name
and the data is the whole record. Diagrams are unlisted-by-URL. Editing is authorised by an
edit token embedded in the editor link, not by identity.

---

## Features

### Must have — v1 is not shippable without these

**Canvas and nodes**
- Create a node: double-click empty canvas, or a visible "add" control (both — pointer users
  discover the first, everyone else needs the second).
- Drag a node to move it. Drag from a node's edge handle to another node to connect them.
- Edit a node's label in place. Multi-line. Enter commits, Escape cancels.
- Select a node or edge; Delete removes it, and removing a node removes its edges.
- Pan (drag empty canvas or space-drag) and zoom (wheel/pinch), plus explicit **zoom in / zoom
  out / fit** buttons. The Snap Call map had these three and they earned their place — wheel
  zoom alone is unusable on a trackpad.
- **Undo/redo**, at least 50 steps deep. This is the single feature whose absence makes a
  diagram editor feel like a toy. Do not defer it.

**Structure**
- Edge labels (optional text on a connection).
- A handful of node shapes — rectangle, rounded, diamond (decision), pill (start/end). Shape
  is meaning in a flow diagram; do not ship one shape.
- Node colour chosen from **theme tokens only**, offered as a small named palette (not a
  colour picker — `AGENTS.md` explicitly bans shipping another colour picker, and an
  arbitrary hex would break dark mode).

**Persistence and sharing**
- **Save** → `POST /api/flowmap` returns `{ id, editToken }`. The editor URL carries the edit
  token; the view URL does not.
- **View link** — read-only, opens the diagram, no editing affordances.
- **Image URL** — `GET /api/flowmap/<id>.svg`, always current, correct in light and dark
  (respect `prefers-color-scheme` in the SVG itself; a README on a dark GitHub theme must not
  get black-on-black).
- **Export** — download as SVG, and **copy as Mermaid** to the clipboard. The Mermaid export
  is what lets someone move their work into a repo, and it costs about forty lines.
- **Import** — paste Mermaid flowchart syntax and get a diagram. This is the empty state's
  best friend: someone arrives with a diagram already written in a README and gets it laid out
  in one paste.

**Layout**
- **Auto-arrange** — at least two: a hierarchical/flow layout (top-down or left-right) and a
  force/organic layout for mind maps. The Snap Call map shipped three modes (Flow, By band,
  Force) and the mode switch was the most-used control on it.
- Manual positions survive auto-arrange as an undoable step, not a destructive one.

**The page itself**
- **Search** across node and edge labels, highlighting matches on the canvas. On a map past
  about thirty nodes this stops being a nicety.
- **Empty state that is not empty**: load a small, genuinely interesting example diagram so a
  first-time visitor sees the thing working before they have drawn anything.
- Keyboard: Tab moves between nodes, Enter edits, arrows nudge, Delete removes. Every pointer
  action needs a keyboard path — this is an `AGENTS.md` accessibility basic, not a stretch.
- Touch: drag, pinch-zoom, and long-press for the node menu. Test on a real phone viewport.

### Should have — v1.1, in this order

- **Groups / containers** (swimlanes, boxes that hold nodes and move with them).
- **Minimap** for large diagrams.
- **PNG export** at 2× — server-side from the same SVG, so it matches exactly.
- **OG image** — a shared view link should unfurl in Slack/WhatsApp with the actual diagram
  as its preview card. The repo already has an `npm run og` habit; reuse it rather than
  inventing a second path.
- **Snap-to-grid and alignment guides.**
- **Version history** — the store already holds the document; keeping the last N revisions
  behind the edit token is cheap and turns "I broke my diagram" into a non-event.

### Explicitly not in scope

- Real-time multiplayer. It is a different product and it will eat the whole build.
- Accounts, folders, a dashboard of "my diagrams". The permalink *is* the filing system.
- Freehand drawing, sticky notes, images, an infinite whiteboard. This is a node-and-edge
  diagram tool. Excalidraw exists and is better at being Excalidraw.
- A template gallery. One good example diagram beats twelve stubs.

---

## Server half

- `POST /api/flowmap` — create. Returns `{ id, editToken }`.
- `PUT /api/flowmap/<id>` — update, requires the edit token.
- `GET /api/flowmap/<id>` — the document as JSON.
- `GET /api/flowmap/<id>.svg` — rendered, theme-aware, cacheable.
- `GET /api/flowmap/<id>.mmd` — Mermaid source. Cheap, and it makes the tool scriptable.

**This is a trust boundary, so read the security invariants section of `AGENTS.md` in full
before writing any of it, and add assertions to `scripts/security-smoke.mjs` in the same
commit** — that is standing rule 5 and the change is incomplete without it. At minimum:

- Every label is untrusted input and ends up inside an SVG that other sites embed. Escape on
  output; never interpolate raw. An SVG that executes script from a node label is a stored
  XSS with a `<img>`-shaped delivery mechanism.
- Cap document size, node count, and label length, and reject past them with a real status
  code rather than truncating silently.
- Rate-limit creates. An unauthenticated write endpoint is a free database otherwise.
- Ids must be unguessable — these diagrams are unlisted, not public, and a sequential id
  makes the whole store enumerable.
- The edit token goes in the URL fragment or a header, never a query string that lands in
  logs. Compare it in constant time.
- Set the right headers on the SVG route so it cannot be framed into something it isn't.

Storage: match whatever `webhook-inspector` and Type Trial's leaderboard already use. Do not
introduce a new datastore for this.

---

## Definition of done

- `npm run build`, `npm run security:smoke`, `npm run poker:check` all green. New smoke
  assertions for the new endpoints.
- Verified by **in-site navigation**, not a reload — the `astro:page-load` mounting bug only
  appears when the page is reached by clicking a link, and a hard reload hides it every time.
  Start the dev server through the preview tools and click through.
- Page weight measured and under budget; the number goes in the commit message.
- Light and dark both checked, including the server-rendered SVG.
- Real phone viewport checked for drag and pinch.
- A diagram created, saved, closed, reopened from the permalink, and embedded as an image in a
  scratch markdown file that actually renders.
- `AGENTS.md` updated in the same commit — architecture, config keys, commands.

## The one thing to get right

The demo that sells this is: **draw a five-node flow, hit save, paste the image URL into a
README, edit a label, watch the README picture change.** If that loop is smooth, the tool
clears the bar with room to spare. If the build starts drifting toward a prettier canvas with
more shapes and no server, it has become the thing `AGENTS.md:736` was written to prevent.

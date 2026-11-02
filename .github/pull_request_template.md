**What changed and why (one line):**

## Gate (all must pass, same as CI)

- [ ] `npm run build`
- [ ] `npm run check` reports 0 errors
- [ ] `npm run security:smoke`
- [ ] `npm run poker:check`
- [ ] `npm run boot:check` (after the build)

## Also

- [ ] Docs updated in the same change (AGENTS.md and `docs/`)
- [ ] `/terms` updated if something the site keeps changed
- [ ] Share cards regenerated (`npm run og`) if a title or description changed
- [ ] A new invariant has an assertion that I broke on purpose and saw fail

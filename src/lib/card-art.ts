/**
 * One literal SVG line drawing (viewBox 0 0 160 72) per tool, game and article
 * slug, with its hue. Read by components/CardArt.astro (hub cards, coloured by
 * shared.css) and by scripts/generate-og.mjs (share cards), so both draw the
 * same picture. Colour comes from CSS, never the markup: strokes are
 * currentColor (muted), `.a` strokes and `.d` dots take the item's hue, `.f`
 * fills tint it, `.c-<hue>` swatches a fixed one. No style attributes (CSP), no hex.
 */
export const CARD_ART: Record<string, { hue: string; svg: string }> = {
  'webhook-inspector': {
    hue: 'violet',
    svg: `<path d="M100 10V40a10 10 0 0 1-20 0v-6"/><path class="a" d="M16 22H66m-6-5 6 5-6 5M16 40H66m-6-5 6 5-6 5"/><circle class="d" cx="80" cy="33" r="2.5"/><path d="M92 10h16"/>`,
  },
  'chainsaw': {
    hue: 'amber',
    svg: `<rect x="22" y="28" width="30" height="16" rx="8"/><rect x="44" y="28" width="30" height="16" rx="8"/><rect class="a" x="66" y="28" width="30" height="16" rx="8" stroke-dasharray="3 4"/><rect x="88" y="28" width="30" height="16" rx="8"/><rect x="110" y="28" width="30" height="16" rx="8"/>`,
  },
  'dns-sightline': {
    hue: 'teal',
    svg: `<circle cx="24" cy="36" r="10"/><path class="a" d="M20.5 32.5a4 4 0 1 1 5.5 3.6q-2 1-2 3"/><circle class="d" cx="24" cy="43" r="1.2"/><path d="M34 36C70 36 78 14 108 14M34 36H108M34 36C70 36 78 58 108 58"/><rect class="a" x="110" y="8" width="26" height="12" rx="3"/><rect x="110" y="30" width="26" height="12" rx="3"/><rect x="110" y="52" width="26" height="12" rx="3"/>`,
  },
  'link-peek': {
    hue: 'rose',
    svg: `<rect x="30" y="8" width="100" height="56" rx="5"/><rect x="36" y="14" width="88" height="26" rx="3"/><path d="M40 36l14-12 10 8 10-6 20 10"/><circle class="d" cx="108" cy="23" r="3"/><path d="M38 49H96"/><path class="a" d="M38 57H74"/>`,
  },
  'token-bench': {
    hue: 'sky',
    svg: `<path d="M16 18H46M58 18H92"/><path class="a" d="M104 18H134"/><circle class="d" cx="52" cy="18" r="1.8"/><circle class="d" cx="98" cy="18" r="1.8"/><path d="M80 30l16 6v9c0 8-7 12-16 16-9-4-16-8-16-16v-9z"/><path class="a" d="M73 46l5 5 9-10"/>`,
  },
  'cron-whisperer': {
    hue: 'lime',
    svg: `<circle cx="52" cy="36" r="24"/><path d="M52 15v4M73 36h-4M52 57v-4M31 36h4"/><path class="a" d="M52 36V22M52 36l10 7"/><circle class="d" cx="52" cy="36" r="2"/><path d="M96 24H134M96 36H134M96 48H134"/><circle class="d" cx="104" cy="24" r="2.4"/><circle class="d" cx="120" cy="36" r="2.4"/><circle class="d" cx="112" cy="48" r="2.4"/>`,
  },
  'hash-smith': {
    hue: 'violet',
    svg: `<rect x="38" y="15" width="84" height="42" rx="3"/><path d="M38 29H122M38 43H122M52 15V57M66 15V57M80 15V57M94 15V57M108 15V57"/><rect class="f" x="52" y="15" width="14" height="14"/><rect class="f" x="94" y="29" width="14" height="14"/><rect class="f" x="66" y="43" width="14" height="14"/><rect class="f" x="108" y="43" width="14" height="14"/>`,
  },
  'flowmap': {
    hue: 'teal',
    svg: `<rect class="a" x="58" y="8" width="44" height="16" rx="4"/><rect x="18" y="48" width="44" height="16" rx="4"/><rect x="98" y="48" width="44" height="16" rx="4"/><path d="M80 24V36M40 36H120M40 36V48M120 36V48"/><circle class="d" cx="80" cy="36" r="2.4"/>`,
  },
  'draftboard': {
    hue: 'amber',
    svg: `<rect x="22" y="10" width="116" height="52" rx="5"/><path d="M80 10V62"/><path d="M32 22H62M32 32H68M32 42H54M32 52H64"/><path class="a" d="M92 22H122"/><path d="M92 34H128M92 44H112"/>`,
  },
  'driftfield': {
    hue: 'rose',
    svg: `<path d="M12 20C40 6 58 34 86 20S130 10 148 22"/><path class="a" d="M12 38C40 24 58 52 86 38S130 28 148 40"/><path d="M12 56C40 42 58 70 86 56S130 46 148 58"/><circle class="d" cx="48" cy="38" r="2.6"/><circle class="d" cx="116" cy="34" r="2.6"/>`,
  },
  'json-tidy': {
    hue: 'sky',
    svg: `<path d="M50 10q-10 0-10 10v8q0 8-8 8 8 0 8 8v8q0 10 10 10M110 10q10 0 10 10v8q0 8 8 8-8 0-8 8v8q0 10-10 10"/><path d="M64 22V50M64 22h8M64 36h22M64 50h14"/><path class="a" d="M76 22h20M90 36h12M82 50h18"/><circle class="d" cx="64" cy="22" r="2.4"/><circle class="d" cx="64" cy="36" r="2.4"/><circle class="d" cx="64" cy="50" r="2.4"/>`,
  },
  'regex-lab': {
    hue: 'lime',
    svg: `<path d="M46 14H34V58H46M114 14H126V58H114"/><circle cx="62" cy="40" r="1.8"/><path class="a" d="M82 28v14M75.9 31.5l12.2 7M88.1 31.5l-12.2 7"/><path d="M98 40h4"/><path class="a" d="M56 50H106"/>`,
  },
  'list-forge': {
    hue: 'violet',
    svg: `<path d="M20 18H46M20 30H46M20 42H46M20 54H46"/><path class="a" d="M58 36H80m-5-5 5 5-5 5"/><path d="M92 34h10M110 34h10M128 34h10"/><path class="a" d="M105 38l-1.5 5M123 38l-1.5 5"/>`,
  },
  'epoch-wizard': {
    hue: 'amber',
    svg: `<rect x="24" y="14" width="50" height="46" rx="4"/><path d="M24 27H74M38 9V19M60 9V19"/><circle class="d" cx="38" cy="40" r="2.4"/><circle class="d" cx="50" cy="40" r="2.4"/><circle class="a" cx="62" cy="40" r="4"/><circle class="d" cx="38" cy="51" r="2.4"/><path d="M88 36H138M96 30V42M110 30V42M124 30V42"/><circle class="d" cx="110" cy="36" r="3"/>`,
  },
  'codec-forge': {
    hue: 'teal',
    svg: `<path d="M44 20L26 36L44 52M116 20L134 36L116 52"/><path d="M56 29H104m-6-5 6 5-6 5"/><path class="a" d="M104 43H56m6-5-6 5 6 5"/>`,
  },
  'chroma-lab': {
    hue: 'rose',
    svg: `<rect class="c-violet" x="22" y="18" width="30" height="36" rx="5"/><rect class="c-rose" x="46" y="12" width="30" height="36" rx="5"/><rect class="c-amber" x="70" y="24" width="30" height="36" rx="5"/><rect class="c-teal" x="94" y="14" width="30" height="36" rx="5"/><path d="M28 64H132"/>`,
  },
  'deep-shore': {
    hue: 'sky',
    svg: `<path d="M98 36C90 20 68 16 58 26 50 34 50 38 58 46 68 56 90 52 98 36Z"/><circle cx="42" cy="36" r="10"/><circle cx="76" cy="14" r="5"/><circle cx="22" cy="36" r="4"/><path class="a" d="M98 36H136"/><circle class="d" cx="112" cy="36" r="2.4"/><circle class="d" cx="124" cy="36" r="1.8"/>`,
  },
  'poker-trainer': {
    hue: 'rose',
    svg: `<rect x="26" y="14" width="34" height="46" rx="4" transform="rotate(-10 43 37)"/><rect x="48" y="12" width="34" height="46" rx="4" transform="rotate(8 65 35)"/><path class="a" d="M67 29c-3-5-10 0-5 6l5 6 5-6c5-6-2-11-5-6z"/><ellipse cx="116" cy="54" rx="16" ry="6"/><ellipse class="a" cx="116" cy="46" rx="16" ry="6"/><path d="M100 46v8M132 46v8"/>`,
  },
  '2048': {
    hue: 'amber',
    svg: `<rect x="40" y="7" width="16" height="16" rx="3"/><rect x="61" y="7" width="16" height="16" rx="3"/><rect class="f" x="82" y="7" width="16" height="16" rx="3"/><rect x="103" y="7" width="16" height="16" rx="3"/><rect x="40" y="28" width="16" height="16" rx="3"/><rect class="f" x="61" y="28" width="16" height="16" rx="3"/><rect x="82" y="28" width="16" height="16" rx="3"/><rect x="103" y="28" width="16" height="16" rx="3"/><rect class="f" x="40" y="49" width="16" height="16" rx="3"/><rect x="61" y="49" width="16" height="16" rx="3"/><rect x="82" y="49" width="16" height="16" rx="3"/><rect class="f" x="103" y="49" width="16" height="16" rx="3"/>`,
  },
  'quintle': {
    hue: 'lime',
    svg: `<rect class="f" x="20" y="12" width="20" height="20" rx="3"/><rect x="45" y="12" width="20" height="20" rx="3"/><rect class="a" x="70" y="12" width="20" height="20" rx="3"/><rect x="95" y="12" width="20" height="20" rx="3"/><rect x="120" y="12" width="20" height="20" rx="3"/><text x="30" y="27" text-anchor="middle" font-size="13">B</text><text x="55" y="27" text-anchor="middle" font-size="13">Y</text><text x="80" y="27" text-anchor="middle" font-size="13">T</text><text x="105" y="27" text-anchor="middle" font-size="13">E</text><text x="130" y="27" text-anchor="middle" font-size="13">S</text><path d="M20 42H140M20 56H140" stroke-dasharray="3 5"/>`,
  },
  'maze-weaver': {
    hue: 'teal',
    svg: `<path d="M50 6H130V46M130 66H30V6"/><path d="M30 26H70M90 26H110M50 46H90M110 46H130M90 6V26M50 26V46M70 46V66M110 26V46"/><path class="a" d="M40 6V16H80V36H100V56H132"/><circle class="d" cx="40" cy="6" r="2.4"/>`,
  },
  'type-trial': {
    hue: 'violet',
    svg: `<path d="M22 14H66"/><path class="a" d="M72 8V20"/><rect x="22" y="26" width="16" height="12" rx="2"/><rect x="42" y="26" width="16" height="12" rx="2"/><rect class="f" x="62" y="26" width="16" height="12" rx="2"/><rect x="82" y="26" width="16" height="12" rx="2"/><rect x="102" y="26" width="16" height="12" rx="2"/><rect x="122" y="26" width="16" height="12" rx="2"/><rect x="32" y="42" width="16" height="12" rx="2"/><rect x="52" y="42" width="16" height="12" rx="2"/><rect x="72" y="42" width="16" height="12" rx="2"/><rect x="92" y="42" width="16" height="12" rx="2"/><rect x="112" y="42" width="16" height="12" rx="2"/><rect x="42" y="58" width="76" height="9" rx="2"/>`,
  },
  'hue-hunt': {
    hue: 'rose',
    svg: `<rect class="c-rose" x="20" y="12" width="60" height="48" rx="6"/><rect class="c-sky" x="92" y="12" width="26" height="20" rx="4"/><rect class="c-amber" x="120" y="12" width="26" height="20" rx="4"/><rect class="c-teal" x="92" y="40" width="26" height="20" rx="4"/><rect class="c-lime" x="120" y="40" width="26" height="20" rx="4"/>`,
  },
  'unable-to-get-local-issuer-certificate': {
    hue: 'amber',
    svg: `<rect x="14" y="22" width="36" height="28" rx="3"/><path d="M20 31H38M20 37H32"/><circle class="d" cx="42" cy="43" r="3"/><rect class="a" x="62" y="22" width="36" height="28" rx="3" stroke-dasharray="3 4"/><rect x="110" y="22" width="36" height="28" rx="3"/><path d="M116 31H134M116 37H128"/><circle class="d" cx="138" cy="43" r="3"/><path d="M50 36H62M98 36H110"/>`,
  },
  'how-the-internet-works': {
    hue: 'sky',
    svg: `<rect x="12" y="28" width="24" height="16" rx="2"/><path d="M8 48H40"/><path d="M36 36H52M68 36H78M94 36H112"/><circle class="a" cx="60" cy="36" r="6"/><circle class="a" cx="86" cy="36" r="6"/><path d="M36 30Q80 2 124 28"/><rect x="118" y="20" width="30" height="12" rx="2"/><rect x="118" y="38" width="30" height="12" rx="2"/><circle class="d" cx="126" cy="26" r="1.8"/><circle class="d" cx="126" cy="44" r="1.8"/>`,
  },
  'which-diagram-to-draw': {
    hue: 'teal',
    svg: `<rect x="12" y="28" width="32" height="16" rx="3"/><path class="a" d="M80 20L100 36L80 52L60 36Z"/><rect x="116" y="28" width="32" height="16" rx="3"/><path d="M44 36H60m-5-4 5 4-5 4M100 36H116m-5-4 5 4-5 4M80 52V62"/><circle class="d" cx="80" cy="64" r="2.4"/>`,
  },
}

// Neutral mark for a slug with no drawing: shown rather than failing a page.
export const CARD_ART_FALLBACK = {
  hue: 'violet',
  svg: `<circle cx="80" cy="36" r="20"/><rect x="66" y="22" width="28" height="28" rx="3" transform="rotate(45 80 36)"/><path d="M28 36H58M102 36H132"/><circle class="d" cx="80" cy="36" r="3"/>`,
}

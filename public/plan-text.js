// Turns a plain-English paragraph into click-plan steps for the recorder, e.g.
//   "Scroll to the pricing section, click Yearly, then hover over the Pro plan and click Get started.
//    After that open the About page, scroll to the bottom and go back."
// →  scroll to pricing · click Yearly · hover Pro plan · click Get started · click About · scroll page · back
// Lines already written as steps ("click Pricing") pass straight through. Works offline: simple rules, no AI service.

const VERB = '(?:click|tap|press|select|choose|pick|switch|toggle|open|go|visit|navigate|head|hover|point|move|scroll|wait|pause|stay|hold|return|come)';
const ORD = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, last: 0 };
const NOUNS = /\s+(?:button|btn|link|tab|tabs|menu|menu item|item|toggle|switch|option|icon|card|page|section|area|part|block|cta|pill|chip|dropdown|field|image|logo|text|heading|title)$/i;

// pull out the thing to act on: quoted text wins, then the words after the verb (minus "the", "button", …)
function target(rest) {
  const q = rest.match(/["“”'‘’]([^"“”'‘’]{1,80})["“”'‘’]/);
  let t = q ? q[1] : rest.replace(/[\s,.!?:;]+$/, '').replace(/\s+(?:and|then|and then)$/i, '');
  let nth = 1;
  if (!q) {
    t = t.replace(/^\s*(?:on|onto|at|over|to|into)\s+/i, '').replace(/^\s*(?:the|a|an|that|this|our|its)\s+/i, '');
    const o = t.match(/^(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+(?:one\s+)?/i);
    if (o) { nth = ORD[o[1].toLowerCase()]; t = t.slice(o[0].length); }
    t = t.replace(/\s+(?:on|in|at|from|of)\s+(?:the\s+)?(?:page|top|header|nav|navbar|navigation|menu|footer|screen|hero)(?:\s+.*)?$/i, '')
      .replace(/\s+(?:once|again|twice|quickly|slowly|for a (?:moment|second|bit))$/i, '')
      .replace(/^(?:the|a|an)\s+/i, '');
    for (let k = 0; k < 2; k++) t = t.replace(NOUNS, '');
  }
  t = t.replace(/[.,!?:;]+$/, '').trim();
  return { t, nth };
}
const withNth = (t, nth) => (nth > 1 ? `${t} (${nth})` : t);

function clause(raw) {
  const c = raw.trim().replace(/^(?:and|then|next|now|finally|after that|afterwards|first|lastly|also|please)[,\s]+/i, '').replace(/^(?:and|then)[,\s]+/i, '').trim();
  if (!c) return null;
  const l = c.toLowerCase();
  // already a step line
  if (/^(click|tap|press|hover|point|go|open|visit|back|scroll|wait|pause)\b/i.test(c) && !/\b(the|on|over|to)\b/i.test(c.split(/\s+/).slice(1, 2).join(' ')) && /^(back|scroll( up| top| page| \d+)?|wait \d+(\.\d+)?)$/i.test(c)) return c;
  let m;
  // wait
  if ((m = l.match(/\b(?:wait|pause|stay|hold|stop)\b[^\d]*?(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/))) return `wait ${m[1]}`;
  if (/\b(?:wait|pause|stay|hold on|stop)\b.*\b(?:moment|bit|second|while)\b/.test(l) || /^(?:wait|pause)$/.test(l)) return 'wait 1.5';
  // back
  if (/\b(?:go|come|navigate|head|return)\s+back\b|\bback to (?:the )?previous\b|\bprevious page\b|^back$|\bpress back\b|\bhit back\b/.test(l)) return 'back';
  // scroll
  if (/\bscroll/.test(l)) {
    if (/\b(?:to|until)\s+(?:the\s+)?(?:very\s+)?(?:bottom|end|footer)\b|\ball the way( down)?\b|\bthrough the (?:whole|entire|full)? ?page\b|\bwhole page\b|\bentire page\b/.test(l)) return 'scroll page';
    if (/\b(?:to|back to)\s+(?:the\s+)?top\b|\bup to the top\b/.test(l)) return 'scroll top';
    if ((m = l.match(/\b(\d{2,5})\s*(?:px|pixels?)?\b/))) return `scroll ${/\bup\b/.test(l) ? '-' : ''}${m[1]}`;
    if ((m = c.match(/\bscroll(?:\s+(?:down|up))?\s+(?:to|until|till)\s+(?:you see\s+|reach\s+)?(.+)$/i))) { const { t, nth } = target(m[1]); if (t) return `scroll to ${withNth(t, nth)}`; }
    return /\bup\b/.test(l) ? 'scroll up' : 'scroll';
  }
  // open a link / path
  if ((m = c.match(/\b(?:go|navigate|head)\s+to\s+(https?:\/\/\S+|\/[\w\-./?=&#%]*|[\w-]+\.[a-z]{2,}(?:\/\S*)?)/i)) || (m = c.match(/\b(?:open|visit|load)\s+(https?:\/\/\S+|\/[\w\-./?=&#%]*|[\w-]+\.[a-z]{2,}(?:\/\S*)?)/i))) return `go ${m[1].replace(/[.,!?;]+$/, '')}`;
  // hover
  if ((m = c.match(/\b(?:hover(?:\s+(?:over|on))?|move\s+(?:the\s+)?(?:mouse|cursor|pointer)\s+(?:over|onto|to|on)|point\s+(?:at|to)|mouse\s+over)\s+(.+)$/i))) { const { t, nth } = target(m[1]); if (t) return `hover ${withNth(t, nth)}`; }
  // click (also "open the About page", "go to Pricing", "switch to Yearly")
  if ((m = c.match(/\b(?:click(?:\s+on)?|tap(?:\s+on)?|press|select|choose|pick|toggle|switch\s+to|open(?:\s+up)?|go\s+to|visit|navigate\s+to|head\s+to)\s+(.+)$/i))) {
    const { t, nth } = target(m[1]); if (t) return `click ${withNth(t, nth)}`;
  }
  return { unknown: c };
}

export function planFromText(text) {
  const steps = [], unknown = [];
  const src = String(text || '').replace(/\r/g, '');
  for (const line of src.split('\n')) {
    if (!line.trim() || /^\s*(#|\/\/)/.test(line)) continue;
    // split a paragraph into actions: sentences, "then", ";", "→", and "and" / "," when another action follows
    const parts = line
      .replace(/(\d)\.(\d)/g, '$1․$2')                                   // keep decimals ("wait 1.5") together
      .split(/(?<=[.!?;])\s+|→|->|;|\bthen\b|\bafter that\b|\bafterwards\b|\bnext\b,?/i)
      .flatMap((p) => p.split(new RegExp(`\\s*(?:,\\s*(?:and\\s+)?|\\s+and\\s+)(?=(?:then\\s+)?${VERB}\\b)`, 'i')));
    for (let p of parts) {
      p = p.replace(/․/g, '.').replace(/^[\s,.]+|[\s,]+$/g, '').replace(/\s+(?:and|and then)$/i, '').replace(/^\s*(\d+[.)]|[-*•])\s*/, '');
      if (!p) continue;
      const r = clause(p);
      if (!r) continue;
      if (typeof r === 'string') steps.push(r); else unknown.push(r.unknown);
    }
  }
  return { steps, unknown };
}

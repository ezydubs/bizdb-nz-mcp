// Scrubbing for the recorded company pages (scripts/record-fixtures.mjs).
// - People's names (directors, officers and shareholders who are people) become "Person N" everywhere on the page, in
//   any letter case, and a name with middle names also as its first and last word ("Jane Doe" for "Jane Mary Doe").
//   Shareholders that are neither people nor entities become "Holder N".
// - A person's address in the directors panel is cut to its locality, as the site already shows most New Zealand ones:
//   the street, the building or unit, and any name in brackets go ("(jane doe) Level 9, 1 Example Street, Melbourne,
//   Vic, 3000 Australia" becomes "Melbourne, Vic, 3000 Australia").
// - E-mail addresses become userN@example.com and phone numbers 64 9 555 01NN.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const htmlEsc = (s) => s.replace(/&/g, "&amp;").replace(/'/g, "&#039;").replace(/"/g, "&quot;");

/** Names of people on a company page: directors and officers, and shareholders that are not entities. */
export function names(html) {
  const persons = new Set();
  const others = new Set();
  for (const m of html.matchAll(/<span class="(?:glyphicon glyphicon-edit|fa fa-ban)"[^>]*><\/span>\s*([^<]*?)\s+-\s*\n?\s*[A-Za-z ]+?(?:\s*<small>|\s*<\/p>)/g)) {
    const n = m[1].replace(/\s+/g, " ").trim();
    if (n && !/^(Basic Financial info|Previous Shareholders|Ultimate Holding Company|Previous addresses|Other active addresses|Current address)$/i.test(n)) persons.add(n);
  }
  for (const m of html.matchAll(/<td>\s*<i class="fa fa-[a-z-]+" aria-hidden="true"><\/i>\s*([A-Za-z]+)[^<]*<\/td>\s*<td>([^<]+?)\s*(?:<br|<\/td>)/g)) {
    const kind = m[1].toLowerCase();
    const n = m[2].replace(/\s+/g, " ").trim();
    if (kind !== "entity" && n) (kind === "individual" || kind === "director" ? persons : others).add(n);
  }
  return { persons: [...persons], others: [...others] };
}

const STREET =
  /\b\d+[A-Za-z]?(?:\s*-\s*\d+[A-Za-z]?)?\s+(?:[A-Za-z'.-]+\s+){0,3}(?:St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Pl|Place|Lane|Ln|Tce|Terrace|Cres|Crescent|Way|Quay|View|Ct|Court|Close|Grove|Pde|Parade|Hwy|Highway|Blvd|Boulevard|Square|Sq|Rise|Row|Esplanade|Mews|Walk|Loop|Circle|Green|Gardens|Promenade|Strand|Track|Heights|Hill|Glen|Crest|Link|Mall|Path)\b/i;
const UNIT = /^\s*(?:(?:level|suite|unit|flat|apartment|apt|floor)\s*\d|(?:po box|p\.?\s*o\.?\s*box|private bag)\b)/i;

/** An address without its street, building or unit, or any bracketed name: what is left after the last street part. */
export function localityOnly(address) {
  const parts = address.replace(/\([^)]*\)\s*/g, "").split(",");
  let last = -1;
  parts.forEach((p, i) => {
    if (STREET.test(p) || UNIT.test(p)) last = i;
  });
  return parts.slice(last + 1).join(",").replace(/^[\s,]+/, "");
}

/** The page with every address in its directors panel cut to its locality. */
export function peopleAddresses(html) {
  return html.replace(/(id="roles"[^>]*>)([\s\S]*?)(?=<div id="roles_chart"|<div class="col-sm-12" id=|$)/g, (_, open, panel) =>
    open + panel.replace(/(<i class="fa fa-map-marker" aria-hidden="true"><\/i> Address: )([^<]*)/g, (_, label, address) => label + localityOnly(address)),
  );
}

/** A scrubbed company page; `n` counts across pages, so each person keeps one number in the whole set. */
export function scrub(html, n = { people: 0, holders: 0, emails: 0, phones: 0 }) {
  let out = peopleAddresses(html);
  const { persons, others } = names(out);
  const byLength = (a, b) => b.length - a.length;
  const swaps = [...persons.sort(byLength).map((p) => [p, `Person ${++n.people}`, true]), ...others.sort(byLength).map((h) => [h, `Holder ${++n.holders}`, false])];
  const word = (v, flags) => new RegExp(`(?<![A-Za-z])${esc(v)}(?![A-Za-z])`, flags);
  const swap = (from, to) => {
    for (const v of new Set([from, htmlEsc(from), from.replace(/'/g, "\\'")])) out = out.replace(word(v, "gi"), to);
  };
  for (const [from, to] of swaps) swap(from, to);
  const full = new Set(swaps.map(([from]) => from.toLowerCase()));
  const short = [];
  for (const [from, to, person] of swaps) {
    const w = from.split(" ");
    const fl = `${w[0]} ${w.at(-1)}`;
    if (person && w.length >= 3 && !full.has(fl.toLowerCase())) short.push(fl), swap(fl, to);
  }
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (e) => (/@bizdb\.co\.nz$/i.test(e) ? e : `user${++n.emails}@example.com`));
  out = out.replace(/(<i class="fa fa-phone" aria-hidden="true"><\/i>\s*)([^<]+)/g, (_, i) => `${i}64 9 555 01${String(++n.phones).padStart(2, "0")}`);
  for (const name of [...swaps.map(([from]) => from), ...short]) if (word(name, "i").test(out)) throw new Error(`"${name}" is still on the page after scrubbing`);
  return out;
}

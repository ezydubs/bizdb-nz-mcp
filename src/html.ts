/** Small helpers for the site's own pages: entities, text, balanced blocks, attributes and links. */

/** HTML's Latin-1 entities, &nbsp; (160) to &yuml; (255) in order: names are case-sensitive (&Eacute; is É, &eacute; é). */
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil " +
  "sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute " +
  "Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc " +
  "atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide " +
  "oslash ugrave uacute ucirc uuml yacute thorn yuml";
const ENTITIES: Record<string, string> = Object.fromEntries(LATIN1.split(" ").map((n, i) => [n, String.fromCharCode(160 + i)]));
Object.assign(ENTITIES, {
  shy: "", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", sbquo: "‚", bdquo: "„",
  ndash: "–", mdash: "—", hellip: "…", trade: "™", bull: "•", euro: "€", minus: "−", ensp: " ", emsp: " ", thinsp: " ", zwnj: "", zwj: "",
  lrm: "", rlm: "", larr: "←", rarr: "→",
  amacr: "ā", emacr: "ē", imacr: "ī", omacr: "ō", umacr: "ū", Amacr: "Ā", Emacr: "Ē", Imacr: "Ī", Omacr: "Ō", Umacr: "Ū",
});
/** Entities browsers also take in capitals (&AMP;). */
const CASELESS = new Set(["amp", "lt", "gt", "quot", "nbsp", "apos", "copy", "reg"]);
/** &#128; to &#159; as browsers read them: Windows-1252's characters (&#146; is ’), not control codes. */
const CP1252: Record<number, number> = {
  128: 0x20ac, 130: 0x201a, 131: 0x0192, 132: 0x201e, 133: 0x2026, 134: 0x2020, 135: 0x2021, 136: 0x02c6, 137: 0x2030, 138: 0x0160,
  139: 0x2039, 140: 0x0152, 142: 0x017d, 145: 0x2018, 146: 0x2019, 147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014,
  152: 0x02dc, 153: 0x2122, 154: 0x0161, 155: 0x203a, 156: 0x0153, 158: 0x017e, 159: 0x0178,
};
const safeChar = (n: number): string => {
  const cp = CP1252[n] ?? n;
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0x80 && cp <= 0x9f)) return "";
  return String.fromCodePoint(cp);
};
export function decode(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, n) => ENTITIES[n] ?? (CASELESS.has(n.toLowerCase()) ? ENTITIES[n.toLowerCase()] : m));
}

/** Visible text with its lines kept: <br> and block ends become line breaks, table cells tabs; scripts and styles are dropped. */
export function text(html: string | null | undefined): string {
  if (!html) return "";
  const t = html
    .replace(/<(script|style|noscript|svg|template|ins)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|tr|section|table|ul|ol|dd|dt|blockquote|caption)\s*>/gi, "\n")
    .replace(/<(p|div|h[1-6]|section|table|ul|ol|blockquote|caption)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/t[dh]\s*>/gi, "\t")
    .replace(/<[^>]+>/g, "");
  return decode(t)
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, (m) => (m.includes("\t") ? "\t" : " ")).replace(/^[ \t]+|[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** Text on one line. */
export const line = (html: string | null | undefined): string => text(html).replace(/\s+/g, " ").trim();
/** The lines of an HTML fragment broken at <br>: each line's text, empty lines dropped. */
export const brLines = (html: string | null | undefined): string[] =>
  String(html ?? "")
    .split(/<\s*br\s*\/?>/i)
    .map((l) => line(l))
    .filter(Boolean);

/** Every balanced element whose opening tag matches `open` (nesting of the same tag name is counted), as outer HTML. */
export function blocks(html: string, open: RegExp, tag = "div"): string[] {
  const out: string[] = [];
  const re = new RegExp(open.source, open.flags.includes("g") ? open.flags : `${open.flags}g`);
  const tags = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    tags.lastIndex = m.index;
    let depth = 0;
    let end = -1;
    let t: RegExpExecArray | null;
    while ((t = tags.exec(html))) {
      if (t[0].startsWith("</")) {
        if (--depth === 0) {
          end = t.index + t[0].length;
          break;
        }
      } else if (!/\/\s*>$/.test(t[0])) depth++;
    }
    if (end < 0) {
      out.push(html.slice(m.index));
      break;
    }
    out.push(html.slice(m.index, end));
    re.lastIndex = end;
  }
  return out;
}
/** The inner HTML of a balanced element (outer HTML in, the part between its tags out). */
export function innerOf(outer: string, tag = "div"): string {
  return outer.slice(outer.indexOf(">") + 1).replace(new RegExp(`</${tag}\\s*>$`, "i"), "");
}

export const attr = (tag: string, name: string): string =>
  decode(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1] ?? new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag)?.[1] ?? "");

export interface Anchor {
  href: string;
  text: string;
  /** the opening tag's attributes */
  tag: string;
}
export function anchors(html: string): Anchor[] {
  const out: Anchor[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push({ href: attr(m[1], "href"), text: line(m[2]), tag: m[1] });
  return out;
}

/** The cells of each <tr> in a table's HTML, as inner HTML; rows of header cells only are left out unless asked for. */
export function rows(tableHtml: string, withHeaders = false): string[][] {
  const out: string[][] = [];
  for (const tr of blocks(tableHtml, /<tr\b[^>]*>/i, "tr")) {
    const cells = [...tr.matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1\s*>/gi)];
    if (!cells.length) continue;
    if (!withHeaders && cells.every((c) => c[1].toLowerCase() === "h")) continue;
    out.push(cells.map((c) => c[2]));
  }
  return out;
}

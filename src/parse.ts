/**
 * Readers for the site's pages (NATIVE-NOTES.md, sections 3 to 7): the search's result fragment, the A-Z index, the home
 * page's newest companies, and a company's profile with every section the site shows. Each is a pure function of the HTML.
 */
import { anchors, blocks, brLines, decode, innerOf, line, rows } from "./html.js";
import { isoFromParts, isoFromText, squash, todayNz } from "./format.js";
import { canonicalType, companyUrl, nzbnOf } from "./site.js";

// ---------------------------------------------------------------- shared pieces

/** One "value / label" box of the site's layout (`<div class="… info-element">value<br><span class="info-desc">label</span></div>`). */
export interface InfoBox {
  /** the value's text on one line */
  value: string;
  /** the value's lines (split at <br>), with the country after a globe icon kept as the last line */
  lines: string[];
  /** the text after a globe icon (a country), or "" */
  country: string;
  /** the last info-desc text: the label */
  label: string;
  /** every info-desc text, in order (contact details carry a date before the label) */
  descs: string[];
  /** the value's Font Awesome icon (phone, at, globe, …), or "" */
  icon: string;
}
export function infoBoxes(html: string): InfoBox[] {
  return blocks(html, /<div class="[^"]*\binfo-element\b[^"]*">/i).map((outer) => {
    const body = innerOf(outer);
    const firstDesc = body.search(/<span class="info-desc"/i);
    const valueHtml = firstDesc >= 0 ? body.slice(0, firstDesc) : body;
    const descs = blocks(body, /<span class="info-desc">/i, "span").map((s) => line(innerOf(s, "span")));
    const icon = /<i class="fa fa-([a-z-]+)/i.exec(valueHtml)?.[1] ?? "";
    const globe = valueHtml.search(/<i class="fa fa-globe"/i);
    const country = globe >= 0 && icon !== "globe" ? line(valueHtml.slice(globe)) : "";
    const lines = brLines(globe >= 0 && icon !== "globe" ? valueHtml.slice(0, globe) : valueHtml);
    return { value: line(valueHtml), lines: country ? [...lines, country] : lines, country, label: descs[descs.length - 1] ?? "", descs, icon };
  });
}

/** A section's block by the id the site gives it (general, addresses, contactinfo, finances, roles), or "". */
function section(html: string, id: string): string {
  return blocks(html, new RegExp(`<div class="[^"]*" id="${id}">`, "i"))[0] ?? "";
}
/** A side panel by its heading text ("Nearby companies", "Charity information"), or "". */
function panel(html: string, heading: RegExp): string {
  for (const p of blocks(html, /<div class="panel">/i)) {
    const h = /<div class="panel-heading">([\s\S]*?)<\/div>/i.exec(p);
    if (h && heading.test(line(h[1]))) return p;
  }
  return "";
}
const dateIn = (s: string): string | null => isoFromText(s) || null;
const num = (s: string | null | undefined): number | null => {
  const t = String(s ?? "").replace(/[,\s$]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
/** "Physical & service & registered" -> ["physical", "service", "registered"]; "Other (Address For Share Register)" -> "other". */
const kinds = (s: string): string[] => [
  ...new Set(
    s
      .split(/\s*&\s*/)
      .map((k) => k.replace(/\([^)]*\)/g, "").trim().toLowerCase())
      .filter(Boolean),
  ),
];
/** The note in brackets in an address's kind ("Other (Address For Share Register)"), or null. */
const kindNote = (s: string): string | null => /\(([^)]+)\)/.exec(s)?.[1]?.trim() ?? null;
/** "Physical & service address used since 02 May 2016", "… address (Address For Share Register) used from … to …". */
const USED = /^(.*?)\s+address\s*(?:\(([^)]*)\))?\s+used\s+(since|from)\b/i;
/** "Person Authorised For Service" / "officer" -> "Person authorised for service" / "Officer". */
const sentence = (s: string): string => {
  const t = squash(s).toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
};
const snake = (s: string): string =>
  squash(s)
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export interface CompanyRef {
  nzbn: string;
  name: string;
}

// ---------------------------------------------------------------- the search's result fragment

export interface Hit {
  nzbn: string;
  name: string;
  type: string | null;
  status: string | null;
  post_code: string | null;
  /** the industry classification descriptions ("IC description"), when the site shows them */
  industries: string[];
  url: string;
  /** any other "Label: value" the site added to a result */
  other?: Record<string, string>;
}
export interface ResultsPage {
  hits: Hit[];
  /** the page number the "Next page" link asks for, or null on the last page */
  next: number | null;
  previous: number | null;
  /** the rows per page the site applied (it answers anything but 10, 20 or 50 with 10); null when the answer has no selects */
  pageSize: number | null;
  /** the sort field the site applied (it never marks the sort direction, so that is not read back) */
  sort: string | null;
  /** "No records found" */
  none: boolean;
}

/** The option a select marks selected, or null when none is marked (the site never marks the sort direction). */
function selected(html: string, id: string): string | null {
  const sel = new RegExp(`<select\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</select>`, "i").exec(html)?.[1];
  if (!sel) return null;
  return /<option\b[^>]*value="([^"]*)"[^>]*\bselected\b/i.exec(sel)?.[1] ?? null;
}

export function parseResults(html: string): ResultsPage {
  const hits: Hit[] = [];
  for (const b of blocks(html, /<div class="listing-body">/i)) {
    const a = /<a\b[^>]*href="(\/company\/\d{13}\/?)"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
    if (!a) continue;
    const fields: Record<string, string> = {};
    for (const m of b.matchAll(/<b>([^<]+?):\s*<\/b>([\s\S]*?)<\/div>/gi)) fields[squash(decode(m[1]))] = line(m[2]);
    const nzbn = nzbnOf(a[1]) || fields.NZBN || "";
    const { NZBN: _n, "Post Code": pc, Status: st, Type: ty, "IC description": ic, ...rest } = fields;
    const hit: Hit = {
      nzbn,
      name: line(a[2]),
      type: ty ? canonicalType(ty) : null,
      status: st || null,
      post_code: pc || null,
      industries: ic ? ic.split(/\s*;\s*/).filter(Boolean) : [],
      url: companyUrl(nzbn),
    };
    if (Object.keys(rest).length) hit.other = rest;
    hits.push(hit);
  }
  let next: number | null = null;
  let previous: number | null = null;
  for (const m of html.matchAll(/<li\b([^>]*\bchange-page\b[^>]*)>/gi)) {
    const id = Number(/\bid="(\d+)"/i.exec(m[1])?.[1]);
    if (!Number.isInteger(id)) continue;
    if (/\bnext\b/i.test(m[1])) next = id;
    else if (/\bprevious\b/i.test(m[1])) previous = id;
  }
  const size = Number(selected(html, "branch_row_count"));
  return {
    hits,
    next,
    previous,
    pageSize: Number.isInteger(size) && size > 0 ? size : null,
    sort: selected(html, "branch_sort_field"),
    none: !hits.length && /No records found/i.test(html),
  };
}

// ---------------------------------------------------------------- the A-Z index

export interface IndexGroup {
  /** the name prefix ("F", "FO", "F ", "F-") */
  prefix: string;
  /** whether the site links this prefix to its page; an unlinked prefix (F9, FQ) still has a page when asked for */
  linked: boolean;
  /** from and to are the same company: the prefix holds one name */
  single: boolean;
  from: CompanyRef | null;
  to: CompanyRef | null;
}
export interface IndexCompany {
  nzbn: string;
  name: string;
  type: string | null;
  address: string | null;
  /** which address the site shows ("Registered Address", "Service Address", …) */
  address_kind: string | null;
  post_code: string | null;
}
export interface IndexPage {
  heading: string;
  /** the prefix the page says it shows ("New Zealand Companies by name: AJ " is "AJ "), spaces kept; null on the top page */
  shown: string | null;
  groups: IndexGroup[];
  companies: IndexCompany[];
}

const refOf = (cellHtml: string): CompanyRef | null => {
  const a = anchors(cellHtml).find((x) => nzbnOf(x.href));
  return a ? { nzbn: nzbnOf(a.href), name: a.text } : null;
};

export function parseIndex(html: string): IndexPage {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "";
  const heading = line(h1);
  const by = /New Zealand Companies by name:\s?([\s\S]*)$/i.exec(decode(h1.replace(/<[^>]+>/g, "")));
  const shown = by ? by[1].replace(/\s+/g, " ") : null;
  const groups: IndexGroup[] = [];
  for (const table of blocks(html, /<table\b[^>]*>/i, "table")) {
    if (!/<th\b[^>]*>\s*Index\s*<\/th>/i.test(table)) continue;
    for (const cells of rows(table)) {
      if (cells.length < 3) continue;
      const link = /<a\b[^>]*href="\/index\/([^"]*?)\/?"[^>]*>/i.exec(cells[0]);
      let prefix: string;
      if (link) {
        try {
          prefix = decodeURIComponent(decode(link[1]));
        } catch {
          prefix = decode(link[1]);
        }
      } else {
        // an unlinked cell is the bare prefix, its trailing space kept ("FO " is names like "FO DA (NZ) LIMITED")
        prefix = decode(cells[0].replace(/<[^>]+>/g, "")).replace(/^[\r\n\t]+|[\r\n\t]+$/g, "");
      }
      if (!prefix.trim() && !link) continue;
      const from = refOf(cells[1]);
      const to = refOf(cells[2]);
      groups.push({ prefix, linked: !!link, single: !!from && !!to && from.nzbn === to.nzbn, from, to });
    }
  }
  const companies: IndexCompany[] = [];
  const listing = blocks(html, /<div class="[^"]*" id="companylisting">/i)[0] ?? "";
  for (const p of blocks(listing, /<div class="panel-body">/i)) {
    const a = /<p>\s*<a\b[^>]*href="(\/company\/\d{13}\/?)"[^>]*>([\s\S]*?)<\/a>\s*(?:<br\s*\/?>)?\s*(?:<span class="info-desc">([\s\S]*?)<\/span>)?/i.exec(p);
    if (!a) continue;
    const c: IndexCompany = { nzbn: nzbnOf(a[1]), name: line(a[2]), type: a[3] ? canonicalType(line(a[3])) : null, address: null, address_kind: null, post_code: null };
    for (const box of infoBoxes(p)) {
      if (/^NZBN$/i.test(box.label)) c.nzbn ||= box.value;
      else if (/post\s*code/i.test(box.label)) c.post_code = box.value || null;
      else if (/address/i.test(box.label)) {
        c.address = box.value || null;
        c.address_kind = box.label || null;
      }
    }
    companies.push(c);
  }
  return { heading, shown, groups, companies };
}

// ---------------------------------------------------------------- the home page's newest companies

export interface Latest {
  nzbn: string;
  name: string;
  industry: string | null;
  url: string;
}
export function parseLatest(html: string): Latest[] {
  return blocks(html, /<div class="[^"]*\blatest-box-element\b[^"]*">/i)
    .map((b) => {
      const a = /<a\b[^>]*href="(\/company\/\d{13}\/?)"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
      if (!a) return null;
      const desc = /<span class="info-desc">([\s\S]*?)<\/span>/i.exec(b)?.[1];
      const nzbn = nzbnOf(a[1]);
      return { nzbn, name: line(a[2]), industry: desc ? line(desc) || null : null, url: companyUrl(nzbn) };
    })
    .filter((x): x is Latest => x !== null);
}

// ---------------------------------------------------------------- a company's profile

export interface Address {
  /** physical, service, registered, postal, office, delivery, invoice, shareregister, other, … */
  kinds: string[];
  /** what an "other" address is for ("Address For Share Register"), when the register says */
  note?: string;
  address: string;
  lines?: string[];
  country?: string | null;
  from: string | null;
  to: string | null;
}
export interface Holder {
  /** entity, individual, director or other: the first word of holder_type, in lower case */
  kind: string;
  /** the site's wording: "Entity (NZ Limited Company)", "Individual", "Other (Other)" */
  holder_type: string;
  name: string;
  nzbn: string | null;
  company_number: string | null;
  address: string | null;
  from: string | null;
  to: string | null;
}
export interface Allocation {
  number: number;
  shares: number | null;
  /** of the company's total shares, when the site gives the total */
  percent: number | null;
  holders: Holder[];
}
export interface Role {
  /** "" when the site gives the role without a name */
  name: string;
  role: string;
  /** false when the site marks the role inactive, or it has a termination date that has passed */
  active: boolean;
  appointed: string | null;
  terminated: string | null;
  /** the newest address the site gives (suburb level) */
  address: string | null;
  address_since: string | null;
  /** every address the site gives for the person in this role, newest first */
  addresses: { address: string; from: string | null; to: string | null }[];
}
export interface TimelineRow extends Address {
  /** still in use: the row runs to the day the page was made */
  current: boolean;
  /** an old register entry with no dates (the chart draws it from 1 Jan 1970 to today); not counted as current */
  legacy?: boolean;
}
export interface Contact {
  /** phone, email, website, fax or the icon's name */
  kind: string;
  value: string;
  /** the purpose the register gives it (Phone, primary, invoice email address, …) */
  label: string | null;
  since: string | null;
}
export interface Nearby extends CompanyRef {
  address: string | null;
  url: string;
  lat?: number;
  lng?: number;
}
export interface Company {
  nzbn: string;
  /** the registered name, in capitals as the register writes it (the page heading's title case when the page has no map) */
  name: string;
  /** the page heading, in the site's title case */
  heading: string;
  type: string | null;
  /** the register's code for the type (Ltd, ULtd, Coop, T, I, Y, …) */
  type_code: string | null;
  status: string | null;
  company_number: string | null;
  registered: string | null;
  /** "54 years on market", as the site counts it */
  years: number | null;
  last_updated: string | null;
  gst_numbers: string[];
  industries: { code: string | null; description: string | null }[];
  /** Immigration NZ's accredited-employer list, as the site read it */
  accredited_employer: { text: string; until: string | null; listed_as: string | null; checked: string | null } | null;
  /** other identifiers and facts in the heading boxes (Australian Business Number, …), by label */
  identifiers: Record<string, string>;
  current_addresses: Address[];
  names: { name: string; from: string | null; to: string | null }[];
  statuses: { status: string; comment: string | null; from: string | null; to: string | null }[];
  /** the site's prose summary */
  description: string | null;
  addresses: {
    previous: Address[];
    /** listed under "Other active addresses" */
    other_active: Address[];
    /** listed under "Principal place of activity" (no dates) */
    principal_place: Address[];
    /** the address timeline chart: every address with its dates; current = still in use (to is then null) */
    timeline: TimelineRow[];
  };
  contact: Contact[];
  financial: {
    total_shares: number | null;
    annual_return_month: string | null;
    financial_report_month: string | null;
    annual_return_last_filed: string | null;
    country_of_origin: string | null;
    other: Record<string, string>;
  } | null;
  allocations: Allocation[];
  previous_shareholders: Holder[];
  ultimate_holding_company: {
    name: string | null;
    /** the register's type code (Ltd, Coop, …) */
    type: string | null;
    number: string | null;
    nzbn: string | null;
    country: string | null;
    address: string | null;
    effective_date: string | null;
    other: Record<string, string>;
  } | null;
  /** the people panel's heading ("Directors") */
  roles_heading: string | null;
  roles: Role[];
  charity: {
    fields: Record<string, string>;
    registration_number: string | null;
    status: string | null;
    registered: string | null;
    annual_returns: Record<string, string | number | null>[];
    source: string | null;
  } | null;
  location: { lat: number; lng: number; osm: string } | null;
  nearby: Nearby[];
  similar: Nearby[];
  url: string;
}

/** Kinds, note and dates from "Physical & service address used since 02 May 2016" (or "… used from … to …"). */
function usedFor(desc: string): Pick<Address, "kinds" | "note" | "from" | "to"> {
  const m = USED.exec(desc);
  const dates = [...desc.matchAll(/\b\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}\b/g)].map((x) => isoFromText(x[0]));
  const note = m ? (m[2]?.trim() || kindNote(m[1])) : null;
  return {
    kinds: m ? kinds(m[1]) : [],
    ...(note ? { note } : {}),
    from: dates[0] ?? null,
    to: m && m[3].toLowerCase() === "from" ? (dates[1] ?? null) : null,
  };
}

/** An address box: the lines of the address over "Physical & service & registered address used since 02 May 2016". */
function addressBox(box: InfoBox): Address {
  const lines = box.country ? box.lines.slice(0, -1) : box.lines;
  const used = usedFor(box.descs.join(" "));
  return { kinds: used.kinds, ...(used.note ? { note: used.note } : {}), address: [...lines, box.country].filter(Boolean).join(", "), lines, country: box.country || null, from: used.from, to: used.to };
}

/** "Registered address used from 13 Apr 2015 to 02 May 2016" or "… used since …" with the address before it. */
function listedAddress(addrHtml: string, descHtml: string): Address {
  const used = usedFor(line(descHtml));
  return { kinds: used.kinds, ...(used.note ? { note: used.note } : {}), address: line(addrHtml).replace(/\s*,\s*$/, ""), from: used.from, to: used.to };
}

/** The address timeline's rows: ["Physical & Registered", "address", new Date(2016, 4, 02), new Date(2026, 10, 07)]. */
export function addressTimeline(html: string, lastUpdated: string | null): TimelineRow[] {
  const fn = /function drawAddressChart\(\)[\s\S]*?addRows\(\[([\s\S]*?)\]\);/i.exec(html)?.[1];
  if (!fn) return [];
  const str = (lit: string): string => {
    try {
      return String(JSON.parse(lit));
    } catch {
      return lit.slice(1, -1);
    }
  };
  const out: TimelineRow[] = [];
  const re = /\[\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*,\s*new Date\((\d+),\s*(\d+),\s*(\d+)\)\s*,\s*new Date\((\d+),\s*(\d+),\s*(\d+)\)\s*\]/g;
  for (const m of fn.matchAll(re)) {
    const from = isoFromParts(m[5], Number(m[4]) + 1, m[3]);
    const to = isoFromParts(m[8], Number(m[7]) + 1, m[6]);
    const kindText = str(m[1]);
    const note = kindNote(kindText);
    const row: TimelineRow = { kinds: kinds(kindText), ...(note ? { note } : {}), address: squash(str(m[2])), from: from && from !== "1970-01-01" ? from : null, to: to || null, current: false };
    if (from === "1970-01-01") row.legacy = true;
    out.push(row);
  }
  // A current address ends on the day the page was made: the latest end date, on or after the data's last update.
  // An undated legacy row is drawn to that day too, but the register's dated rows say what is in use; it is not current.
  const latest = out.reduce<string>((a, r) => (r.to && r.to > a ? r.to : a), "");
  if (latest && (!lastUpdated || latest >= lastUpdated))
    for (const r of out)
      if (r.to === latest) {
        r.to = null;
        r.current = !r.legacy;
      }
  return out;
}

function holderOf(cells: string[]): Holder {
  const typeText = line(cells[0]);
  const t = /^(.*?)\s*(?:\((.*)\))?$/.exec(typeText);
  const nameCell = cells[1] ?? "";
  const nameHtml = nameCell.split(/<br\s*\/?>/i)[0];
  const addrCell = cells[2] ?? "";
  const globe = addrCell.search(/<i class="fa fa-globe"/i);
  const lines = brLines(globe >= 0 ? addrCell.slice(0, globe) : addrCell);
  const country = globe >= 0 ? line(addrCell.slice(globe)) : "";
  const period = line(cells[3] ?? "");
  const [from, to] = period.split(/\s+-\s*/);
  return {
    kind: (t?.[1] ?? typeText).toLowerCase() || "unknown",
    holder_type: typeText,
    name: line(nameHtml),
    nzbn: /Shareholder NZBN:\s*<\/span>\s*(\d{13})/i.exec(nameCell)?.[1] ?? null,
    company_number: /Company Number:\s*<\/span>\s*([A-Za-z0-9-]+)/i.exec(nameCell)?.[1] ?? null,
    address: [...lines, country].filter(Boolean).join(", ") || null,
    from: dateIn(from ?? ""),
    to: dateIn(to ?? ""),
  };
}

/** The share allocations table: "Shares Allocation #1 Number of Shares: 1" rows, each followed by its holders. */
function allocationsOf(tableHtml: string): { allocations: Allocation[]; loose: Holder[] } {
  const allocations: Allocation[] = [];
  const loose: Holder[] = [];
  for (const cells of rows(tableHtml)) {
    if (!cells.length) continue;
    const one = line(cells[0]);
    // "Shares Allocation #2 Number of Shares: 13965743"; a company with one allocation has no number ("Shares Allocation Number …")
    const alloc = /Shares Allocation\s*(?:#\s*(\d+))?\s*Number of Shares:\s*([\d,]+)/i.exec(cells.length === 1 ? one : "");
    if (alloc) {
      allocations.push({ number: alloc[1] ? Number(alloc[1]) : allocations.length + 1, shares: num(alloc[2]), percent: null, holders: [] });
      continue;
    }
    if (cells.length < 3 || /^Shareholder Type$/i.test(one)) continue;
    const h = holderOf(cells);
    if (allocations.length) allocations[allocations.length - 1].holders.push(h);
    else loose.push(h);
  }
  return { allocations, loose };
}

/**
 * The coloured sub-headings inside a section ("Basic Financial info", "Previous Shareholders", "Ultimate Holding Company",
 * "Previous addresses", "Other active addresses", "Principal place of activity"): a <p style="color: …"> holding an icon
 * and the heading. (A person's line in the directors' panel is styled "margin-bottom:0px; color: …" and is not one.)
 */
function subSections(html: string): { heading: string; html: string }[] {
  const re = /<p style="color:\s*#[0-9a-f]{3,6};?">\s*<span class="(?:glyphicon glyphicon-edit|fa fa-[a-z-]+)"[^>]*><\/span>([\s\S]*?)<\/p>/gi;
  const marks = [...html.matchAll(re)].map((m) => ({ heading: line(m[1]), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const out = [{ heading: "", html: html.slice(0, marks[0]?.start ?? html.length) }];
  marks.forEach((m, i) => out.push({ heading: m.heading, html: html.slice(m.end, marks[i + 1]?.start ?? html.length) }));
  return out;
}

function financialOf(fin: string): Pick<Company, "financial" | "allocations" | "previous_shareholders" | "ultimate_holding_company"> {
  const parts = subSections(fin);
  const basicPart = parts.find((p) => /basic financial/i.test(p.heading));
  const facts: Record<string, string> = {};
  for (const m of (basicPart?.html ?? fin).matchAll(/<p>\s*([^<:]+?):\s*([^<]*?)\s*<\/p>/gi)) facts[squash(decode(m[1]))] = squash(decode(m[2]));
  const take = (k: string): string | null => {
    const v = facts[k];
    delete facts[k];
    return v || null;
  };
  const total = num(take("Total number of Shares"));
  const financial = {
    total_shares: total,
    annual_return_month: take("Annual return filing month"),
    financial_report_month: take("Financial report filing month"),
    annual_return_last_filed: dateIn(take("Annual return last filed") ?? ""),
    country_of_origin: take("Country of origin"),
    other: facts,
  };
  // the current shareholders' table follows the basic facts; the previous shareholders' table has its own heading
  let allocations: Allocation[] = [];
  const previous: Holder[] = [];
  for (const p of parts) {
    for (const table of blocks(p.html, /<table\b[^>]*>/i, "table")) {
      const { allocations: a, loose } = allocationsOf(table);
      if (/previous shareholders/i.test(p.heading)) previous.push(...a.flatMap((x) => x.holders), ...loose);
      else {
        allocations = allocations.concat(a);
        if (loose.length) allocations.push({ number: allocations.length + 1, shares: null, percent: null, holders: loose });
      }
    }
  }
  if (total)
    for (const a of allocations) if (a.shares !== null) a.percent = Math.round((a.shares / total) * 10_000) / 100;
  const uhcPart = parts.find((p) => /ultimate holding/i.test(p.heading));
  let ultimate: Company["ultimate_holding_company"] = null;
  if (uhcPart) {
    const other: Record<string, string> = {};
    const u: NonNullable<Company["ultimate_holding_company"]> = { name: null, type: null, number: null, nzbn: null, country: null, address: null, effective_date: null, other };
    for (const b of infoBoxes(uhcPart.html)) {
      const l = b.label.toLowerCase();
      if (l === "name") u.name = b.value || null;
      else if (l === "type") u.type = b.value || null;
      else if (/holding company number/.test(l)) u.number = b.value || null;
      else if (l === "nzbn") u.nzbn = b.value || null;
      else if (/country/.test(l)) u.country = b.value || null;
      else if (l === "address") u.address = b.lines.join(", ") || null;
      else if (/effective date/.test(l)) u.effective_date = dateIn(b.value);
      else if (b.label) other[b.label] = b.value;
    }
    if (u.name || u.number) ultimate = u;
  }
  const hasFacts = Object.values(financial).some((v) => v !== null && !(typeof v === "object" && !Object.keys(v).length));
  return { financial: hasFacts ? financial : null, allocations, previous_shareholders: previous, ultimate_holding_company: ultimate };
}

/** Words the site uses for a role, to tell "Director" with no name from a name with no role. */
const ROLE_WORDS = /^(director|officer|person authorised for service|secretary|general partner|limited partner|trustee|member|manager)$/i;

/**
 * "Name - Role" with its dates and addresses: "Jane Mary Doe - Director", "John Doe - Person Authorised For
 * Service", "Name - officer", or a bare "- Director" (the site's own record has no name). `today` (YYYY-MM-DD) decides
 * whether a termination date has passed: the site can draw a terminated officer with the active icon.
 */
function rolesOf(rolesHtml: string, today: string): { heading: string | null; roles: Role[] } {
  const heading = line(/<div class="panel-heading">([\s\S]*?)<\/div>/i.exec(rolesHtml)?.[1] ?? "") || null;
  const body = rolesHtml.split(/<div id="roles_chart"/i)[0];
  const roles: Role[] = [];
  for (const chunk of body.split(/<hr\s*\/?>/i)) {
    const head = /<p\b[^>]*>\s*<span class="(glyphicon glyphicon-edit|fa fa-ban)"[^>]*><\/span>([\s\S]*?)<\/p>/i.exec(chunk);
    if (!head) continue;
    const t = line(head[2]);
    const bare = t.replace(/\s*\(Inactive\)\s*$/i, "").trim();
    // split at the last " - " (or a leading "- "): the name is before it, the role after
    const m = /^(.*?)(?:^|\s)-\s+([^-]*)$/.exec(bare);
    let name = m ? m[1].trim() : bare;
    let role = m ? m[2].trim() : "";
    if (!m && ROLE_WORDS.test(bare)) {
      name = "";
      role = bare;
    }
    const addresses = [...chunk.matchAll(/Address:\s*([\s\S]*?)<\/p>\s*(?:<p class="info-desc">([\s\S]*?)<\/p>)?/gi)].map((a) => {
      const desc = line(a[2] ?? "");
      const dates = [...desc.matchAll(/\b\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}\b/g)].map((x) => isoFromText(x[0]));
      return { address: line(a[1]).replace(/\s*,\s*$/, ""), from: dates[0] ?? null, to: /\bfrom\b.*\bto\b/i.test(desc) ? (dates[1] ?? null) : null };
    });
    const terminated = dateIn(/Termination date:\s*([^<]*)/i.exec(chunk)?.[1] ?? "");
    const inactive = /fa-ban/.test(head[1]) || /\(Inactive\)/i.test(t) || (terminated !== null && terminated <= today);
    roles.push({
      name,
      role: sentence(role) || "Director",
      active: !inactive,
      appointed: dateIn(/Appointment date:\s*([^<]*)/i.exec(chunk)?.[1] ?? ""),
      terminated,
      address: addresses[0]?.address || null,
      address_since: addresses[0]?.from ?? null,
      addresses,
    });
  }
  return { heading, roles };
}

const CONTACT_KIND: Record<string, string> = { phone: "phone", at: "email", envelope: "email", globe: "website", fax: "fax", mobile: "mobile" };

function contactOf(html: string): Contact[] {
  const out: Contact[] = [];
  for (const b of infoBoxes(html)) {
    if (!b.value || /^no (website|email|phone)/i.test(b.value)) continue;
    const since = b.descs.map((d) => isoFromText(d)).find(Boolean) ?? null;
    const raw = b.descs.filter((d) => !/^\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}$/.test(d)).pop() ?? "";
    const label = raw.replace(/^nzbn-reserved-/i, "").replace(/-purpose$/i, "").replace(/-/g, " ").trim() || null;
    out.push({ kind: CONTACT_KIND[b.icon] ?? (b.icon || "other"), value: b.value, label, since });
  }
  return out;
}

function charityOf(html: string): Company["charity"] {
  const p = panel(html, /^Charity information$/i);
  if (!p) return null;
  const fields: Record<string, string> = {};
  for (const b of infoBoxes(p)) if (b.label) fields[b.label] = b.value;
  const annual: Record<string, string | number | null>[] = [];
  const table = blocks(p, /<table\b[^>]*>/i, "table")[0];
  if (table) {
    const all = rows(table, true);
    const head = all.find((r) => r.length > 1 && /Year ended/i.test(line(r[0])));
    const keys = (head ?? []).map((h) => snake(line(h)));
    for (const r of all) {
      if (r === head || r.length !== keys.length) continue;
      const rec: Record<string, string | number | null> = {};
      r.forEach((c, i) => {
        const v = line(c);
        const k = keys[i];
        if (k === "year_ended") rec[k] = dateIn(v) ?? v;
        else if (k === "paid_staff") {
          const m = /^(\d+)\s*\/\s*(\d+)$/.exec(v);
          rec.paid_staff_full_time = m ? Number(m[1]) : null;
          rec.paid_staff_part_time = m ? Number(m[2]) : null;
        } else rec[k] = /^-?\$?-?[\d,]+(\.\d+)?$/.test(v) ? Number(v.replace(/[$,]/g, "")) : v || null;
      });
      annual.push(rec);
    }
  }
  const source = /<span class="info-desc">\s*(Source:[\s\S]*?)<\/span>/i.exec(p)?.[1];
  return {
    fields,
    registration_number: fields["Charity registration number"] ?? null,
    status: fields["Charity status"] ?? null,
    registered: dateIn(fields["Registered as a charity"] ?? ""),
    annual_returns: annual,
    source: source ? line(source) : null,
  };
}

interface MapPoint {
  lat?: string | number;
  lng?: string | number;
  title?: string;
  url?: string;
}
function mapOf(html: string): { main: MapPoint | null; others: MapPoint[] } {
  const raw = /showMap\('([\s\S]*?)'\);/i.exec(html)?.[1];
  if (!raw) return { main: null, others: [] };
  try {
    const j = JSON.parse(raw) as { main_point?: MapPoint; other_points?: MapPoint[] };
    return { main: j.main_point ?? null, others: Array.isArray(j.other_points) ? j.other_points : [] };
  } catch {
    // an apostrophe in a name ends the page's own JS string early (its map then fails too); read the main point by hand
    const lat = /"main_point":\{"lat":"(-?[\d.]+)","lng":"(-?[\d.]+)","title":"((?:[^"\\]|\\.)*)"/.exec(raw);
    return { main: lat ? { lat: lat[1], lng: lat[2], title: lat[3] } : null, others: [] };
  }
}
const coord = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
};

function listPanel(html: string, heading: RegExp, points: MapPoint[]): Nearby[] {
  const p = panel(html, heading);
  if (!p) return [];
  const byNzbn = new Map(points.map((pt) => [nzbnOf(pt.url ?? ""), pt]));
  const out: Nearby[] = [];
  for (const m of p.matchAll(/<a\b[^>]*href="(\/company\/\d{13}\/?)"[^>]*>([\s\S]*?)<\/a>\s*(?:<br\s*\/?>)?\s*(?:<span class="info-desc">([\s\S]*?)<\/span>)?/gi)) {
    const nzbn = nzbnOf(m[1]);
    const pt = byNzbn.get(nzbn);
    const n: Nearby = { nzbn, name: pt?.title ? squash(pt.title) : line(m[2]), address: m[3] ? line(m[3]) || null : null, url: companyUrl(nzbn) };
    const lat = coord(pt?.lat);
    const lng = coord(pt?.lng);
    if (lat !== null && lng !== null) {
      n.lat = lat;
      n.lng = lng;
    }
    out.push(n);
  }
  return out;
}

/** A company page as structured data. `today` (YYYY-MM-DD, default today in NZ) decides whether a role's termination has passed. */
export function parseCompany(html: string, nzbnAsked = "", today = todayNz()): Company {
  const generalStart = html.search(/<div class="[^"]*" id="general">/i);
  const footer = generalStart >= 0 ? html.indexOf('class="panel-footer', generalStart) : -1;
  const general = generalStart >= 0 ? html.slice(generalStart, footer >= 0 ? html.indexOf("</div>", footer) + 6 : undefined) : "";
  const heading = line(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(general || html)?.[1] ?? "");
  const typeText = line(/<b>\s*Type:\s*<\/b>([^<]*)/i.exec(general)?.[1] ?? "");
  const tm = /^(.*\S)\s*\(([^()]*)\)\s*$/.exec(typeText);
  const button = line(/<button class="btn btn-sea"[^>]*>([\s\S]*?)<\/button>/i.exec(general)?.[1] ?? "");
  const lastUpdated = /<time datetime="(\d{4}-\d{2}-\d{2})"/i.exec(general)?.[1] ?? null;

  // the heading boxes, then the current addresses after "Current address"
  const marker = general.search(/Current address\s*<\/div>/i);
  const idPart = marker >= 0 ? general.slice(0, marker) : general;
  const addrPart = marker >= 0 ? general.slice(marker).split(/<div id="(?:nameshistory|statushistory)"|<p class="text-center"/i)[0] : "";
  let nzbn = "";
  let companyNumber: string | null = null;
  let status: string | null = null;
  const gst: string[] = [];
  const industries: Company["industries"] = [];
  let aewv: Company["accredited_employer"] = null;
  const identifiers: Record<string, string> = {};
  for (const b of infoBoxes(idPart)) {
    const l = b.label.toLowerCase();
    if (l === "nzbn") nzbn = b.value;
    else if (l === "company number") companyNumber = b.value || null;
    else if (l === "company status") status = b.value || null;
    else if (l === "gst number") gst.push(b.value);
    else if (l === "industry classification code") industries.push({ code: b.value || null, description: null });
    else if (l === "industry classification description") {
      const open = industries[industries.length - 1];
      if (open && open.description === null) open.description = b.value || null;
      else industries.push({ code: null, description: b.value || null });
    } else if (l.startsWith("accredited employer")) {
      aewv = {
        text: b.value,
        until: dateIn(/until\s+([^()]+)/i.exec(b.value)?.[1] ?? ""),
        listed_as: /\(listed as\s+(.*)\)\s*$/i.exec(b.value)?.[1]?.trim() ?? null,
        checked: dateIn(/checked\s+(.*)$/i.exec(b.label)?.[1] ?? ""),
      };
    } else if (b.label && b.value) identifiers[b.label] = b.value;
  }
  const currentAddresses = infoBoxes(addrPart).map(addressBox);

  const histTable = (id: string): string[][] => {
    const div = blocks(html, new RegExp(`<div id="${id}"[^>]*>`, "i"))[0];
    return div ? rows(div).filter((r) => r.length > 1) : [];
  };
  const names = histTable("nameshistory")
    .map((r) => ({ name: line(r[0]), from: dateIn(line(r[1] ?? "")), to: dateIn(line(r[2] ?? "")) }))
    .filter((n) => n.name);
  const statuses = histTable("statushistory")
    .map((r) => ({ status: line(r[0]), comment: line(r[1] ?? "") || null, from: dateIn(line(r[2] ?? "")), to: dateIn(line(r[3] ?? "")) }))
    .filter((s) => s.status);

  const prose = [...html.matchAll(/<div class="panel-body">\s*<p>([\s\S]*?)<\/p>\s*<\/div>/gi)].map((m) => line(m[1])).find((t) => (nzbn && t.includes(nzbn)) || /business number|NZBN/i.test(t)) ?? null;
  // the heading's "Registered 09 Nov 1971"; a company in liquidation has no such box, and the prose's first date is the same day
  const registered = dateIn(/Registered\s+(\d{1,2}\s+\w{3}\s+\d{4})/i.exec(button)?.[1] ?? "") ?? (prose ? dateIn(prose) : null);
  const years = Number(/(\d+)\s+years?\s+on\s+market/i.exec(button)?.[1]);

  // addresses section: lists under their sub-headings ("Address: …", or "Address #4: …" where the site numbers them), and
  // the timeline chart
  const addrSection = section(html, "addresses");
  const previous: Address[] = [];
  const otherActive: Address[] = [];
  const principal: Address[] = [];
  for (const part of subSections(addrSection)) {
    if (/principal place/i.test(part.heading)) {
      for (const m of part.html.matchAll(/<p\b[^>]*>\s*<i class="fa fa-map-marker"[^>]*><\/i>\s*([\s\S]*?)<\/p>/gi)) {
        const address = line(m[1]).replace(/^Address(?:\s*#\d+)?:\s*/i, "").replace(/\s*,\s*$/, "");
        if (address) principal.push({ kinds: ["principal place of activity"], address, from: null, to: null });
      }
      continue;
    }
    const items = [...part.html.matchAll(/<p\b[^>]*>\s*<i class="fa fa-map-marker"[^>]*><\/i>\s*Address(?:\s*#\d+)?:\s*([\s\S]*?)<\/p>\s*<p class="info-desc">([\s\S]*?)<\/p>/gi)].map((m) =>
      listedAddress(m[1], m[2]),
    );
    if (/other active/i.test(part.heading)) otherActive.push(...items);
    else previous.push(...items);
  }
  const fin = section(html, "finances");
  const money = fin ? financialOf(fin) : { financial: null, allocations: [], previous_shareholders: [], ultimate_holding_company: null };
  const r = rolesOf(section(html, "roles"), today);
  const map = mapOf(html);
  const lat = coord(map.main?.lat);
  const lng = coord(map.main?.lng);
  const nz = nzbn || nzbnAsked;
  return {
    nzbn: nz,
    name: map.main?.title ? squash(decode(map.main.title)) : heading,
    heading,
    type: tm ? canonicalType(tm[1]) : typeText || null,
    type_code: tm ? tm[2] : null,
    status,
    company_number: companyNumber,
    registered,
    years: Number.isInteger(years) ? years : null,
    last_updated: lastUpdated,
    gst_numbers: gst,
    industries,
    accredited_employer: aewv,
    identifiers,
    current_addresses: currentAddresses,
    names,
    statuses,
    description: prose,
    addresses: { previous, other_active: otherActive, principal_place: principal, timeline: addressTimeline(html, lastUpdated) },
    contact: contactOf(section(html, "contactinfo")),
    ...money,
    roles_heading: r.heading,
    roles: r.roles,
    charity: charityOf(html),
    location: lat !== null && lng !== null ? { lat, lng, osm: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}` } : null,
    nearby: listPanel(html, /^Nearby companies$/i, map.others),
    similar: listPanel(html, /^Similar companies$/i, map.others),
    url: companyUrl(nz),
  };
}

/**
 * A company's profile (bizdb_company): /company/{NZBN}/, a server-rendered page (NATIVE-NOTES.md, section 5). A company
 * can also be named by its company number or its exact name, which are looked up with the site's search first.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, InputError, errorMessage, get } from "./http.js";
import { parseCompany, type Company, type Holder, type Role } from "./parse.js";
import { companyPath } from "./site.js";
import { search, hitLine } from "./search.js";
import { readIndex } from "./browse.js";
import { dateShort, fail, fold, join, ok, plural } from "./format.js";

export const SECTIONS = ["overview", "history", "addresses", "contact", "shares", "people", "charity", "nearby", "description"] as const;
export type Section = (typeof SECTIONS)[number];
const DEFAULT_SECTIONS: Section[] = ["overview", "history", "addresses", "contact", "shares", "people", "charity", "nearby"];

/** A company page, read and parsed; a 404 is said in words (bizdb drops companies once they are removed). */
export async function fetchCompany(nzbn: string): Promise<Company> {
  try {
    const r = await get(companyPath(nzbn), { ttlMs: 60 * 60_000, keep: (a) => /id="general"/.test(a.body.toString("utf8")) });
    const html = r.body.toString("utf8");
    if (!/id="general"/.test(html)) throw new InputError(`the page for NZBN ${nzbn} is not a company profile (${r.body.length} bytes); the site may have changed`);
    return parseCompany(html, nzbn);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404)
      throw new InputError(
        `bizdb.co.nz has no page for NZBN ${nzbn}: there is no such NZBN, or the entity has been removed from the register (bizdb keeps only entities that are not removed; the Companies Office register at app.companiesoffice.govt.nz keeps removed ones)`,
      );
    throw e;
  }
}

const NOT_SEARCHED = "the site's search finds registered entities only: a company in liquidation is read by its NZBN, and removed companies are not on bizdb";

export type Resolved = { nzbn: string; exact: boolean; via: "company_number" | "index" | "search" } | { candidates: string[]; message: string };

/**
 * A company number or a name as an NZBN. A number goes through the search (an exact field there). A name is looked up in
 * the A-Z index first: /index/{NAME}/ lists every company whose name starts with it, so an exact name is found however
 * many other names contain it. When the index cannot help (a name with "&", or so many names start with it that the site
 * splits it into sub-prefixes), the search's first 50 name matches are used. Candidates come back when no one name fits.
 */
export async function resolve(by: { company_number?: string; name?: string }): Promise<Resolved> {
  if (by.company_number) {
    const num = by.company_number.replace(/\s/g, "");
    if (!/^[0-9A-Za-z-]{1,20}$/.test(num)) throw new InputError(`a company number is digits (for example 191954); got "${by.company_number}"`);
    const r = await search({ company_number: num, sort: "name", order: "asc" }, 0, 10);
    if (!r.hits.length) throw new InputError(`no registered company on bizdb.co.nz has company number ${num} (${NOT_SEARCHED})`);
    return { nzbn: r.hits[0].nzbn, exact: true, via: "company_number" };
  }
  const name = (by.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new InputError("give nzbn, company_number or name");
  if (!/[&/\\?#%]/.test(name) && name.length <= 60) {
    try {
      const x = await readIndex(name);
      const exact = x.companies.filter((c) => fold(c.name) === fold(name));
      if (exact.length === 1) return { nzbn: exact[0].nzbn, exact: true, via: "index" };
    } catch (e) {
      // no index page, or one the site misread: the search below still answers
      if (!(e instanceof InputError)) throw e;
    }
  }
  const r = await search({ name, sort: "name", order: "asc" }, 0, 50);
  const exact = r.hits.filter((h) => fold(h.name) === fold(name));
  if (exact.length === 1) return { nzbn: exact[0].nzbn, exact: true, via: "search" };
  if (!exact.length && r.hits.length === 1) return { nzbn: r.hits[0].nzbn, exact: false, via: "search" };
  if (!r.hits.length) throw new InputError(`no registered company on bizdb.co.nz has "${name}" in its name (${NOT_SEARCHED})`);
  const list = (exact.length ? exact : r.hits).slice(0, 15);
  const why =
    exact.length > 1
      ? `${exact.length} companies are named exactly "${name}"`
      : r.more
        ? `more than 50 companies have "${name}" in their name and none of the first 50 (by name) is named exactly that`
        : `${plural(r.hits.length, "company has", "companies have")} "${name}" in their name and none is named exactly that`;
  return { candidates: list.map((h, i) => hitLine(h, i + 1)), message: `${why}; call bizdb_company again with the nzbn of the one meant:` };
}

const cap = <T>(list: T[], max: number): { items: T[]; omitted: number } => ({ items: list.slice(0, max), omitted: Math.max(0, list.length - max) });

/** The parts of a profile that were asked for, with long lists cut to max_items (and how many were left out). */
export function shape(c: Company, sections: Set<Section>, currentOnly: boolean, maxItems: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    nzbn: c.nzbn,
    name: c.name,
    type: c.type,
    type_code: c.type_code,
    status: c.status,
    company_number: c.company_number,
    registered: c.registered,
    years_on_market: c.years,
    last_updated: c.last_updated,
    gst_numbers: c.gst_numbers,
    industries: c.industries,
    accredited_employer: c.accredited_employer,
    identifiers: c.identifiers,
    current_addresses: c.current_addresses,
    location: c.location,
    url: c.url,
  };
  const omitted: Record<string, number> = {};
  const put = <T>(key: string, list: T[]): void => {
    const x = cap(list, maxItems);
    out[key] = x.items;
    if (x.omitted) omitted[key] = x.omitted;
  };
  if (sections.has("history")) {
    put("names", c.names);
    put("statuses", c.statuses);
  }
  if (sections.has("addresses")) {
    if (!currentOnly) put("previous_addresses", c.addresses.previous);
    put("other_active_addresses", c.addresses.other_active);
    put("principal_place_of_activity", c.addresses.principal_place);
    put("address_timeline", currentOnly ? c.addresses.timeline.filter((t) => t.current) : c.addresses.timeline);
  }
  if (sections.has("contact")) out.contact = c.contact;
  if (sections.has("shares")) {
    out.financial = c.financial;
    // largest first, so a short max_items keeps the biggest holders; each keeps the site's allocation number
    put("allocations", [...c.allocations].sort((a, b) => (b.shares ?? -1) - (a.shares ?? -1) || a.number - b.number));
    // no page seen lists more than 10 allocations, and big companies show exactly 10: their list is partial
    if (c.allocations.length >= 10) out.allocations_may_be_partial = true;
    if (!currentOnly) put("previous_shareholders", c.previous_shareholders);
    out.ultimate_holding_company = c.ultimate_holding_company;
  }
  if (sections.has("people")) {
    out.people_heading = c.roles_heading;
    put("people", currentOnly ? c.roles.filter((r) => r.active) : c.roles);
    out.people_counts = { current: c.roles.filter((r) => r.active).length, former: c.roles.filter((r) => !r.active).length };
  }
  if (sections.has("charity")) out.charity = c.charity;
  if (sections.has("nearby")) {
    out.nearby = c.nearby;
    out.similar = c.similar;
  }
  if (sections.has("description")) out.description = c.description;
  if (Object.keys(omitted).length) out.omitted = omitted;
  return out;
}

const d = (iso: string | null | undefined): string => dateShort(iso ?? "") || "";
const money = (v: unknown): string => (typeof v === "number" ? `$${v.toLocaleString("en-NZ")}` : String(v ?? ""));
const holderName = (h: Holder): string => (h.nzbn ? `${h.name} (NZBN ${h.nzbn})` : h.name);
const roleLine = (r: Role): string => `${r.name || "(no name on the site)"}${r.role && r.role !== "Director" ? ` (${r.role.toLowerCase()})` : ""}${r.appointed ? ` since ${d(r.appointed)}` : ""}`;

/** A profile in a few lines, for the summary above the JSON. */
export function summary(c: Company, sections: Set<Section>): string[] {
  const lines: string[] = [];
  lines.push(`${c.name} — ${join([c.type && `${c.type}${c.type_code ? ` (${c.type_code})` : ""}`, c.status])}`);
  lines.push(
    join(
      [
        `NZBN ${c.nzbn}`,
        c.company_number && `company number ${c.company_number}`,
        c.registered && `registered ${d(c.registered)}${c.years !== null ? ` (${plural(c.years, "year")})` : ""}`,
        c.last_updated && `data last updated ${d(c.last_updated)}`,
      ],
      " · ",
    ),
  );
  if (c.industries.length) lines.push(`Industry: ${c.industries.map((i) => join([i.code, i.description], " ")).join("; ")}`);
  if (c.accredited_employer)
    lines.push(`Accredited employer (AEWV): ${c.accredited_employer.text}${c.accredited_employer.checked ? ` — Immigration NZ list checked ${d(c.accredited_employer.checked)}` : ""}`);
  if (c.gst_numbers.length) lines.push(`GST: ${c.gst_numbers.join(", ")}`);
  for (const [k, v] of Object.entries(c.identifiers)) lines.push(`${k}: ${v}`);
  for (const a of c.current_addresses) lines.push(`Address: ${a.address} (${join([a.kinds.join(", "), a.note, a.from && `since ${d(a.from)}`], "; ")})`);
  if (sections.has("addresses")) {
    for (const a of c.addresses.other_active) lines.push(`Other active address: ${a.address} (${join([a.kinds.join(", "), a.note, a.from && `since ${d(a.from)}`], "; ")})`);
    for (const a of c.addresses.principal_place) lines.push(`Principal place of activity: ${a.address}`);
  }
  if (sections.has("contact") && c.contact.length) lines.push(`Contact: ${c.contact.map((x) => `${x.kind} ${x.value}${x.label && !new RegExp(`^${x.kind}$`, "i").test(x.label) ? ` (${x.label})` : ""}`).join(" · ")}`);
  if (sections.has("history")) {
    const former = c.names.filter((n) => n.to);
    if (former.length) lines.push(`Former names: ${former.map((n) => `${n.name} (${join([n.from?.slice(0, 4), n.to?.slice(0, 4)], "–")})`).join(", ")}`);
    if (c.statuses.length) lines.push(`Status history: ${c.statuses.map((s) => `${s.status} ${join([d(s.from), d(s.to)], " to ")}${s.comment ? ` (${s.comment})` : ""}`).join("; ")}`);
  }
  if (sections.has("shares")) {
    const f = c.financial;
    if (c.allocations.length) {
      const top = [...c.allocations].sort((a, b) => (b.shares ?? 0) - (a.shares ?? 0)).slice(0, 5);
      lines.push(
        `Shares: ${f?.total_shares !== null && f?.total_shares !== undefined ? f.total_shares.toLocaleString("en-NZ") : "?"} in ${plural(c.allocations.length, "allocation")}: ${top
          .map((a) => `${a.holders.map(holderName).join(" & ") || "?"} ${a.shares !== null ? a.shares.toLocaleString("en-NZ") : "?"}${a.percent !== null ? ` (${a.percent}%)` : ""}`)
          .join("; ")}${c.allocations.length > top.length ? "; …" : ""}${c.allocations.length >= 10 ? " (bizdb lists no more than 10 allocations, so there may be more holders)" : ""}`,
      );
    }
    if (c.previous_shareholders.length) lines.push(`Previous shareholders: ${c.previous_shareholders.length}`);
    const u = c.ultimate_holding_company;
    if (u) lines.push(`Ultimate holding company: ${join([u.name, join([u.type, u.number, u.country], ", ") && `(${join([u.type, u.number, u.country], ", ")})`], " ")}`);
    if (f) lines.push(`Filing: ${join([f.annual_return_month && `annual return due in ${f.annual_return_month}`, f.annual_return_last_filed && `last filed ${d(f.annual_return_last_filed)}`, f.financial_report_month && `financial report in ${f.financial_report_month}`, f.country_of_origin && `country of origin ${f.country_of_origin}`])}`);
  }
  if (sections.has("people") && c.roles.length) {
    const cur = c.roles.filter((r) => r.active);
    const former = c.roles.length - cur.length;
    lines.push(`${c.roles_heading ?? "People"}: ${cur.length} current${cur.length ? ` — ${cur.slice(0, 8).map(roleLine).join("; ")}${cur.length > 8 ? "; …" : ""}` : ""}${former ? `; ${former} former` : ""}`);
  }
  if (sections.has("charity") && c.charity) {
    const latest = c.charity.annual_returns[0];
    lines.push(
      `Charity: ${join([c.charity.registration_number, c.charity.status, latest && `year ended ${d(String(latest.year_ended ?? ""))}: income ${money(latest.gross_income)}, expenditure ${money(latest.expenditure)}`], " · ")}`,
    );
  }
  if (sections.has("nearby") && (c.nearby.length || c.similar.length)) lines.push(`Nearby companies: ${c.nearby.length} · similar companies: ${c.similar.length}`);
  lines.push(c.url);
  return lines;
}

export function register(server: McpServer): void {
  server.registerTool(
    "bizdb_company",
    {
      title: "A New Zealand company's profile",
      description:
        "A company's full profile on bizdb.co.nz, from the Companies Office register and the NZBN register: name, type, status, " +
        "company number, NZBN, registration date, GST number, industry classifications, accredited-employer (AEWV) status, current " +
        "addresses with map coordinates (LINZ), former names, status history, previous addresses and the address timeline, contact " +
        "phone/email/website, shares (total, allocations with each holder and their NZBN, previous shareholders), the ultimate " +
        "holding company, directors/officers (current and former, appointment and termination dates, suburb-level addresses), " +
        "Charities Register details and annual-return figures, and nearby and similar companies. Name it by nzbn (one, or up to 10), " +
        "company_number (looked up with the search), or exact name (looked up in the A-Z index, then the search; when no one company " +
        "fits, the candidates are returned, and an inexact single match says so). The search finds registered entities only, so a " +
        "company in liquidation is read by its NZBN. Removed companies are not on bizdb.",
      inputSchema: {
        nzbn: z.union([z.string(), z.array(z.string()).min(1).max(10)]).optional().describe("An NZBN (13 digits), or a list of up to 10"),
        company_number: z.string().max(20).optional().describe("A Companies Office company number, e.g. 191954"),
        name: z.string().max(200).optional().describe("The company's exact name, e.g. \"Fonterra (New Zealand) Limited\""),
        sections: z
          .array(z.enum(SECTIONS))
          .optional()
          .describe(
            "Parts to include (default all but description): overview (always), history (former names, status history), addresses, contact, shares (financial, allocations, previous shareholders, ultimate holding company), people (directors/officers), charity, nearby (nearby and similar companies), description (the site's prose summary)",
          ),
        current_only: z.boolean().optional().describe("Leave out former directors, previous shareholders and past addresses"),
        max_items: z.number().int().min(1).max(1000).optional().describe("Most entries per list (people, allocations, previous shareholders, addresses; default 100)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ nzbn, company_number, name, sections, current_only = false, max_items = 100 }) => {
      try {
        const wanted = new Set<Section>(["overview", ...(sections?.length ? sections : DEFAULT_SECTIONS)]);
        let nzbns: string[];
        let lookup: Exclude<Resolved, { candidates: string[] }> | null = null;
        if (nzbn !== undefined) {
          nzbns = (Array.isArray(nzbn) ? nzbn : [nzbn]).map((x) => x.replace(/[\s-]/g, ""));
          const bad = nzbns.filter((x) => !/^\d{13}$/.test(x));
          if (bad.length) throw new InputError(`an NZBN is 13 digits (9429…); got ${bad.map((b) => `"${b}"`).join(", ")}`);
          nzbns = [...new Set(nzbns)];
        } else {
          const r = await resolve({ company_number, name });
          if ("candidates" in r) return ok([r.message, ...r.candidates], { candidates: r.candidates });
          lookup = r;
          nzbns = [r.nzbn];
        }
        if (nzbns.length === 1) {
          const c = await fetchCompany(nzbns[0]);
          const note = lookup && !lookup.exact ? [`No company is named exactly "${(name ?? "").trim()}"; this is the only one whose name contains it.`, ""] : [];
          return ok([...note, ...summary(c, wanted)], { ...shape(c, wanted, current_only, max_items), ...(lookup ? { lookup } : {}) });
        }
        const lines: string[] = [];
        const companies: unknown[] = [];
        const errors: { nzbn: string; error: string }[] = [];
        for (const n of nzbns) {
          try {
            const c = await fetchCompany(n);
            lines.push(...summary(c, wanted), "");
            companies.push(shape(c, wanted, current_only, max_items));
          } catch (e) {
            const msg = errorMessage(e);
            errors.push({ nzbn: n, error: msg });
            lines.push(`${n}: ${msg}`, "");
          }
        }
        if (!companies.length) throw new InputError(errors.map((e) => `${e.nzbn}: ${e.error}`).join("\n"));
        return ok([`${plural(companies.length, "company", "companies")}${errors.length ? ` (${errors.length} not found)` : ""}:`, "", ...lines], { companies, errors });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

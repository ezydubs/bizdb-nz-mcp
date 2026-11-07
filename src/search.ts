/**
 * The company search (bizdb_search): the form on /company-search/, which the page's script posts to
 * /filter/branch/results (NATIVE-NOTES.md, section 3), and the industry classification suggestions behind its industry
 * box (bizdb_industries, section 4).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InputError, post } from "./http.js";
import { parseResults, type Hit } from "./parse.js";
import { COMPANY_TYPES, PAGE_SIZES, PATHS, TYPE_KEYS, type CompanyType } from "./site.js";
import { fail, join, ok, plural } from "./format.js";

export interface SearchQuery {
  name?: string;
  nzbn?: string;
  company_number?: string;
  type?: CompanyType;
  industry?: string;
  accredited_employer?: boolean;
  sort?: "name" | "type";
  order?: "asc" | "desc";
}

/** The form the site's search page posts, with its field names in its order; the page number only past the first page. */
export function searchForm(q: SearchQuery, pageSize: number, page: number): [string, string][] {
  const form: [string, string][] = [
    ["branch_nzbn", q.nzbn ?? ""],
    ["branch_name", q.name ?? ""],
    ["branch_source_register_unique_id", q.company_number ?? ""],
    ["branch_type", q.type ? COMPANY_TYPES[q.type].id : ""],
    ["branch_industry_classification", q.industry ?? ""],
    ["branch_aewv", q.accredited_employer ? "1" : ""],
    ["branch_row_count", String(pageSize)],
    ["branch_sort_field", q.sort ?? "name"],
    ["branch_sort_direction", q.order ?? "asc"],
  ];
  if (page > 1) form.push(["branch_paging_position", String(page)]);
  return form;
}

/** The site pages that cover rows [offset, offset + limit): the page size (10, 20 or 50) that needs the fewest requests. */
export function plan(offset: number, limit: number): { size: number; first: number; last: number } {
  let best: { size: number; first: number; last: number } | null = null;
  for (const size of PAGE_SIZES) {
    const first = Math.floor(offset / size) + 1;
    const last = Math.floor((offset + limit - 1) / size) + 1;
    if (!best || last - first < best.last - best.first) best = { size, first, last };
  }
  return best!;
}

/** A query's values cleaned and checked; an InputError says what is wrong. */
export function cleanQuery(q: SearchQuery): SearchQuery {
  const out: SearchQuery = { sort: q.sort ?? "name", order: q.order ?? "asc" };
  const name = q.name?.replace(/\s+/g, " ").trim();
  if (name) out.name = name;
  const nzbn = q.nzbn?.replace(/[\s-]/g, "");
  if (nzbn) {
    if (!/^\d{13}$/.test(nzbn)) throw new InputError(`an NZBN is 13 digits (9429…); got "${q.nzbn}"`);
    out.nzbn = nzbn;
  }
  const num = q.company_number?.replace(/\s/g, "");
  if (num) {
    if (!/^[0-9A-Za-z-]{1,20}$/.test(num)) throw new InputError(`a company number is digits (for example 191954); got "${q.company_number}"`);
    out.company_number = num;
  }
  if (q.type) out.type = q.type;
  const industry = q.industry?.replace(/\s+/g, " ").trim();
  if (industry) out.industry = industry;
  if (q.accredited_employer) out.accredited_employer = true;
  if (!out.name && !out.nzbn && !out.company_number && !out.type && !out.industry && !out.accredited_employer)
    throw new InputError(
      "give at least one of name, nzbn, company_number, type, industry or accredited_employer (an empty search would list all 600,000 companies; bizdb_index browses them by name, bizdb_latest lists the newest)",
    );
  return out;
}

export interface SearchResult {
  hits: Hit[];
  /** whether the site has rows after these */
  more: boolean;
  /** site pages read, and the rows per page used */
  pages: number;
  pageSize: number;
}

/** Rows [offset, offset + limit) of a search, read from as few site pages as possible, one after another. */
export async function search(q: SearchQuery, offset: number, limit: number): Promise<SearchResult> {
  const { size, first, last } = plan(offset, limit);
  const hits: Hit[] = [];
  let more = false;
  let pages = 0;
  for (let page = first; page <= last; page++) {
    const r = await post(PATHS.search, searchForm(q, size, page), { ttlMs: 10 * 60_000, keep: (a) => /listing-body|No records found/i.test(a.body.toString("utf8")) });
    pages++;
    const res = parseResults(r.body.toString("utf8"));
    if (!res.hits.length && !res.none && !/branch_paging/i.test(r.body.toString("utf8")))
      throw new InputError(`the search answered with something other than results (${r.body.length} bytes); the site may have changed`);
    // the rows are numbered by the page size asked for: a page of another size would put them in the wrong places
    if (res.pageSize !== null && res.pageSize !== size)
      throw new InputError(`the search answered with ${res.pageSize} rows a page instead of the ${size} asked for; the site may have changed`);
    res.hits.forEach((h, i) => {
      const at = (page - 1) * size + i;
      if (at >= offset && at < offset + limit) hits.push(h);
      else if (at >= offset + limit) more = true;
    });
    if (res.next === null) break;
    if (page === last) more = true;
  }
  return { hits, more, pages, pageSize: size };
}

function describe(q: SearchQuery): string {
  return join([
    q.name && `name contains "${q.name}"`,
    q.nzbn && `NZBN ${q.nzbn}`,
    q.company_number && `company number ${q.company_number}`,
    q.type && COMPANY_TYPES[q.type].label,
    q.industry && `industry contains "${q.industry}"`,
    q.accredited_employer && "accredited employers (AEWV)",
  ]);
}
export const hitLine = (h: Hit, n: number): string =>
  `${n}. ${h.name} — ${join([`NZBN ${h.nzbn}`, h.type, h.status, h.post_code && `post code ${h.post_code}`, h.industries.join("; ")], " · ")}`;

export function register(server: McpServer): void {
  server.registerTool(
    "bizdb_search",
    {
      title: "Search New Zealand companies",
      description:
        "Search bizdb.co.nz's copy of the NZ Companies Office register with every field of the site's company search: name " +
        "(matches the text anywhere in the name, any case), NZBN (exact, 13 digits), company number (exact), entity type, industry " +
        "(matches any part of an industry classification description; bizdb_industries suggests them) and accredited employers " +
        "only (Immigration NZ's AEWV list). Fields combine (AND). Sorted by name (punctuation ignored) or type, ascending or " +
        "descending. Each result has the NZBN, name, type, status, post code and, when classified, industry descriptions. The site " +
        "gives no total count; `more` says whether rows follow, and offset pages on. bizdb_company reads a result in full. The " +
        "search covers registered entities only: a company in liquidation still has a page (bizdb_company by NZBN) but no search " +
        "result, and removed companies are not on bizdb at all.",
      inputSchema: {
        name: z.string().max(200).optional().describe("Text in the company name (anywhere in it, any case), e.g. \"fonterra\" or \"dairy farm\""),
        nzbn: z.string().max(20).optional().describe("Exact NZBN, 13 digits (9429…)"),
        company_number: z.string().max(20).optional().describe("Exact Companies Office number, e.g. 191954"),
        type: z.enum(TYPE_KEYS).optional().describe("Entity type: " + TYPE_KEYS.map((k) => `${k} (${COMPANY_TYPES[k].label})`).join(", ")),
        industry: z.string().max(200).optional().describe("Text in an industry classification description, e.g. \"Dairy cattle farming\" or just \"dairy\""),
        accredited_employer: z.boolean().optional().describe("Only accredited employers on Immigration NZ's AEWV list (this filter is slow on the site: 10–20 s)"),
        sort: z.enum(["name", "type"]).optional().describe("Sort by company name (default) or entity type"),
        order: z.enum(["asc", "desc"]).optional().describe("Ascending (default) or descending"),
        limit: z.number().int().min(1).max(200).optional().describe("Results to return (default 20, at most 200)"),
        offset: z.number().int().min(0).max(100_000).optional().describe("Results to skip, for paging (default 0)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ limit = 20, offset = 0, ...rest }) => {
      try {
        const q = cleanQuery(rest);
        const r = await search(q, offset, limit);
        const sortText = `sorted by ${q.sort === "type" ? "entity type" : "name"}, ${q.order === "desc" ? "descending" : "ascending"}`;
        const head = r.hits.length
          ? `bizdb.co.nz companies where ${describe(q)} (${sortText}): ${offset + 1}–${offset + r.hits.length}${r.more ? `, more after these (offset ${offset + r.hits.length})` : ", the last of them"}.`
          : offset
            ? `No companies past the first ${offset} where ${describe(q)}.`
            : `No companies where ${describe(q)}. The search covers registered entities only (a company in liquidation is read by NZBN with bizdb_company; removed ones are not on bizdb); check the spelling, or search a shorter part of the name.`;
        return ok([head, "", ...r.hits.map((h, i) => hitLine(h, offset + i + 1))], {
          query: q,
          offset,
          limit,
          count: r.hits.length,
          more: r.more,
          next_offset: r.more ? offset + r.hits.length : null,
          site_pages_read: r.pages,
          companies: r.hits,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "bizdb_industries",
    {
      title: "Industry classification suggestions",
      description:
        "The industry classification descriptions bizdb.co.nz suggests for a word, as its search page's industry box does (the " +
        "Business Industry Classification, ANZSIC-based, used by the Companies Office and NZBN register). Pass one to bizdb_search's " +
        "industry to find companies classified under it.",
      inputSchema: {
        text: z.string().min(1).max(100).describe("A word or two from the industry, e.g. \"dairy\", \"plumb\", \"software\""),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ text }) => {
      try {
        const t = text.replace(/\s+/g, " ").trim();
        if (!t) throw new InputError("give a word to suggest industries for");
        const r = await post(PATHS.industryPrompt, [["string", t]], { ttlMs: 24 * 3600_000, keep: (a) => /^\s*\{[\s\S]*"code"\s*:/.test(a.body.toString("utf8")) });
        let j: { prompt?: unknown; code?: unknown };
        try {
          j = JSON.parse(r.body.toString("utf8"));
        } catch {
          throw new InputError(`the industry suggestions answered with something other than JSON (${r.body.length} bytes)`);
        }
        const list = Array.isArray(j.prompt) ? j.prompt.map((x) => String(x).trim()).filter(Boolean) : [];
        if (!list.length) return ok(`No industry classifications match "${t}". Try a shorter word or another spelling.`, { text: t, industries: [], code: j.code ?? null });
        return ok([`${plural(list.length, "industry classification")} for "${t}" (use one as bizdb_search's industry):`, ...list.map((d) => `- ${d}`)], { text: t, industries: list });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

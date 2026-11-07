/**
 * Browsing (NATIVE-NOTES.md, sections 6 and 7): the A-Z company index under /index/ (bizdb_index), and the newest
 * companies on the home page (bizdb_latest).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, InputError, SITE, get } from "./http.js";
import { parseIndex, parseLatest, type IndexPage } from "./parse.js";
import { PATHS, companyUrl } from "./site.js";
import { fail, join, ok, plural } from "./format.js";

/** An index prefix as the site's path: capitals (the site has no lower-case paths), each character escaped ("F " is F%20). */
export function indexPath(prefix: string): string {
  const p = prefix.toUpperCase();
  return p ? `${PATHS.index}${[...p].map((ch) => encodeURIComponent(ch)).join("")}/` : PATHS.index;
}

/** An index page is one with the index's heading; anything else (a maintenance or error page) is not kept or believed. */
const isIndexPage = (html: string): boolean => /<h1\b[^>]*>\s*New Zealand Companies (Index|by name:)/i.test(html);

/** The longest prefix the site's index matches: "ONE LIMITE" lists ONE LIMITED, "ONE LIMITED" lists nothing. */
export const MAX_PREFIX = 10;

/**
 * The index page for a prefix, read and checked.
 * - The site reads %20 in its index paths but not %26, and a raw "&" is a 404, so names with "&" after the prefix's start
 *   cannot be browsed: such a prefix is refused before anything is sent, and any other prefix the page does not echo back
 *   is reported as not read.
 * - The site matches at most 10 characters: a longer prefix is asked for by its first 10 and the names are filtered here.
 */
export async function readIndex(prefix: string): Promise<IndexPage & { prefix: string; asked: string; url: string }> {
  if (/[\u0000-\u001f\/\\?#%]/.test(prefix)) throw new InputError("a prefix cannot hold slashes, ?, #, % or control characters");
  const p = prefix.toUpperCase().replace(/\s+/g, " ");
  if (p.includes("&")) throw new InputError(`bizdb.co.nz's index cannot show prefixes with "&" (it does not read & in its index paths); search the name with bizdb_search instead`);
  const asked = [...p].slice(0, MAX_PREFIX).join("");
  let r;
  try {
    r = await get(indexPath(asked), { ttlMs: 24 * 3600_000, keep: (a) => isIndexPage(a.body.toString("utf8")) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new InputError(`bizdb.co.nz has no index page for "${asked}"`);
    throw e;
  }
  const html = r.body.toString("utf8");
  if (!isIndexPage(html)) throw new InputError(`the index page for "${asked}" is not an index page (${r.body.length} bytes); the site may be down or changed`);
  const x = parseIndex(html);
  if (asked && x.shown !== null && x.shown !== asked)
    throw new InputError(`bizdb.co.nz did not read the prefix "${asked}" (its page shows it as "${x.shown}"); search the name with bizdb_search instead`);
  const url = `${SITE}${indexPath(asked)}`;
  if (asked === p) return { ...x, prefix: p, asked, url };
  if (x.groups.length && !x.companies.length)
    throw new InputError(
      `bizdb.co.nz's index matches at most ${MAX_PREFIX} characters, and so many names start with "${asked}" that it only splits them further; search the name with bizdb_search instead`,
    );
  return { ...x, groups: [], companies: x.companies.filter((c) => c.name.toUpperCase().replace(/\s+/g, " ").startsWith(p)), prefix: p, asked, url };
}

export function register(server: McpServer): void {
  server.registerTool(
    "bizdb_index",
    {
      title: "The A-Z company index",
      description:
        "bizdb.co.nz's A-Z index of company names. With no prefix: the first characters (0–9, A–Z), each with its first and last " +
        "company. With a prefix the site either splits it further (sub-prefixes such as FO, FON with their first and last company) or, " +
        "once few enough names share it, lists every company whose name starts with it (NZBN, name, type, an address and its kind, " +
        "post code). A prefix can be asked for directly, such as \"FONTERRA\"; the site matches at most 10 characters, so a longer " +
        "one is read under its first 10 and filtered. Prefixes are capitals; spaces and punctuation count (\"F \" is names like " +
        "\"F 1 LIMITED\"), but the site cannot show prefixes containing \"&\".",
      inputSchema: {
        prefix: z.string().max(60).optional().describe("Start of the company name, e.g. \"F\", \"FON\", \"FONTERRA\" (default: the top of the index)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ prefix = "" }) => {
      try {
        const x = await readIndex(prefix);
        const p = x.prefix;
        const companies = x.companies.map((c) => ({ ...c, url: companyUrl(c.nzbn) }));
        const head = p
          ? x.groups.length
            ? `bizdb.co.nz index "${p}": ${plural(x.groups.length, "sub-prefix", "sub-prefixes")}${companies.length ? ` and ${plural(companies.length, "company", "companies")}` : ""}. Ask for a sub-prefix to go further.`
            : companies.length
              ? `bizdb.co.nz index "${p}": ${plural(companies.length, "company", "companies")} whose names start with "${p}".`
              : `No company names on bizdb.co.nz start with "${p}".`
          : `bizdb.co.nz company index: ${plural(x.groups.length, "first character")}.`;
        const lines = [
          head,
          ...(x.asked !== p ? [`(The site's index matches at most ${MAX_PREFIX} characters: these are the names under "${x.asked}" that start with "${p}".)`] : []),
          "",
          ...x.groups.map((g) => `${JSON.stringify(g.prefix)}${g.single ? " (one company)" : ""}: ${join([g.from?.name, g.single ? null : g.to?.name], " … ")}`),
          ...companies.map((c, i) => `${i + 1}. ${c.name} — ${join([`NZBN ${c.nzbn}`, c.type, c.address && `${c.address}${c.address_kind ? ` (${c.address_kind.toLowerCase()})` : ""}`, c.post_code && `post code ${c.post_code}`], " · ")}`),
        ];
        return ok(lines, { prefix: p, ...(x.asked !== p ? { site_prefix: x.asked } : {}), heading: x.heading, url: x.url, groups: x.groups, companies });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "bizdb_latest",
    {
      title: "The newest companies",
      description:
        "The newest companies on bizdb.co.nz's home page (about 21, recently registered or added), each with its NZBN and industry " +
        "classification. bizdb_company reads any of them in full.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const r = await get(PATHS.home, { ttlMs: 30 * 60_000, keep: (a) => /latest-box-element/.test(a.body.toString("utf8")) });
        const list = parseLatest(r.body.toString("utf8"));
        if (!list.length) throw new InputError("the home page had no list of latest companies; the site may have changed");
        return ok([`The ${plural(list.length, "latest company", "latest companies")} on bizdb.co.nz:`, ...list.map((c, i) => `${i + 1}. ${c.name} — NZBN ${c.nzbn}${c.industry ? ` · ${c.industry}` : ""}`)], { companies: list });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

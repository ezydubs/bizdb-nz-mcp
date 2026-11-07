/** This server's own state (bizdb_status), with the site's terms of use and privacy policy as text when asked. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InputError, SITE, UA, cacheInfo, clearCaches, get, pacing, stats } from "./http.js";
import { text } from "./html.js";
import { PATHS } from "./site.js";
import { cut, fail, kb, ok } from "./format.js";

/** Where the site says its data comes from (its terms page, read 7 November 2026). */
export const SOURCES = [
  "Companies: the New Zealand Companies Office register (companies, societies, trusts, partnerships), with NZBN register details (GST numbers, contact details, industry classifications).",
  "Map coordinates: LINZ Data Service (NZ Addresses), CC BY 4.0.",
  "Accredited employers (AEWV): Immigration New Zealand's published list, checked regularly; employers may choose not to be listed, so no entry does not mean not accredited.",
  "Charities: the Charities Register (Charities Services, Department of Internal Affairs), CC BY 3.0 NZ.",
];

/** The terms page's own text: what lies between the navigation bar and the footer. */
export function termsText(html: string): string {
  const a = html.indexOf("</nav>");
  const b = html.indexOf('class="container footer-content"');
  return text(a >= 0 && b > a ? html.slice(a + 6, b) : html);
}

export function register(server: McpServer): void {
  server.registerTool(
    "bizdb_status",
    {
      title: "This server's state",
      description:
        "This server's state: requests made to www.bizdb.co.nz and answered from the cache, the last error, the cache, the pacing and " +
        "the user agent, and where the site's data comes from. terms adds the site's terms of use and privacy policy as text. " +
        "clear_cache empties the in-memory cache. Requests are plain HTTPS from this computer (no browser).",
      inputSchema: {
        terms: z.boolean().optional().describe("Also read the site's terms of use and privacy policy page"),
        clear_cache: z.boolean().optional().describe("Empty the in-memory cache of pages and searches"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ terms, clear_cache }) => {
      try {
        if (clear_cache) clearCaches();
        let termsBody: string | null = null;
        if (terms) {
          const page = (await get(PATHS.terms, { ttlMs: 24 * 3600_000, keep: (a) => /Terms of use/i.test(a.body.toString("utf8")) })).body.toString("utf8");
          if (!/Terms of use/i.test(page)) throw new InputError("the terms page did not hold the terms; the site may be down or changed");
          termsBody = termsText(page);
        }
        const c = cacheInfo();
        const lines = [
          `www.bizdb.co.nz over plain HTTPS (Node fetch, no browser), one request at a time at least ${pacing() / 1000} s apart.`,
          `Requests: ${stats.requests} made, ${stats.cached} answered from the cache${clear_cache ? " (cache emptied now)" : ""}.`,
          stats.lastError ? `Last error (${stats.lastErrorAt}): ${stats.lastError}` : "No errors.",
          `Cache: ${c.entries} answers, ${kb(c.bytes)}.`,
          `User agent: ${UA}`,
          "",
          "The site's data:",
          ...SOURCES.map((s) => `- ${s}`),
          "bizdb.co.nz is run by Datafic sp. z o.o. (Poznań, Poland); contact@bizdb.co.nz. Its content is given \"as is\", without warranty.",
          ...(termsBody !== null ? ["", `Terms of use and privacy policy (${SITE}${PATHS.terms}):`, "", cut(termsBody, 20_000)] : []),
        ];
        return ok(lines, { stats, cache: c, pacing_ms: pacing(), user_agent: UA, sources: SOURCES, terms_url: `${SITE}${PATHS.terms}` });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

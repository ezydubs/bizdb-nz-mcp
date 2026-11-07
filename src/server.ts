#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { register as search } from "./search.js";
import { register as company } from "./company.js";
import { register as browse } from "./browse.js";
import { register as info } from "./info.js";

export const TOOL_NAMES = ["bizdb_search", "bizdb_industries", "bizdb_company", "bizdb_index", "bizdb_latest", "bizdb_status"] as const;

export const INSTRUCTIONS =
  "bizdb.co.nz, a free directory of New Zealand companies built from the Companies Office register, natively over the site's own " +
  "pages and form endpoints (plain HTTPS, no browser). It holds about 600,000 entities that are not removed: NZ limited, unlimited " +
  "and co-operative companies, overseas companies, incorporated societies, charitable trusts, limited partnerships, credit unions, " +
  "building, friendly and industrial & provident societies, and special bodies. A removed company has no page (HTTP 404), and the " +
  "site cannot search people. bizdb_search has every field of the site's company search (name text anywhere in the name, exact " +
  "NZBN, exact company number, entity type, industry classification text, accredited employers only), sorted by name or type, " +
  "with offset paging; the site gives no total count, and its search covers registered entities only (a company in liquidation " +
  "still has a page, read by NZBN). bizdb_industries suggests industry classification descriptions for a word. " +
  "bizdb_company reads a profile in full by NZBN, company number or exact name: status, type, dates, GST number, industry codes, " +
  "AEWV accreditation, current and past addresses with coordinates, former names, status history, contact details, shares and " +
  "shareholders, the ultimate holding company, directors and officers with their dates and suburb-level addresses, Charities " +
  "Register figures, and nearby and similar companies. bizdb_index browses the A-Z name index: the site splits a prefix " +
  "further or lists the names starting with it, and cannot browse prefixes containing \"&\". bizdb_latest lists the newest " +
  "companies. bizdb_status shows this server's state and the site's data sources and terms. Data comes from public registers " +
  "and may lag them (each profile says when it was last updated). A person's name " +
  "matching a director or shareholder is not proof that it is the same person: compare addresses and dates. The site asks " +
  "crawlers to keep off its /filter/ search endpoint, so search for what is needed rather than harvesting the register. Requests " +
  "are paced a second apart and cached. Results are text: a summary first, then JSON. Dates are ISO (YYYY-MM-DD).";

export function createServer(): McpServer {
  const server = new McpServer({ name: "bizdb-nz", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  search(server);
  company(server);
  browse(server);
  info(server);
  return server;
}

/** The started script as a file URL, symlinks resolved (the package's bin is a symlink; import.meta.url is the real path). */
function entryUrl(): string {
  const arg = process.argv[1];
  if (!arg) return "";
  try {
    return pathToFileURL(realpathSync(arg)).href;
  } catch {
    return pathToFileURL(arg).href;
  }
}
const entry = entryUrl();
if (entry && import.meta.url === entry) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    process.exit(0);
  };
  process.stdin.on("close", shutdown);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, shutdown);
}

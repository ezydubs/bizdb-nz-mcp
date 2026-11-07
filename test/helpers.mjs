import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { clearCaches, setPacing, setTransport } from "../dist/http.js";

/** A recorded fixture's text (people's names, e-mails and phone numbers scrubbed by scripts/record-fixtures.mjs). */
export const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** A fresh start for a test: no cache, no pacing. */
export function reset() {
  clearCaches();
  setPacing(0);
}

/** The site labels everything text/html, its JSON answers included. */
const CONTENT_TYPE = "text/html; charset=UTF-8";
/**
 * The site, faked: handler({method, url, path, form}) answers {status?, body, url?, headers?} for a request (url a URL
 * object, form the POST's URLSearchParams), or undefined for the site's 404 page. Returns {calls, restore}: every
 * request as "GET /path" or "POST /path?form", in order.
 */
export function serve(handler) {
  const calls = [];
  setTransport({
    async send(req) {
      const u = new URL(req.url);
      const form = new URLSearchParams(req.form ?? "");
      calls.push(req.method === "POST" ? `POST ${u.pathname} ${req.form ?? ""}` : `GET ${decodeURIComponent(u.pathname + u.search)}`);
      const r = (await handler({ method: req.method, url: u, path: u.pathname, form })) ?? { status: 404, body: fx("not-found.html") };
      if (r instanceof Error) throw r;
      const body = Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body ?? "", "utf8");
      return { status: r.status ?? 200, url: r.url ?? req.url, contentType: r.contentType ?? CONTENT_TYPE, headers: r.headers ?? {}, body };
    },
  });
  return { calls, restore: () => setTransport(null) };
}

/** The recorded company pages by NZBN. */
export const COMPANIES = {
  "9429040089218": "company-fonterra-nz.html",
  "9429042946779": "company-charity.html",
  "9429000000000": "company-gs1.html",
  "9429043146031": "company-lp.html",
  "9429043370498": "company-liquidation.html",
  "9429032666175": "company-aewv.html",
  "9429040402543": "company-airnz.html",
  "9429039809797": "company-overseas.html",
  "9429042765240": "company-incsoc.html",
  "9429030159549": "company-dairy.html",
};

/** A whole recorded site: company pages, the index, the home page, the terms, and searches answered from fixtures. */
export function site(extra = () => undefined) {
  return serve(async (r) => {
    const x = await extra(r);
    if (x !== undefined) return x;
    const m = /^\/company\/(\d{13})\/$/.exec(r.path);
    if (m) return COMPANIES[m[1]] ? { body: fx(COMPANIES[m[1]]) } : undefined;
    if (r.path === "/") return { body: fx("home.html") };
    if (r.path === "/terms-of-use-and-privacy-policy/") return { body: fx("terms.html") };
    if (r.path === "/index/") return { body: fx("index-top.html") };
    if (r.path === "/index/F/") return { body: fx("index-F.html") };
    if (r.path === "/index/FONTERRA/") return { body: fx("index-FONTERRA.html") };
    if (r.path === "/index/ZZZZZZ/") return { body: fx("index-ZZZZZZ.html") };
    if (r.path === "/industry-classification-prompt/") return { body: fx(/dairy/i.test(r.form.get("string") ?? "") ? "industry-dairy.json" : "industry-none.json") };
    if (r.path === "/filter/branch/results") return { body: searchAnswer(r.form) };
    return undefined;
  });
}

/** The recorded search pages: "fonterra" (17 hits) by 10 or 50 a page, the first 20 "dairy" hits, and nothing else. */
export function searchAnswer(form) {
  const name = form.get("branch_name") ?? "";
  const size = form.get("branch_row_count");
  const page = Number(form.get("branch_paging_position") ?? "1");
  if (/^fonterra$/i.test(name) && !form.get("branch_type")) {
    if (size === "50") return page === 1 ? fx("search-fonterra-50.html") : fx("search-none.html");
    if (size === "10") return page === 1 ? fx("search-fonterra-p1.html") : page === 2 ? fx("search-fonterra-p2.html") : fx("search-none.html");
    if (size === "20") return page === 1 ? fx("search-fonterra-50.html").replace(/selected="selected"/, "") : fx("search-none.html");
  }
  if (/^dairy$/i.test(name) && size === "20" && page === 1) return fx("search-dairy-20.html");
  if (form.get("branch_nzbn") === "9429040089218" || form.get("branch_source_register_unique_id") === "191954") return onlyHit(fx("search-fonterra-50.html"), "9429040089218");
  return fx("search-none.html");
}

/** A results page cut down to the one result with this NZBN. */
export function onlyHit(html, nzbn) {
  const parts = html.split('<div class="listing-body">');
  const keep = parts.slice(1).find((p) => p.includes(`/company/${nzbn}/`));
  assert.ok(keep, `no result ${nzbn} in the fixture`);
  return `${parts[0]}<div class="listing-body">${keep}`;
}

/** Assert a summary has no junk (undefined, NaN, null, [object …]) and return its text. */
export function clean(lines) {
  const t = Array.isArray(lines) ? lines.join("\n") : String(lines);
  assert.ok(!/undefined|NaN|\bnull\b|\[object /.test(t), `junk in summary:\n${t}`);
  return t;
}

/** An in-memory client connected to a fresh server. */
export async function connect() {
  const { createServer } = await import("../dist/server.js");
  const server = createServer();
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
/** Call a tool: {isError, text, summary, data, content}. */
export async function callTool(client, name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.find((c) => c.type === "text")?.text ?? "";
  const cut = text.indexOf("\n\n{");
  return { isError: r.isError === true, text, summary: cut < 0 ? text : text.slice(0, cut), data: cut < 0 ? null : JSON.parse(text.slice(cut + 2)), content: r.content };
}

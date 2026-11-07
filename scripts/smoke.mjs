// Live checks against www.bizdb.co.nz: each tool once or twice, a second apart (the server's own pacing). About 14 requests.
// Run with `npm run smoke`.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";

const server = createServer();
const client = new Client({ name: "smoke", version: "0" });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);

async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.find((c) => c.type === "text")?.text ?? "";
  const cut = text.indexOf("\n\n{");
  return { isError: r.isError === true, text, summary: cut < 0 ? text : text.slice(0, cut), data: cut < 0 ? null : JSON.parse(text.slice(cut + 2)) };
}

let failed = 0;
async function check(label, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`ok   ${label} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${label}: ${e.message.split("\n").slice(0, 6).join("\n     ")}`);
  }
}
const okResult = (r) => assert.ok(!r.isError, r.text.slice(0, 400));
const keyOf = (n) => n.replace(/[^A-Z0-9]/g, "");

await check("bizdb_search name, paged across two calls", async () => {
  const r = await call("bizdb_search", { name: "fonterra", limit: 10 });
  okResult(r);
  assert.equal(r.data.count, 10);
  assert.equal(r.data.more, true);
  assert.ok(r.data.companies.every((c) => /FONTERRA/.test(c.name) && /^9429\d{9}$/.test(c.nzbn)));
  const k = r.data.companies.map((c) => keyOf(c.name));
  assert.deepEqual([...k].sort(), k, "sorted by name, punctuation left out");
  const p = await call("bizdb_search", { name: "fonterra", offset: 10, limit: 10 });
  okResult(p);
  assert.ok(p.data.count >= 1);
  assert.ok(!p.data.companies.some((x) => r.data.companies.some((y) => y.nzbn === x.nzbn)), "no overlap between pages");
});

await check("bizdb_search type and industry, descending", async () => {
  const r = await call("bizdb_search", { type: "nz_limited", industry: "Dairy cattle farming", order: "desc", limit: 5 });
  okResult(r);
  assert.equal(r.data.count, 5);
  assert.ok(r.data.companies.every((c) => c.type === "NZ Limited Company" && c.industries.some((i) => /dairy cattle farming/i.test(i))));
  const k = r.data.companies.map((c) => keyOf(c.name));
  assert.deepEqual([...k].sort().reverse(), k, "descending");
});

await check("bizdb_search exact NZBN and company number", async () => {
  const n = await call("bizdb_search", { nzbn: "9429036748471" });
  okResult(n);
  assert.deepEqual(n.data.companies.map((c) => c.name), ["FONTERRA CO-OPERATIVE GROUP LIMITED"]);
  const c = await call("bizdb_search", { company_number: "1166320" });
  okResult(c);
  assert.equal(c.data.companies[0]?.nzbn, "9429036748471");
});

await check("bizdb_industries", async () => {
  const r = await call("bizdb_industries", { text: "dairy" });
  okResult(r);
  assert.ok(r.data.industries.includes("Dairy cattle farming"), JSON.stringify(r.data.industries));
});

await check("bizdb_company by NZBN: every section", async () => {
  const r = await call("bizdb_company", { nzbn: "9429040089218", sections: ["overview", "history", "addresses", "shares", "people", "nearby", "description"] });
  okResult(r);
  const d = r.data;
  assert.equal(d.name, "FONTERRA (NEW ZEALAND) LIMITED");
  assert.equal(d.company_number, "191954");
  assert.equal(d.registered, "1971-11-09");
  assert.ok(d.current_addresses.length >= 1);
  assert.ok(d.location && d.location.lat < -30 && d.location.lng > 160);
  assert.ok(d.names.length >= 2);
  assert.ok(d.allocations.length >= 1 && d.allocations.every((a) => a.holders.length));
  assert.ok(d.people.length >= 2 && d.people.some((p) => p.active));
  assert.ok(d.nearby.length >= 1);
  assert.match(d.description, /9429040089218/);
});

await check("bizdb_company by exact name and by company number", async () => {
  const r = await call("bizdb_company", { name: "fonterra limited", sections: ["overview"] });
  okResult(r);
  assert.equal(r.data.nzbn, "9429037784669");
  const n = await call("bizdb_company", { company_number: "826165", sections: ["overview", "charity"] });
  okResult(n);
  assert.match(n.data.charity?.registration_number ?? "", /^CC\d+$/);
});

await check("bizdb_company: a removed company has no page", async () => {
  const r = await call("bizdb_company", { nzbn: "9429039159199" });
  assert.equal(r.isError, true);
  assert.match(r.text, /no page for NZBN 9429039159199/);
});

await check("bizdb_index top and a prefix's companies", async () => {
  const t = await call("bizdb_index", {});
  okResult(t);
  assert.equal(t.data.groups.length, 36);
  const p = await call("bizdb_index", { prefix: "fonterra" });
  okResult(p);
  assert.ok(p.data.companies.length >= 10);
  assert.ok(p.data.companies.every((c) => c.name.startsWith("FONTERRA")));
});

await check("bizdb_latest", async () => {
  const r = await call("bizdb_latest", {});
  okResult(r);
  assert.ok(r.data.companies.length >= 10);
});

await check("bizdb_status with the terms", async () => {
  const r = await call("bizdb_status", { terms: true });
  okResult(r);
  assert.match(r.summary, /Terms of use and privacy policy/);
  // the removed company's 404 above is the only error expected
  assert.ok(r.data.stats.lastError === null || /HTTP 404/.test(r.data.stats.lastError), r.data.stats.lastError);
});

await client.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);

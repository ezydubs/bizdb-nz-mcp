import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { plan, searchForm, cleanQuery } from "../dist/search.js";
import { callTool, clean, connect, fx, onlyHit, reset, serve, site } from "./helpers.mjs";

let restore = () => {};
beforeEach(() => reset());
afterEach(() => restore());

test("search form: the site's field names in its order, type ids, the page only past page 1", () => {
  assert.deepEqual(searchForm({ name: "dairy farm", type: "charitable_trust", accredited_employer: true, sort: "type", order: "desc" }, 20, 1), [
    ["branch_nzbn", ""],
    ["branch_name", "dairy farm"],
    ["branch_source_register_unique_id", ""],
    ["branch_type", "17"],
    ["branch_industry_classification", ""],
    ["branch_aewv", "1"],
    ["branch_row_count", "20"],
    ["branch_sort_field", "type"],
    ["branch_sort_direction", "desc"],
  ]);
  assert.deepEqual(searchForm({ industry: "Dairy cattle farming" }, 50, 3).slice(-4), [
    ["branch_row_count", "50"],
    ["branch_sort_field", "name"],
    ["branch_sort_direction", "asc"],
    ["branch_paging_position", "3"],
  ]);
});

test("paging plan: the page size needing fewest requests, the smaller on a tie", () => {
  assert.deepEqual(plan(0, 10), { size: 10, first: 1, last: 1 });
  assert.deepEqual(plan(0, 20), { size: 20, first: 1, last: 1 });
  assert.deepEqual(plan(5, 10), { size: 20, first: 1, last: 1 });
  assert.deepEqual(plan(0, 50), { size: 50, first: 1, last: 1 });
  assert.deepEqual(plan(0, 200), { size: 50, first: 1, last: 4 });
  assert.deepEqual(plan(40, 20), { size: 20, first: 3, last: 3 });
  assert.deepEqual(plan(45, 10), { size: 20, first: 3, last: 3 });
  assert.deepEqual(plan(95, 10), { size: 10, first: 10, last: 11 }, "every size needs two pages: the smallest");
  assert.deepEqual(plan(100_000, 1), { size: 10, first: 10_001, last: 10_001 });
});

test("query checks: an NZBN is 13 digits, a number is digits, and something must be asked", () => {
  assert.throws(() => cleanQuery({}), /give at least one of/);
  assert.throws(() => cleanQuery({ name: "   " }), /give at least one of/);
  assert.throws(() => cleanQuery({ nzbn: "94290" }), /13 digits/);
  assert.throws(() => cleanQuery({ company_number: "12 34;x" }), /company number/);
  assert.deepEqual(cleanQuery({ nzbn: "9429 0400 89218", name: "  a   b " }), { sort: "name", order: "asc", name: "a b", nzbn: "9429040089218" });
  assert.deepEqual(cleanQuery({ accredited_employer: false, type: "nz_limited" }), { sort: "name", order: "asc", type: "nz_limited" });
});

test("bizdb_search: one site page for 20 rows, the form as the site posts it, results and more", async () => {
  const s = site();
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_search", { name: "Dairy" });
  assert.equal(r.isError, false, r.text);
  assert.equal(s.calls.length, 1);
  assert.equal(
    s.calls[0],
    "POST /filter/branch/results branch_nzbn=&branch_name=Dairy&branch_source_register_unique_id=&branch_type=&branch_industry_classification=&branch_aewv=&branch_row_count=20&branch_sort_field=name&branch_sort_direction=asc",
  );
  assert.equal(r.data.count, 20);
  assert.equal(r.data.more, true);
  assert.equal(r.data.next_offset, 20);
  assert.equal(r.data.site_pages_read, 1);
  const t = clean(r.summary);
  assert.match(t, /name contains "Dairy"/);
  assert.match(t, /1–20, more after these \(offset 20\)/);
  assert.match(t, /^1\. \S/m);
});

test("bizdb_search: rows across two site pages of 10 come out in order, and the last page says no more", async () => {
  const s = site();
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_search", { name: "fonterra", offset: 5, limit: 10 });
  assert.equal(r.isError, false, r.text);
  // offset 5 + 10 rows fit one page of 20: the recorded 50-row answer stands in for it
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0], /branch_row_count=20/);
  const all = JSON.parse(JSON.stringify(r.data.companies));
  assert.equal(all.length, 10);
  s.calls.length = 0;
  const p = await callTool(c, "bizdb_search", { name: "fonterra", offset: 10, limit: 10 });
  assert.equal(p.isError, false, p.text);
  assert.deepEqual(s.calls.map((x) => /branch_row_count=(\d+)/.exec(x)[1] + "/" + (/branch_paging_position=(\d+)/.exec(x)?.[1] ?? "1")), ["10/2"]);
  assert.equal(p.data.count, 7);
  assert.equal(p.data.more, false);
  assert.equal(p.data.next_offset, null);
  assert.match(clean(p.summary), /11–17, the last of them/);
  s.calls.length = 0;
  const two = await callTool(c, "bizdb_search", { name: "fonterra", offset: 0, limit: 17, sort: "name" });
  assert.equal(two.data.count, 17);
  assert.equal(s.calls.length, 0, "the same page of 20 as the first call, from the cache");
  assert.equal(two.data.more, false);
});

test("bizdb_search: two site pages read one after another when the window spans them", async () => {
  // rows 95..104 need two pages at every size, so pages 10 and 11 of 10 rows: the recorded pages 1 and 2 stand in for them
  const s = serve((r) => {
    const page = r.form.get("branch_paging_position");
    if (r.form.get("branch_row_count") !== "10") return { body: fx("search-none.html") };
    if (page === "10") return { body: fx("search-fonterra-p1.html").replace(/id="2"/, 'id="11"') };
    if (page === "11") return { body: fx("search-fonterra-p2.html") };
    return { body: fx("search-none.html") };
  });
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_search", { name: "fonterra", offset: 95, limit: 10 });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(s.calls.map((x) => /branch_paging_position=(\d+)/.exec(x)?.[1]), ["10", "11"]);
  const p1 = fx("search-fonterra-p1.html");
  const p2 = fx("search-fonterra-p2.html");
  const nz = (html) => [...html.matchAll(/href="\/company\/(\d{13})\/"/g)].map((m) => m[1]);
  assert.deepEqual(r.data.companies.map((h) => h.nzbn), [...nz(p1).slice(5), ...nz(p2).slice(0, 5)]);
  assert.equal(r.data.more, true, "rows 105 and 106 follow");
  assert.equal(r.data.site_pages_read, 2);
});

test("bizdb_search: past the end, nothing found, and a type filter as the site's id", async () => {
  const s = site();
  restore = s.restore;
  const c = await connect();
  const past = await callTool(c, "bizdb_search", { name: "fonterra", offset: 40, limit: 10 });
  assert.equal(past.isError, false, past.text);
  assert.equal(past.data.count, 0);
  assert.match(past.summary, /No companies past the first 40/);
  const none = await callTool(c, "bizdb_search", { name: "zzqq", type: "overseas_asic" });
  assert.equal(none.isError, false);
  assert.match(none.summary, /No companies where name contains "zzqq", Overseas ASIC Company\. The search covers registered entities only/);
  assert.match(s.calls.at(-1), /branch_type=3&/);
  const bad = await callTool(c, "bizdb_search", {});
  assert.equal(bad.isError, true);
  assert.match(bad.text, /give at least one of/);
  assert.equal(s.calls.length, 2, "nothing sent for a bad query");
});

test("bizdb_search: an answer that is not results is an error, not an empty list", async () => {
  const s = serve(() => ({ body: "<html><body>Service temporarily unavailable</body></html>" }));
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_search", { name: "x" });
  assert.equal(r.isError, true);
  assert.match(r.text, /something other than results/);
});

test("bizdb_industries: suggestions, none, and something that is not JSON", async () => {
  const s = site((r) => (r.path === "/industry-classification-prompt/" && r.form.get("string") === "broken" ? { body: "<html>oops</html>" } : undefined));
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_industries", { text: "  dairy " });
  assert.equal(r.isError, false, r.text);
  assert.equal(s.calls[0], "POST /industry-classification-prompt/ string=dairy");
  assert.ok(r.data.industries.includes("Dairy cattle farming"));
  assert.match(clean(r.summary), /industry classifications for "dairy"/);
  const none = await callTool(c, "bizdb_industries", { text: "zzqq" });
  assert.equal(none.isError, false);
  assert.deepEqual(none.data.industries, []);
  assert.match(none.summary, /No industry classifications match "zzqq"/);
  const broken = await callTool(c, "bizdb_industries", { text: "broken" });
  assert.equal(broken.isError, true);
  assert.match(broken.text, /other than JSON/);
});

test("bizdb_company by NZBN: the summary and every default section", async () => {
  const s = site();
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_company", { nzbn: "9429040089218" });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(s.calls, ["GET /company/9429040089218/"]);
  const t = clean(r.summary);
  assert.match(t, /^FONTERRA \(NEW ZEALAND\) LIMITED — NZ Limited Company \(Ltd\), Registered/);
  assert.match(t, /NZBN 9429040089218 · company number 191954 · registered 9 Nov 1971 \(54 years\)/);
  assert.match(t, /Former names: Nzmp New Zealand Limited \(2002–2004\)/);
  assert.match(t, /Shares: 13,965,744 in 2 allocations: Fonterra Limited \(NZBN 9429037784669\) 13,965,743 \(100%\)/);
  assert.match(t, /Ultimate holding company: Fonterra Co-operative Group Limited \(Coop, 1166320, NZ\)/);
  assert.match(t, /Directors: 2 current — Person \d+ since 29 Aug 2023; Person \d+ since 16 Feb 2026; 17 former/);
  for (const k of ["names", "previous_addresses", "address_timeline", "contact", "financial", "allocations", "people", "charity", "nearby", "similar"]) assert.ok(k in r.data, k);
  assert.ok(!("description" in r.data));
  assert.deepEqual(r.data.people_counts, { current: 2, former: 17 });
  // a second call is answered from the cache
  await callTool(c, "bizdb_company", { nzbn: "9429040089218" });
  assert.equal(s.calls.length, 1);
});

test("bizdb_company: sections, current only, and long lists cut with a count of what was left out", async () => {
  const s = site();
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_company", { nzbn: "9429040402543", sections: ["people", "shares", "description"], current_only: true, max_items: 3 });
  assert.equal(r.isError, false, r.text);
  assert.ok(!("names" in r.data) && !("previous_shareholders" in r.data) && !("contact" in r.data));
  assert.equal(r.data.people.length, 3);
  assert.ok(r.data.people.every((p) => p.active));
  assert.equal(r.data.allocations.length, 3);
  assert.deepEqual(r.data.allocations.map((a) => a.number), [10, 9, 8], "largest first, the site's numbers kept");
  assert.equal(r.data.omitted.allocations, 7);
  assert.equal(r.data.allocations_may_be_partial, true, "ten allocations shown");
  assert.ok(r.data.omitted.people >= 1);
  assert.match(r.data.description, /Air New Zealand Limited/);
  const t = clean(r.summary);
  assert.match(t, /Australian Business Number: 70000312685/);
  assert.match(t, /in 10 allocations: .*\(51\.64%\).*bizdb lists no more than 10 allocations/);
});

test("bizdb_company: a removed or unknown NZBN says why there is no page", async () => {
  const s = site();
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_company", { nzbn: "9429039159199" });
  assert.equal(r.isError, true);
  assert.match(r.text, /no page for NZBN 9429039159199: there is no such NZBN, or the entity has been removed/);
  const bad = await callTool(c, "bizdb_company", { nzbn: "12345" });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /13 digits/);
  const nothing = await callTool(c, "bizdb_company", {});
  assert.equal(nothing.isError, true);
  assert.match(nothing.text, /give nzbn, company_number or name/);
});

test("bizdb_company: several NZBNs, one of them missing", async () => {
  const s = site();
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_company", { nzbn: ["9429042946779", "9429039159199", "9429042946779"], sections: ["charity"] });
  assert.equal(r.isError, false, r.text);
  assert.equal(s.calls.length, 2, "duplicates fetched once");
  assert.equal(r.data.companies.length, 1);
  assert.equal(r.data.errors.length, 1);
  assert.equal(r.data.errors[0].nzbn, "9429039159199");
  assert.match(r.summary, /^1 company \(1 not found\):/);
  assert.match(r.summary, /Charity: CC33239 · Deregistered \(31 Dec 2017\) · year ended 31 Dec 2016: income \$100,565, expenditure \$106,147/);
});

test("bizdb_company by company number and by name: exact match, a single hit, or the candidates", async () => {
  const s = site((r) => {
    if (r.path !== "/filter/branch/results") return undefined;
    const name = r.form.get("branch_name");
    if (name === "Fonterra (New Zealand) Limited" || name === "fonterra") return { body: fx("search-fonterra-50.html") };
    if (name === "fonterra (new") return { body: onlyHit(fx("search-fonterra-50.html"), "9429040089218") };
    return undefined;
  });
  restore = s.restore;
  const c = await connect();
  const byNum = await callTool(c, "bizdb_company", { company_number: "191954", sections: ["overview"] });
  assert.equal(byNum.isError, false, byNum.text);
  assert.match(s.calls[0], /branch_source_register_unique_id=191954/);
  assert.equal(s.calls[1], "GET /company/9429040089218/");
  const noNum = await callTool(c, "bizdb_company", { company_number: "999999999" });
  assert.equal(noNum.isError, true);
  assert.match(noNum.text, /no registered company on bizdb\.co\.nz has company number 999999999 \(the site's search finds registered entities only: a company in liquidation is read by its NZBN/);
  s.calls.length = 0;
  const exact = await callTool(c, "bizdb_company", { name: "Fonterra (New Zealand) Limited", sections: ["overview"] });
  assert.equal(exact.isError, false, exact.text);
  assert.equal(exact.data.nzbn, "9429040089218", "the exact name among 17 results");
  s.calls.length = 0;
  const single = await callTool(c, "bizdb_company", { name: "fonterra (new", sections: ["overview"] });
  assert.equal(single.isError, false, single.text);
  assert.equal(single.data.nzbn, "9429040089218", "the only result, though not named exactly that");
  s.calls.length = 0;
  const many = await callTool(c, "bizdb_company", { name: "fonterra" });
  assert.equal(many.isError, false);
  assert.deepEqual(s.calls.map((x) => x.split(" ").slice(0, 2).join(" ")), ["GET /index/FONTERRA/", "POST /filter/branch/results"], "the index, then the search; no company page when the name is not unique");
  assert.match(many.summary, /^17 companies have "fonterra" in their name and none is named exactly that/);
  assert.equal(many.data.candidates.length, 15);
  const none = await callTool(c, "bizdb_company", { name: "zzqq nothing" });
  assert.equal(none.isError, true);
  assert.match(none.text, /no registered company on bizdb\.co\.nz has "zzqq nothing" in its name/);
});

test("bizdb_index: the top, a letter (lower case asked), a prefix's companies, an empty prefix, a refused path", async () => {
  const s = site();
  restore = s.restore;
  const c = await connect();
  const top = await callTool(c, "bizdb_index", {});
  assert.equal(top.isError, false, top.text);
  assert.match(clean(top.summary), /^bizdb\.co\.nz company index: 36 first characters\./);
  const f = await callTool(c, "bizdb_index", { prefix: "f" });
  assert.equal(f.isError, false, f.text);
  assert.equal(s.calls.at(-1), "GET /index/F/");
  assert.match(f.summary, /"F9" \(one company\): F9 LIMITED/);
  assert.match(f.summary, /^"F ": F 1 LIMITED … F Y DECORATOR LIMITED$/m);
  const fon = await callTool(c, "bizdb_index", { prefix: "Fonterra" });
  assert.equal(fon.data.companies.length, 17);
  assert.match(clean(fon.summary), /17 companies whose names start with "FONTERRA"/);
  assert.equal(fon.data.url, "https://www.bizdb.co.nz/index/FONTERRA/");
  const z = await callTool(c, "bizdb_index", { prefix: "zzzzzz" });
  assert.match(z.summary, /No company names on bizdb\.co\.nz start with "ZZZZZZ"/);
  const missing = await callTool(c, "bizdb_index", { prefix: "Q" });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /no index page for "Q"/);
  const slash = await callTool(c, "bizdb_index", { prefix: "a/b" });
  assert.equal(slash.isError, true);
  assert.match(slash.text, /slashes/);
});

test("bizdb_latest: the home page's newest companies", async () => {
  const s = site();
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_latest", {});
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.companies.length, 21);
  assert.match(clean(r.summary), /^The 21 latest companies on bizdb\.co\.nz:\n1\. /);
  const empty = serve(() => ({ body: "<html><body>maintenance</body></html>" }));
  restore = empty.restore;
  reset();
  const bad = await callTool(c, "bizdb_latest", {});
  assert.equal(bad.isError, true);
  assert.match(bad.text, /no list of latest companies/);
});

test("bizdb_status: counts, the data sources, the terms page, and emptying the cache", async () => {
  const s = site();
  restore = s.restore;
  const c = await connect();
  await callTool(c, "bizdb_latest", {});
  await callTool(c, "bizdb_latest", {});
  const r = await callTool(c, "bizdb_status", { terms: true });
  assert.equal(r.isError, false, r.text);
  assert.match(r.summary, /answered from the cache/);
  assert.match(r.summary, /LINZ Data Service/);
  assert.match(r.summary, /Terms of use and privacy policy \(https:\/\/www\.bizdb\.co\.nz\/terms-of-use-and-privacy-policy\/\):/);
  assert.match(r.summary, /Datafic sp z o\.o\./);
  assert.ok(!/Company search\s*\n\s*Company index/.test(r.summary.split("Terms of use and privacy policy (")[1] ?? ""), "the navigation bar is left out");
  assert.ok(r.data.stats.cached >= 1);
  const cleared = await callTool(c, "bizdb_status", { clear_cache: true });
  assert.match(cleared.summary, /cache emptied now/);
  assert.equal(cleared.data.cache.entries, 0);
});

// Regressions for the independent review of 7 November 2026: each test pins a finding that was confirmed and fixed.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseCompany, parseIndex, parseResults } from "../dist/parse.js";
import { get } from "../dist/http.js";
import { callTool, clean, connect, fx, onlyHit, reset, serve, site } from "./helpers.mjs";

let restore = () => {};
beforeEach(() => reset());
afterEach(() => restore());

test("#1 numbered address lists ('Address #4: …') and the principal place of activity are read", () => {
  const air = parseCompany(fx("company-airnz.html"));
  assert.ok(air.addresses.other_active.length >= 4, `other active: ${air.addresses.other_active.length}`);
  assert.ok(air.addresses.previous.length >= 4, `previous: ${air.addresses.previous.length}`);
  const mufg = air.addresses.other_active.find((a) => /Mufg Corporate Markets/.test(a.address));
  assert.deepEqual([mufg.kinds, mufg.from, mufg.to], [["shareregister"], "2025-03-11", null]);
  assert.ok(!/^Address/.test(mufg.address), "the 'Address #N:' label is not part of the address");
  assert.deepEqual(air.addresses.principal_place.map((a) => a.address), ["185 Fanshawe Street, Auckland, 1010 New Zealand"]);
  const gs1 = parseCompany(fx("company-gs1.html"));
  assert.deepEqual(gs1.addresses.other_active.map((a) => [a.kinds.join("/"), a.from, a.to]), [["registered", "2026-07-20", null]]);
  assert.match(gs1.addresses.other_active[0].address, /^96 The Terrace/);
  assert.ok(gs1.addresses.previous.length >= 1, "the singular 'Previous address' heading too");
  const liq = parseCompany(fx("company-liquidation.html"));
  assert.deepEqual(liq.addresses.other_active.map((a) => [a.kinds.join("/"), a.from]), [["service/registered", "2026-02-25"]]);
  assert.match(liq.addresses.other_active[0].address, /^344 Great South Road/);
  assert.deepEqual(liq.addresses.principal_place.map((a) => a.address), ["28f Lambie Drive, Papatoetoe, Auckland, 2104 New Zealand"]);
  assert.ok(liq.addresses.previous.length >= 3);
});

test("#1 the summary shows other active addresses and the principal place", async () => {
  const s = site();
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_company", { nzbn: "9429043370498" });
  assert.equal(r.isError, false, r.text);
  const t = clean(r.summary);
  assert.match(t, /Other active address: 344 Great South Road.*\(service, registered; since 25 Feb 2026\)/);
  assert.match(t, /Principal place of activity: 28f Lambie Drive/);
  assert.equal(r.data.other_active_addresses.length, 1);
  assert.equal(r.data.principal_place_of_activity.length, 1);
});

test("#2 a role whose termination date has passed is not current, whatever icon the site draws", () => {
  const gs1 = parseCompany(fx("company-gs1.html"));
  const ended = gs1.roles.filter((r) => r.terminated);
  assert.ok(ended.length >= 1);
  assert.ok(ended.every((r) => !r.active));
  for (const f of ["company-gs1.html", "company-airnz.html", "company-overseas.html", "company-dairy.html", "company-aewv.html", "company-liquidation.html", "company-fonterra-nz.html"])
    for (const r of parseCompany(fx(f)).roles) if (r.terminated && r.terminated <= "2026-11-07") assert.equal(r.active, false, `${f}: ${r.name}`);
  // a termination still to come leaves the role current
  const later = parseCompany(fx("company-gs1.html"), "", "2026-01-01");
  assert.ok(later.roles.some((r) => r.terminated && r.active));
});

test("#3 a prefix with & is refused before anything is sent; a prefix the site misreads is reported, not 'no names'", async () => {
  const s = serve((r) =>
    r.path.startsWith("/index/") ? { body: fx("index-ZZZZZZ.html").replace(/by name: ZZZZZZ/, "by name: AJ %2C RA") } : undefined,
  );
  restore = s.restore;
  const c = await connect();
  const amp = await callTool(c, "bizdb_index", { prefix: "aj & ra" });
  assert.equal(amp.isError, true);
  assert.match(amp.text, /cannot show prefixes with "&"/);
  assert.equal(s.calls.length, 0);
  const comma = await callTool(c, "bizdb_index", { prefix: "AJ , RA" });
  assert.equal(comma.isError, true);
  assert.match(comma.text, /did not read the prefix "AJ , RA" \(its page shows it as "AJ %2C RA"\)/);
  const bad = await callTool(c, "bizdb_index", { prefix: "50%" });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /cannot hold slashes, \?, #, %/);
});

test("#4 an unlinked index row is 'one company' only when its first and last company are the same", async () => {
  const f = parseIndex(fx("index-F.html"));
  const fq = f.groups.find((g) => g.prefix === "FQ");
  assert.deepEqual([fq.linked, fq.single], [false, false]);
  assert.notEqual(fq.from.nzbn, fq.to.nzbn);
  const s = site();
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_index", { prefix: "F" });
  assert.match(r.summary, /^"F9" \(one company\): F9 LIMITED$/m);
  assert.match(r.summary, /^"FQ": FQR NEW ZEALAND LIMITED … FQS INTERIOR LIMITED$/m);
  assert.match(r.summary, /^"FZ": FZ INVESTMENT LIMITED … FZ-SURVEY LIMITED$/m);
});

test("#5 an exact name is found in the A-Z index (under its first 10 characters) however many names contain it", async () => {
  const index = fx("index-FONTERRA.html").replace(/by name: FONTERRA</, "by name: FONTERRA (<");
  const s = site((r) => (r.path === "/index/FONTERRA%20(/" ? { body: index } : undefined));
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_company", { name: "Fonterra (New Zealand) Limited", sections: ["overview"] });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(s.calls, ["GET /index/FONTERRA (/", "GET /company/9429040089218/"], "no search needed");
  assert.deepEqual(r.data.lookup, { nzbn: "9429040089218", exact: true, via: "index" });
});

test("the index matches at most 10 characters: a longer prefix is read under its first 10 and filtered", async () => {
  const s = site((r) => {
    if (r.path === "/index/FONTERRA%20L/") return { body: fx("index-FONTERRA.html").replace(/by name: FONTERRA</, "by name: FONTERRA L<") };
    if (r.path === "/index/NEW%20ZEALAN/") return { body: fx("index-F.html").replace(/by name: F</, "by name: NEW ZEALAN<") };
    return undefined;
  });
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_index", { prefix: "fonterra  limited" });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(s.calls, ["GET /index/FONTERRA L/"]);
  assert.deepEqual(r.data.companies.map((x) => x.name), ["FONTERRA LIMITED"]);
  assert.equal(r.data.prefix, "FONTERRA LIMITED", "spaces collapsed");
  assert.equal(r.data.site_prefix, "FONTERRA L");
  assert.match(clean(r.summary), /matches at most 10 characters: these are the names under "FONTERRA L" that start with "FONTERRA LIMITED"/);
  const split = await callTool(c, "bizdb_index", { prefix: "New Zealand Post" });
  assert.equal(split.isError, true);
  assert.match(split.text, /matches at most 10 characters, and so many names start with "NEW ZEALAN" that it only splits them further/);
});

test("#5 a name not in the first 50 search matches is not claimed to be missing", async () => {
  // 50 results and a next page, none named exactly "One Limited"
  const fifty = fx("search-dairy-20.html");
  const s = serve((r) => (r.path === "/filter/branch/results" ? { body: fifty.replace(/<option value="20" selected="selected">/, '<option value="50" selected="selected">') } : undefined));
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_company", { name: "One Limited" });
  assert.equal(r.isError, false, r.text);
  assert.match(r.summary, /^more than 50 companies have "One Limited" in their name and none of the first 50 \(by name\) is named exactly that/);
  assert.ok(!/and none is named exactly that/.test(r.summary));
});

test("#5 a single inexact match says it is not an exact match", async () => {
  const s = site((r) => (r.path === "/filter/branch/results" && r.form.get("branch_name") === "fonterra (new" ? { body: onlyHit(fx("search-fonterra-50.html"), "9429040089218") } : undefined));
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_company", { name: "fonterra (new", sections: ["overview"] });
  assert.equal(r.isError, false, r.text);
  assert.match(r.summary, /^No company is named exactly "fonterra \(new"; this is the only one whose name contains it\./);
  assert.deepEqual(r.data.lookup, { nzbn: "9429040089218", exact: false, via: "search" });
});

test("#6 a maintenance page in place of an index page is an error and is not cached", async () => {
  let n = 0;
  const s = serve((r) => (n++, r.path === "/index/FON/" ? { body: "<html><body><h1>Down for maintenance</h1></body></html>" } : undefined));
  restore = s.restore;
  const c = await connect();
  const a = await callTool(c, "bizdb_index", { prefix: "FON" });
  assert.equal(a.isError, true);
  assert.match(a.text, /is not an index page/);
  await callTool(c, "bizdb_index", { prefix: "FON" });
  assert.equal(n, 2, "asked again: the bad page was not kept");
});

test("#6 industry suggestions and the home page are not cached when they are not what was asked for", async () => {
  let n = 0;
  const s = serve(() => (n++, { body: "<html>Service Unavailable</html>" }));
  restore = s.restore;
  const c = await connect();
  for (let i = 0; i < 2; i++) assert.equal((await callTool(c, "bizdb_industries", { text: "dairy" })).isError, true);
  for (let i = 0; i < 2; i++) assert.equal((await callTool(c, "bizdb_latest", {})).isError, true);
  assert.equal(n, 4);
});

test("a role the site gives without a name is not a person called 'Director'", () => {
  const air = parseCompany(fx("company-airnz.html"));
  const nameless = air.roles.filter((r) => !r.name);
  assert.ok(nameless.length >= 1);
  assert.ok(nameless.every((r) => r.role === "Director"));
  assert.ok(!air.roles.some((r) => r.name === "Director"));
});

test("a director's earlier addresses are kept, newest first", () => {
  const d = parseCompany(fx("company-dairy.html"));
  const two = d.roles.find((r) => r.addresses.length > 1);
  assert.ok(two, "someone with two addresses");
  assert.equal(two.address, two.addresses[0].address);
  assert.equal(two.address_since, two.addresses[0].from);
  assert.ok(two.addresses[0].from > two.addresses[1].from);
});

test("the search's page size is checked against the rows asked for", async () => {
  const s = serve(() => ({ body: fx("search-fonterra-p1.html") }));
  restore = s.restore;
  const c = await connect();
  const r = await callTool(c, "bizdb_search", { name: "fonterra", limit: 20 });
  assert.equal(r.isError, true);
  assert.match(r.text, /answered with 10 rows a page instead of the 20 asked for/);
  assert.equal(parseResults(fx("search-fonterra-p1.html")).sort, "name");
});

test("the map's fallback reads the main point when the page's JSON is broken", () => {
  const broken = fx("company-charity.html").replace('"types":["osm"]', '"types":["osm",]');
  assert.notEqual(broken, fx("company-charity.html"), "the fixture was changed");
  const c = parseCompany(broken);
  assert.deepEqual([c.location?.lat, c.location?.lng], [-36.7980232, 174.7414227]);
  assert.equal(c.name, "AUCKLAND CHILDREN'S THEATRE ACADEMY TRUST");
  assert.deepEqual(c.nearby.map((n) => n.lat), c.nearby.map(() => undefined), "no points from a broken map");
});

test("identical requests at the same time share one trip to the site", async () => {
  let n = 0;
  const s = serve(async () => {
    n++;
    await new Promise((r) => setTimeout(r, 20));
    return { body: "<p>once</p>" };
  });
  restore = s.restore;
  const [a, b] = await Promise.all([get("/same/"), get("/same/")]);
  assert.equal(n, 1);
  assert.deepEqual([a.body.toString(), b.body.toString()], ["<p>once</p>", "<p>once</p>"]);
  assert.equal([a.cached, b.cached].filter(Boolean).length, 1);
});

test("an unlinked index prefix keeps its trailing space ('FO ' is not 'FO')", () => {
  const f = parseIndex(fx("index-F.html").replace("<td>F9</td>", "<td>F9 </td>"));
  assert.ok(f.groups.some((g) => g.prefix === "F9 " && !g.linked));
  assert.ok(f.groups.some((g) => g.prefix === "FQ"), "no space added where there is none");
});

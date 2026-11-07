import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, InputError, absolute, errorMessage, formBody, get, isSiteUrl, post, setPacing, siteRedirect, stats } from "../dist/http.js";
import { reset, serve } from "./helpers.mjs";

let restore = () => {};
beforeEach(() => reset());
afterEach(() => restore());

test("addresses: bizdb.co.nz and http:// become https://www.bizdb.co.nz; other hosts are refused", async () => {
  assert.equal(absolute("/index/"), "https://www.bizdb.co.nz/index/");
  assert.equal(absolute("company/1/"), "https://www.bizdb.co.nz/company/1/");
  assert.equal(absolute("http://bizdb.co.nz/x/"), "https://www.bizdb.co.nz/x/");
  assert.ok(isSiteUrl("https://www.bizdb.co.nz/"));
  assert.ok(!isSiteUrl("https://evil.example/"));
  assert.ok(!isSiteUrl("https://www.bizdb.co.nz:8443/"));
  assert.equal(siteRedirect("https://www.bizdb.co.nz/company/1/", "https://www.bizdb.co.nz/company/1"), "https://www.bizdb.co.nz/company/1/");
  assert.equal(siteRedirect("http://bizdb.co.nz/", "https://www.bizdb.co.nz/"), "https://www.bizdb.co.nz/");
  assert.equal(siteRedirect("https://elsewhere.example/", "https://www.bizdb.co.nz/"), null);
  await assert.rejects(get("https://elsewhere.example/x"), (e) => e instanceof InputError && /not a www\.bizdb\.co\.nz address/.test(e.message));
});

test("forms are written as jQuery writes them: spaces as +, the rest percent-escaped", () => {
  assert.equal(formBody([["branch_name", "a & b (nz)"], ["x", ""]]), "branch_name=a+%26+b+(nz)&x=");
  assert.equal(formBody([["string", "café/ō"]]), "string=caf%C3%A9%2F%C5%8D");
});

test("pacing: requests one at a time, the gap apart", async () => {
  const starts = [];
  const s = serve(async () => {
    starts.push(Date.now());
    await new Promise((r) => setTimeout(r, 5));
    return { body: "<p>ok</p>" };
  });
  restore = s.restore;
  setPacing(60);
  await Promise.all([get("/a/", { ttlMs: 0 }), get("/b/", { ttlMs: 0 }), post("/c/", [["x", "1"]], { ttlMs: 0 })]);
  assert.equal(starts.length, 3);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 55, `gap ${starts[i] - starts[i - 1]} ms`);
});

test("retries: once on a 503 or a dropped connection, never on 403 or 429, never twice", async () => {
  let n = 0;
  let s = serve(() => (++n === 1 ? { status: 503, body: "busy" } : { body: "<p>fine</p>" }));
  restore = s.restore;
  assert.equal((await get("/x/", { ttlMs: 0 })).body.toString(), "<p>fine</p>");
  assert.equal(n, 2);
  n = 0;
  s = serve(() => (++n === 1 ? new ApiError(0, "network error: the site reset the connection", "https://www.bizdb.co.nz/y/") : { body: "<p>back</p>" }));
  assert.equal((await get("/y/", { ttlMs: 0 })).body.toString(), "<p>back</p>");
  assert.equal(n, 2);
  n = 0;
  s = serve(() => (n++, { status: 503, body: "still busy" }));
  await assert.rejects(get("/z/", { ttlMs: 0 }), (e) => e instanceof ApiError && e.status === 503);
  assert.equal(n, 2);
  for (const status of [403, 429]) {
    n = 0;
    s = serve(() => (n++, { status, body: "go away", headers: status === 429 ? { "retry-after": "30" } : {} }));
    await assert.rejects(get("/w/", { ttlMs: 0 }), (e) => {
      assert.equal(e.status, status);
      assert.match(errorMessage(e), status === 429 ? /asked for fewer requests \(HTTP 429, retry after 30 s\)/ : /refused the request \(HTTP 403\)/);
      assert.match(errorMessage(e), /does not work around a refusal/);
      return true;
    });
    assert.equal(n, 1);
  }
  n = 0;
  s = serve(() => (n++, new ApiError(0, "timed out after 60 s", "https://www.bizdb.co.nz/t/")));
  await assert.rejects(get("/t/", { ttlMs: 0 }), /timed out/);
  assert.equal(n, 1, "a timeout is not retried");
  restore = s.restore;
});

test("errors: a 404 is 'not found', other codes say their number and where", async () => {
  const s = serve((r) => (r.path === "/gone/" ? undefined : { status: 500, body: "boom" }));
  restore = s.restore;
  await assert.rejects(get("/gone/"), (e) => e.status === 404 && /HTTP 404 for \/gone\/: not found/.test(errorMessage(e)));
  await assert.rejects(get("/boom/"), (e) => e.status === 500 && /answered HTTP 500 for \/boom\//.test(errorMessage(e)));
  assert.match(stats.lastError, /HTTP 500/);
});

test("an answer that ended up off the site is refused", async () => {
  const s = serve(() => ({ status: 301, url: "https://elsewhere.example/", body: "" }));
  restore = s.restore;
  await assert.rejects(get("/moved/"), /sent the request on to another address \(https:\/\/elsewhere\.example\/\)/);
});

test("the cache: a POST is kept by its form, an answer the caller rejects is not kept", async () => {
  let n = 0;
  const s = serve((r) => (n++, { body: `<p>${r.form.get("q") ?? r.path}</p>` }));
  restore = s.restore;
  const a = await post("/f/", [["q", "1"]]);
  const b = await post("/f/", [["q", "1"]]);
  const c = await post("/f/", [["q", "2"]]);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(c.body.toString(), "<p>2</p>");
  assert.equal(n, 2);
  await get("/k/", { keep: () => false });
  await get("/k/", { keep: () => false });
  assert.equal(n, 4, "not kept, so asked again");
  await get("/k/", { ttlMs: 0 });
  assert.equal(n, 5);
});

test("the native transport: a real fetch is never made in the tests (the transport is faked)", async () => {
  const s = serve(() => ({ body: "<p>faked</p>" }));
  restore = s.restore;
  const r = await get("/");
  assert.equal(r.body.toString(), "<p>faked</p>");
  assert.deepEqual(s.calls, ["GET /"]);
});

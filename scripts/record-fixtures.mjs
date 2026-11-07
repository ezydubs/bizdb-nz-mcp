// Records the test fixtures from the live site, 1.2 s apart, and scrubs the company pages (scripts/scrub.mjs): people's
// names become "Person N" / "Holder N", their street addresses are cut to the locality, e-mail addresses become
// userN@example.com and phone numbers 64 9 555 01NN. Run with `node scripts/record-fixtures.mjs` after `npm run build`.
import { mkdirSync, writeFileSync } from "node:fs";
import { formBody, UA } from "../dist/http.js";
import { searchForm } from "../dist/search.js";
import { scrub } from "./scrub.mjs";

const SITE = "https://www.bizdb.co.nz";
const OUT = new URL("../test/fixtures/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const pages = [
  ["home.html", "/"],
  ["not-found.html", "/company/9429000000001/"],
  ["terms.html", "/terms-of-use-and-privacy-policy/"],
  ["company-fonterra-nz.html", "/company/9429040089218/"],
  ["company-charity.html", "/company/9429042946779/"],
  ["company-gs1.html", "/company/9429000000000/"],
  ["company-lp.html", "/company/9429043146031/"],
  ["company-liquidation.html", "/company/9429043370498/"],
  ["company-aewv.html", "/company/9429032666175/"],
  ["company-airnz.html", "/company/9429040402543/"],
  ["company-overseas.html", "/company/9429039809797/"],
  ["company-incsoc.html", "/company/9429042765240/"],
  ["company-dairy.html", "/company/9429030159549/"],
  ["index-top.html", "/index/"],
  ["index-F.html", "/index/F/"],
  ["index-FONTERRA.html", "/index/FONTERRA/"],
  ["index-ZZZZZZ.html", "/index/ZZZZZZ/"],
];
const searches = [
  ["search-fonterra-p1.html", { name: "fonterra" }, 10, 1],
  ["search-fonterra-p2.html", { name: "fonterra" }, 10, 2],
  ["search-fonterra-50.html", { name: "fonterra" }, 50, 1],
  ["search-dairy-20.html", { name: "dairy" }, 20, 1],
  ["search-none.html", { name: "zzqqxxnothing" }, 10, 1],
];
const prompts = [
  ["industry-dairy.json", "dairy"],
  ["industry-none.json", "zzqqxx"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POST_HEADERS = { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", referer: `${SITE}/company-search/` };
async function fetchText(path, form) {
  await sleep(1200);
  const r = await fetch(SITE + path, form ? { method: "POST", headers: { "user-agent": UA, ...POST_HEADERS }, body: form } : { headers: { "user-agent": UA } });
  return { status: r.status, text: await r.text() };
}

const counts = { people: 0, holders: 0, emails: 0, phones: 0 };
for (const [file, path] of pages) {
  const r = await fetchText(path);
  writeFileSync(new URL(file, OUT), file.startsWith("company-") ? scrub(r.text, counts) : r.text);
  console.log(`${file}: HTTP ${r.status}, ${r.text.length} chars`);
}
for (const [file, q, size, page] of searches) {
  const r = await fetchText("/filter/branch/results", formBody(searchForm({ sort: "name", order: "asc", ...q }, size, page)));
  writeFileSync(new URL(file, OUT), r.text);
  console.log(`${file}: HTTP ${r.status}, ${r.text.length} chars`);
}
for (const [file, text] of prompts) {
  const r = await fetchText("/industry-classification-prompt/", formBody([["string", text]]));
  writeFileSync(new URL(file, OUT), r.text);
  console.log(`${file}: HTTP ${r.status}, ${r.text.length} chars`);
}
console.log(`scrubbed ${counts.people} people, ${counts.holders} other shareholders, ${counts.emails} e-mail addresses, ${counts.phones} phone numbers`);

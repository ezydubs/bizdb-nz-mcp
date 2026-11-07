import { test } from "node:test";
import assert from "node:assert/strict";
import { addressTimeline, infoBoxes, parseCompany, parseIndex, parseLatest, parseResults } from "../dist/parse.js";
import { indexPath } from "../dist/browse.js";
import { fx } from "./helpers.mjs";

const PERSON = /^(Person|Holder) \d+$/;

test("search results: fields, industries, paging and the page size the site applied", () => {
  const p1 = parseResults(fx("search-fonterra-p1.html"));
  assert.equal(p1.hits.length, 10);
  assert.equal(p1.next, 2);
  assert.equal(p1.previous, null);
  assert.equal(p1.pageSize, 10);
  assert.equal(p1.sort, "name");
  for (const h of p1.hits) {
    assert.match(h.nzbn, /^9429\d{9}$/);
    assert.match(h.name, /FONTERRA/);
    assert.equal(h.url, `https://www.bizdb.co.nz/company/${h.nzbn}/`);
    assert.equal(h.status, "Registered");
  }
  // the site sorts names with their punctuation and spaces left out: CO-OPERATIVE comes after COMMODITIES
  const keys = p1.hits.map((h) => h.name.replace(/[^A-Z0-9]/g, ""));
  assert.deepEqual([...keys].sort(), keys, "sorted by name");
  const p2 = parseResults(fx("search-fonterra-p2.html"));
  assert.equal(p2.hits.length, 7);
  assert.equal(p2.next, null);
  assert.equal(p2.previous, 1);
  const all = parseResults(fx("search-fonterra-50.html"));
  assert.equal(all.hits.length, 17);
  assert.equal(all.pageSize, 50);
  assert.deepEqual(all.hits.slice(0, 10).map((h) => h.nzbn), p1.hits.map((h) => h.nzbn), "the same order at 10 and 50 a page");
  const coop = all.hits.find((h) => h.nzbn === "9429036748471");
  assert.equal(coop.type, "NZ Co-operative Company");
  assert.equal(coop.post_code, "1010");
  const dairy = parseResults(fx("search-dairy-20.html"));
  assert.equal(dairy.hits.length, 20);
  assert.equal(dairy.next, 2);
  const two = dairy.hits.find((h) => h.industries.length > 1);
  assert.ok(two, "a hit with two industry descriptions");
  assert.ok(two.industries.every((i) => i && !i.includes(";")));
  const none = parseResults(fx("search-none.html"));
  assert.deepEqual(none.hits, []);
  assert.equal(none.none, true);
  assert.equal(none.next, null);
});

test("index: the top level, a letter's sub-prefixes (one without a page), a prefix's companies, an empty prefix", () => {
  const top = parseIndex(fx("index-top.html"));
  assert.equal(top.heading, "New Zealand Companies Index");
  assert.equal(top.groups.length, 36);
  assert.deepEqual(top.groups.map((g) => g.prefix).slice(0, 3), ["0", "1", "2"]);
  assert.equal(top.groups.at(-1).prefix, "Z");
  assert.ok(top.groups.every((g) => g.linked && !g.single && g.from?.nzbn && g.to?.nzbn));
  assert.equal(top.shown, null);
  assert.equal(top.companies.length, 0);
  const f = parseIndex(fx("index-F.html"));
  assert.equal(f.heading, "New Zealand Companies by name: F");
  assert.equal(f.groups[0].prefix, "F ", "the space prefix, from /index/F%20/");
  assert.equal(f.groups[1].prefix, "F-");
  assert.equal(f.shown, "F");
  const single = f.groups.find((g) => g.prefix === "F9");
  assert.deepEqual([single.linked, single.single], [false, true], "F9: one company, not linked");
  assert.equal(single.from.nzbn, single.to.nzbn);
  assert.ok(f.groups.every((g) => g.prefix.startsWith("F")));
  const fon = parseIndex(fx("index-FONTERRA.html"));
  assert.equal(fon.groups.length, 0);
  assert.equal(fon.companies.length, 17);
  for (const c of fon.companies) {
    assert.match(c.name, /^FONTERRA/);
    assert.match(c.nzbn, /^9429\d{9}$/);
    assert.match(c.address_kind ?? "", /Address$/);
    assert.match(c.post_code ?? "", /^\d{4}$/);
  }
  assert.ok(fon.companies.some((c) => c.type === "NZ Co-operative Company"));
  const empty = parseIndex(fx("index-ZZZZZZ.html"));
  assert.deepEqual([empty.groups.length, empty.companies.length], [0, 0]);
});

test("index paths: capitals, and every character escaped", () => {
  assert.equal(indexPath(""), "/index/");
  assert.equal(indexPath("fon"), "/index/FON/");
  assert.equal(indexPath("F "), "/index/F%20/");
  assert.equal(indexPath("a&b"), "/index/A%26B/");
});

test("latest companies on the home page", () => {
  const l = parseLatest(fx("home.html"));
  assert.equal(l.length, 21);
  for (const c of l) {
    assert.match(c.nzbn, /^9429\d{9}$/);
    assert.ok(c.name.length > 2);
    assert.ok(c.industry === null || c.industry.length > 2);
  }
});

test("company: a limited company with former names, previous addresses, allocations, a holding company and directors", () => {
  const c = parseCompany(fx("company-fonterra-nz.html"));
  assert.equal(c.nzbn, "9429040089218");
  assert.equal(c.name, "FONTERRA (NEW ZEALAND) LIMITED", "the register's capitals, from the map");
  assert.equal(c.heading, "Fonterra (new Zealand) Limited");
  assert.equal(c.type, "NZ Limited Company");
  assert.equal(c.type_code, "Ltd");
  assert.equal(c.status, "Registered");
  assert.equal(c.company_number, "191954");
  assert.equal(c.registered, "1971-11-09");
  assert.equal(c.years, 54);
  assert.match(c.last_updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(c.current_addresses.length, 1);
  assert.deepEqual(c.current_addresses[0].kinds, ["physical", "service", "registered"]);
  assert.equal(c.current_addresses[0].address, "109 Fanshawe Street, Auckland Central, Auckland 1010, New Zealand");
  assert.equal(c.current_addresses[0].country, "New Zealand");
  assert.equal(c.current_addresses[0].from, "2016-05-02");
  assert.equal(c.names.length, 6);
  assert.deepEqual(c.names[1], { name: "Nzmp New Zealand Limited", from: "2002-02-01", to: "2004-02-01" });
  assert.equal(c.addresses.previous.length, 6);
  assert.deepEqual(c.addresses.previous[0], { kinds: ["registered"], address: "9 Princes Street, Auckland, 1010 New Zealand", from: "2015-04-13", to: "2016-05-02" });
  assert.equal(c.addresses.timeline.length, 7);
  assert.deepEqual(c.addresses.timeline.filter((t) => t.current).map((t) => t.from), ["2016-05-02"]);
  assert.equal(c.addresses.timeline[0].to, null);
  assert.equal(c.financial.total_shares, 13965744);
  assert.equal(c.financial.annual_return_month, "April");
  assert.match(c.financial.annual_return_last_filed, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(c.financial.country_of_origin, "NZ");
  assert.equal(c.allocations.length, 2);
  assert.deepEqual(
    c.allocations.map((a) => [a.number, a.shares, a.percent, a.holders.map((h) => [h.kind, h.name, h.nzbn])]),
    [
      [1, 1, 0, [["entity", "Fonterra Co-operative Group Limited", "9429036748471"]]],
      [2, 13965743, 100, [["entity", "Fonterra Limited", "9429037784669"]]],
    ],
  );
  assert.equal(c.allocations[1].holders[0].holder_type, "Entity (NZ Limited Company)");
  assert.equal(c.allocations[1].holders[0].address, "Auckland Central, Auckland, 1010, New Zealand");
  assert.equal(c.allocations[1].holders[0].from, "1971-11-09");
  assert.equal(c.allocations[1].holders[0].to, null);
  assert.deepEqual(c.ultimate_holding_company, { name: "Fonterra Co-operative Group Limited", type: "Coop", number: "1166320", nzbn: null, country: "NZ", address: null, effective_date: null, other: {} });
  assert.equal(c.roles_heading, "Directors");
  assert.equal(c.roles.length, 19);
  assert.equal(c.roles.filter((r) => r.active).length, 2);
  for (const r of c.roles) {
    assert.match(r.name, PERSON);
    assert.equal(r.role, "Director");
    assert.match(r.appointed, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(r.active, r.terminated === null);
  }
  assert.equal(c.roles[0].address, "Remuera, Auckland, 1050 New Zealand");
  assert.equal(c.roles[0].address_since, "2023-08-29");
  assert.deepEqual(c.location, { lat: -36.8457629, lng: 174.7562406, osm: "https://www.openstreetmap.org/?mlat=-36.8457629&mlon=174.7562406#map=17/-36.8457629/174.7562406" });
  assert.equal(c.nearby.length, 6);
  assert.equal(c.nearby[0].name, "CANPAC INTERNATIONAL LIMITED", "names in capitals from the map's points");
  assert.equal(c.nearby[0].address, "109 Fanshawe Street");
  assert.equal(c.nearby[0].lat, -36.8457629);
  assert.deepEqual(c.similar, []);
  assert.equal(c.charity, null);
  assert.match(c.description, /^Fonterra \(New Zealand\) Limited, a registered company/);
  assert.equal(c.url, "https://www.bizdb.co.nz/company/9429040089218/");
});

test("company: charity information, its annual returns, and a name with an apostrophe that breaks the page's own map script", () => {
  const c = parseCompany(fx("company-charity.html"));
  assert.equal(c.name, "AUCKLAND CHILDREN'S THEATRE ACADEMY TRUST");
  assert.equal(c.type, "Charitable Trust");
  assert.equal(c.type_code, "T");
  assert.equal(c.charity.registration_number, "CC33239");
  assert.equal(c.charity.status, "Deregistered (31 Dec 2017)");
  assert.equal(c.charity.registered, "2008-06-30");
  assert.equal(c.charity.fields["Main sector"], "Arts / culture / heritage");
  assert.equal(c.charity.annual_returns.length, 5);
  assert.deepEqual(c.charity.annual_returns[0], {
    year_ended: "2016-12-31",
    gross_income: 100565,
    expenditure: 106147,
    total_assets: 0,
    total_liabilities: 0,
    paid_staff_full_time: 3,
    paid_staff_part_time: 2,
    volunteers_per_week: 15,
  });
  assert.match(c.charity.source, /^Source: Charities Register/);
  assert.equal(c.location.lat, -36.7980232);
  assert.equal(c.nearby.length, 6);
  assert.deepEqual([c.financial, c.allocations.length, c.roles.length], [null, 0, 0]);
});

test("company: status history, officers without addresses, GST number, contact details and similar companies", () => {
  const c = parseCompany(fx("company-gs1.html"));
  assert.equal(c.type, "Incorporated Society");
  assert.deepEqual(c.gst_numbers, ["063-941-905"]);
  assert.deepEqual(c.industries, [{ code: "M699945", description: "Professional, Scientific And Technical Services Nec" }]);
  assert.deepEqual(c.statuses, [
    { status: "Removed", comment: null, from: "2001-01-19", to: "2001-01-19" },
    { status: "Registered", comment: null, from: "1994-11-14", to: "2001-01-19" },
  ]);
  assert.equal(c.names.length, 2);
  assert.deepEqual(c.current_addresses.map((a) => a.kinds.join("/")), ["invoice", "service/office/delivery", "postal"]);
  assert.deepEqual(
    c.contact.map((x) => [x.kind, x.label]),
    [
      ["phone", "phone"],
      ["email", "primary"],
      ["website", "Website"],
    ],
  );
  assert.equal(c.contact[0].value, "64 9 555 0101");
  assert.equal(c.contact[2].value, "www.gs1nz.org");
  assert.match(c.contact[0].since, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(c.roles.length >= 2);
  assert.ok(c.roles.every((r) => r.role === "Officer" && r.address === null));
  assert.equal(c.similar.length, 6);
  assert.ok(c.similar.every((s) => s.nzbn && s.url.endsWith(`/${s.nzbn}/`)));
});

test("company: a limited partnership's timeline with unknown start dates, and contact without dates", () => {
  const c = parseCompany(fx("company-lp.html"));
  assert.equal(c.type, "Limited Partnership (NZ)", "the form's spelling, not the page's (nz)");
  assert.equal(c.type_code, "Y");
  assert.equal(c.current_addresses.length, 2);
  assert.equal(c.addresses.timeline.length, 4);
  assert.ok(c.addresses.timeline.every((t) => t.to === null));
  assert.deepEqual(c.addresses.timeline.map((t) => t.from), [null, null, "2011-07-22", "2011-07-22"], "1 Jan 1970 is the chart's unknown date");
  assert.deepEqual(c.addresses.timeline.map((t) => [t.current, t.legacy === true]), [[false, true], [false, true], [true, false], [true, false]], "undated legacy rows are not current");
  assert.deepEqual(c.contact, [{ kind: "email", value: "user2@example.com", label: "Email", since: null }]);
  assert.equal(c.financial, null);
});

test("company: in liquidation, two industries, one unnumbered allocation and previous shareholders", () => {
  const c = parseCompany(fx("company-liquidation.html"));
  assert.equal(c.status, "In Liquidation");
  assert.equal(c.years, null, "no years-on-market box");
  assert.equal(c.registered, "2016-10-11", "from the prose when the box is missing");
  assert.deepEqual(c.industries.map((i) => i.code), ["M692325", "E324210"]);
  assert.ok(c.industries.every((i) => i.description));
  assert.deepEqual(c.current_addresses.map((a) => a.kinds.join("/")), ["office/delivery", "postal", "service/registered/physical"]);
  assert.equal(c.allocations.length, 1);
  assert.equal(c.allocations[0].number, 1);
  assert.equal(c.allocations[0].shares, 5000);
  assert.equal(c.allocations[0].percent, 100);
  assert.equal(c.allocations[0].holders.length, 1);
  assert.equal(c.allocations[0].holders[0].kind, "individual");
  assert.ok(c.previous_shareholders.length >= 5);
  const ent = c.previous_shareholders.find((h) => h.kind === "entity");
  assert.match(ent.nzbn, /^\d{13}$/);
  assert.match(ent.company_number, /^\d+$/);
  assert.ok(c.previous_shareholders.every((h) => h.from));
  assert.equal(c.names.length, 3);
});

test("company: accredited employer, holding company effective date, previous shareholders", () => {
  const c = parseCompany(fx("company-aewv.html"));
  assert.deepEqual(c.accredited_employer, {
    text: "Accredited Employer until 01 Jul 2027 (listed as Construction Specialties NZ)",
    until: "2027-07-01",
    listed_as: "Construction Specialties NZ",
    checked: c.accredited_employer.checked,
  });
  assert.match(c.accredited_employer.checked, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(c.ultimate_holding_company.effective_date, "2015-05-26");
  assert.equal(c.ultimate_holding_company.name, "Van Tilborg Trustees No. 2 Limited");
  assert.equal(c.allocations[0].shares, 1);
  assert.equal(c.allocations[0].percent, 100);
  assert.ok(c.previous_shareholders.length >= 3);
  assert.equal(c.addresses.previous.length, 6);
});

test("company: Australian numbers, a share-register address, ten allocations and an e-mail purpose from the NZBN register", () => {
  const c = parseCompany(fx("company-airnz.html"));
  assert.deepEqual(c.identifiers, { "Australian Business Number": "70000312685", "Australian Company Number": "000312685" });
  assert.equal(c.industries.length, 3);
  const reg = c.current_addresses.find((a) => a.kinds.includes("shareregister"));
  assert.deepEqual(reg.kinds, ["other", "shareregister"]);
  assert.equal(reg.note, "Address For Share Register");
  const tl = c.addresses.timeline.find((t) => t.kinds.includes("shareregister") && t.note);
  assert.equal(tl.note, "Address For Share Register");
  assert.equal(c.allocations.length, 10);
  assert.equal(c.financial.total_shares, 3326453382);
  assert.equal(c.financial.financial_report_month, "June");
  const crown = c.allocations.find((a) => a.number === 10);
  assert.equal(crown.percent, 51.64);
  const sum = c.allocations.reduce((s, a) => s + (a.shares ?? 0), 0);
  assert.ok(sum <= c.financial.total_shares);
  assert.ok(c.previous_shareholders.length > 50);
  assert.deepEqual(
    c.contact.map((x) => [x.kind, x.label]),
    [
      ["phone", "Phone"],
      ["email", "invoice email address"],
      ["website", "Website"],
    ],
  );
  assert.ok(c.roles.length > 40);
  assert.ok(c.roles.some((r) => r.active) && c.roles.some((r) => !r.active));
  assert.match(c.accredited_employer.until, /^\d{4}-\d{2}-\d{2}$/);
});

test("company: an overseas company with people authorised for service and no shares", () => {
  const c = parseCompany(fx("company-overseas.html"));
  assert.equal(c.type, "Overseas ASIC Company");
  assert.deepEqual(c.identifiers, { "Australian Company Number": "005357522" });
  assert.equal(c.financial.country_of_origin, "AU");
  assert.equal(c.financial.total_shares, null);
  assert.equal(c.allocations.length, 0);
  assert.ok(c.roles.some((r) => r.role === "Person authorised for service"));
  assert.ok(c.roles.some((r) => r.role === "Director"));
  assert.equal(c.addresses.previous.length, 5);
});

test("company: an incorporated society's charity details, and a holding company's address", () => {
  const s = parseCompany(fx("company-incsoc.html"));
  assert.equal(s.charity.fields["Main activity"], "Provides buildings / facilities / open space");
  assert.equal(s.charity.status, "Registered");
  const d = parseCompany(fx("company-dairy.html"));
  assert.equal(d.ultimate_holding_company.address, "47 Waterloo Road, Hornby, Christchurch 8042, New Zealand");
  assert.equal(d.allocations[0].shares, 10000);
  assert.deepEqual(d.contact.map((x) => x.kind), ["phone", "email"], "'No website' is left out");
  assert.equal(d.similar.length, 6);
  assert.deepEqual(d.industries, [{ code: "A016020", description: "Milk Production - Dairy Cattle" }]);
});

test("info boxes: value, label, dates before the label, and the country after a globe icon", () => {
  const boxes = infoBoxes(
    '<div class="col-sm-4 info-element"><i class="fa fa-address-card-o"></i> 1 A St <br />Town 1010<br /> <i class="fa fa-globe"></i> New Zealand<br /><span class="info-desc"><i class="fa fa-map-marker"></i> Postal address used since <span style="white-space: nowrap">02 May 2016</span></span></div>' +
      '<div class="col-sm-6 col-xs-12 info-element"><i class="fa fa-phone"></i> 64 9 555 0100<br /><span class="info-desc">03 Oct 2018</span> <span class="info-desc">Phone</span></div>',
  );
  assert.deepEqual(boxes[0].lines, ["1 A St", "Town 1010", "New Zealand"]);
  assert.equal(boxes[0].country, "New Zealand");
  assert.equal(boxes[0].label, "Postal address used since 02 May 2016");
  assert.deepEqual(boxes[1].descs, ["03 Oct 2018", "Phone"]);
  assert.equal(boxes[1].icon, "phone");
});

test("address timeline: rows ending on the page's date are current only when that date is not before the last update", () => {
  const chart = (end) =>
    `function drawAddressChart() { dataTable.addRows([["Registered","A \\"quoted\\" St", new Date(2016, 4, 02), new Date(${end})], ["Physical","B St", new Date(2001, 0, 31), new Date(2016, 4, 02)]]); }`;
  const now = addressTimeline(chart("2026, 10, 07"), "2026-11-03");
  assert.deepEqual(now.map((t) => [t.address, t.from, t.to, t.current]), [
    ['A "quoted" St', "2016-05-02", null, true],
    ["B St", "2001-01-31", "2016-05-02", false],
  ]);
  const stale = addressTimeline(chart("2020, 0, 01"), "2026-11-03");
  assert.ok(stale.every((t) => !t.current), "a latest end before the last update is a real end date");
  assert.deepEqual(addressTimeline("<p>no chart</p>", null), []);
});

test("a page without the usual sections parses to empty parts, not errors", () => {
  const c = parseCompany(fx("not-found.html"), "9429000000001");
  assert.equal(c.nzbn, "9429000000001");
  assert.deepEqual([c.roles.length, c.allocations.length, c.contact.length, c.nearby.length], [0, 0, 0, 0]);
  assert.equal(c.charity, null);
  assert.equal(c.location, null);
});

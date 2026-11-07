# www.bizdb.co.nz natively

How bizdb.co.nz works over plain HTTPS, as found on 7 November 2026. The endpoints were mapped in CloakBrowser by
driving the site's own pages (the search form, its paging, page-size and sort controls, the industry box, company pages,
the index) and recording every request they made, then confirmed with plain `curl`/`fetch`. The server itself is plain
Node `fetch` and runs no browser.

## 1. The site

- **Stack.** PHP on Apache/2.4.38 (Debian), `Vary: User-Agent, Accept-Encoding`, gzip. No CDN, bot wall or captcha.
  jQuery 1.x and Bootstrap 3 on the pages; Google Analytics, AdSense and Funding Choices for ads and consent.
- **Rendering.** Every page is server-rendered HTML. The only XHRs the site's own scripts make are the two form POSTs in
  sections 3 and 4.
- **No session.** No cookie, token or login is needed for anything. Every request is anonymous.
- **User agent.** The site served a browser user agent, `node` and curl's alike. The server sends a browser user agent
  that names it (`… Chrome/145 … bizdb-nz-mcp/0.1`).
- **Owner.** Datafic sp. z o.o., Poznań, Poland (contact@bizdb.co.nz). The code comments are in Polish.
- **robots.txt.**
  - For `User-agent: *` it allows everything except `/filter/` (the search endpoint).
  - Since 29 Oct 2026 it disallows `/` for named crawlers "overloading the server": GPTBot, ClaudeBot, CCBot,
    Bytespider, Amazonbot, meta-externalagent, DataForSeoBot, PetalBot, ExaSearchBot and SemrushBot. Since 2 Nov it
    also blocks KakaoBot, PerplexityBot, SERankingBacklinksBot and Reflectionbot, and since 5 Nov Amzn-SearchBot. Older
    entries block SEO crawlers (AhrefsBot, MJ12bot, dotbot, …). It names no user-driven agents (Claude-User,
    ChatGPT-User and the like).
  - This server is not a crawler. It sends one search, page or suggestion per tool call, on the user's request, the
    same POST the site's own search page sends. It has no bulk export, crawl or polling, and paces requests a second
    apart.
- **Terms** (/terms-of-use-and-privacy-policy/): no clause restricts automated use. Content is "as is". Data sources:
  - the NZ Companies Office;
  - LINZ address coordinates, CC BY 4.0;
  - Immigration NZ's accredited employer list (an employer may opt out of the list);
  - the Charities Register, CC BY 3.0 NZ.
- **Redirects.** All are 301s:
  - a missing trailing slash (`/company/9429040089218` goes to `/company/9429040089218/`, and `/index/F` to
    `/index/F/`);
  - `bizdb.co.nz` and `http://` go to `https://www.bizdb.co.nz/`.

  The server follows them by hand (`redirect: "manual"`), at most 3 hops, and only while they stay on the site. A
  redirected POST is not re-sent.
- **Errors.** An unknown path answers **404** with the site's own "not found" page (19 KB). The server never saw a 403
  or 429. If one comes it is reported, never retried or worked around.
- **Speed.** Most pages answer in 0.1–1 s; one company page took 4 s. A search with the accredited-employer filter
  took 17 s.

## 2. Identifiers and types

- **NZBN.** 13 digits, starting `9429` for these entities. It is the company's key on the site: `/company/{NZBN}/`.
- **Company number.** The Companies Office number, digits (191954, 1166320).
- **Entity types.** These are the search form's `branch_type` values. A company page writes the type with its register
  code, `NZ Limited Company (Ltd)`, in the site's title case (`Limited Partnership (nz) (Y)`); the server reports the
  form's spelling.

| server name | `branch_type` | label | code on the page |
|---|---|---|---|
| nz_limited | 1 | NZ Limited Company | Ltd |
| overseas_non_asic | 2 | Overseas Non-ASIC Company | |
| overseas_asic | 3 | Overseas ASIC Company | Asic |
| nz_cooperative | 4 | NZ Co-operative Company | Coop |
| nz_unlimited | 5 | NZ Unlimited Company | |
| incorporated_society | 15 | Incorporated Society | I |
| limited_partnership_nz | 16 | Limited Partnership (NZ) | Y |
| charitable_trust | 17 | Charitable Trust | T |
| industrial_provident_society | 18 | Industrial & Provident Society | |
| friendly_society | 19 | Friendly Society | |
| building_society | 20 | Building Society | |
| credit_union | 21 | Credit Union | |
| limited_partnership_overseas | 22 | Limited Partnership (Overseas) | Z |
| special_body | 26 | Special Body | |

- **Removed entities are not on the site.** `/company/{NZBN}/` answers 404 for them (for example the removed EX-PPOL
  LIMITED, 9429039159199). A company in liquidation still has its page, with status "In Liquidation", but the search
  does not find it (section 3). An entity once removed and then restored has the removal in its status history.

## 3. Company search: `POST /filter/branch/results`

The form on `/company-search/` (and beside the index's company lists) never submits. On every change its script posts
the whole form as an XHR and puts the HTML fragment it gets back into `#companylisting`:

```
POST /filter/branch/results
content-type: application/x-www-form-urlencoded; charset=UTF-8
x-requested-with: XMLHttpRequest

branch_nzbn=&branch_name=fonterra&branch_source_register_unique_id=&branch_type=&branch_industry_classification=
&branch_aewv=&branch_row_count=10&branch_sort_field=type&branch_sort_direction=asc[&branch_paging_position=2]
```

The site accepts the POST without `x-requested-with`, a referer or a cookie. The server sends the first two as the page
does.

| field | meaning |
|---|---|
| `branch_name` | Text anywhere in the name, any case. "dairy" finds ABERCAIRNEY DAIRY LIMITED; "air new zealand limited" finds DIESEL AIR NEW ZEALAND LIMITED. |
| `branch_nzbn` | Exact NZBN. Twelve of the 13 digits find nothing. |
| `branch_source_register_unique_id` | Exact company number. "116632" does not find 1166320. |
| `branch_type` | The type id in section 2, or empty. |
| `branch_industry_classification` | Text anywhere in an industry classification description. "dairy" finds "Dairy/superette operation" and "Dairy cattle farming". A code such as A016020 is not matched. |
| `branch_aewv` | `1` for accredited employers only, or empty. |
| `branch_row_count` | 10, 20 or 50. Anything else (100) is answered with 10. |
| `branch_sort_field` | `type` (the form's default) or `name`. |
| `branch_sort_direction` | `asc` or `desc`. |
| `branch_paging_position` | The page number, 1-based; 0 acts as 1. The traffic recorded in CloakBrowser had it only on a paging link's request: a change of page size or sort posted the other nine fields without it. |

- **An empty form** lists every company (page 1 of all 600,000). The server refuses an empty search and points to the
  index instead.
- **Name sort.** Sorting by name ignores punctuation and spaces: FONTERRA COMMODITIES comes before FONTERRA
  CO-OPERATIVE GROUP, and FONTERRA (DELEGATED …) after it. Within a type, the type sort keeps the database order, so
  the server defaults to sorting by name, which pages stably.
- **Answer.** An HTML fragment. Each result is a block:

  ```html
  <div class="listing-body"> … <a class="primary-icon" href="/company/9429032106367/">FONTERRA EQUITIES LIMITED</a> …
    <div class="col-sm-4"><b>NZBN:</b> 9429032106367</div>  <b>Post Code:</b> 1010  <b>Status:</b> Registered
    <b>Type:</b> NZ Limited Company  [<b>IC description:</b> Milk production - dairy cattle; Holding company …]
  ```

  - The industry descriptions are joined with "; ".
  - After the results come the page-size and sort selects (`#branch_row_count`, `#branch_sort_field`,
    `#branch_sort_direction`, with the applied option `selected`), then the pager:
    `<ul class="pager universal-filter-paging" id="branch_paging"><li class="change-page next" id="2">`. Its `id` is
    the page that link asks for (`previous` likewise).
- **No total count.** The site never says how many results there are, only whether a next page exists.
- **No results**, and a page past the end, are the bare text `No records found` (16 bytes, no selects or pager).
- **Registered entities only.** Every result seen had status Registered. The NZBN of a company in liquidation
  (Construction & Kitchens Limited, 9429043370498) finds nothing, although its page exists. Such a company is reached
  by NZBN only.

## 4. Industry suggestions: `POST /industry-classification-prompt/`

The industry box on the search form calls this 300 ms after typing (it uses Bootstrap 3 typeahead):

```
POST /industry-classification-prompt/      string=dairy
→ {"prompt":["Dairy cattle farming","Dairy herd testing","Dairy products mfg nec","Dairy product wholesaling",
   "Dairy/superette operation","Milk production - dairy cattle","Stud dairy cattle breeding or farming"],"code":"ok"}
→ {"code":"empty"}                                      (nothing matches, or an empty string)
```

- The page's script sends `encodeURI(string)`. A plain value works the same ("dairy cattle" with a space or as
  `dairy%20cattle`).
- The answer is labelled `text/html` but is JSON. The descriptions are the Business Industry Classification
  (ANZSIC-based) descriptions, in the spelling the search's `branch_industry_classification` matches.

## 5. A company's page: `GET /company/{NZBN}/`

A 35–125 KB server-rendered page (58 KB for Fonterra (New Zealand) Limited). A query string is ignored. The left column
has shortcuts to the sections present (`#general`, `#addresses`, `#contactinfo`, `#finances`, `#roles`). The site's
layout unit is the info box:
`<div class="col-… info-element">VALUE<br /><span class="info-desc">LABEL</span></div>`.

- **Heading** (`#general`):
  - `<h1>`: the name in the site's title case ("Fonterra (new Zealand) Limited"). The register's capitals are in the
    map's `main_point.title`.
  - `<b>Type:</b> NZ Limited Company (Ltd)`.
  - `<button class="btn btn-sea">54 years on market<br />Registered 09 Nov 1971</button>`. This box is missing for a
    company in liquidation; the prose's first date is then the registration date.
  - Info boxes labelled NZBN, Company Number, Company Status, GST Number, Industry classification code and Industry
    classification description (code and description in pairs, one pair per classification), Australian Business
    Number and Australian Company Number.
  - An accredited employer has a box "Accredited Employer until 01 Jul 2027 (listed as Construction Specialties NZ)",
    labelled "Accredited Employer (AEWV) – source: Immigration New Zealand, checked 03 Nov 2026".
- **Current addresses**, after `Current address</div>`: one box each. The lines are split by `<br />`, then
  `<i class="fa fa-globe"></i> Country`. The label reads "Physical & service & registered address used since
  `<span>02 May 2016</span>`".
  - Kinds seen: physical, service, registered, postal, office, delivery, invoice and shareregister.
  - An "other" address carries its purpose twice: "Other (Address For Share Register) & shareregister address
    (Address For Share Register) used since …".
- **Names history**: `#nameshistory` (hidden behind "Show names history"), a table of Name, Start Date and End Date.
  The current name's row has no dates, or only a start date.
- **Status history**: `#statushistory` (behind "Show status history"), when the status ever changed. It is a table of
  Status, Comment, Start Date and End Date. GS1 New Zealand Incorporated was Removed on 19 Jan 2001 and restored.
- **Last updated**: `<time datetime="2026-11-03">` in the heading's footer. This is when bizdb last refreshed the
  record.
- **Prose**: a `<div class="panel-body"><p>` summary written from the data. Its wording varies ("was launched on", "was
  registered on", "was incorporated on"). It holds nothing the sections lack.
- **Addresses** (`#addresses`):
  - Sub-headings are `<p style="color: #…"><span class="glyphicon glyphicon-edit"></span> Previous addresses</p>`
    (or "Previous address", "Other active addresses"), or `<span class="fa fa-users">` for "Principal place of
    activity".
  - Under each are pairs of `<p>… Address: …</p><p class="info-desc">Registered address used from 13 Apr 2015 to
    02 May 2016</p>`.
    - A page that has an "Other active addresses" list numbers every entry instead: `Address #4: …`. An active one
      reads "used from 25 Feb 2026", with no end.
    - The principal place of activity is a bare address line, with no label and no dates.
  - "Other active addresses" can hold an address the heading's boxes do not show. Construction & Kitchens (in
    liquidation) moved its service and registered address on 25 Feb 2026, but the boxes still show the old one.
  - The address timeline is a Google Charts script, `drawAddressChart`: rows `["Physical & Registered", "address",
    new Date(2016, 4, 02), new Date(2026, 10, 07)]`.
    - Months are 0-based.
    - An address still in use ends on the day the page was made. That is the server's date in Poland, and the page may
      be a day old.
    - An unknown start is `new Date(1970, 0, 01)`. Those are old register entries, drawn to today like a current
      address, though a dated row may show the address ended. GS1's old Woolstore registered address is drawn from 1970
      to today, but its dated row ends on 20 Jul 2026.
    - The server marks the dated rows that end on the latest date as current, when that date is not before the last
      update. It flags the undated ones as `legacy` and not current.
- **Contact info** (`#contactinfo`): boxes with `fa-phone`, `fa-at` (e-mail) or `fa-globe` (website).
  - Each value may have a date span (when it was registered) and a purpose label: Phone, Email, Website, "primary",
    "phone", or the NZBN register's raw purpose `nzbn-reserved-invoice-email-address-purpose`.
  - "No website" stands for none.
- **Financial Data** (`#finances`):
  - "Basic Financial info" is a set of `<p>Label: value</p>`: Total number of Shares, Annual return filing month,
    Financial report filing month, Annual return last filed, Country of origin.
  - Then a shares pie chart, and a table with columns Shareholder Type, Shareholder Name, Address and Period.
    - Rows `<td colspan="4">Shares Allocation #2 Number of Shares: 13965743</td>` start each allocation. A company
      with one allocation writes "Shares Allocation Number of Shares: 10000".
    - The holder rows follow. Their type is "Entity (NZ Limited Company)", "Entity", "Individual", "Director",
      "Other (Other)" or "Other".
    - The name cell has `Shareholder NZBN: …` and `Company Number: …` for an entity.
    - Holder addresses are suburb-level.
    - The period reads "06 Nov 2025 - " or "19 May 2010 - 25 Jan 2012".
  - No page seen had more than 10 allocations. Air New Zealand and Fonterra Co-operative Group (1.6 billion shares,
    thousands of holders) show exactly 10, so a large company's list is partial. The server says how many it shows
    and does not total them.
  - A "Previous Shareholders" table has the same columns, without allocation rows.
  - "Ultimate Holding Company" boxes: Name, Type, Ultimate Holding Company Number, Country of origin, Effective Date,
    Address.
- **Directors** (`#roles`; the heading reads "Directors" even when the people are officers or people authorised for
  service). Each person is
  `<p><span class="glyphicon glyphicon-edit|fa fa-ban"></span> Name - Role [<small>(Inactive)</small>]</p>`, then
  "Appointment date: …", "Termination date: …", and one or more "Address: …" lines, each with "Address used since …".
  The newest address comes first. Entries are separated by `<hr />`.
  - Roles seen: Director, officer (incorporated societies; no address), and Person Authorised For Service (overseas
    companies).
  - `fa-ban` marks a former role, but not always. A GS1 officer with "Termination date: 09 Jul 2026" has the active
    icon, so the server treats a passed termination date as former too.
  - The register can lack the name: Air New Zealand has an entry that reads just "- Director (Inactive)".
  - A `drawRolesChart` timeline repeats the same data.
- **Charity information** (a side panel): boxes for Charity registration number, Charity status ("Deregistered (31 Dec
  2017)"), Registered as a charity, Main sector, Main activity, Main beneficiaries, Areas of operation and Charitable
  purpose.
  - It also has an "Annual returns (NZD)" table: Year ended, Gross income, Expenditure, Total assets, Total
    liabilities, Paid staff (full / part time) and Volunteers per week.
  - Source: the Charities Register (CC BY 3.0 NZ).
- **Map**: `map.showMap('{"main_point":{"lat":"-36.8457629","lng":"174.7562406","title":"FONTERRA (NEW ZEALAND)
  LIMITED",…},"other_points":[{…,"url":"/company/…/"}]}')`.
  - The coordinates come from LINZ.
  - The JSON sits in a single-quoted JS string. An apostrophe in a name ("AUCKLAND CHILDREN'S THEATRE …") ends it
    early, so the site's own map fails there. The server reads up to `');`.
- **Nearby companies** and **Similar companies**: panels of `<a href="/company/…/">Name</a><br /><span
  class="info-desc">street</span>`, six each. The nearby ones are also the map's other points, with coordinates.

## 6. The A-Z index: `GET /index/` and `GET /index/{PREFIX}/`

- `/index/` is a table with columns Index, From and To, one row per first character (0–9, A–Z: 36 rows). From and To
  link the first and last company.
- `/index/{PREFIX}/` is in capitals; lower case answers 404. The site either splits the prefix further (the same
  table, rows such as `F `, `F-`, `F1`, `FA`) or lists the companies whose names start with it.
  - The site leaves some sub-prefixes unlinked (`<td>F9</td>`).
    - F9 holds one company: its From and To are the same.
    - FQ (FQR NEW ZEALAND … FQS INTERIOR) and FZ hold several, and `/index/FQ/` answers with them.
    - An unlinked prefix still has its page.
  - A company listing is a set of panels: the name link, the type, info boxes for NZBN, one address with its kind
    ("Registered Address", "Service Address", "Physical Address") and Post Code. It has the search form beside it.
- A capital prefix need not be in the tree: `/index/FONTERRA/` lists the 17 names starting FONTERRA, and
  `/index/ZZZZZZ/` is an empty page (200).
- **At most 10 characters.**
  - `/index/ONE%20LIMITE/` (10 characters) lists ONE LIMITED.
  - `/index/ONE%20LIMITED/` (11) and `/index/ONE%20LIMITED%20/` (12) are empty pages.

  The server asks for a longer prefix by its first 10 characters and keeps the names that start with the whole prefix.
  If those 10 characters are still split into sub-prefixes, it says so.
- Spaces are part of prefixes: `/index/F%20/` is names like "F 1 LIMITED".
- The site reads `%20` in the path but not every escape.
  - `/index/AJ%20%26%20RA/` answers 200, with the heading "AJ %26 RA" and no names.
  - `/index/AJ%20&%20RA/` answers 404.
  - The `AJ ` page itself does not list AJ & RA DAIRY LIMITED.

  So names with "&" after the prefix's start cannot be browsed. The server refuses prefixes with "&". For any other
  prefix it compares the page's heading ("New Zealand Companies by name: …") with what it asked for, and says when the
  site did not read it.

## 7. The home page and the terms

- `GET /` has 21 "Latest Companies" in three columns:
  `<div class="… latest-box-element"><a href="/company/…/">NAME</a><br /><span class="info-desc">industry</span></div>`.
- `GET /terms-of-use-and-privacy-policy/` holds the terms, privacy statement, data sources and owner (section 1).

## 8. Not on the site

- **Removed companies** (section 2).
- **People.** There is no director or shareholder search, and no person pages. Names appear only on company pages.
- **Documents and filings.** There are no filings, annual-return documents or financial statements, beyond the dates
  and Charities Register figures above.
- **Trademarks.** The home page mentions trademarks, but no company page seen has any.
- **Total counts** for searches.

## 9. The server

| tool | site calls |
|---|---|
| bizdb_search | `POST /filter/branch/results`, 1–5 pages per call. It picks the page size (10/20/50) needing the fewest pages for the offset and limit asked, and checks the page size the site applied. |
| bizdb_industries | `POST /industry-classification-prompt/` |
| bizdb_company | `GET /company/{NZBN}/`. A company number is first looked up with one search. A name is looked up in the index first (the page for its first 10 characters lists every name starting with them, so an exact name is found however many names contain it), then in the first 50 search matches. |
| bizdb_index | `GET /index/` or `GET /index/{PREFIX}/` |
| bizdb_latest | `GET /` |
| bizdb_status | `GET /terms-of-use-and-privacy-policy/` when the terms are asked for |

- Requests go one at a time, at least 1 s apart.
- A dropped connection or a 502/503/504 is retried once after 2 s. A timeout (60 s), a 403 or a 429 is not retried.
- Answers are cached in memory: searches 10 min, company pages 1 h, the home page 30 min, index pages, industry
  suggestions and the terms 24 h.

# bizdb-nz-mcp

An MCP server for [bizdb.co.nz](https://www.bizdb.co.nz), a free directory of New Zealand companies built from the
Companies Office register. It holds about 600,000 entities:

- companies (NZ limited, unlimited and co-operative, and overseas);
- incorporated societies and charitable trusts;
- limited partnerships;
- credit unions;
- building, friendly and industrial & provident societies;
- special bodies.

The server talks to the site natively, over its own pages and the two form endpoints its pages post to, with plain
HTTPS. No browser is involved. The endpoints were mapped in CloakBrowser; NATIVE-NOTES.md describes them.

## Tools

| tool | what it does |
|---|---|
| `bizdb_search` | Every field of the site's company search (details below), sorted by name or type, with offset paging (up to 200 results a call) |
| `bizdb_industries` | Industry classification descriptions the site suggests for a word, to use as the search's industry |
| `bizdb_company` | A company's full profile by NZBN (up to 10 at once), company number or exact name. An exact name is looked up in the A-Z index, then the search (details below). |
| `bizdb_index` | The A-Z name index: first characters, sub-prefixes, or every company whose name starts with a prefix. The site cannot browse prefixes containing "&". |
| `bizdb_latest` | The newest companies on the home page, with their industries |
| `bizdb_status` | Requests made, cache, pacing, user agent, the site's data sources, and its terms page |

`bizdb_search` takes:
- name text, found anywhere in the name;
- an exact NZBN;
- an exact company number;
- an entity type (14 kinds);
- industry text;
- accredited employers only.

`bizdb_company` returns:
- status, type, registration date, GST number and industry codes;
- AEWV accreditation;
- current addresses, with LINZ coordinates;
- former names and status history;
- previous and other active addresses, the principal place of activity, and the address timeline;
- phone, e-mail and website;
- shares and shareholders, previous shareholders, and the ultimate holding company;
- directors and officers, current and former, with their address history;
- Charities Register figures;
- nearby and similar companies.

## Install

Needs Node 22.13 or later.

```sh
git clone https://github.com/ezydubs/bizdb-nz-mcp.git
cd bizdb-nz-mcp
npm install
npm run build
claude mcp add --scope user bizdb -- node "$PWD/dist/server.js"
```

Any other MCP client can run it over stdio:

```json
{ "mcpServers": { "bizdb": { "command": "node", "args": ["/path/to/bizdb-nz-mcp/dist/server.js"] } } }
```

## What the site does not have

- **Removed companies.** Their pages answer 404.
- **Companies in liquidation, in search.** They keep their page, but the search finds registered entities only, so
  read them by NZBN.
- **Search counts.** The search gives no totals.
- **People.** There is no person search and there are no person pages. Directors and shareholders appear only on
  company pages.
- **Filings and documents.**
- **Every shareholding of a large company.** No page lists more than 10 share allocations, so a large company's list
  is partial.

## How it treats the site

- **One request at a time.** Requests are at least a second apart, with a browser user agent that names this server.
- **Retries.** A dropped connection or a 502/503/504 is retried once. A 403 or 429 is reported and never retried.
- **Caching.** Answers are cached in memory: searches 10 min, company pages 1 h, index pages and suggestions 24 h.
- **No crawling.** robots.txt asks crawlers to stay off `/filter/`, the search endpoint, and blocks named AI crawlers
  that were overloading the server. This server is not a crawler: it sends one search or page per tool call, as the
  site's own search page does. There is no bulk export or polling, and an empty search is refused.
- **Licences and accuracy.** The data comes from public registers. The Charities Register is CC BY 3.0 NZ and the
  LINZ addresses are CC BY 4.0. bizdb gives it "as is". A name that matches a director or shareholder is not proof
  that it is the same person.

## Development

- `npm test`: offline tests on recorded pages in `test/fixtures`. People's names, e-mails and phone numbers in them
  are scrubbed, and people's addresses are cut to the suburb or town (`scripts/scrub.mjs`).
- `npm run smoke`: live checks against the site (about 16 requests).
- `node scripts/call.mjs bizdb_search '{"name":"fonterra"}'`: calls a tool from the command line.
- `node scripts/record-fixtures.mjs`: records the fixtures again (24 requests, scrubbed).

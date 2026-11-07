/**
 * Transport for www.bizdb.co.nz, a PHP site on Apache (NATIVE-NOTES.md, section 1). Everything this server reads is made
 * natively with Node's fetch, no browser: GETs of the server-rendered pages (company profiles, the A-Z index, the home
 * page, the terms) and the two form POSTs the site's own scripts make (the company search and the industry suggestions).
 * Requests go one at a time, at least a second apart, with a user agent that names this server; a request is retried once
 * on a dropped connection or a 502/503/504, never on 403 or 429 (the site's way of saying stop), and answers are cached
 * for a while. A refusal is reported as it is.
 */
export const SITE = "https://www.bizdb.co.nz";
export const HOST = "www.bizdb.co.nz";
const BARE_HOST = "bizdb.co.nz";
export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 bizdb-nz-mcp/0.1";
const TIMEOUT_MS = 60_000;
const RETRY = new Set([502, 503, 504]);
/** The only response headers this server reads. */
export const KEPT_HEADERS = ["date", "retry-after", "content-type"];

export class ApiError extends Error {
  constructor(public status: number, message: string, public url: string) {
    super(message);
    this.name = "ApiError";
  }
}
/** A request this server will not send as asked (bad input, or past a limit); nothing went to the site. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

// ---------------------------------------------------------------- transport

export interface Request {
  method: "GET" | "POST";
  url: string;
  /** an application/x-www-form-urlencoded body, for a POST */
  form?: string;
}
export interface Answer {
  status: number;
  /** the URL that answered, after redirects */
  url: string;
  contentType: string;
  /** the headers in KEPT_HEADERS that came back, by lower-case name */
  headers: Record<string, string>;
  body: Buffer;
}
/** How a request is made: Node's fetch here, a recorded site in the tests. */
export interface Transport {
  send(req: Request, timeoutMs: number): Promise<Answer>;
}

export function keptHeaders(read: (name: string) => string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of KEPT_HEADERS) {
    const v = read(h);
    if (v) out[h] = v;
  }
  return out;
}

/** Redirects followed for one request: the site's own (a missing trailing slash, bizdb.co.nz to www.) need one or two. */
const MAX_HOPS = 3;
/** A redirect's target on the site, as https://www.bizdb.co.nz; null for anywhere else. */
export function siteRedirect(location: string, from: string): string | null {
  let u: URL;
  try {
    u = new URL(location, from);
  } catch {
    return null;
  }
  if (u.hostname !== HOST && u.hostname !== BARE_HOST) return null;
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  u.protocol = "https:";
  u.hostname = HOST;
  u.port = "";
  return u.href;
}

/** The headers the site's own page scripts send with their XHR form posts. */
const POST_HEADERS = {
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  "x-requested-with": "XMLHttpRequest",
  referer: `${SITE}/company-search/`,
  origin: SITE,
};

/**
 * Node's fetch, with redirects followed by hand: a redirect is followed only while it stays on the site (at most
 * MAX_HOPS), so a redirect elsewhere is answered as it is (send() refuses it) and never fetched. A POST that is
 * redirected is not sent again (the site never does this); it is answered as the redirect.
 */
const nativeTransport: Transport = {
  async send(req, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let at = req.url;
    try {
      for (let hop = 0; ; hop++) {
        const post = req.method === "POST";
        const r = await fetch(at, {
          method: req.method,
          headers: {
            "user-agent": UA,
            accept: post ? "*/*" : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-NZ,en;q=0.9",
            ...(post ? POST_HEADERS : {}),
          },
          body: post ? (req.form ?? "") : undefined,
          redirect: "manual",
          signal: ctrl.signal,
        });
        const location = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
        if (location) {
          await r.arrayBuffer().catch(() => undefined);
          const next = siteRedirect(location, at);
          if (next && hop < MAX_HOPS && !post) {
            // the next hop is another request to the site: it keeps the pacing too
            await sleep(minGapMs);
            stats.requests++;
            at = next;
            continue;
          }
          // off the site, round and round, or a moved POST: answered as the redirect itself, with where it pointed
          return { status: r.status, url: next ?? new URL(location, at).href, contentType: "", headers: keptHeaders((h) => r.headers.get(h)), body: Buffer.alloc(0) };
        }
        return { status: r.status, url: at, contentType: r.headers.get("content-type") ?? "", headers: keptHeaders((h) => r.headers.get(h)), body: Buffer.from(await r.arrayBuffer()) };
      }
    } catch (e) {
      throw new ApiError(0, networkWhy(e, timeoutMs), at);
    } finally {
      clearTimeout(timer);
    }
  },
};

/** A fetch failure in words: a timeout, or the cause Node hides under "fetch failed" (ECONNRESET and the like). */
export function networkWhy(e: unknown, timeoutMs: number): string {
  if (e instanceof Error && e.name === "AbortError") return `timed out after ${Math.round(timeoutMs / 1000)} s`;
  const cause = e instanceof Error ? (e as Error & { cause?: { code?: string; message?: string } }).cause : undefined;
  if (cause?.code === "ECONNRESET") return "network error: the site reset the connection";
  return `network error: ${[e instanceof Error ? e.message : String(e), cause?.message].filter(Boolean).join(": ")}`;
}

let override: Transport | null = null;
/** Tests put a recorded site here; null goes back to Node's fetch. */
export function setTransport(t: Transport | null): void {
  override = t;
}
const transport = (): Transport => override ?? nativeTransport;

// ---------------------------------------------------------------- pacing

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let minGapMs = 1000;
/** The least time between two requests to the site (1 s; the tests set 0). */
export function setPacing(ms: number): void {
  minGapMs = ms;
}
export const pacing = (): number => minGapMs;
/** How long to wait before the one retry: twice the pacing (2 s). */
const retryDelay = (): number => minGapMs * 2;
let busy: Promise<void> = Promise.resolve();
let lastStart = 0;
/** Runs fn when the site is free: one request at a time, minGapMs apart. */
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = busy.then(async () => {
    const wait = lastStart + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    return fn();
  });
  busy = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ---------------------------------------------------------------- cache

interface Cached {
  at: number;
  ttl: number;
  answer: Answer;
}
const cache = new Map<string, Cached>();
const MAX_CACHED = 400;
const MAX_CACHED_BYTES = 40 * 1024 * 1024;
let cachedBytes = 0;
export function clearCaches(): void {
  cache.clear();
  cachedBytes = 0;
  inflight.clear();
}
function remember(key: string, answer: Answer, ttl: number): void {
  const old = cache.get(key);
  if (old) cachedBytes -= old.answer.body.length;
  cache.set(key, { at: Date.now(), ttl, answer });
  cachedBytes += answer.body.length;
  for (const [k, v] of cache) {
    if (cache.size <= MAX_CACHED && cachedBytes <= MAX_CACHED_BYTES) break;
    cache.delete(k);
    cachedBytes -= v.answer.body.length;
  }
}
function recall(key: string): Answer | null {
  const c = cache.get(key);
  if (!c) return null;
  if (Date.now() - c.at > c.ttl) {
    cache.delete(key);
    cachedBytes -= c.answer.body.length;
    return null;
  }
  // most recently used last, so the oldest go first
  cache.delete(key);
  cache.set(key, c);
  return c.answer;
}

// ---------------------------------------------------------------- the one way to the site

export const stats = {
  requests: 0,
  cached: 0,
  lastError: null as string | null,
  lastErrorAt: null as string | null,
};
export const cacheInfo = (): { entries: number; bytes: number } => ({ entries: cache.size, bytes: cachedBytes });

/** A path or URL on the site as an https URL on www.bizdb.co.nz (bizdb.co.nz and http:// are made the canonical form). */
export function absolute(path: string): string {
  if (!/^https?:\/\//i.test(path)) return `${SITE}${path.startsWith("/") ? "" : "/"}${path}`;
  try {
    const u = new URL(path);
    if (u.hostname === BARE_HOST) u.hostname = HOST;
    if (u.hostname === HOST) u.protocol = "https:";
    return u.href;
  } catch {
    return path;
  }
}
export function isSiteUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === HOST && (u.port === "" || u.port === "443");
  } catch {
    return false;
  }
}

export interface Got extends Answer {
  cached: boolean;
}
export interface FetchOptions {
  /** how long the answer may be reused (default 10 minutes; 0 keeps it out of the cache) */
  ttlMs?: number;
  timeoutMs?: number;
  /** whether this answer may be cached at all (default: yes); an answer the caller will reject is not kept */
  keep?: (a: Answer) => boolean;
}

/** GET a path (or URL) on www.bizdb.co.nz. Status 400 and up and a refusal are ApiErrors. */
export function get(path: string, opts: FetchOptions = {}): Promise<Got> {
  return send({ method: "GET", url: absolute(path) }, opts);
}

/** POST a form (name/value pairs, in the order given) to a path on www.bizdb.co.nz, as the site's own scripts do. */
export function post(path: string, form: [string, string][], opts: FetchOptions = {}): Promise<Got> {
  return send({ method: "POST", url: absolute(path), form: formBody(form) }, opts);
}

/** Pairs as application/x-www-form-urlencoded, the way jQuery's $.ajax writes them (spaces as +). */
export function formBody(form: [string, string][]): string {
  return form.map(([k, v]) => `${encodeForm(k)}=${encodeForm(v)}`).join("&");
}
const encodeForm = (s: string): string => encodeURIComponent(s).replace(/%20/g, "+");

/** Requests on their way to the site, by cache key: an identical request made meanwhile waits for the same answer. */
const inflight = new Map<string, Promise<Got>>();

async function send(req: Request, opts: FetchOptions): Promise<Got> {
  const url = req.url;
  if (!isSiteUrl(url)) throw new InputError(`not a ${HOST} address: ${url}`);
  const key = req.method === "POST" ? `POST ${url}\n${req.form ?? ""}` : url;
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const hit = ttl > 0 ? recall(key) : null;
  if (hit) {
    stats.cached++;
    return { ...hit, cached: true };
  }
  if (ttl <= 0) return fetchFresh(req, key, ttl, opts);
  const pending = inflight.get(key);
  if (pending) {
    const a = await pending;
    stats.cached++;
    return { ...a, cached: true };
  }
  const p = fetchFresh(req, key, ttl, opts);
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

async function fetchFresh(req: Request, key: string, ttl: number, opts: FetchOptions): Promise<Got> {
  const url = req.url;
  const t = transport();
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const answer = await queued(async () => {
    for (let attempt = 0; ; attempt++) {
      stats.requests++;
      lastStart = Date.now();
      let a: Answer;
      try {
        a = await t.send(req, timeoutMs);
      } catch (e) {
        // a timeout is not retried: when the site hangs, waiting again only makes the caller wait longer
        const timedOut = e instanceof ApiError && /timed out/.test(e.message);
        if (attempt === 0 && !timedOut) {
          await sleep(retryDelay());
          continue;
        }
        throw e;
      }
      if (RETRY.has(a.status) && attempt === 0) {
        await sleep(retryDelay());
        continue;
      }
      return a;
    }
  }).catch((e) => {
    noteError(e instanceof Error ? e.message : String(e));
    throw e;
  });
  if (answer.status === 403) throw refused(answer, "refused the request (HTTP 403)");
  if (answer.status === 429) throw refused(answer, `asked for fewer requests (HTTP 429${answer.headers["retry-after"] ? `, retry after ${answer.headers["retry-after"]} s` : ""})`);
  if (!isSiteUrl(answer.url)) {
    noteError(`sent on to ${answer.url}`);
    throw new ApiError(502, `the site sent the request on to another address (${answer.url})`, url);
  }
  if (answer.status >= 400) {
    noteError(`HTTP ${answer.status} for ${url}`);
    throw new ApiError(answer.status, answer.status === 404 ? "not found" : `HTTP ${answer.status}`, url);
  }
  if (answer.status >= 300) {
    noteError(`HTTP ${answer.status} for ${url}`);
    throw new ApiError(answer.status, `the site redirected the request (HTTP ${answer.status} to ${answer.url})`, url);
  }
  if (ttl > 0 && (opts.keep?.(answer) ?? true)) remember(key, answer, ttl);
  return { ...answer, cached: false };
}

function noteError(message: string): void {
  stats.lastError = message;
  stats.lastErrorAt = new Date().toISOString();
}
function refused(a: Answer, what: string): ApiError {
  const e = new ApiError(a.status, `www.bizdb.co.nz ${what}. This server does not work around a refusal: wait a while before trying again, and search more narrowly`, a.url);
  noteError(e.message);
  return e;
}

// ---------------------------------------------------------------- helpers

export function errorMessage(e: unknown): string {
  if (e instanceof InputError) return e.message;
  if (e instanceof ApiError) {
    let where = e.url;
    try {
      const u = new URL(e.url);
      where = u.pathname + (u.search.length > 80 ? "?…" : u.search);
    } catch {
      /* keep */
    }
    if (e.status === 403 || e.status === 429) return e.message;
    return e.status ? `www.bizdb.co.nz answered HTTP ${e.status} for ${where}: ${e.message}` : `${e.message} (${where})`;
  }
  return e instanceof Error ? e.message : String(e);
}

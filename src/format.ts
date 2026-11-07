import { errorMessage } from "./http.js";

export type Content = { type: "text"; text: string };
export type ToolResult = { content: Content[]; isError?: boolean };
/** JSON longer than this is cut, with a note. */
const MAX_JSON = 120_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const join = (parts: (string | number | null | undefined | false)[], sep = ", "): string =>
  parts.filter((p) => p !== null && p !== undefined && p !== false && String(p).trim() !== "").map(String).join(sep);
export const plural = (n: number, word: string, pl = `${word}s`): string => `${n.toLocaleString("en-NZ")} ${n === 1 ? word : pl}`;
export const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max).trimEnd()}… [${(s.length - max).toLocaleString("en-NZ")} more characters]` : s);
export const kb = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`);
/** Letters and digits only, lower case, accents dropped: the key two names are compared by. */
export const fold = (s: unknown): string =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
/** Spaces collapsed and trimmed. */
export const squash = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/** "1", "Jul" (or "July"), "2010" -> "2010-07-01"; "" when they are not a date. */
export function isoFromParts(day: string | number, month: string | number, year: string | number): string {
  const d = Number(day);
  const y = Number(year);
  const m = typeof month === "number" ? month : MONTHS.findIndex((x) => x.toLowerCase() === String(month).trim().slice(0, 3).toLowerCase()) + 1;
  if (!Number.isInteger(d) || d < 1 || d > 31 || !Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 1800) return "";
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return validDate(iso) ? iso : "";
}
/** The first "09 Nov 1971" or "26 October 2017" in a text, as 1971-11-09; "" when there is none. */
export function isoFromText(s: string | null | undefined): string {
  const m = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})\b/i.exec(s ?? "");
  return m ? isoFromParts(m[1], m[2], m[3]) : "";
}
/** "2010-07-01" -> "1 Jul 2010"; "" for anything else. */
export function dateShort(s: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof s === "string" ? s.trim() : "");
  if (!m) return "";
  const mon = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  return mon && day >= 1 && day <= 31 ? `${day} ${mon} ${m[1]}` : "";
}
/** Whether a YYYY-MM-DD string is a real calendar date. */
export function validDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}
/** Today's date in New Zealand, as 2026-11-07. */
export const todayNz = (now = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

function render(summary: string | string[], data?: unknown): string {
  const head = (Array.isArray(summary) ? summary.filter((l) => l != null).join("\n").replace(/\n{3,}/g, "\n\n") : summary).trim();
  if (data === undefined) return head;
  let json = JSON.stringify(data, null, 2);
  if (json.length > MAX_JSON) json = `${json.slice(0, MAX_JSON)}\n… [JSON cut at ${MAX_JSON.toLocaleString("en-NZ")} characters; ask for fewer results or fewer sections]`;
  return `${head}\n\n${json}`;
}
export function ok(summary: string | string[], data?: unknown): ToolResult {
  return { content: [{ type: "text", text: render(summary, data) }] };
}
export function fail(e: unknown): ToolResult {
  return { content: [{ type: "text", text: errorMessage(e) }], isError: true };
}

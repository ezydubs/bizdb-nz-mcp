// Call tools from the command line against the live site and print what they return:
//   node scripts/call.mjs bizdb_search '{"name":"fonterra","limit":5}' [bizdb_company '{"nzbn":"9429040089218"}' …]
// Set CALL_MAX to change how many characters of each result are printed (default all).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";

const args = process.argv.slice(2);
if (!args.length || args.length % 2) {
  console.error("usage: node scripts/call.mjs <tool> '<json args>' [<tool> '<json args>' …]");
  process.exit(2);
}
const max = Number(process.env.CALL_MAX) || Infinity;
const server = createServer();
const client = new Client({ name: "call", version: "0" });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);
let errors = 0;
for (let i = 0; i < args.length; i += 2) {
  const r = await client.callTool({ name: args[i], arguments: JSON.parse(args[i + 1]) });
  if (r.isError) errors++;
  console.log(`######## ${args[i]} ${args[i + 1]}${r.isError ? " [error]" : ""}`);
  for (const c of r.content) console.log(c.type === "text" ? c.text.slice(0, max) : `[${c.type}]`);
  console.log();
}
await client.close();
process.exit(errors ? 1 : 0);

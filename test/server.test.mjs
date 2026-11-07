import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTRUCTIONS, TOOL_NAMES } from "../dist/server.js";
import { connect } from "./helpers.mjs";

test("the server lists its six tools, each read-only, described, and with an input schema", async () => {
  const c = await connect();
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
  for (const t of tools) {
    assert.ok(t.description && t.description.length > 80, `${t.name} has a description`);
    assert.equal(t.inputSchema.type, "object");
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} is read-only`);
  }
  const search = tools.find((t) => t.name === "bizdb_search");
  assert.deepEqual(Object.keys(search.inputSchema.properties).sort(), ["accredited_employer", "company_number", "industry", "limit", "name", "nzbn", "offset", "order", "sort", "type"]);
  assert.equal(search.inputSchema.properties.type.enum.length, 14);
  const company = tools.find((t) => t.name === "bizdb_company");
  assert.deepEqual(company.inputSchema.properties.sections.items.enum, ["overview", "history", "addresses", "contact", "shares", "people", "charity", "nearby", "description"]);
  await c.close();
});

test("the instructions name every tool and say what the site does not have", async () => {
  for (const name of TOOL_NAMES) assert.ok(INSTRUCTIONS.includes(name), name);
  assert.match(INSTRUCTIONS, /removed company has no page/);
  assert.match(INSTRUCTIONS, /cannot search people/);
  assert.match(INSTRUCTIONS, /no total count/);
  assert.match(INSTRUCTIONS, /not proof that it is the same person/);
  const c = await connect();
  assert.equal(c.getInstructions(), INSTRUCTIONS);
  await c.close();
});

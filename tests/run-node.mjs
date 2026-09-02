/*
 * Node test runner (optional — needs Node 18+).
 *   node --test tests/run-node.mjs
 * or just:  node tests/run-node.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SC = require("../extension/shared/suggest-core.js");
const buildCases = require("./cases.js");

const a = {
  ok: (v, m) => assert.ok(v, m),
  equal: (x, y, m) => assert.equal(x, y, m),
  notEqual: (x, y, m) => assert.notEqual(x, y, m)
};

for (const c of buildCases(SC)) {
  test(c.name, () => c.fn(a));
}

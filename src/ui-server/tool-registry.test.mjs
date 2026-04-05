import test from "node:test";
import assert from "node:assert/strict";

import {
  TOOL_DEFINITIONS,
  buildCliArgs,
  buildCommandPreview,
  getToolDefinition,
  requiresConfirmation,
  sanitizeParams,
  validateRequiredFields,
} from "./tool-registry.mjs";

test("tool registry exposes the expected tabs", () => {
  assert.equal(TOOL_DEFINITIONS.length, 4);
  assert.deepEqual(
    TOOL_DEFINITIONS.map((tool) => tool.id),
    ["pool.manage", "api-pool.start", "proxy.start", "llm.probe"],
  );
});

test("virtual pool-manage tab is exposed as a non-runnable tool definition", () => {
  const tool = getToolDefinition("pool.manage");
  assert.equal(tool.virtual, true);
  assert.equal(requiresConfirmation(tool, sanitizeParams(tool, {})), false);
});

test("probe validates required fields", () => {
  const tool = getToolDefinition("llm.probe");
  assert.deepEqual(validateRequiredFields(tool, sanitizeParams(tool, {})), [
    "目标 Base URL",
    "API Key / Token",
  ]);
});

test("command preview hides secrets while cli args keep real values", () => {
  const tool = getToolDefinition("api-pool.start");
  const params = sanitizeParams(tool, {
    provider: "codex",
    localApiKey: "secret-value",
  });
  assert.match(buildCommandPreview(tool, params, { hiddenFields: ["localApiKey"] }), /\*\*\*/);
  assert.ok(buildCliArgs(tool, params).some((item) => item.includes("secret-value")));
});

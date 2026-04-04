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

test("tool registry exposes the expected v1 tabs", () => {
  assert.equal(TOOL_DEFINITIONS.length, 4);
  assert.deepEqual(
    TOOL_DEFINITIONS.map((tool) => tool.id),
    ["proxy.start", "codex.configure", "codex.switch-account", "llm.probe"],
  );
});

test("switch-account confirmation only applies when dryRun is false", () => {
  const tool = getToolDefinition("codex.switch-account");
  assert.equal(requiresConfirmation(tool, sanitizeParams(tool, { dryRun: true })), false);
  assert.equal(requiresConfirmation(tool, sanitizeParams(tool, { dryRun: false })), true);
});

test("probe validates required fields", () => {
  const tool = getToolDefinition("llm.probe");
  assert.deepEqual(validateRequiredFields(tool, sanitizeParams(tool, {})), [
    "目标 Base URL",
    "API Key / Token",
  ]);
});

test("command preview hides secrets while cli args keep real values", () => {
  const tool = getToolDefinition("codex.configure");
  const params = sanitizeParams(tool, {
    baseUrl: "http://127.0.0.1:8787",
    apiKey: "secret-value",
  });
  assert.match(buildCommandPreview(tool, params, { hiddenFields: ["apiKey"] }), /\*\*\*/);
  assert.ok(buildCliArgs(tool, params).some((item) => item.includes("secret-value")));
});

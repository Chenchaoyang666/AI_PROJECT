import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ApiEndpointPool,
  isEndpointStructurallyEligible,
  normalizeEndpointType,
} from "./api-endpoint-pool.mjs";

async function makeTempPoolDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "api-pool-test-"));
}

test("normalizeEndpointType accepts codex and claude aliases", () => {
  assert.equal(normalizeEndpointType("codex"), "codex");
  assert.equal(normalizeEndpointType("claude"), "claude-code");
  assert.equal(normalizeEndpointType("claude_code"), "claude-code");
});

test("isEndpointStructurallyEligible rejects invalid or disabled items", () => {
  const valid = {
    type: "codex",
    baseUrl: "https://example.com/v1",
    apiKey: "sk-1",
    disabled: false,
  };
  assert.equal(isEndpointStructurallyEligible(valid, "codex"), true);
  assert.equal(isEndpointStructurallyEligible({ ...valid, disabled: true }, "codex"), false);
  assert.equal(isEndpointStructurallyEligible({ ...valid, apiKey: "" }, "codex"), false);
  assert.equal(isEndpointStructurallyEligible({ ...valid, type: "claude-code" }, "codex"), false);
});

test("ApiEndpointPool loads eligible items for the selected provider", async () => {
  const dir = await makeTempPoolDir();
  await fs.writeFile(
    path.join(dir, "good.json"),
    JSON.stringify({
      name: "main",
      type: "codex",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-good",
    }),
  );
  await fs.writeFile(
    path.join(dir, "wrong-provider.json"),
    JSON.stringify({
      name: "cc",
      type: "claude-code",
      baseUrl: "https://claude.example.com",
      apiKey: "sk-cc",
    }),
  );

  const pool = new ApiEndpointPool({
    poolDir: dir,
    provider: "codex",
    fetchFn: async () => new Response('{"data":[]}', { status: 200 }),
  });

  await pool.load();
  assert.equal(pool.listEndpoints().length, 1);
  assert.equal(pool.listEndpoints()[0].name, "main");
});

test("ApiEndpointPool rotates after failure and respects cooldown", async () => {
  const dir = await makeTempPoolDir();
  await fs.writeFile(
    path.join(dir, "a.json"),
    JSON.stringify({
      name: "a",
      type: "codex",
      baseUrl: "https://a.example.com/v1",
      apiKey: "sk-a",
    }),
  );
  await fs.writeFile(
    path.join(dir, "b.json"),
    JSON.stringify({
      name: "b",
      type: "codex",
      baseUrl: "https://b.example.com/v1",
      apiKey: "sk-b",
    }),
  );

  const pool = new ApiEndpointPool({
    poolDir: dir,
    provider: "codex",
    fetchFn: async (url, options) => {
      const auth = options?.headers?.authorization || "";
      if (String(url).includes("a.example.com") && auth.includes("sk-a")) {
        return new Response("forbidden", { status: 403 });
      }
      return new Response('{"data":[{"id":"gpt-5.4"}]}', { status: 200 });
    },
  });

  await pool.load();
  const initial = await pool.getInitialEndpoint();
  assert.ok(initial);
  assert.equal(initial.name, "b");

  const failed = pool.listEndpoints().find((item) => item.name === "a");
  assert.ok(pool.isCoolingDown(failed));
});

test("ApiEndpointPool returns null when all endpoints are cooling down", async () => {
  const dir = await makeTempPoolDir();
  await fs.writeFile(
    path.join(dir, "only.json"),
    JSON.stringify({
      name: "only",
      type: "codex",
      baseUrl: "https://only.example.com/v1",
      apiKey: "sk-only",
    }),
  );

  const pool = new ApiEndpointPool({
    poolDir: dir,
    provider: "codex",
    fetchFn: async () => new Response("rate limit", { status: 429 }),
  });

  await pool.load();
  const initial = await pool.getInitialEndpoint();
  assert.equal(initial, null);
  assert.equal(pool.listEndpoints().length, 1);
  assert.ok(pool.isCoolingDown(pool.listEndpoints()[0]));
});

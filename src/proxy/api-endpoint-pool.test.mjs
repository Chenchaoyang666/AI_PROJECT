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
    JSON.stringify([
      {
        name: "main",
        type: "codex",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-good",
      },
      {
        name: "backup",
        type: "codex",
        baseUrl: "https://backup.example.com/v1",
        apiKey: "sk-backup",
      },
    ]),
  );
  await fs.writeFile(
    path.join(dir, "wrong-provider.json"),
    JSON.stringify([
      {
        name: "cc",
        type: "claude-code",
        baseUrl: "https://claude.example.com",
        apiKey: "sk-cc",
      },
    ]),
  );

  const pool = new ApiEndpointPool({
    poolDir: dir,
    provider: "codex",
    fetchFn: async () => new Response('{"data":[]}', { status: 200 }),
  });

  await pool.load();
  assert.equal(pool.listEndpoints().length, 2);
  assert.equal(pool.listEndpoints()[0].name, "main");
  assert.equal(pool.listEndpoints()[1].name, "backup");
});

test("ApiEndpointPool supports legacy single-object files and array files together", async () => {
  const dir = await makeTempPoolDir();
  await fs.writeFile(
    path.join(dir, "single.json"),
    JSON.stringify({
      name: "single",
      type: "codex",
      baseUrl: "https://single.example.com/v1",
      apiKey: "sk-single",
    }),
  );
  await fs.writeFile(
    path.join(dir, "many.json"),
    JSON.stringify([
      {
        name: "many-1",
        type: "codex",
        baseUrl: "https://many1.example.com/v1",
        apiKey: "sk-many-1",
      },
      {
        name: "many-2",
        type: "codex",
        baseUrl: "https://many2.example.com/v1",
        apiKey: "sk-many-2",
      },
    ]),
  );

  const pool = new ApiEndpointPool({
    poolDir: dir,
    provider: "codex",
    fetchFn: async () => new Response('{"data":[]}', { status: 200 }),
  });

  await pool.load();
  assert.equal(pool.listEndpoints().length, 3);
  assert.deepEqual(
    pool.listEndpoints().map((item) => item.name),
    ["many-1", "many-2", "single"],
  );
});

test("ApiEndpointPool prioritizes pool.json over other json files in the same directory", async () => {
  const dir = await makeTempPoolDir();
  await fs.writeFile(
    path.join(dir, "pool.json"),
    JSON.stringify([
      {
        name: "preferred",
        type: "codex",
        baseUrl: "https://preferred.example.com/v1",
        apiKey: "sk-preferred",
      },
    ]),
  );
  await fs.writeFile(
    path.join(dir, "other.json"),
    JSON.stringify({
      name: "ignored",
      type: "codex",
      baseUrl: "https://ignored.example.com/v1",
      apiKey: "sk-ignored",
    }),
  );

  const pool = new ApiEndpointPool({
    poolDir: dir,
    provider: "codex",
    fetchFn: async () => new Response('{"data":[]}', { status: 200 }),
  });

  await pool.load();
  assert.equal(pool.listEndpoints().length, 1);
  assert.equal(pool.listEndpoints()[0].name, "preferred");
});

test("ApiEndpointPool rotates after failure and respects cooldown", async () => {
  const dir = await makeTempPoolDir();
  await fs.writeFile(
    path.join(dir, "a.json"),
    JSON.stringify([
      {
        name: "a",
        type: "codex",
        baseUrl: "https://a.example.com/v1",
        apiKey: "sk-a",
      },
      {
        name: "b",
        type: "codex",
        baseUrl: "https://b.example.com/v1",
        apiKey: "sk-b",
      },
    ]),
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
    JSON.stringify([
      {
        name: "only",
        type: "codex",
        baseUrl: "https://only.example.com/v1",
        apiKey: "sk-only",
      },
    ]),
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

test("ApiEndpointPool uses OpenAI-style probe for claude-code entries with gpt/codex models", async () => {
  const dir = await makeTempPoolDir();
  await fs.writeFile(
    path.join(dir, "pool.json"),
    JSON.stringify([
      {
        name: "openai-compatible",
        type: "claude-code",
        baseUrl: "https://compat.example.com",
        apiKey: "sk-compat",
        model: "gpt-5.3-codex",
      },
    ]),
  );

  let seenUrl = "";
  const pool = new ApiEndpointPool({
    poolDir: dir,
    provider: "claude-code",
    fetchFn: async (url) => {
      seenUrl = String(url);
      return new Response('{"data":[{"id":"gpt-5.3-codex"}]}', { status: 200 });
    },
  });

  await pool.load();
  const endpoint = await pool.getInitialEndpoint();
  assert.ok(endpoint);
  assert.match(seenUrl, /\/v1\/models$/);
});

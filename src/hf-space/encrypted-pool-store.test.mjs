import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EncryptedPoolStore } from "./encrypted-pool-store.mjs";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "enc-pool-store-test-"));
  const store = new EncryptedPoolStore({
    dataDir: path.join(root, "data"),
    cryptoKey: "test-crypto-key",
  });
  await store.init();
  return { root, store };
}

test("EncryptedPoolStore writes encrypted payload without plaintext secrets", async () => {
  const { store } = await makeStore();
  await store.savePool("codex-api", [
    {
      name: "main",
      type: "codex",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.4",
      disabled: false,
    },
  ]);

  const encryptedPath = path.join(store.dataDir, "pools", "codex-api.enc");
  const encrypted = await fs.readFile(encryptedPath, "utf8");
  assert.doesNotMatch(encrypted, /sk-test-secret/);

  const loaded = await store.loadPool("codex-api");
  assert.equal(loaded.items[0].apiKey, "");
  assert.ok(loaded.items[0].apiKeyMasked);

  const raw = await store.loadRawPoolItems("codex-api");
  assert.equal(raw[0].apiKey, "sk-test-secret");
});

test("EncryptedPoolStore preserves existing secrets when admin submits blank replacements", async () => {
  const { store } = await makeStore();
  await store.savePool("claude-code-api", [
    {
      name: "claude-main",
      type: "claude-code",
      baseUrl: "https://claude.example.com",
      apiKey: "sk-claude-secret",
      model: "claude-sonnet",
      disabled: false,
    },
  ]);

  await store.savePool("claude-code-api", [
    {
      name: "claude-main-renamed",
      type: "claude-code",
      baseUrl: "https://claude.example.com",
      apiKey: "",
      model: "claude-sonnet",
      disabled: false,
    },
  ]);

  const raw = await store.loadRawPoolItems("claude-code-api");
  assert.equal(raw[0].name, "claude-main-renamed");
  assert.equal(raw[0].apiKey, "sk-claude-secret");
});

test("EncryptedPoolStore can persist to a private hf dataset backend", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "enc-pool-store-hf-test-"));
  const files = new Map();
  const fetchCalls = [];
  const fetchFn = async (url, options = {}) => {
    fetchCalls.push({ url, options });

    if (String(url) === "https://huggingface.co/api/datasets/alice/private-db") {
      return new Response("{}", { status: 200 });
    }

    if (String(url).includes("/resolve/")) {
      const relativePath = String(url).split("/main/")[1];
      if (options.method === "HEAD") {
        if (!files.has(relativePath)) {
          return new Response("", { status: 404 });
        }
        return new Response("", {
          status: 200,
          headers: { "last-modified": new Date("2026-04-08T00:00:00.000Z").toUTCString() },
        });
      }
      if (!files.has(relativePath)) {
        return new Response("", { status: 404 });
      }
      return new Response(files.get(relativePath), {
        status: 200,
        headers: { "last-modified": new Date("2026-04-08T00:00:00.000Z").toUTCString() },
      });
    }

    if (String(url) === "https://huggingface.co/api/datasets/alice/private-db/commit/main") {
      const body = String(options.body || "").trim().split("\n").map((line) => JSON.parse(line));
      const fileOp = body.find((item) => item.key === "file");
      files.set(fileOp.value.path, Buffer.from(fileOp.value.content, "base64").toString("utf8"));
      return new Response(JSON.stringify({ commitOid: "abc123", commitUrl: "https://huggingface.co/commit/abc123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const store = new EncryptedPoolStore({
    dataDir: path.join(root, "data"),
    cryptoKey: "test-crypto-key",
    storageBackend: "hf-dataset",
    hfDatasetRepo: "alice/private-db",
    hfToken: "hf_test_token",
    fetchFn,
  });
  await store.init();

  await store.savePool("codex-api", [
    {
      name: "dataset-main",
      type: "codex",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-dataset-secret",
      model: "gpt-5.4",
      disabled: false,
    },
  ]);

  const pool = await store.loadPool("codex-api");
  assert.equal(pool.pool.filePath, "hf://datasets/alice/private-db/main/pools/codex-api.enc");
  assert.equal(pool.items[0].apiKey, "");
  assert.ok(fetchCalls.some(({ url }) => String(url) === "https://huggingface.co/api/datasets/alice/private-db"));
  assert.ok(fetchCalls.some(({ url }) => String(url) === "https://huggingface.co/api/datasets/alice/private-db/commit/main"));
});

test("EncryptedPoolStore marks hf dataset backend as read-only without HF_TOKEN", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "enc-pool-store-hf-ro-test-"));
  const store = new EncryptedPoolStore({
    dataDir: path.join(root, "data"),
    cryptoKey: "test-crypto-key",
    storageBackend: "hf-dataset",
    hfDatasetRepo: "alice/private-db",
  });
  await store.init();

  assert.equal(store.readOnly, true);
  assert.match(store.readOnlyReason, /HF_TOKEN is required/i);
});

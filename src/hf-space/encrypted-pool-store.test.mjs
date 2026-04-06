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

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PoolStore } from "./pool-store.mjs";

async function makeTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "pool-store-test-"));
}

test("PoolStore lists the fixed pools", () => {
  const store = new PoolStore();
  assert.deepEqual(
    store.listPools().map((item) => item.id),
    ["codex-accounts", "codex-api", "claude-code-api"],
  );
});

test("PoolStore validates bad pool ids", async () => {
  const store = new PoolStore();
  await assert.rejects(
    store.loadPool("missing-pool"),
    (error) => error?.statusCode === 404,
  );
});

test("PoolStore rejects invalid codex account items", () => {
  const store = new PoolStore();
  const result = store.validatePoolItems("codex-accounts", [
    { type: "codex", tokens: { access_token: "", account_id: "" } },
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 2);
});

test("PoolStore saves valid api pool items to pool.json", async () => {
  const root = await makeTempRoot();
  const filePath = path.join(root, "api_pool", "codex", "pool.json");
  const store = new PoolStore([
    {
      id: "codex-api",
      label: "Codex API 池",
      category: "api",
      provider: "codex",
      filePath,
    },
  ]);
  const result = await store.savePool("codex-api", [
    {
      name: "main",
      type: "codex",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4",
      disabled: false,
    },
  ]);
  assert.equal(result.count, 1);
  const written = JSON.parse(await fs.readFile(result.pool.filePath, "utf8"));
  assert.equal(written[0].name, "main");
});

test("PoolStore uses injected definitions instead of workspace defaults", async () => {
  const root = await makeTempRoot();
  const injectedFilePath = path.join(root, "custom", "pool.json");
  const store = new PoolStore([
    {
      id: "codex-api",
      label: "Injected Codex API 池",
      category: "api",
      provider: "codex",
      filePath: injectedFilePath,
    },
  ]);

  const result = await store.savePool("codex-api", [
    {
      name: "injected",
      type: "codex",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-injected",
      model: "gpt-5.4",
      disabled: false,
    },
  ]);

  assert.equal(result.pool.filePath, injectedFilePath);
  const written = JSON.parse(await fs.readFile(injectedFilePath, "utf8"));
  assert.equal(written[0].name, "injected");
});

test("PoolStore updates a codex account from local auth.json when account_id matches", async () => {
  const root = await makeTempRoot();
  const poolFilePath = path.join(root, "acc_pool", "pool.json");
  const authPath = path.join(root, "home", ".codex", "auth.json");
  await fs.mkdir(path.dirname(poolFilePath), { recursive: true });
  await fs.mkdir(path.dirname(authPath), { recursive: true });

  await fs.writeFile(
    poolFilePath,
    `${JSON.stringify([
      {
        type: "codex",
        email: "user@example.com",
        tokens: {
          access_token: "old-access",
          account_id: "acc-1",
          id_token: "old-id",
          refresh_token: "old-refresh",
        },
      },
    ], null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    authPath,
    `${JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "new-access",
        account_id: "acc-1",
        id_token: "new-id",
        refresh_token: "new-refresh",
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const store = new PoolStore([
    {
      id: "codex-accounts",
      label: "Codex 账号池",
      category: "accounts",
      provider: "codex",
      filePath: poolFilePath,
    },
  ]);

  const result = await store.updateCodexAccountFromLocalAuth(0, { authPath });
  assert.equal(result.items[0].tokens.access_token, "new-access");
  assert.equal(result.items[0].tokens.refresh_token, "new-refresh");
});

test("PoolStore rejects local auth.json update when account_id mismatches", async () => {
  const root = await makeTempRoot();
  const poolFilePath = path.join(root, "acc_pool", "pool.json");
  const authPath = path.join(root, "home", ".codex", "auth.json");
  await fs.mkdir(path.dirname(poolFilePath), { recursive: true });
  await fs.mkdir(path.dirname(authPath), { recursive: true });

  await fs.writeFile(
    poolFilePath,
    `${JSON.stringify([
      {
        type: "codex",
        tokens: {
          access_token: "old-access",
          account_id: "acc-1",
          id_token: "old-id",
          refresh_token: "old-refresh",
        },
      },
    ], null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    authPath,
    `${JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "new-access",
        account_id: "acc-2",
        id_token: "new-id",
        refresh_token: "new-refresh",
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const store = new PoolStore([
    {
      id: "codex-accounts",
      label: "Codex 账号池",
      category: "accounts",
      provider: "codex",
      filePath: poolFilePath,
    },
  ]);

  await assert.rejects(
    store.updateCodexAccountFromLocalAuth(0, { authPath }),
    (error) => error?.statusCode === 409,
  );
});

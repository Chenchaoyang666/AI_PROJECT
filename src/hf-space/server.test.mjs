import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAdminSessionCookie } from "./admin-auth.mjs";
import { EncryptedPoolStore } from "./encrypted-pool-store.mjs";
import { createHfSpaceServer } from "./server.mjs";

async function startServer(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function stopServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function makeEnv() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hf-space-server-test-"));
  return {
    root,
    env: {
      DATA_DIR: path.join(root, "data"),
      POOL_CRYPTO_KEY: "pool-crypto-test",
      ADMIN_SESSION_SECRET: "admin-session-secret",
      ADMIN_HF_USERNAMES: "alice",
      CODEX_ACCOUNT_PROXY_KEY: "acc-proxy-key",
      CODEX_API_PROXY_KEY: "codex-api-proxy-key",
      CLAUDE_API_PROXY_KEY: "claude-api-proxy-key",
      CODEX_PROXY_UPSTREAM_BASE: "https://chatgpt.com/backend-api/codex",
    },
  };
}

function sessionCookie(env) {
  return createAdminSessionCookie(
    {
      username: "alice",
      displayName: "Alice",
    },
    env.ADMIN_SESSION_SECRET,
  ).split(";")[0];
}

test("HF server enforces admin and proxy auth boundaries", async () => {
  const { env } = await makeEnv();
  const { server } = await createHfSpaceServer({
    env,
    codexApiFetchFn: async () => new Response('{"data":[{"id":"gpt-5.4"}]}', { status: 200 }),
  });
  const baseUrl = await startServer(server);

  try {
    const healthRes = await fetch(`${baseUrl}/healthz`);
    assert.deepEqual(await healthRes.json(), { ok: true });

    const adminRes = await fetch(`${baseUrl}/admin/api/app-config`);
    assert.equal(adminRes.status, 401);

    const adminWithProxyKey = await fetch(`${baseUrl}/admin/api/app-config`, {
      headers: {
        authorization: "Bearer acc-proxy-key",
      },
    });
    assert.equal(adminWithProxyKey.status, 401);

    const proxyWithSessionOnly = await fetch(`${baseUrl}/proxy/codex-account/v1/models`, {
      headers: {
        cookie: sessionCookie(env),
      },
    });
    assert.equal(proxyWithSessionOnly.status, 401);
  } finally {
    await stopServer(server);
  }
});

test("HF server imports encrypted pool data, reloads services, and hides public status routes", async () => {
  const { env } = await makeEnv();
  const { server } = await createHfSpaceServer({
    env,
    codexApiFetchFn: async () => new Response('{"data":[{"id":"gpt-5.4"}]}', { status: 200 }),
  });
  const baseUrl = await startServer(server);
  const cookie = sessionCookie(env);

  try {
    const importRes = await fetch(`${baseUrl}/admin/api/pools/codex-api/import`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            name: "main",
            type: "codex",
            baseUrl: "https://example.com/v1",
            apiKey: "sk-import-secret",
            model: "gpt-5.4",
            disabled: false,
          },
        ],
      }),
    });
    assert.equal(importRes.status, 200);

    const encryptedPath = path.join(env.DATA_DIR, "pools", "codex-api.enc");
    const encrypted = await fs.readFile(encryptedPath, "utf8");
    assert.doesNotMatch(encrypted, /sk-import-secret/);

    const reloadRes = await fetch(`${baseUrl}/admin/api/reload`, {
      method: "POST",
      headers: {
        cookie,
      },
    });
    assert.equal(reloadRes.status, 200);

    const statusRes = await fetch(`${baseUrl}/admin/api/api-pool/codex/status`, {
      headers: {
        cookie,
      },
    });
    const status = await statusRes.json();
    assert.equal(status.running, true);
    assert.equal(status.proxyStatus.body.scheduledSwitchEnabled, true);
    assert.equal(typeof status.proxyStatus.body.inflightRequests, "number");
    assert.equal(status.proxyStatus.body.scheduledSwitchIntervalMs, 900000);

    const proxyRes = await fetch(`${baseUrl}/proxy/codex-api/v1/models`, {
      headers: {
        authorization: "Bearer codex-api-proxy-key",
      },
    });
    assert.equal(proxyRes.status, 200);

    const hiddenStatusRes = await fetch(`${baseUrl}/proxy/codex-api/proxy/status`, {
      headers: {
        authorization: "Bearer codex-api-proxy-key",
      },
    });
    assert.equal(hiddenStatusRes.status, 404);
  } finally {
    await stopServer(server);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CodexAccountPool,
  classifyFailure,
  decodeJwtPayload,
  isAccountStructurallyEligible,
} from "./codex-account-pool.mjs";

function makeFakeJwt(payload) {
  const head = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${head}.${body}.sig`;
}

async function makeTempTokensDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "codex-pool-test-"));
}

test("classifyFailure covers primary categories", () => {
  assert.equal(classifyFailure({ status: 401 }).category, "auth");
  assert.equal(classifyFailure({ status: 429 }).category, "rate_limit");
  assert.equal(classifyFailure({ status: 503 }).category, "server");
  assert.equal(
    classifyFailure({ status: 400, detail: "insufficient_quota" }).category,
    "quota",
  );
  assert.equal(classifyFailure({ status: 0, detail: "network timeout" }).category, "network");
});

test("decodeJwtPayload decodes base64url payload", () => {
  const token = makeFakeJwt({ exp: 2000000000, client_id: "client-1" });
  const payload = decodeJwtPayload(token);
  assert.equal(payload.client_id, "client-1");
  assert.equal(payload.exp, 2000000000);
});

test("isAccountStructurallyEligible requires refresh token", () => {
  const valid = {
    type: "codex",
    disabled: false,
    accountId: "acc-1",
    accessToken: "a",
    idToken: "b",
    refreshToken: "r",
  };
  assert.equal(isAccountStructurallyEligible(valid), true);
  assert.equal(isAccountStructurallyEligible({ ...valid, refreshToken: "" }), false);
  assert.equal(isAccountStructurallyEligible({ ...valid, disabled: true }), false);
});

test("CodexAccountPool loads eligible accounts and probes active", async () => {
  const dir = await makeTempTokensDir();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;

  const goodToken = makeFakeJwt({ exp: futureExp, client_id: "app_1" });
  const badToken = makeFakeJwt({ exp: futureExp, client_id: "app_2" });

  await fs.writeFile(
    path.join(dir, "good.json"),
    JSON.stringify(
      {
        type: "codex",
        disabled: false,
        account_id: "good-acc",
        email: "good@example.com",
        access_token: goodToken,
        id_token: "id-1",
        refresh_token: "rt-1",
      },
      null,
      2,
    ),
  );

  await fs.writeFile(
    path.join(dir, "missing-refresh.json"),
    JSON.stringify(
      {
        type: "codex",
        disabled: false,
        account_id: "bad-acc",
        email: "bad@example.com",
        access_token: badToken,
        id_token: "id-2",
        refresh_token: "",
      },
      null,
      2,
    ),
  );

  const fetchFn = async (url, options) => {
    if (url.endsWith("/v1/models")) {
      const auth = options?.headers?.authorization || "";
      const ok = auth.includes(goodToken);
      return new Response(ok ? '{"data":[{"id":"gpt-5.4"}]}' : "forbidden", {
        status: ok ? 200 : 403,
      });
    }
    return new Response("not found", { status: 404 });
  };

  const pool = new CodexAccountPool({
    tokensDir: dir,
    probeUrl: "https://api.openai.com/v1/models",
    fetchFn,
  });

  await pool.load();
  assert.equal(pool.listAccounts().length, 1);
  assert.equal(pool.listAccounts()[0].accountId, "good-acc");

  const active = await pool.getInitialAccount();
  assert.ok(active);
  assert.equal(active.accountId, "good-acc");
  assert.equal(pool.getActiveAccount().id, active.id);
});

test("CodexAccountPool accepts provider auth.json token shape", async () => {
  const dir = await makeTempTokensDir();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = makeFakeJwt({ exp: futureExp, client_id: "app_provider" });

  await fs.writeFile(
    path.join(dir, "provider-auth-shape.json"),
    JSON.stringify(
      {
        OPENAI_API_KEY: "",
        auth_mode: "chatgpt",
        last_refresh: new Date().toISOString(),
        tokens: {
          access_token: accessToken,
          account_id: "provider-acc",
          id_token: "provider-id-token",
          refresh_token: "provider-refresh-token",
        },
      },
      null,
      2,
    ),
  );

  const fetchFn = async () => new Response('{"data":[{"id":"gpt-5.4"}]}', { status: 200 });
  const pool = new CodexAccountPool({
    tokensDir: dir,
    probeUrl: "https://api.openai.com/v1/models",
    fetchFn,
  });

  await pool.load();
  assert.equal(pool.listAccounts().length, 1);
  assert.equal(pool.listAccounts()[0].accountId, "provider-acc");
  assert.equal(pool.listAccounts()[0].type, "codex");
});

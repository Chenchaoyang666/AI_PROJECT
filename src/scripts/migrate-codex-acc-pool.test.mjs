import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrateCodexAccountPool } from "./migrate-codex-acc-pool.mjs";

async function makeTempTokensDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "migrate-codex-pool-test-"));
}

test("migrateCodexAccountPool merges scattered account files into pool.json and backs them up", async () => {
  const dir = await makeTempTokensDir();
  await fs.writeFile(
    path.join(dir, "a.json"),
    JSON.stringify({
      type: "codex",
      email: "a@example.com",
      tokens: {
        access_token: "token-a",
        account_id: "acc-a",
        id_token: "id-a",
        refresh_token: "rt-a",
      },
    }),
  );
  await fs.writeFile(
    path.join(dir, "b.json"),
    JSON.stringify({
      type: "codex",
      email: "b@example.com",
      tokens: {
        access_token: "token-b",
        account_id: "acc-b",
        id_token: "id-b",
        refresh_token: "rt-b",
      },
    }),
  );

  const result = await migrateCodexAccountPool({ tokensDir: dir });
  const pool = JSON.parse(await fs.readFile(result.poolPath, "utf8"));
  assert.equal(pool.length, 2);
  assert.equal(pool[0].tokens.account_id, "acc-a");
  assert.ok(result.backupDir);

  const backupEntries = await fs.readdir(result.backupDir);
  assert.ok(backupEntries.includes("a.json"));
  assert.ok(backupEntries.includes("b.json"));
});

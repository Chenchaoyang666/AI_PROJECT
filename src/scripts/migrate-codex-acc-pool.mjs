#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_TOKENS_DIR = path.resolve(process.cwd(), "acc_pool");

function parseArgs(argv) {
  const args = {};
  for (const part of argv) {
    if (!part.startsWith("--")) continue;
    const raw = part.slice(2);
    const idx = raw.indexOf("=");
    if (idx === -1) {
      args[raw] = "true";
      continue;
    }
    args[raw.slice(0, idx)] = raw.slice(idx + 1);
  }
  return args;
}

function nowStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function normalizeEntries(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((entry) => entry && typeof entry === "object");
  }
  if (raw && typeof raw === "object") {
    return [raw];
  }
  return [];
}

function getTokenSource(entry) {
  return entry?.tokens && typeof entry.tokens === "object" ? entry.tokens : entry;
}

function isUsableCodexEntry(entry) {
  const tokenSource = getTokenSource(entry);
  return Boolean(
    (entry.type || "codex") === "codex" &&
      tokenSource.access_token &&
      tokenSource.account_id &&
      tokenSource.id_token &&
      tokenSource.refresh_token,
  );
}

function normalizeCodexEntry(entry) {
  const tokenSource = getTokenSource(entry);
  return {
    OPENAI_API_KEY: entry.OPENAI_API_KEY || "",
    auth_mode: entry.auth_mode || "chatgpt",
    type: entry.type || "codex",
    disabled: Boolean(entry.disabled),
    email: entry.email || "",
    name: entry.name || "",
    last_refresh: entry.last_refresh || new Date().toISOString(),
    expired: entry.expired || null,
    tokens: {
      access_token: tokenSource.access_token || "",
      account_id: tokenSource.account_id || "",
      id_token: tokenSource.id_token || "",
      refresh_token: tokenSource.refresh_token || "",
    },
  };
}

export async function migrateCodexAccountPool({ tokensDir = DEFAULT_TOKENS_DIR } = {}) {
  const dirEntries = await fs.readdir(tokensDir, { withFileTypes: true });
  const files = dirEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "pool.json")
    .map((entry) => path.join(tokensDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const merged = [];
  const seen = new Set();

  for (const filePath of files) {
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      continue;
    }
    for (const entry of normalizeEntries(raw)) {
      if (!isUsableCodexEntry(entry)) continue;
      const normalized = normalizeCodexEntry(entry);
      const accountId = normalized.tokens.account_id;
      if (!accountId || seen.has(accountId)) continue;
      seen.add(accountId);
      merged.push(normalized);
    }
  }

  const poolPath = path.join(tokensDir, "pool.json");
  await fs.writeFile(poolPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  let backupDir = null;
  if (files.length > 0) {
    backupDir = path.join(tokensDir, "_backup", nowStamp());
    await fs.mkdir(backupDir, { recursive: true });
    for (const filePath of files) {
      await fs.rename(filePath, path.join(backupDir, path.basename(filePath)));
    }
  }

  return {
    poolPath,
    backupDir,
    count: merged.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tokensDir = path.resolve(args["tokens-dir"] || DEFAULT_TOKENS_DIR);
  const result = await migrateCodexAccountPool({ tokensDir });
  console.log(`Pool written: ${result.poolPath}`);
  console.log(`Accounts merged: ${result.count}`);
  console.log(`Backup dir: ${result.backupDir || "(none)"}`);
}

const directRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (directRun) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

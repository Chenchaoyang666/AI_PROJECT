#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_CODEX_HOME = path.join(os.homedir(), ".codex");
const DEFAULT_AUTH_PATH = path.join(DEFAULT_CODEX_HOME, "auth.json");
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_CODEX_HOME, "config.toml");
const DEFAULT_BACKUP_DIR = path.join(DEFAULT_CODEX_HOME, "backups", "configure-codex-local-proxy");

const DEFAULT_PROXY_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_PROXY_API_KEY = "local-codex-proxy-key";
const DEFAULT_MODEL = "gpt-5.4";

function parseArgs(argv) {
  const args = {};
  for (const part of argv) {
    if (!part.startsWith("--")) continue;
    const raw = part.slice(2);
    const idx = raw.indexOf("=");
    if (idx < 0) {
      args[raw] = "true";
      continue;
    }
    args[raw.slice(0, idx)] = raw.slice(idx + 1);
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node src/scripts/configure-codex-local-proxy.mjs

Options:
  --base-url=http://127.0.0.1:8787
  --api-key=local-codex-proxy-key
  --model=gpt-5.4
  --auth-path=~/.codex/auth.json
  --config-path=~/.codex/config.toml
  --backup-dir=~/.codex/backups/configure-codex-local-proxy
  --help
`);
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

function buildConfigToml({ model, baseUrl }) {
  return [
    'model_provider = "OpenAI"',
    `model = "${model}"`,
    `review_model = "${model}"`,
    "disable_response_storage = true",
    'network_access = "enabled"',
    "windows_wsl_setup_acknowledged = true",
    "model_context_window = 1000000",
    "model_auto_compact_token_limit = 900000",
    'model_reasoning_effort = "medium"',
    "",
    "[model_providers]",
    "[model_providers.OpenAI]",
    'name = "OpenAI"',
    `base_url = "${baseUrl}"`,
    'wire_api = "responses"',
    "requires_openai_auth = true",
    "",
  ].join("\n");
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function backupIfExists(sourcePath, backupDir) {
  try {
    await fs.access(sourcePath);
  } catch {
    return null;
  }
  await ensureDir(backupDir);
  const targetPath = path.join(
    backupDir,
    `${path.basename(sourcePath)}.${nowStamp()}.bak`,
  );
  await fs.copyFile(sourcePath, targetPath);
  return targetPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    printUsage();
    return;
  }

  const baseUrl = args["base-url"] || process.env.CODEX_PROXY_BASE_URL || DEFAULT_PROXY_BASE_URL;
  const apiKey = args["api-key"] || process.env.CODEX_PROXY_API_KEY || DEFAULT_PROXY_API_KEY;
  const model = args.model || DEFAULT_MODEL;
  const authPath = path.resolve(args["auth-path"] || DEFAULT_AUTH_PATH);
  const configPath = path.resolve(args["config-path"] || DEFAULT_CONFIG_PATH);
  const backupDir = path.resolve(args["backup-dir"] || DEFAULT_BACKUP_DIR);

  const authBackup = await backupIfExists(authPath, backupDir);
  const configBackup = await backupIfExists(configPath, backupDir);

  await ensureDir(path.dirname(authPath));
  await ensureDir(path.dirname(configPath));

  const authJson = { OPENAI_API_KEY: apiKey };
  const configToml = buildConfigToml({ model, baseUrl });

  await fs.writeFile(authPath, `${JSON.stringify(authJson, null, 2)}\n`, "utf8");
  await fs.writeFile(configPath, configToml, "utf8");

  console.log("Codex configured to local proxy.");
  console.log(`Auth file: ${authPath}`);
  console.log(`Config file: ${configPath}`);
  console.log(`Proxy base URL: ${baseUrl}`);
  console.log(`Model: ${model}`);
  console.log(`Auth backup: ${authBackup || "(none)"}`);
  console.log(`Config backup: ${configBackup || "(none)"}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});

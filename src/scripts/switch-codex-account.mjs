#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TOKENS_DIR = path.resolve(process.cwd(), "acc_pool");
const DEFAULT_CODEX_HOME = path.join(os.homedir(), ".codex");
const DEFAULT_AUTH_PATH = path.join(DEFAULT_CODEX_HOME, "auth.json");
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_CODEX_HOME, "config.toml");
const DEFAULT_BACKUP_DIR = path.join(DEFAULT_CODEX_HOME, "backups", "switch-codex-account");
const DEFAULT_VALIDATE_URL = "https://api.openai.com/v1/models";
const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_TIMEOUT_SECONDS = 20;

function parseArgs(argv) {
  const args = {};
  for (const part of argv) {
    if (!part.startsWith("--")) continue;
    const raw = part.slice(2);
    const eqIndex = raw.indexOf("=");
    if (eqIndex === -1) {
      args[raw] = "true";
      continue;
    }
    const key = raw.slice(0, eqIndex);
    const value = raw.slice(eqIndex + 1);
    args[key] = value;
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node src/scripts/switch-codex-account.mjs
  node src/scripts/switch-codex-account.mjs --tokens-dir=acc_pool --model=gpt-5.4

Options:
  --tokens-dir=PATH       Token JSON directory. Default: acc_pool
  --auth-path=PATH        Target Codex auth.json path
  --config-path=PATH      Target Codex config.toml path
  --backup-dir=PATH       Backup directory
  --validate-url=URL      Validation URL. Default: https://api.openai.com/v1/models
  --model=NAME            model / review_model value. Default: gpt-5.4
  --timeout=SECONDS       Curl timeout. Default: 20
  --dry-run               Validate only, do not write files
  --help                  Show this help
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

function maskToken(value) {
  if (!value) return "";
  if (value.length <= 12) return "*".repeat(value.length);
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function toIsoString(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function isFutureDate(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

function buildCodexAuthJson(entry) {
  const tokenSource = entry.tokens && typeof entry.tokens === "object" ? entry.tokens : entry;
  return {
    OPENAI_API_KEY: "",
    auth_mode: "chatgpt",
    last_refresh: toIsoString(entry.last_refresh) || new Date().toISOString(),
    tokens: {
      access_token: tokenSource.access_token,
      account_id: tokenSource.account_id,
      id_token: tokenSource.id_token,
      refresh_token: tokenSource.refresh_token,
    },
  };
}

function buildCodexConfigToml(model) {
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
    'wire_api = "responses"',
    "requires_openai_auth = true",
    "",
  ].join("\n");
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function listTokenFiles(tokensDir) {
  const entries = await fs.readdir(tokensDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(tokensDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function precheckEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return { ok: false, reason: "invalid-json" };
  }
  const tokenSource = entry.tokens && typeof entry.tokens === "object" ? entry.tokens : entry;
  if (entry.disabled) {
    return { ok: false, reason: "disabled" };
  }
  if (
    !tokenSource.access_token ||
    !tokenSource.account_id ||
    !tokenSource.id_token ||
    !tokenSource.refresh_token
  ) {
    return { ok: false, reason: "missing-required-fields" };
  }
  if (entry.expired && !isFutureDate(entry.expired)) {
    return { ok: false, reason: "expired-field" };
  }

  const payload = decodeJwtPayload(tokenSource.access_token);
  if (!payload) {
    return { ok: false, reason: "invalid-access-token-jwt" };
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
    return { ok: false, reason: "expired-jwt" };
  }

  return {
    ok: true,
    reason: "precheck-passed",
    payload,
  };
}

async function validateAccessToken(accessToken, validateUrl, timeoutSeconds) {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      [
        "-sS",
        "-D",
        "-",
        "-o",
        "/dev/null",
        "-m",
        String(timeoutSeconds),
        "-H",
        `Authorization: Bearer ${accessToken}`,
        validateUrl,
      ],
      { maxBuffer: 1024 * 1024 * 2 },
    );

    const match = stdout.match(/^HTTP\/\S+\s+(\d+)/m);
    const status = match ? Number(match[1]) : 0;
    const ok = status >= 200 && status < 300;
    return {
      ok,
      status,
      reason: ok ? "validated" : `http-${status || "unknown"}`,
    };
  } catch (error) {
    const detail = [error?.stdout, error?.stderr, error?.message]
      .filter(Boolean)
      .join(" ")
      .trim();
    return {
      ok: false,
      status: 0,
      reason: detail || "curl-failed",
    };
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function backupFileIfExists(sourcePath, backupDir) {
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

async function writeSelectedAccount({
  selectedFile,
  selectedEntry,
  authPath,
  configPath,
  backupDir,
  model,
  dryRun,
}) {
  const authJson = buildCodexAuthJson(selectedEntry);
  const configToml = buildCodexConfigToml(model);

  if (dryRun) {
    return {
      authBackupPath: null,
      configBackupPath: null,
      wrote: false,
      authJson,
      configToml,
    };
  }

  const authBackupPath = await backupFileIfExists(authPath, backupDir);
  const configBackupPath = await backupFileIfExists(configPath, backupDir);

  await ensureDir(path.dirname(authPath));
  await ensureDir(path.dirname(configPath));
  await fs.writeFile(authPath, `${JSON.stringify(authJson, null, 2)}\n`, "utf8");
  await fs.writeFile(configPath, configToml, "utf8");

  return {
    authBackupPath,
    configBackupPath,
    wrote: true,
    authJson,
    configToml,
    selectedFile,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    printUsage();
    return;
  }

  const tokensDir = path.resolve(args["tokens-dir"] || DEFAULT_TOKENS_DIR);
  const authPath = path.resolve(args["auth-path"] || DEFAULT_AUTH_PATH);
  const configPath = path.resolve(args["config-path"] || DEFAULT_CONFIG_PATH);
  const backupDir = path.resolve(args["backup-dir"] || DEFAULT_BACKUP_DIR);
  const validateUrl = args["validate-url"] || DEFAULT_VALIDATE_URL;
  const model = args.model || DEFAULT_MODEL;
  const timeoutSeconds = Number(args.timeout || DEFAULT_TIMEOUT_SECONDS);
  const dryRun = args["dry-run"] === "true";

  const tokenFiles = await listTokenFiles(tokensDir);
  if (tokenFiles.length === 0) {
    throw new Error(`No token json files found in ${tokensDir}`);
  }

  console.log(`Scanning token files: ${tokensDir}`);
  console.log(`Validation URL: ${validateUrl}`);
  console.log(`Dry run: ${dryRun ? "yes" : "no"}`);

  const failures = [];
  let selected = null;

  for (const filePath of tokenFiles) {
    const fileName = path.basename(filePath);
    let entry;
    try {
      entry = await readJsonFile(filePath);
    } catch (error) {
      failures.push({ file: fileName, stage: "read", reason: error.message });
      console.log(`skip ${fileName}: failed to read json`);
      continue;
    }

    const precheck = precheckEntry(entry);
    if (!precheck.ok) {
      failures.push({ file: fileName, stage: "precheck", reason: precheck.reason });
      console.log(`skip ${fileName}: ${precheck.reason}`);
      continue;
    }

    const tokenSource = entry.tokens && typeof entry.tokens === "object" ? entry.tokens : entry;
    console.log(`validate ${fileName}: ${maskToken(tokenSource.access_token)}`);
    const validation = await validateAccessToken(
      tokenSource.access_token,
      validateUrl,
      timeoutSeconds,
    );

    if (!validation.ok) {
      failures.push({ file: fileName, stage: "validate", reason: validation.reason });
      console.log(`invalid ${fileName}: ${validation.reason}`);
      continue;
    }

    selected = {
      filePath,
      fileName,
      entry,
      validation,
      payload: precheck.payload,
    };
    break;
  }

  if (!selected) {
    console.error("No usable account found.");
    if (failures.length > 0) {
      console.error("Recent failures:");
      for (const failure of failures.slice(0, 10)) {
        console.error(`- ${failure.file} [${failure.stage}] ${failure.reason}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  const writeResult = await writeSelectedAccount({
    selectedFile: selected.fileName,
    selectedEntry: selected.entry,
    authPath,
    configPath,
    backupDir,
    model,
    dryRun,
  });

  console.log("");
  console.log(`Selected account: ${selected.fileName}`);
  console.log(`Email: ${selected.entry.email || "(unknown)"}`);
  const selectedTokenSource =
    selected.entry.tokens && typeof selected.entry.tokens === "object"
      ? selected.entry.tokens
      : selected.entry;
  console.log(`Account ID: ${selectedTokenSource.account_id}`);
  console.log(`Plan: ${selected.payload?.["https://api.openai.com/auth"]?.chatgpt_plan_type || "(unknown)"}`);
  console.log(`Auth path: ${authPath}`);
  console.log(`Config path: ${configPath}`);

  if (writeResult.wrote) {
    console.log(`Auth backup: ${writeResult.authBackupPath || "(none)"}`);
    console.log(`Config backup: ${writeResult.configBackupPath || "(none)"}`);
    console.log("Codex auth.json and config.toml updated.");
  } else {
    console.log("Dry run only. Files were not written.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

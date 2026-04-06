#!/usr/bin/env node

import { spawn } from "node:child_process";
import http from "node:http";
import { Readable } from "node:stream";
import path from "node:path";

import { CodexAccountPool, classifyFailure } from "../proxy/codex-account-pool.mjs";
import { sanitizeForLogs } from "../shared/secret-sanitizer.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_TOKENS_DIR = path.resolve(process.cwd(), "acc_pool");
const DEFAULT_UPSTREAM_BASE = "https://chatgpt.com/backend-api/codex";
const DEFAULT_REFRESH_ENDPOINT = "https://auth.openai.com/oauth/token";
const DEFAULT_CLIENT_VERSION = "0.117.0";
const DEFAULT_PROBE_URL = `${DEFAULT_UPSTREAM_BASE}/models?client_version=${DEFAULT_CLIENT_VERSION}`;
const DEFAULT_LOCAL_API_KEY = "local-codex-proxy-key";
const DEFAULT_MAX_SWITCH_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

const SUPPORTED_PATHS = new Set([
  "/models",
  "/responses",
  "/v1/models",
  "/v1/responses",
  "/v1/chat/completions",
]);

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
  node src/scripts/codex-local-proxy.mjs

Options:
  --host=127.0.0.1
  --port=8787
  --tokens-dir=acc_pool
  --upstream-base=https://chatgpt.com/backend-api/codex
  --refresh-endpoint=https://auth.openai.com/oauth/token
  --probe-url=https://chatgpt.com/backend-api/codex/models?client_version=0.117.0
  --local-api-key=local-codex-proxy-key
  --max-switch-attempts=3
  --request-timeout-ms=60000
  --proxy-url=http://127.0.0.1:8118
  --help
`);
}

async function maybeRespawnWithProxy(argv) {
  const args = parseArgs(argv);
  const proxyUrl = args["proxy-url"] || "";
  if (!proxyUrl || process.env.CODEX_PROXY_BOOTSTRAPPED === "1") {
    return false;
  }

  const childEnv = {
    ...process.env,
    CODEX_PROXY_BOOTSTRAPPED: "1",
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: proxyUrl,
    HTTP_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
  };

  const child = spawn(process.execPath, [process.argv[1], ...argv], {
    stdio: "inherit",
    env: childEnv,
  });

  await new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
      resolve();
    });
    child.on("error", reject);
  });

  return true;
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function getRequestPath(url = "/") {
  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.pathname;
  } catch {
    return "/";
  }
}

function resolveUpstreamUrl(reqUrl, requestPath, options) {
  const upstreamBase = options.upstreamBase.replace(/\/+$/, "");
  const parsed = new URL(reqUrl || "/", "http://localhost");

  if (upstreamBase.includes("chatgpt.com/backend-api/codex")) {
    if (requestPath === "/models" || requestPath === "/v1/models") {
      return `${upstreamBase}/models?client_version=${encodeURIComponent(
        options.clientVersion,
      )}`;
    }
    if (requestPath === "/responses" || requestPath === "/v1/responses") {
      return `${upstreamBase}/responses`;
    }
  }

  return `${upstreamBase}${parsed.pathname}${parsed.search}`;
}

function copyHeadersForUpstream(reqHeaders, token) {
  const headers = {};
  for (const [key, value] of Object.entries(reqHeaders || {})) {
    if (value == null) continue;
    const lower = key.toLowerCase();
    if (["host", "authorization", "content-length", "connection"].includes(lower)) {
      continue;
    }
    headers[key] = value;
  }
  headers.authorization = `Bearer ${token}`;
  return headers;
}

function copyHeadersToClient(res, upstreamHeaders) {
  for (const [key, value] of upstreamHeaders.entries()) {
    if (key.toLowerCase() === "transfer-encoding") continue;
    res.setHeader(key, value);
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function requireLocalAuth(req, expectedKey) {
  const auth = String(req.headers.authorization || "");
  const expected = `Bearer ${expectedKey}`;
  return auth === expected;
}

function classifyRetryableFailure(status, detail) {
  const result = classifyFailure({ status, detail });
  const retryable = ["auth", "rate_limit", "quota", "server", "network"].includes(
    result.category,
  );
  return { ...result, retryable };
}

export function accountSummary(account) {
  if (!account) return null;
  return {
    id: account.id,
    email: account.email,
    accountId: account.accountId,
    healthy: account.healthy,
    cooldownUntil: account.cooldownUntilMs ? new Date(account.cooldownUntilMs).toISOString() : null,
    lastFailureReason: account.lastFailureReason,
    lastValidation: account.lastValidation,
  };
}

function createConsoleStartupLogger() {
  return (event, payload = {}) => {
    const time = new Date().toISOString();
    const sanitized = sanitizeForLogs(payload);
    const details = Object.entries(sanitized)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" ");
    console.log(`[startup] ${time} ${event}${details ? ` ${details}` : ""}`);
  };
}

function unauthorized(res) {
  res.statusCode = 401;
  res.setHeader("content-type", "application/json");
  res.end(safeJson({ error: { message: "Unauthorized local proxy key." } }));
}

export async function createProxyService(options) {
  const startupLogger = typeof options.logger === "function" ? options.logger : createConsoleStartupLogger();
  const fetchFn = options.fetchFn || (await createFetchWithProxy(options.proxyUrl));
  const pool = new CodexAccountPool({
    tokensDir: options.tokensDir,
    refreshEndpoint: options.refreshEndpoint,
    probeUrl: options.probeUrl,
    fetchFn,
    logger: startupLogger,
    loadSnapshot: options.loadSnapshot,
    saveSnapshot: options.saveSnapshot,
    sourcePath: options.sourcePath,
  });

  startupLogger("pool:load:start", { tokensDir: options.tokensDir });
  await pool.load();
  startupLogger("pool:load:done", { count: pool.listAccounts().length });
  startupLogger("pool:initial-account:start");
  const active = await pool.getInitialAccount();
  if (!active) {
    const snapshot = pool.listAccounts().map((account) => ({
      id: account.id,
      email: account.email,
      accountId: account.accountId,
      cooldownUntil: account.cooldownUntilMs
        ? new Date(account.cooldownUntilMs).toISOString()
        : null,
      lastFailureReason: account.lastFailureReason || "(none)",
      hasRefreshToken: Boolean(account.refreshToken),
    }));
    throw new Error(
      `No usable account after initial probe. Accounts: ${JSON.stringify(snapshot)}`,
    );
  }
  startupLogger("pool:initial-account:done", {
    id: active.id,
    accountId: active.accountId,
  });

  async function reload() {
    await pool.load();
    const nextActive = await pool.getInitialAccount();
    if (!nextActive) {
      throw new Error("No usable account after reload.");
    }
    return nextActive;
  }

  function getAdminStatus() {
    return {
      active: accountSummary(pool.getActiveAccount()),
      accounts: pool.listAccounts().map(accountSummary),
    };
  }

  async function handleRequest(
    req,
    res,
    { requestUrl = req.url, exposeHealthDetails = true, exposeStatus = true } = {},
  ) {
    const requestPath = getRequestPath(requestUrl);

    if (requestPath === "/healthz") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        safeJson(
          exposeHealthDetails
            ? { ok: true, active: accountSummary(pool.getActiveAccount()) }
            : { ok: true },
        ),
      );
      return;
    }

    if (requestPath === "/proxy/status" && exposeStatus) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(safeJson(getAdminStatus()));
      return;
    }

    if (!requireLocalAuth(req, options.localApiKey)) {
      unauthorized(res);
      return;
    }

    if (!SUPPORTED_PATHS.has(requestPath)) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(
        safeJson({
          error: {
            message: `Unsupported path: ${requestPath}. Supported: ${[
              ...SUPPORTED_PATHS,
            ].join(", ")}`,
          },
        }),
      );
      return;
    }

    const requestBody =
      req.method === "GET" || req.method === "HEAD" ? null : await readRequestBody(req);

    const excluded = new Set();
    const maxAttempts = Math.max(1, Number(options.maxSwitchAttempts) + 1);
    let lastFailure = null;
    let succeeded = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const current =
        attempt === 0 ? pool.getActiveAccount() || (await pool.getInitialAccount()) : pool.pickNextHealthyAccount(excluded);
      if (!current) {
        break;
      }
      excluded.add(current.id);

      if (pool.isCoolingDown(current)) {
        continue;
      }

      try {
        if (pool.needsRefresh(current)) {
          await pool.refreshAccount(current);
        }

        if (
          options.upstreamBase.includes("chatgpt.com/backend-api/codex") &&
          requestPath === "/v1/chat/completions"
        ) {
          res.statusCode = 501;
          res.setHeader("content-type", "application/json");
          res.end(
            safeJson({
              error: {
                message:
                  "ChatGPT/Codex upstream mode currently supports /v1/models and /v1/responses only.",
              },
            }),
          );
          return;
        }

        const upstreamUrl = resolveUpstreamUrl(requestUrl, requestPath, options);
        const upstreamHeaders = copyHeadersForUpstream(req.headers, current.accessToken);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs);

        let upstream;
        try {
          upstream = await fetchFn(upstreamUrl, {
            method: req.method,
            headers: upstreamHeaders,
            body: requestBody,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!upstream.ok) {
          const detail = await upstream.text();
          const classified = classifyRetryableFailure(upstream.status, detail);
          pool.markFailure(current, classified.category, detail || classified.reason);
          lastFailure = {
            status: upstream.status,
            category: classified.category,
            reason: detail || classified.reason,
          };
          if (classified.retryable) {
            continue;
          }
          res.statusCode = upstream.status;
          res.setHeader("content-type", "application/json");
          res.end(
            safeJson({
              error: {
                message: detail || "Upstream request failed.",
                category: classified.category,
              },
            }),
          );
          return;
        }

        pool.markSuccess(current);
        succeeded = true;
        res.statusCode = upstream.status;
        copyHeadersToClient(res, upstream.headers);
        if (!upstream.body) {
          res.end();
          return;
        }
        Readable.fromWeb(upstream.body).pipe(res);
        return;
      } catch (error) {
        const detail = error?.message || String(error);
        const classified = classifyRetryableFailure(0, detail);
        pool.markFailure(current, classified.category, detail);
        lastFailure = {
          status: 0,
          category: classified.category,
          reason: detail,
        };
        continue;
      }
    }

    if (!succeeded) {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json");
      res.end(
        safeJson({
          error: {
            message: "No healthy account available.",
            lastFailure,
          },
        }),
      );
    }
  }

  return {
    pool,
    handleRequest,
    reload,
    getAdminStatus,
  };
}

export async function createProxyServer(options) {
  const service = await createProxyService(options);
  const server = http.createServer((req, res) =>
    service.handleRequest(req, res, {
      exposeHealthDetails: true,
      exposeStatus: true,
    }),
  );

  return { server, pool: service.pool, service };
}

async function createFetchWithProxy(proxyUrl) {
  if (!proxyUrl) {
    return fetch;
  }

  process.env.NODE_USE_ENV_PROXY = "1";
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.HTTP_PROXY = proxyUrl;
  process.env.ALL_PROXY = proxyUrl;

  return fetch;
}

async function verifyStartupAccounts(pool) {
  const reports = [];
  for (const account of pool.listAccounts()) {
    if (pool.isCoolingDown(account)) {
      reports.push({
        id: account.id,
        ok: false,
        stage: "cooldown",
        reason: account.lastFailureReason || "cooldown",
      });
      continue;
    }
    try {
      const result = await pool.ensureAccountHealthy(account);
      reports.push({
        id: account.id,
        ok: Boolean(result?.ok),
        stage: "probe",
        reason: result?.ok
          ? "ok"
          : `${result?.category || "unknown"}:${result?.detail || result?.reason || "failed"}`,
      });
    } catch (error) {
      reports.push({
        id: account.id,
        ok: false,
        stage: "exception",
        reason: error?.message || String(error),
      });
    }
  }
  return reports;
}

async function main() {
  if (await maybeRespawnWithProxy(process.argv.slice(2))) {
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    printUsage();
    return;
  }

  const envProxy =
    process.env.CODEX_PROXY_UPSTREAM_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    "";
  const options = {
    host: args.host || process.env.CODEX_PROXY_HOST || DEFAULT_HOST,
    port: Number(args.port || process.env.CODEX_PROXY_PORT || DEFAULT_PORT),
    tokensDir: path.resolve(args["tokens-dir"] || process.env.CODEX_TOKENS_DIR || DEFAULT_TOKENS_DIR),
    upstreamBase: args["upstream-base"] || process.env.CODEX_PROXY_UPSTREAM_BASE || DEFAULT_UPSTREAM_BASE,
    refreshEndpoint:
      args["refresh-endpoint"] || process.env.CODEX_PROXY_REFRESH_ENDPOINT || DEFAULT_REFRESH_ENDPOINT,
    probeUrl: args["probe-url"] || process.env.CODEX_PROXY_PROBE_URL || DEFAULT_PROBE_URL,
    localApiKey: args["local-api-key"] || process.env.CODEX_PROXY_API_KEY || DEFAULT_LOCAL_API_KEY,
    maxSwitchAttempts: Number(
      args["max-switch-attempts"] || process.env.CODEX_PROXY_MAX_SWITCH_ATTEMPTS || DEFAULT_MAX_SWITCH_ATTEMPTS,
    ),
    requestTimeoutMs: Number(
      args["request-timeout-ms"] || process.env.CODEX_PROXY_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    proxyUrl: args["proxy-url"] || envProxy || "",
    clientVersion:
      args["client-version"] || process.env.CODEX_PROXY_CLIENT_VERSION || DEFAULT_CLIENT_VERSION,
  };

  console.log("[startup] preparing local proxy");
  console.log(`[startup] host=${options.host} port=${options.port}`);
  console.log(`[startup] tokensDir=${options.tokensDir}`);
  console.log(`[startup] upstreamBase=${options.upstreamBase}`);
  console.log(`[startup] upstreamProxy=${options.proxyUrl || "(none)"}`);

  let server;
  let pool;
  try {
    ({ server, pool } = await createProxyServer(options));
  } catch (error) {
    const fetchFn = await createFetchWithProxy(options.proxyUrl);
    const bootstrapPool = new CodexAccountPool({
      tokensDir: options.tokensDir,
      refreshEndpoint: options.refreshEndpoint,
      probeUrl: options.probeUrl,
      fetchFn,
    });
    await bootstrapPool.load();
    const reports = await verifyStartupAccounts(bootstrapPool);
    console.error(error?.message || error);
    console.error("Startup diagnostics:");
    for (const report of reports) {
      console.error(`- ${report.id} [${report.stage}] ${report.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  server.listen(options.port, options.host, () => {
    const active = pool.getActiveAccount();
    console.log(`Codex 本地代理已启动：http://${options.host}:${options.port}`);
    console.log(`初始活跃账号：${active?.email || active?.id || "(none)"}`);
    console.log(`上游代理：${options.proxyUrl || "(none)"}`);
  });
}

const directRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (directRun) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

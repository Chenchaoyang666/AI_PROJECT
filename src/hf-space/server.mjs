#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import {
  beginAdminOAuth,
  clearAdminSessionCookie,
  finishAdminOAuth,
  getAdminSession,
  isAdminUser,
} from "./admin-auth.mjs";
import { EncryptedPoolStore } from "./encrypted-pool-store.mjs";
import { createApiPoolProxyService } from "../scripts/api-pool-proxy.mjs";
import { createProxyService } from "../scripts/codex-local-proxy.mjs";
import { redactSensitiveText, sanitizeForLogs } from "../shared/secret-sanitizer.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = Number(process.env.PORT || 7860);
const DEFAULT_STATIC_DIR = path.join(REPO_ROOT, "dist", "ui");
const MAX_LOG_ENTRIES = 500;

const REMOTE_TOOL_DEFINITIONS = [
  {
    id: "pool.manage",
    tabTitle: "池管理",
    description: "查看、导入并保存到 /data Bucket 的加密池文件，修改后手动 reload 生效。",
    argsSchema: [],
    defaults: {},
    virtual: true,
    remoteManaged: true,
  },
  {
    id: "proxy.start",
    tabTitle: "Codex 账号池代理",
    description: "Hugging Face 常驻托管的 Codex 账号池代理，仅支持查看状态与手动 reload。",
    argsSchema: [],
    defaults: {},
    virtual: true,
    remoteManaged: true,
  },
  {
    id: "api-pool.start",
    tabTitle: "API 池代理",
    description: "Hugging Face 常驻托管的 API 池代理，仅支持查看状态与手动 reload。",
    argsSchema: [],
    defaults: {},
    virtual: true,
    remoteManaged: true,
  },
];

function nowIso() {
  return new Date().toISOString();
}

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

function json(res, statusCode, value) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(value, null, 2)}\n`);
}

function html(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function serveAdminStatic(req, res, staticDir) {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname;
  const adminPath = pathname === "/admin" ? "/index.html" : pathname;
  const relativePath = adminPath.startsWith("/admin/") ? adminPath.slice("/admin".length) : adminPath;
  const requested = path.join(staticDir, relativePath);
  const resolved = path.resolve(requested);
  const staticRoot = path.resolve(staticDir);
  if (!resolved.startsWith(staticRoot)) {
    json(res, 403, { error: "Forbidden" });
    return true;
  }

  const filePath = (await fileExists(resolved)) ? resolved : path.join(staticDir, "index.html");
  if (!(await fileExists(filePath))) {
    json(res, 500, { error: "Admin UI is not built. Run npm run ui:build first." });
    return true;
  }

  const body = await fs.readFile(filePath);
  res.statusCode = 200;
  res.setHeader("content-type", contentTypeFor(filePath));
  res.end(body);
  return true;
}

function formatLogLine(event, payload = {}) {
  const sanitized = sanitizeForLogs(payload);
  const details = Object.entries(sanitized)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  return `[startup] ${nowIso()} ${event}${details ? ` ${details}` : ""}`;
}

function createLogBuffer(label) {
  const logs = [];
  function append(stream, text) {
    const normalized = String(text || "").replace(/\r\n/g, "\n");
    for (const line of normalized.split("\n")) {
      if (!line) continue;
      logs.push({
        timestamp: nowIso(),
        stream,
        text: redactSensitiveText(`${label}: ${line}`),
      });
    }
    if (logs.length > MAX_LOG_ENTRIES) {
      logs.splice(0, logs.length - MAX_LOG_ENTRIES);
    }
  }
  return {
    append,
    logger(event, payload = {}) {
      append("stdout", formatLogLine(event, payload));
    },
    list() {
      return [...logs];
    },
  };
}

function unauthorizedJson(res) {
  json(res, 401, { error: "Unauthorized" });
}

function requireAdmin(req, res, env) {
  const session = getAdminSession(req, env.ADMIN_SESSION_SECRET);
  if (!session || !isAdminUser(session, env)) {
    unauthorizedJson(res);
    return null;
  }
  return session;
}

function requireProxyAuth(req, expectedKey) {
  if (!expectedKey) return false;
  return String(req.headers.authorization || "") === `Bearer ${expectedKey}`;
}

function unavailable(res, message) {
  json(res, 503, {
    error: {
      message,
    },
  });
}

function renderLoginPage(env = process.env) {
  const spaceHost = env.SPACE_HOST ? `https://${env.SPACE_HOST}` : "";
  const loginHref = `${spaceHost}/oauth/start`;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>登录管理台</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(180deg, #eefaf7 0%, #f8fbff 100%);
        font-family: "IBM Plex Sans", "Noto Sans SC", sans-serif;
        color: #1f2937;
      }
      .card {
        width: min(560px, calc(100vw - 32px));
        background: rgba(255,255,255,0.96);
        border: 1px solid rgba(148,163,184,0.18);
        border-radius: 24px;
        box-shadow: 0 24px 60px rgba(15,23,42,0.08);
        padding: 28px;
      }
      h1 { margin: 0 0 12px; font-size: 28px; }
      p { margin: 0 0 14px; line-height: 1.6; color: #475569; }
      .actions { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 12px 18px;
        border-radius: 14px;
        text-decoration: none;
        font-weight: 600;
      }
      .button-primary {
        background: linear-gradient(135deg, #14b8a6, #1d4ed8);
        color: white;
      }
      .button-secondary {
        border: 1px solid rgba(148,163,184,0.28);
        color: #334155;
      }
      code {
        background: #f1f5f9;
        padding: 2px 6px;
        border-radius: 8px;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>登录 Hugging Face 管理台</h1>
      <p>为了避免 Spaces 嵌入页里的 cookie / state 问题，登录流程会在新标签页中打开。</p>
      <p>如果你是从 <code>huggingface.co/spaces/...</code> 页面进入，请点击下面的按钮，在新标签页完成登录。</p>
      <div class="actions">
        <a class="button button-primary" href="${loginHref}" target="_blank" rel="noopener noreferrer">在新标签页登录</a>
        ${spaceHost ? `<a class="button button-secondary" href="${spaceHost}/admin" target="_blank" rel="noopener noreferrer">直接打开 hf.space 管理台</a>` : ""}
      </div>
    </main>
  </body>
</html>`;
}

function normalizeApiPoolRuntimeConfig(value, defaults = {}) {
  const enableScheduledSwitch =
    value?.enableScheduledSwitch == null
      ? Boolean(defaults.enableScheduledSwitch)
      : Boolean(value.enableScheduledSwitch);
  const intervalSource =
    value?.scheduledSwitchIntervalMs == null
      ? defaults.scheduledSwitchIntervalMs
      : value.scheduledSwitchIntervalMs;
  const scheduledSwitchIntervalMs = Math.max(1_000, Number(intervalSource || 900000));
  return {
    enableScheduledSwitch,
    scheduledSwitchIntervalMs,
  };
}

class ManagedRemoteService {
  constructor({ id, endpoint, authEnvName, apiKey, logLabel, createService }) {
    this.id = id;
    this.endpoint = endpoint;
    this.authEnvName = authEnvName;
    this.apiKey = apiKey;
    this.createService = createService;
    this.logBuffer = createLogBuffer(logLabel);
    this.service = null;
    this.lastError = "";
  }

  async load({ initial = false } = {}) {
    try {
      const nextService = await this.createService(this.logBuffer.logger);
      this.service?.close?.();
      this.service = nextService;
      this.lastError = "";
      this.logBuffer.append("stdout", initial ? "service initialized" : "service reloaded");
    } catch (error) {
      this.lastError = error?.message || String(error);
      this.logBuffer.append("stderr", this.lastError);
      if (!initial) {
        throw error;
      }
    }
  }

  async reload() {
    await this.load({ initial: false });
    return this.getStatus();
  }

  async handle(req, res, { requestUrl }) {
    if (!requireProxyAuth(req, this.apiKey)) {
      unauthorizedJson(res);
      return;
    }
    if (!this.service) {
      unavailable(res, this.lastError || "Service is not ready.");
      return;
    }
    return this.service.handleRequest(req, res, {
      requestUrl,
      exposeHealthDetails: false,
      exposeStatus: false,
    });
  }

  getStatus() {
    return {
      running: Boolean(this.service),
      endpoint: this.endpoint,
      authEnvName: this.authEnvName,
      lastError: this.lastError || "",
      recentLogs: this.logBuffer.list(),
      health: {
        ok: true,
        status: 200,
        body: { ok: true },
      },
      proxyStatus: this.service
        ? {
            ok: true,
            status: 200,
            body: this.service.getAdminStatus(),
          }
        : {
            ok: false,
            status: 503,
            body: {
              error: this.lastError || "Service is not ready.",
            },
          },
    };
  }
}

export async function createHfSpaceServer({
  env = process.env,
  staticDir = DEFAULT_STATIC_DIR,
  accountFetchFn,
  codexApiFetchFn,
  claudeApiFetchFn,
} = {}) {
  const dataDir = path.resolve(env.DATA_DIR || path.join(REPO_ROOT, ".hf-data"));
  const poolStore = new EncryptedPoolStore({
    dataDir,
    cryptoKey: env.POOL_CRYPTO_KEY,
  });
  await poolStore.init();

  const proxyOptions = {
    upstreamBase: env.CODEX_PROXY_UPSTREAM_BASE || "https://chatgpt.com/backend-api/codex",
    refreshEndpoint: env.CODEX_PROXY_REFRESH_ENDPOINT || "https://auth.openai.com/oauth/token",
    probeUrl:
      env.CODEX_PROXY_PROBE_URL ||
      "https://chatgpt.com/backend-api/codex/models?client_version=0.117.0",
    maxSwitchAttempts: Number(env.CODEX_PROXY_MAX_SWITCH_ATTEMPTS || 5),
    requestTimeoutMs: Number(env.CODEX_PROXY_REQUEST_TIMEOUT_MS || 60000),
    proxyUrl: env.CODEX_PROXY_UPSTREAM_PROXY || env.HTTPS_PROXY || env.HTTP_PROXY || "",
    clientVersion: env.CODEX_PROXY_CLIENT_VERSION || "0.117.0",
  };
  const apiProxyOptions = {
    maxSwitchAttempts: Number(env.API_POOL_MAX_SWITCH_ATTEMPTS || 5),
    requestTimeoutMs: Number(env.API_POOL_REQUEST_TIMEOUT_MS || 60000),
    enableScheduledSwitch: env.API_POOL_SCHEDULED_SWITCH_ENABLED ?? "true",
    scheduledSwitchIntervalMs: Number(
      env.API_POOL_SCHEDULED_SWITCH_INTERVAL_MS || 900000,
    ),
    proxyUrl: env.API_POOL_PROXY_URL || env.HTTPS_PROXY || env.HTTP_PROXY || "",
  };
  const apiPoolRuntimeConfigDefaults = normalizeApiPoolRuntimeConfig({
    enableScheduledSwitch: apiProxyOptions.enableScheduledSwitch,
    scheduledSwitchIntervalMs: apiProxyOptions.scheduledSwitchIntervalMs,
  });
  let apiPoolRuntimeConfig = await poolStore.loadRuntimeConfig(
    "api-pool-runtime",
    apiPoolRuntimeConfigDefaults,
  );
  apiPoolRuntimeConfig = normalizeApiPoolRuntimeConfig(
    apiPoolRuntimeConfig,
    apiPoolRuntimeConfigDefaults,
  );

  const services = {
    "codex-account": new ManagedRemoteService({
      id: "codex-account",
      endpoint: "/proxy/codex-account",
      authEnvName: "CODEX_ACCOUNT_PROXY_KEY",
      apiKey: env.CODEX_ACCOUNT_PROXY_KEY || "",
      logLabel: "codex-account",
      createService: (logger) =>
        createProxyService({
          ...proxyOptions,
          localApiKey: env.CODEX_ACCOUNT_PROXY_KEY || "",
          fetchFn: accountFetchFn,
          logger,
          sourcePath: "encrypted://codex-accounts",
          loadSnapshot: async () => ({
            entries: await poolStore.loadRawPoolItems("codex-accounts"),
            sourcePath: "encrypted://codex-accounts",
          }),
          saveSnapshot: async (entries) => {
            await poolStore.writeEncryptedPool("codex-accounts", entries);
          },
        }),
    }),
    "codex-api": new ManagedRemoteService({
      id: "codex-api",
      endpoint: "/proxy/codex-api",
      authEnvName: "CODEX_API_PROXY_KEY",
      apiKey: env.CODEX_API_PROXY_KEY || "",
      logLabel: "codex-api",
      createService: (logger) =>
        createApiPoolProxyService({
          ...apiProxyOptions,
          enableScheduledSwitch: apiPoolRuntimeConfig.enableScheduledSwitch,
          scheduledSwitchIntervalMs: apiPoolRuntimeConfig.scheduledSwitchIntervalMs,
          provider: "codex",
          localApiKey: env.CODEX_API_PROXY_KEY || "",
          fetchFn: codexApiFetchFn,
          logger,
          sourcePath: "encrypted://codex-api",
          loadSnapshot: async () => ({
            entries: await poolStore.loadRawPoolItems("codex-api"),
            sourcePath: "encrypted://codex-api",
          }),
        }),
    }),
    "claude-api": new ManagedRemoteService({
      id: "claude-api",
      endpoint: "/proxy/claude-api",
      authEnvName: "CLAUDE_API_PROXY_KEY",
      apiKey: env.CLAUDE_API_PROXY_KEY || "",
      logLabel: "claude-api",
      createService: (logger) =>
        createApiPoolProxyService({
          ...apiProxyOptions,
          enableScheduledSwitch: apiPoolRuntimeConfig.enableScheduledSwitch,
          scheduledSwitchIntervalMs: apiPoolRuntimeConfig.scheduledSwitchIntervalMs,
          provider: "claude-code",
          localApiKey: env.CLAUDE_API_PROXY_KEY || "",
          fetchFn: claudeApiFetchFn,
          logger,
          sourcePath: "encrypted://claude-code-api",
          loadSnapshot: async () => ({
            entries: await poolStore.loadRawPoolItems("claude-code-api"),
            sourcePath: "encrypted://claude-code-api",
          }),
        }),
    }),
  };

  await Promise.all(Object.values(services).map((service) => service.load({ initial: true })));

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const pathname = url.pathname;

      if (req.method === "GET" && pathname === "/healthz") {
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && pathname === "/") {
        res.statusCode = 302;
        res.setHeader("location", "/admin");
        res.end();
        return;
      }

      if (req.method === "GET" && pathname === "/login") {
        html(res, 200, renderLoginPage(env));
        return;
      }

      if (req.method === "GET" && pathname === "/oauth/start") {
        await beginAdminOAuth(req, res, env);
        return;
      }

      if (req.method === "GET" && pathname === "/login/callback") {
        await finishAdminOAuth(req, res, env);
        return;
      }

      if (req.method === "POST" && pathname === "/logout") {
        res.statusCode = 204;
        res.setHeader("set-cookie", clearAdminSessionCookie());
        res.end();
        return;
      }

      if (pathname.startsWith("/proxy/codex-account/")) {
        const requestUrl = pathname.slice("/proxy/codex-account".length) + url.search;
        await services["codex-account"].handle(req, res, { requestUrl });
        return;
      }

      if (pathname.startsWith("/proxy/codex-api/")) {
        const requestUrl = pathname.slice("/proxy/codex-api".length) + url.search;
        await services["codex-api"].handle(req, res, { requestUrl });
        return;
      }

      if (pathname.startsWith("/proxy/claude-api/")) {
        const requestUrl = pathname.slice("/proxy/claude-api".length) + url.search;
        await services["claude-api"].handle(req, res, { requestUrl });
        return;
      }

      if (pathname.startsWith("/admin/api/")) {
        const session = requireAdmin(req, res, env);
        if (!session) return;

        if (req.method === "GET" && pathname === "/admin/api/app-config") {
          json(res, 200, {
            mode: "remote",
            apiBase: "/admin/api",
            environment: "Hugging Face Space + /data Bucket",
            user: session,
            readOnly: poolStore.readOnly,
            readOnlyReason: poolStore.readOnlyReason,
            storageBackend: poolStore.storageBackend,
            dataDir: poolStore.dataDir,
          });
          return;
        }

        if (req.method === "GET" && pathname === "/admin/api/tools") {
          json(res, 200, { tools: REMOTE_TOOL_DEFINITIONS });
          return;
        }

        if (req.method === "GET" && pathname === "/admin/api/history") {
          json(res, 200, { items: [] });
          return;
        }

        if (req.method === "GET" && pathname === "/admin/api/pools") {
          json(res, 200, { items: poolStore.listPools() });
          return;
        }

        if (req.method === "GET" && pathname.startsWith("/admin/api/pools/")) {
          const poolId = pathname.split("/")[4];
          json(res, 200, await poolStore.loadPool(poolId));
          return;
        }

        if (
          req.method === "POST" &&
          pathname.startsWith("/admin/api/pools/") &&
          pathname.endsWith("/validate")
        ) {
          const poolId = pathname.split("/")[4];
          const body = await readJsonBody(req);
          const result = await poolStore.validatePoolItems(poolId, body.items || []);
          json(res, result.ok ? 200 : 400, result);
          return;
        }

        if (
          req.method === "POST" &&
          pathname.startsWith("/admin/api/pools/") &&
          pathname.endsWith("/import")
        ) {
          const poolId = pathname.split("/")[4];
          const body = await readJsonBody(req);
          json(res, 200, await poolStore.importPool(poolId, body.items || []));
          return;
        }

        if (req.method === "PUT" && pathname.startsWith("/admin/api/pools/")) {
          const poolId = pathname.split("/")[4];
          const body = await readJsonBody(req);
          json(res, 200, await poolStore.savePool(poolId, body.items || []));
          return;
        }

        if (req.method === "POST" && pathname === "/admin/api/reload") {
          const results = {};
          for (const [serviceId, service] of Object.entries(services)) {
            try {
              results[serviceId] = await service.reload();
            } catch (error) {
              results[serviceId] = service.getStatus();
              results[serviceId].lastError = error?.message || String(error);
            }
          }
          json(res, 200, { ok: true, results });
          return;
        }

        if (req.method === "GET" && pathname === "/admin/api/api-pool/config") {
          json(res, 200, apiPoolRuntimeConfig);
          return;
        }

        if (req.method === "PUT" && pathname === "/admin/api/api-pool/config") {
          const body = await readJsonBody(req);
          apiPoolRuntimeConfig = normalizeApiPoolRuntimeConfig(
            body,
            apiPoolRuntimeConfigDefaults,
          );
          await poolStore.saveRuntimeConfig("api-pool-runtime", apiPoolRuntimeConfig);
          const serviceId = body?.provider === "claude-code" ? "claude-api" : "codex-api";
          const status = await services[serviceId].reload();
          json(res, 200, {
            ok: true,
            config: apiPoolRuntimeConfig,
            status,
          });
          return;
        }

        if (req.method === "GET" && pathname === "/admin/api/proxy/status") {
          json(res, 200, services["codex-account"].getStatus());
          return;
        }

        if (req.method === "GET" && pathname === "/admin/api/api-pool/codex/status") {
          json(res, 200, services["codex-api"].getStatus());
          return;
        }

        if (req.method === "GET" && pathname === "/admin/api/api-pool/claude-code/status") {
          json(res, 200, services["claude-api"].getStatus());
          return;
        }

        if (req.method === "GET" && pathname.startsWith("/admin/api/status/")) {
          const serviceId = pathname.split("/")[4];
          const service = services[serviceId];
          if (!service) {
            json(res, 404, { error: "Unknown service" });
            return;
          }
          json(res, 200, service.getStatus());
          return;
        }

        json(res, 404, { error: "Not found" });
        return;
      }

      if (pathname === "/admin" || pathname.startsWith("/admin/")) {
        const session = getAdminSession(req, env.ADMIN_SESSION_SECRET);
        if (!session || !isAdminUser(session, env)) {
          html(res, 401, renderLoginPage(env));
          return;
        }
        await serveAdminStatic(req, res, staticDir);
        return;
      }

      if (pathname.startsWith("/assets/")) {
        await serveAdminStatic(req, res, staticDir);
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, error.statusCode || 500, {
        error: error?.message || String(error),
      });
    }
  });

  return {
    server,
    services,
    poolStore,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = args.host || process.env.HF_SERVER_HOST || DEFAULT_HOST;
  const port = Number(args.port || process.env.PORT || DEFAULT_PORT);
  const staticDir = path.resolve(args["static-dir"] || process.env.HF_STATIC_DIR || DEFAULT_STATIC_DIR);
  const { server } = await createHfSpaceServer({ staticDir });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      console.log(`HF secure proxy server listening on http://${host}:${port}`);
      console.log(`Admin path: /admin`);
      resolve();
    });
  });
}

const directRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (directRun) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

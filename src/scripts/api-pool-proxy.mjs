#!/usr/bin/env node

import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";

import { ApiEndpointPool, normalizeEndpointType } from "../proxy/api-endpoint-pool.mjs";
import { classifyFailure } from "../proxy/codex-account-pool.mjs";
import { sanitizeForLogs } from "../shared/secret-sanitizer.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8789;
const DEFAULT_PROVIDER = "codex";
const DEFAULT_POOL_DIR = path.resolve(process.cwd(), "api_pool", DEFAULT_PROVIDER);
const DEFAULT_LOCAL_API_KEY = "local-api-pool-proxy-key";
const DEFAULT_MAX_SWITCH_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_ENABLE_SCHEDULED_SWITCH = true;
const DEFAULT_SCHEDULED_SWITCH_INTERVAL_MS = 15 * 60_000;

const SUPPORTED_PATHS = {
  codex: new Set(["/models", "/responses", "/v1/models", "/v1/responses", "/v1/chat/completions"]),
  "claude-code": new Set(["/v1/messages", "/messages", "/v1/models"]),
};

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
  node src/scripts/api-pool-proxy.mjs

Options:
  --provider=codex
  --pool-dir=api_pool/codex
  --host=127.0.0.1
  --port=8789
  --local-api-key=local-api-pool-proxy-key
  --max-switch-attempts=3
  --request-timeout-ms=60000
  --enable-scheduled-switch=true
  --scheduled-switch-interval-ms=900000
  --proxy-url=http://127.0.0.1:8118
  --help
`);
}

function parseBooleanish(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
}

async function maybeRespawnWithProxy(argv) {
  const args = parseArgs(argv);
  const proxyUrl = args["proxy-url"] || "";
  if (!proxyUrl || process.env.CODEX_PROXY_BOOTSTRAPPED === "1") {
    return false;
  }

  const child = spawn(process.execPath, [process.argv[1], ...argv], {
    stdio: "inherit",
    env: {
      ...process.env,
      CODEX_PROXY_BOOTSTRAPPED: "1",
      NODE_USE_ENV_PROXY: "1",
      HTTPS_PROXY: proxyUrl,
      HTTP_PROXY: proxyUrl,
      ALL_PROXY: proxyUrl,
    },
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
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function requireLocalAuth(req, expectedKey) {
  return String(req.headers.authorization || "") === `Bearer ${expectedKey}`;
}

function copyHeadersToClient(res, upstreamHeaders) {
  for (const [key, value] of upstreamHeaders.entries()) {
    if (key.toLowerCase() === "transfer-encoding") continue;
    res.setHeader(key, value);
  }
}

function copyHeadersForUpstream(reqHeaders, apiKey, provider) {
  const headers = {};
  for (const [key, value] of Object.entries(reqHeaders || {})) {
    if (value == null) continue;
    const lower = key.toLowerCase();
    if (["host", "authorization", "content-length", "connection", "x-api-key"].includes(lower)) {
      continue;
    }
    headers[key] = value;
  }

  if (provider === "claude-code") {
    headers["x-api-key"] = apiKey;
    headers.authorization = `Bearer ${apiKey}`;
    if (!headers["anthropic-version"]) {
      headers["anthropic-version"] = "2023-06-01";
    }
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function classifyRetryableFailure(status, detail) {
  const result = classifyFailure({ status, detail });
  return {
    ...result,
    retryable: ["auth", "rate_limit", "quota", "server", "network"].includes(result.category),
  };
}

export function endpointSummary(endpoint) {
  if (!endpoint) return null;
  return {
    id: endpoint.id,
    name: endpoint.name,
    type: endpoint.type,
    baseUrl: endpoint.baseUrl,
    model: endpoint.model || "",
    healthy: endpoint.healthy,
    cooldownUntil: endpoint.cooldownUntilMs ? new Date(endpoint.cooldownUntilMs).toISOString() : null,
    lastValidation: endpoint.lastValidation,
    lastFailureReason: endpoint.lastFailureReason,
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

function resolveUpstreamUrl(baseUrl, reqUrl, requestPath) {
  const upstream = new URL(baseUrl);
  const requestUrl = new URL(reqUrl || "/", "http://localhost");
  const basePath = upstream.pathname.replace(/\/+$/, "");
  const incomingPath = requestPath;
  let finalPath = incomingPath;

  if (basePath && basePath !== "/" && incomingPath.startsWith(`${basePath}/`)) {
    finalPath = incomingPath;
  } else if (basePath === "/v1" && incomingPath.startsWith("/v1/")) {
    finalPath = incomingPath;
  } else if (basePath && basePath !== "/" && incomingPath.startsWith("/")) {
    finalPath = `${basePath}${incomingPath}`;
  }

  upstream.pathname = finalPath;
  upstream.search = requestUrl.search;
  return upstream.toString();
}

async function createFetchWithProxy(proxyUrl) {
  if (!proxyUrl) return fetch;
  process.env.NODE_USE_ENV_PROXY = "1";
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.HTTP_PROXY = proxyUrl;
  process.env.ALL_PROXY = proxyUrl;
  return fetch;
}

function unauthorized(res) {
  res.statusCode = 401;
  res.setHeader("content-type", "application/json");
  res.end(safeJson({ error: { message: "Unauthorized local proxy key." } }));
}

export async function createApiPoolProxyService(options) {
  const startupLogger =
    typeof options.logger === "function" ? options.logger : createConsoleStartupLogger();
  const fetchFn = options.fetchFn || (await createFetchWithProxy(options.proxyUrl));
  const pool = new ApiEndpointPool({
    poolDir: options.poolDir,
    provider: options.provider,
    fetchFn,
    logger: startupLogger,
    loadSnapshot: options.loadSnapshot,
    sourcePath: options.sourcePath,
  });

  startupLogger("pool:load:start", {
    provider: options.provider,
    poolDir: options.poolDir,
  });
  await pool.load();
  startupLogger("pool:load:done", { count: pool.listEndpoints().length });
  const active = await pool.getInitialEndpoint();
  if (!active) {
    throw new Error(`No usable endpoint for provider=${options.provider}`);
  }

  const scheduledSwitchEnabled = parseBooleanish(
    options.enableScheduledSwitch,
    DEFAULT_ENABLE_SCHEDULED_SWITCH,
  );
  const scheduledSwitchIntervalMs = Math.max(
    1_000,
    Number(options.scheduledSwitchIntervalMs || DEFAULT_SCHEDULED_SWITCH_INTERVAL_MS),
  );
  const scheduleState = {
    inflightRequests: 0,
    lastScheduledSwitchAt: null,
    nextScheduledSwitchAt: scheduledSwitchEnabled
      ? new Date(Date.now() + scheduledSwitchIntervalMs).toISOString()
      : null,
    lastScheduledSwitchReason: scheduledSwitchEnabled ? "waiting" : "disabled",
    pendingScheduledSwitch: false,
    timer: null,
    closed: false,
  };

  function clearScheduledTimer() {
    if (scheduleState.timer) {
      clearTimeout(scheduleState.timer);
      scheduleState.timer = null;
    }
  }

  function scheduleNextSwitch(delayMs = scheduledSwitchIntervalMs) {
    clearScheduledTimer();
    if (!scheduledSwitchEnabled || scheduleState.closed) {
      scheduleState.nextScheduledSwitchAt = null;
      return;
    }
    scheduleState.nextScheduledSwitchAt = new Date(Date.now() + delayMs).toISOString();
    scheduleState.timer = setTimeout(() => {
      void runScheduledSwitch("timer");
    }, delayMs);
    scheduleState.timer.unref?.();
  }

  async function runScheduledSwitch(trigger = "timer") {
    if (!scheduledSwitchEnabled || scheduleState.closed) {
      scheduleState.lastScheduledSwitchReason = "disabled";
      scheduleState.nextScheduledSwitchAt = null;
      return { switched: false, reason: "disabled" };
    }

    if (scheduleState.inflightRequests > 0) {
      scheduleState.pendingScheduledSwitch = true;
      scheduleState.lastScheduledSwitchReason = "busy";
      scheduleState.nextScheduledSwitchAt = null;
      startupLogger("scheduled-switch:defer", {
        provider: options.provider,
        trigger,
        inflightRequests: scheduleState.inflightRequests,
      });
      return { switched: false, reason: "busy" };
    }

    const currentActive = pool.getActiveEndpoint();
    if (!currentActive) {
      scheduleState.lastScheduledSwitchReason = "no-active";
      scheduleState.pendingScheduledSwitch = false;
      scheduleNextSwitch();
      return { switched: false, reason: "no-active" };
    }

    const excluded = new Set([currentActive.id]);
    for (let attempt = 0; attempt < pool.listEndpoints().length; attempt += 1) {
      const candidate = pool.pickNextRotationCandidate(excluded);
      if (!candidate) {
        scheduleState.lastScheduledSwitchReason = "no-healthy-spare";
        scheduleState.pendingScheduledSwitch = false;
        scheduleNextSwitch();
        startupLogger("scheduled-switch:skip", {
          provider: options.provider,
          trigger,
          reason: "no-healthy-spare",
        });
        return { switched: false, reason: "no-healthy-spare" };
      }
      excluded.add(candidate.id);

      const probe = await pool.probeEndpoint(candidate, {
        activateOnSuccess: false,
        activationMode: "scheduled",
      });
      if (!probe.ok) {
        continue;
      }

      pool.markScheduledSwitch(candidate);
      scheduleState.lastScheduledSwitchAt = new Date().toISOString();
      scheduleState.lastScheduledSwitchReason = "switched";
      scheduleState.pendingScheduledSwitch = false;
      scheduleNextSwitch();
      startupLogger("scheduled-switch:done", {
        provider: options.provider,
        trigger,
        previousId: currentActive.id,
        nextId: candidate.id,
        nextName: candidate.name,
      });
      return { switched: true, reason: "switched", endpoint: candidate };
    }

    scheduleState.lastScheduledSwitchReason = "no-healthy-spare";
    scheduleState.pendingScheduledSwitch = false;
    scheduleNextSwitch();
    return { switched: false, reason: "no-healthy-spare" };
  }

  function attachInflightTracker(res) {
    scheduleState.inflightRequests += 1;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      scheduleState.inflightRequests = Math.max(0, scheduleState.inflightRequests - 1);
      if (scheduleState.inflightRequests === 0 && scheduleState.pendingScheduledSwitch) {
        queueMicrotask(() => {
          void runScheduledSwitch("idle-drain");
        });
      }
    };
    res.once("finish", finish);
    res.once("close", finish);
  }

  scheduleNextSwitch();

  async function reload() {
    await pool.load();
    const nextActive = await pool.getInitialEndpoint();
    if (!nextActive) {
      throw new Error(`No usable endpoint for provider=${options.provider}`);
    }
    scheduleState.pendingScheduledSwitch = false;
    scheduleState.lastScheduledSwitchReason = scheduledSwitchEnabled ? "reloaded" : "disabled";
    scheduleNextSwitch();
    return nextActive;
  }

  function getAdminStatus() {
    return {
      provider: options.provider,
      active: endpointSummary(pool.getActiveEndpoint()),
      endpoints: pool.listEndpoints().map(endpointSummary),
      inflightRequests: scheduleState.inflightRequests,
      lastScheduledSwitchAt: scheduleState.lastScheduledSwitchAt,
      nextScheduledSwitchAt: scheduleState.nextScheduledSwitchAt,
      scheduledSwitchEnabled,
      scheduledSwitchIntervalMs,
      lastScheduledSwitchReason: scheduleState.lastScheduledSwitchReason,
    };
  }

  function close() {
    scheduleState.closed = true;
    clearScheduledTimer();
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
            ? {
                ok: true,
                provider: options.provider,
                active: endpointSummary(pool.getActiveEndpoint()),
              }
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

    const supported = SUPPORTED_PATHS[options.provider] || new Set();
    if (!supported.has(requestPath)) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(
        safeJson({
          error: {
            message: `Unsupported path: ${requestPath}. Supported: ${[...supported].join(", ")}`,
          },
        }),
      );
      return;
    }

    const requestBody =
      req.method === "GET" || req.method === "HEAD" ? null : await readRequestBody(req);
    attachInflightTracker(res);

    const excluded = new Set();
    const maxAttempts = Math.max(1, Number(options.maxSwitchAttempts) + 1);
    let lastFailure = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const current =
        attempt === 0
          ? pool.getActiveEndpoint() || (await pool.getInitialEndpoint())
          : pool.pickNextHealthyEndpoint(excluded);
      if (!current) break;
      excluded.add(current.id);
      if (pool.isCoolingDown(current)) continue;
      const selectedActiveId = pool.getActiveEndpoint()?.id || null;
      const selectedActiveVersion = pool.getActiveEndpointVersion();

      try {
        const upstreamUrl = resolveUpstreamUrl(current.baseUrl, requestUrl, requestPath);
        const headers = copyHeadersForUpstream(req.headers, current.apiKey, current.type);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs);

        let upstream;
        try {
          upstream = await fetchFn(upstreamUrl, {
            method: req.method,
            headers,
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
          if (classified.retryable) continue;
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

        const activated = pool.markSuccess(current, {
          expectedId: selectedActiveId,
          expectedVersion: selectedActiveVersion,
        });
        if (!activated) {
          startupLogger("pool:active-endpoint:stale-success", {
            provider: options.provider,
            requestPath,
            endpointId: current.id,
            endpointName: current.name,
            selectedActiveId,
            selectedActiveVersion,
            currentActiveId: pool.getActiveEndpoint()?.id || null,
            currentActiveVersion: pool.getActiveEndpointVersion(),
            message: `忽略旧请求成功回写：请求开始时活跃节点=${selectedActiveId || "none"}@v${selectedActiveVersion}，当前活跃节点=${pool.getActiveEndpoint()?.id || "none"}@v${pool.getActiveEndpointVersion()}，成功节点=${current.id}`,
          });
        }
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
      }
    }

    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(
      safeJson({
        error: {
          message: "No healthy endpoint available.",
          lastFailure,
        },
      }),
    );
  }

  return {
    pool,
    handleRequest,
    reload,
    getAdminStatus,
    runScheduledSwitchNow: () => runScheduledSwitch("manual"),
    close,
  };
}

export async function createApiPoolProxyServer(options) {
  const service = await createApiPoolProxyService(options);
  const server = http.createServer((req, res) =>
    service.handleRequest(req, res, {
      exposeHealthDetails: true,
      exposeStatus: true,
    }),
  );
  const originalClose = server.close.bind(server);
  server.close = (callback) => {
    service.close?.();
    return originalClose(callback);
  };

  return { server, pool: service.pool, service };
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

  const provider = normalizeEndpointType(
    args.provider || process.env.API_POOL_PROVIDER || DEFAULT_PROVIDER,
  );
  if (!provider) {
    throw new Error("provider must be codex or claude-code");
  }

  const defaultPoolDir = path.resolve(process.cwd(), "api_pool", provider);
  const options = {
    provider,
    poolDir: path.resolve(args["pool-dir"] || process.env.API_POOL_DIR || defaultPoolDir || DEFAULT_POOL_DIR),
    host: args.host || process.env.API_POOL_HOST || DEFAULT_HOST,
    port: Number(args.port || process.env.API_POOL_PORT || DEFAULT_PORT),
    localApiKey: args["local-api-key"] || process.env.API_POOL_LOCAL_API_KEY || DEFAULT_LOCAL_API_KEY,
    maxSwitchAttempts: Number(
      args["max-switch-attempts"] || process.env.API_POOL_MAX_SWITCH_ATTEMPTS || DEFAULT_MAX_SWITCH_ATTEMPTS,
    ),
    requestTimeoutMs: Number(
      args["request-timeout-ms"] || process.env.API_POOL_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    enableScheduledSwitch: parseBooleanish(
      args["enable-scheduled-switch"] ?? process.env.API_POOL_SCHEDULED_SWITCH_ENABLED,
      DEFAULT_ENABLE_SCHEDULED_SWITCH,
    ),
    scheduledSwitchIntervalMs: Number(
      args["scheduled-switch-interval-ms"] ||
        process.env.API_POOL_SCHEDULED_SWITCH_INTERVAL_MS ||
        DEFAULT_SCHEDULED_SWITCH_INTERVAL_MS,
    ),
    proxyUrl:
      args["proxy-url"] ||
      process.env.API_POOL_PROXY_URL ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      "",
  };

  console.log("[startup] preparing api pool proxy");
  console.log(`[startup] provider=${options.provider}`);
  console.log(`[startup] host=${options.host} port=${options.port}`);
  console.log(`[startup] poolDir=${options.poolDir}`);
  console.log(`[startup] scheduledSwitch=${options.enableScheduledSwitch ? "on" : "off"}`);
  console.log(`[startup] scheduledSwitchIntervalMs=${options.scheduledSwitchIntervalMs}`);
  console.log(`[startup] upstreamProxy=${options.proxyUrl || "(none)"}`);

  const { server, pool } = await createApiPoolProxyServer(options);
  server.listen(options.port, options.host, () => {
    const active = pool.getActiveEndpoint();
    console.log(`API 池代理已启动：http://${options.host}:${options.port}`);
    console.log(`Provider: ${options.provider}`);
    console.log(`初始活跃节点：${active?.name || active?.id || "(none)"}`);
  });
}

const directRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (directRun) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { HistoryStore } from "./history-store.mjs";
import { ApiPoolProxyManager } from "./api-pool-proxy-manager.mjs";
import { PoolStore } from "./pool-store.mjs";
import { ProxyManager } from "./proxy-manager.mjs";
import { RunManager } from "./run-manager.mjs";
import { createToolPayload } from "./tool-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, ".local-ui-data");
const DEFAULT_STATIC_DIR = path.join(REPO_ROOT, "dist", "ui");

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...rest] = item.slice(2).split("=");
    args[key] = rest.length > 0 ? rest.join("=") : "true";
  }
  return args;
}

function json(res, statusCode, value) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(value, null, 2)}\n`);
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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

async function serveStatic(req, res, staticDir) {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const requested = path.join(staticDir, pathname);
  const resolved = path.resolve(requested);
  if (!resolved.startsWith(path.resolve(staticDir))) {
    json(res, 403, { error: "Forbidden" });
    return true;
  }

  const filePath = (await fileExists(resolved))
    ? resolved
    : path.join(staticDir, "index.html");
  if (!(await fileExists(filePath))) {
    return false;
  }

  const body = await fs.readFile(filePath);
  res.statusCode = 200;
  res.setHeader("content-type", contentTypeFor(filePath));
  res.end(body);
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = args.host || DEFAULT_HOST;
  const port = Number(args.port || DEFAULT_PORT);
  const dataDir = path.resolve(args["data-dir"] || DEFAULT_DATA_DIR);
  const staticDir = path.resolve(args["static-dir"] || DEFAULT_STATIC_DIR);

  const historyStore = new HistoryStore(dataDir);
  await historyStore.load();
  const poolStore = new PoolStore();
  const runManager = new RunManager(historyStore);
  const proxyManager = new ProxyManager(historyStore);
  const apiPoolProxyManagerCodex = new ApiPoolProxyManager(historyStore);
  const apiPoolProxyManagerClaude = new ApiPoolProxyManager(historyStore);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const pathname = url.pathname;

      if (req.method === "GET" && pathname === "/api/app-config") {
        json(res, 200, {
          mode: "local",
          apiBase: "/api",
          environment: "本地 Node + React",
          user: null,
          readOnly: false,
          readOnlyReason: "",
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/tools") {
        json(res, 200, { tools: createToolPayload() });
        return;
      }

      if (req.method === "GET" && pathname === "/api/history") {
        json(res, 200, { items: await historyStore.list() });
        return;
      }

      if (req.method === "GET" && pathname === "/api/pools") {
        json(res, 200, { items: poolStore.listPools() });
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/api/pools/")) {
        const poolId = pathname.split("/")[3];
        json(res, 200, await poolStore.loadPool(poolId));
        return;
      }

      if (req.method === "PUT" && pathname.startsWith("/api/pools/")) {
        const poolId = pathname.split("/")[3];
        const body = await readJsonBody(req);
        json(res, 200, await poolStore.savePool(poolId, body.items || []));
        return;
      }

      if (
        req.method === "POST" &&
        pathname.startsWith("/api/pools/") &&
        pathname.endsWith("/validate")
      ) {
        const poolId = pathname.split("/")[3];
        const body = await readJsonBody(req);
        const result = poolStore.validatePoolItems(poolId, body.items || []);
        json(res, result.ok ? 200 : 400, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/runs") {
        const body = await readJsonBody(req);
        const result = await runManager.execute(body);
        json(res, 202, result);
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/api/runs/") && pathname.endsWith("/logs")) {
        const runId = pathname.split("/")[3];
        const run = runManager.getRun(runId);
        if (!run) {
          json(res, 404, { error: "Run not found" });
          return;
        }
        json(res, 200, { runId, status: run.status, logs: run.logs });
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/api/runs/")) {
        const runId = pathname.split("/")[3];
        const run = runManager.getRun(runId);
        if (!run) {
          json(res, 404, { error: "Run not found" });
          return;
        }
        json(res, 200, {
          run: {
            id: run.id,
            toolId: run.toolId,
            status: run.status,
            createdAt: run.createdAt,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            exitCode: run.exitCode,
            error: run.error,
            commandPreview: run.commandPreview,
            params: run.params,
          },
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/proxy/start") {
        const body = await readJsonBody(req);
        const result = await proxyManager.start(body.params || {});
        json(res, result.reused ? 200 : 201, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/proxy/stop") {
        json(res, 200, await proxyManager.stop());
        return;
      }

      if (req.method === "GET" && pathname === "/api/proxy/status") {
        json(res, 200, await proxyManager.getStatus());
        return;
      }

      if (req.method === "POST" && pathname === "/api/api-pool/start") {
        const body = await readJsonBody(req);
        const params = body.params || {};
        const provider = params.provider || "codex";
        const manager = provider === "claude-code" ? apiPoolProxyManagerClaude : apiPoolProxyManagerCodex;
        const result = await manager.start(params);
        json(res, result.reused ? 200 : 201, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/api-pool/stop") {
        const body = await readJsonBody(req);
        const params = body.params || {};
        const provider = params.provider || "codex";
        const manager = provider === "claude-code" ? apiPoolProxyManagerClaude : apiPoolProxyManagerCodex;
        json(res, 200, await manager.stop());
        return;
      }

      if (req.method === "GET" && pathname === "/api/api-pool/status") {
        json(res, 200, await apiPoolProxyManagerCodex.getStatus());
        return;
      }

      if (req.method === "POST" && pathname === "/api/api-pool/codex/start") {
        const body = await readJsonBody(req);
        const result = await apiPoolProxyManagerCodex.start(body.params || {});
        json(res, result.reused ? 200 : 201, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/api-pool/codex/stop") {
        json(res, 200, await apiPoolProxyManagerCodex.stop());
        return;
      }

      if (req.method === "GET" && pathname === "/api/api-pool/codex/status") {
        json(res, 200, await apiPoolProxyManagerCodex.getStatus());
        return;
      }

      if (req.method === "POST" && pathname === "/api/api-pool/claude-code/start") {
        const body = await readJsonBody(req);
        const result = await apiPoolProxyManagerClaude.start(body.params || {});
        json(res, result.reused ? 200 : 201, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/api-pool/claude-code/stop") {
        json(res, 200, await apiPoolProxyManagerClaude.stop());
        return;
      }

      if (req.method === "GET" && pathname === "/api/api-pool/claude-code/status") {
        json(res, 200, await apiPoolProxyManagerClaude.getStatus());
        return;
      }

      if (await serveStatic(req, res, staticDir)) {
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, error.statusCode || 500, {
        error: error?.message || String(error),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      console.log(`Local UI server listening on http://${host}:${port}`);
      console.log(`Data dir: ${dataDir}`);
      console.log(`Static dir: ${staticDir}`);
      resolve();
    });
  });
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});

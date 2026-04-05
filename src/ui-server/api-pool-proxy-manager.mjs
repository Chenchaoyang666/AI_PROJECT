import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

import {
  buildCliArgs,
  buildCommandPreview,
  getToolDefinition,
  sanitizeParams,
} from "./tool-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const MAX_LOG_ENTRIES = 800;

function nowIso() {
  return new Date().toISOString();
}

async function checkPortAvailable(host, port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      server.close(() => reject(error));
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class ApiPoolProxyManager {
  constructor(historyStore) {
    this.historyStore = historyStore;
    this.child = null;
    this.state = {
      running: false,
      pid: null,
      startedAt: null,
      stopRequestedAt: null,
      lastExitCode: null,
      params: null,
      commandPreview: null,
      recentLogs: [],
    };
  }

  appendLog(stream, chunk) {
    const normalized = String(chunk || "").replace(/\r\n/g, "\n");
    const pieces = normalized.split("\n");
    for (const piece of pieces) {
      if (!piece) continue;
      this.state.recentLogs.push({
        timestamp: nowIso(),
        stream,
        text: piece,
      });
    }
    if (this.state.recentLogs.length > MAX_LOG_ENTRIES) {
      this.state.recentLogs.splice(0, this.state.recentLogs.length - MAX_LOG_ENTRIES);
    }
  }

  async start(rawParams = {}) {
    if (this.child && this.state.running) {
      return { reused: true, status: await this.getStatus() };
    }

    const tool = getToolDefinition("api-pool.start");
    const params = sanitizeParams(tool, rawParams);

    try {
      await checkPortAvailable(params.host, params.port);
    } catch (error) {
      const message =
        error?.code === "EADDRINUSE"
          ? `端口 ${params.host}:${params.port} 已被占用，请更换 API 池代理端口或先停止已有进程。`
          : `无法绑定 ${params.host}:${params.port}：${error?.message || String(error)}`;
      const wrapped = new Error(message);
      wrapped.statusCode = 409;
      throw wrapped;
    }

    const childEnv = { ...process.env };
    if (params.proxyUrl) {
      childEnv.CODEX_PROXY_BOOTSTRAPPED = "1";
      childEnv.NODE_USE_ENV_PROXY = "1";
      childEnv.HTTPS_PROXY = params.proxyUrl;
      childEnv.HTTP_PROXY = params.proxyUrl;
      childEnv.ALL_PROXY = params.proxyUrl;
    }

    const child = spawn(tool.command, buildCliArgs(tool, params), {
      cwd: REPO_ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.child = child;
    this.state = {
      running: true,
      pid: child.pid,
      startedAt: nowIso(),
      stopRequestedAt: null,
      lastExitCode: null,
      params,
      commandPreview: buildCommandPreview(tool, params, {
        hiddenFields: ["localApiKey"],
      }),
      recentLogs: [],
    };

    this.appendLog("stdout", `启动 API 池代理进程 PID=${child.pid}`);

    child.stdout.on("data", (chunk) => {
      this.appendLog("stdout", chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      this.appendLog("stderr", chunk.toString("utf8"));
    });
    child.on("error", async (error) => {
      this.appendLog("stderr", error?.message || String(error));
      this.state.running = false;
      this.state.pid = null;
      this.state.lastExitCode = 1;
      await this.historyStore.add({
        id: `api-pool-start-${Date.now()}`,
        toolId: "api-pool.start",
        status: "failed",
        exitCode: 1,
        createdAt: this.state.startedAt,
        startedAt: this.state.startedAt,
        finishedAt: nowIso(),
        commandPreview: this.state.commandPreview,
        paramsSummary: `provider=${params.provider}, 监听 ${params.host}:${params.port}`,
      });
    });
    child.on("close", async (code) => {
      this.state.running = false;
      this.state.pid = null;
      this.state.lastExitCode = code ?? 1;
      this.appendLog("stdout", `API 池代理进程已退出，exitCode=${this.state.lastExitCode}`);
      await this.historyStore.add({
        id: `api-pool-start-${Date.now()}`,
        toolId: "api-pool.start",
        status: this.state.lastExitCode === 0 ? "succeeded" : "failed",
        exitCode: this.state.lastExitCode,
        createdAt: this.state.startedAt,
        startedAt: this.state.startedAt,
        finishedAt: nowIso(),
        commandPreview: this.state.commandPreview,
        paramsSummary: `provider=${params.provider}, 监听 ${params.host}:${params.port}`,
      });
      this.child = null;
    });

    return { reused: false, status: await this.getStatus() };
  }

  async stop() {
    if (!this.child || !this.state.running) {
      return { stopped: false, status: await this.getStatus() };
    }
    this.state.stopRequestedAt = nowIso();
    this.appendLog("stdout", "收到停止请求，准备关闭 API 池代理进程");
    const child = this.child;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.child && this.state.running) {
          this.appendLog("stderr", "SIGTERM 超时，改用 SIGKILL");
          this.child.kill("SIGKILL");
        }
      }, 3000);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    return { stopped: true, status: await this.getStatus() };
  }

  async fetchHealth() {
    if (!this.state.params) return null;
    const { host, port } = this.state.params;
    try {
      const response = await fetch(`http://${host}:${port}/healthz`);
      return {
        ok: response.ok,
        status: response.status,
        body: await safeJson(response),
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error?.message || String(error),
      };
    }
  }

  async fetchProxyStatus() {
    if (!this.state.params) return null;
    const { host, port, localApiKey } = this.state.params;
    try {
      const response = await fetch(`http://${host}:${port}/proxy/status`, {
        headers: {
          authorization: `Bearer ${localApiKey}`,
        },
      });
      return {
        ok: response.ok,
        status: response.status,
        body: await safeJson(response),
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error?.message || String(error),
      };
    }
  }

  async getStatus() {
    return {
      ...this.state,
      endpoint:
        this.state.params && this.state.params.host && this.state.params.port
          ? `http://${this.state.params.host}:${this.state.params.port}`
          : null,
      health: await this.fetchHealth(),
      proxyStatus: await this.fetchProxyStatus(),
    };
  }
}

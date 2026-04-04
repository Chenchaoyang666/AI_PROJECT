import { spawn } from "node:child_process";
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

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class ProxyManager {
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

    const tool = getToolDefinition("proxy.start");
    const params = sanitizeParams(tool, rawParams);
    const child = spawn(tool.command, buildCliArgs(tool, params), {
      cwd: REPO_ROOT,
      env: process.env,
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

    this.appendLog("stdout", `启动代理进程 PID=${child.pid}`);

    child.stdout.on("data", (chunk) => {
      this.appendLog("stdout", chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      this.appendLog("stderr", chunk.toString("utf8"));
    });
    child.on("error", async (error) => {
      this.appendLog("stderr", error?.message || String(error));
      this.state.running = false;
      this.state.lastExitCode = 1;
      await this.historyStore.add({
        id: `proxy-start-${Date.now()}`,
        toolId: "proxy.start",
        status: "failed",
        exitCode: 1,
        createdAt: this.state.startedAt,
        startedAt: this.state.startedAt,
        finishedAt: nowIso(),
        commandPreview: this.state.commandPreview,
        paramsSummary: `监听 ${params.host}:${params.port}`,
      });
    });
    child.on("close", async (code) => {
      this.state.running = false;
      this.state.lastExitCode = code ?? 1;
      this.appendLog("stdout", `代理进程已退出，exitCode=${this.state.lastExitCode}`);
      await this.historyStore.add({
        id: `proxy-start-${Date.now()}`,
        toolId: "proxy.start",
        status: this.state.lastExitCode === 0 ? "succeeded" : "failed",
        exitCode: this.state.lastExitCode,
        createdAt: this.state.startedAt,
        startedAt: this.state.startedAt,
        finishedAt: nowIso(),
        commandPreview: this.state.commandPreview,
        paramsSummary: `监听 ${params.host}:${params.port}`,
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
    this.appendLog("stdout", "收到停止请求，准备关闭代理进程");
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

import { spawn } from "node:child_process";
import path from "node:path";

import {
  buildCliArgs,
  buildCommandPreview,
  getToolDefinition,
  requiresConfirmation,
  sanitizeParams,
  validateRequiredFields,
} from "./tool-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const MAX_LOG_ENTRIES = 800;

function nowIso() {
  return new Date().toISOString();
}

function summarizeParams(toolId, params) {
  if (toolId === "codex.configure") {
    return `baseUrl=${params.baseUrl}, model=${params.model}`;
  }
  if (toolId === "codex.switch-account") {
    return `tokensDir=${params.tokensDir}, dryRun=${params.dryRun ? "yes" : "no"}`;
  }
  if (toolId === "llm.probe") {
    return `baseUrl=${params.baseUrl}`;
  }
  return "";
}

export class RunManager {
  constructor(historyStore) {
    this.historyStore = historyStore;
    this.runs = new Map();
    this.nextId = 1;
  }

  getRun(runId) {
    return this.runs.get(runId) || null;
  }

  appendLog(run, stream, chunk) {
    const normalized = String(chunk || "").replace(/\r\n/g, "\n");
    const pieces = normalized.split("\n");
    for (const piece of pieces) {
      if (!piece) continue;
      run.logs.push({
        timestamp: nowIso(),
        stream,
        text: piece,
      });
    }
    if (run.logs.length > MAX_LOG_ENTRIES) {
      run.logs.splice(0, run.logs.length - MAX_LOG_ENTRIES);
    }
  }

  async execute({ toolId, params: rawParams = {}, confirmed = false }) {
    const tool = getToolDefinition(toolId);
    if (!tool) {
      const error = new Error(`Unknown tool: ${toolId}`);
      error.statusCode = 404;
      throw error;
    }
    if (tool.longRunning) {
      const error = new Error("Long-running tools must use dedicated proxy endpoints.");
      error.statusCode = 400;
      throw error;
    }

    const params = sanitizeParams(tool, rawParams);
    const missing = validateRequiredFields(tool, params);
    if (missing.length > 0) {
      const error = new Error(`Missing required fields: ${missing.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }
    if (requiresConfirmation(tool, params) && !confirmed) {
      const error = new Error("Confirmation required before running this tool.");
      error.statusCode = 409;
      throw error;
    }

    const runId = String(this.nextId++);
    const commandPreview = buildCommandPreview(tool, params, {
      hiddenFields: ["apiKey", "key", "localApiKey"],
    });
    const run = {
      id: runId,
      toolId,
      status: "queued",
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      commandPreview,
      params,
      logs: [],
      error: null,
    };
    this.runs.set(runId, run);

    const child = spawn(tool.command, buildCliArgs(tool, params), {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    run.status = "running";
    run.startedAt = nowIso();
    run.childPid = child.pid;

    child.stdout.on("data", (chunk) => {
      this.appendLog(run, "stdout", chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      this.appendLog(run, "stderr", chunk.toString("utf8"));
    });
    child.on("error", async (error) => {
      run.status = "failed";
      run.finishedAt = nowIso();
      run.error = error?.message || String(error);
      this.appendLog(run, "stderr", run.error);
      await this.historyStore.add({
        id: run.id,
        toolId,
        status: run.status,
        exitCode: run.exitCode,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        commandPreview: run.commandPreview,
        paramsSummary: summarizeParams(toolId, params),
      });
    });
    child.on("close", async (code) => {
      run.exitCode = code ?? 1;
      run.finishedAt = nowIso();
      run.status = run.exitCode === 0 ? "succeeded" : "failed";
      await this.historyStore.add({
        id: run.id,
        toolId,
        status: run.status,
        exitCode: run.exitCode,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        commandPreview: run.commandPreview,
        paramsSummary: summarizeParams(toolId, params),
      });
    });

    return {
      runId,
      status: run.status,
      commandPreview,
    };
  }
}

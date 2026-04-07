import fs from "node:fs/promises";
import path from "node:path";

import { classifyFailure } from "./codex-account-pool.mjs";

const COOLDOWN_SECONDS = {
  auth: 1800,
  quota: 900,
  rate_limit: 120,
  server: 45,
  network: 30,
  invalid: 300,
};

function nowMs(nowFn = Date.now) {
  return Number(nowFn());
}

function isoFromMs(ms) {
  return new Date(ms).toISOString();
}

function normalizeProvider(value) {
  const input = String(value || "").trim().toLowerCase();
  if (input === "codex") return "codex";
  if (input === "claude-code" || input === "claude_code" || input === "claude") {
    return "claude-code";
  }
  return "";
}

function prefersOpenAICompatibility(endpoint) {
  const model = String(endpoint?.model || "").trim().toLowerCase();
  return (
    model.startsWith("gpt-") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4") ||
    model.includes("codex")
  );
}

function makeEndpoint(raw, filePath) {
  return {
    id: path.basename(filePath),
    filePath,
    raw,
    name: raw.name || path.basename(filePath, path.extname(filePath)),
    type: normalizeProvider(raw.type),
    baseUrl: String(raw.baseUrl || "").trim(),
    apiKey: String(raw.apiKey || "").trim(),
    model: String(raw.model || "").trim(),
    probePath: String(raw.probePath || "").trim(),
    disabled: Boolean(raw.disabled),
    lastValidation: null,
    lastFailureReason: "",
    consecutiveFailures: 0,
    cooldownUntilMs: 0,
    healthy: false,
  };
}

function makeEndpointFromEntry(raw, filePath, index = 0) {
  const endpoint = makeEndpoint(raw, filePath);
  if (index > 0) {
    endpoint.id = `${path.basename(filePath)}#${index + 1}`;
  }
  if (!endpoint.name) {
    endpoint.name = `${path.basename(filePath, path.extname(filePath))}-${index + 1}`;
  }
  return endpoint;
}

function normalizeRawEntries(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((entry) => entry && typeof entry === "object");
  }
  if (raw && typeof raw === "object") {
    return [raw];
  }
  return [];
}

export function normalizeEndpointType(value) {
  return normalizeProvider(value);
}

export function isEndpointStructurallyEligible(endpoint, provider = "") {
  if (!endpoint) return false;
  if (endpoint.disabled) return false;
  if (!endpoint.baseUrl || !endpoint.apiKey) return false;
  if (!["codex", "claude-code"].includes(endpoint.type)) return false;
  if (provider && endpoint.type !== normalizeProvider(provider)) return false;
  return true;
}

export class ApiEndpointPool {
  constructor({
    poolDir,
    provider,
    fetchFn = fetch,
    nowFn = Date.now,
    logger = () => {},
    loadSnapshot = null,
    sourcePath = "",
  }) {
    this.poolDir = poolDir;
    this.provider = normalizeProvider(provider);
    this.fetchFn = fetchFn;
    this.nowFn = nowFn;
    this.logger = logger;
    this.loadSnapshot = loadSnapshot;
    this.sourcePath = sourcePath || (poolDir ? path.join(poolDir, "pool.json") : "pool.json");
    this.endpoints = [];
    this.activeEndpointId = null;
    this.activeEndpointVersion = 0;
  }

  listEndpoints() {
    return [...this.endpoints];
  }

  getActiveEndpoint() {
    if (!this.activeEndpointId) return null;
    return this.endpoints.find((endpoint) => endpoint.id === this.activeEndpointId) || null;
  }

  getActiveEndpointVersion() {
    return this.activeEndpointVersion;
  }

  async readSnapshots() {
    if (typeof this.loadSnapshot === "function") {
      const loaded = await this.loadSnapshot();
      if (!loaded) return [];
      if (Array.isArray(loaded)) {
        return [{ entries: loaded, sourcePath: this.sourcePath }];
      }
      return [
        {
          entries: Array.isArray(loaded.entries) ? loaded.entries : [],
          sourcePath: loaded.sourcePath || this.sourcePath,
        },
      ];
    }

    const dirEntries = await fs.readdir(this.poolDir, { withFileTypes: true });
    const allFiles = dirEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(this.poolDir, entry.name))
      .sort((left, right) => left.localeCompare(right));
    const prioritizedPoolFile = allFiles.find((filePath) => path.basename(filePath) === "pool.json");
    const files = prioritizedPoolFile ? [prioritizedPoolFile] : allFiles;
    const snapshots = [];

    for (const filePath of files) {
      try {
        const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
        snapshots.push({
          entries: normalizeRawEntries(raw),
          sourcePath: filePath,
        });
      } catch {
        snapshots.push({
          entries: [],
          sourcePath: filePath,
        });
      }
    }

    return snapshots;
  }

  async load() {
    const snapshots = await this.readSnapshots();
    const loaded = [];
    for (const snapshot of snapshots) {
      const entries = normalizeRawEntries(snapshot.entries);
      if (entries.length === 0) {
        this.logger("load:skip", {
          file: path.basename(snapshot.sourcePath),
          reason: "empty-or-invalid-json",
        });
        continue;
      }

      for (const [index, entry] of entries.entries()) {
        const endpoint = makeEndpointFromEntry(entry, snapshot.sourcePath, index);
        if (!isEndpointStructurallyEligible(endpoint, this.provider)) {
          this.logger("load:skip", {
            file: path.basename(snapshot.sourcePath),
            index,
            reason: "structurally-ineligible",
          });
          continue;
        }
        loaded.push(endpoint);
        this.logger("load:endpoint", {
          file: path.basename(snapshot.sourcePath),
          index,
          provider: endpoint.type,
          baseUrl: endpoint.baseUrl,
        });
      }
    }

    this.endpoints = loaded;
    if (!this.activeEndpointId && this.endpoints.length > 0) {
      this.activeEndpointId = this.endpoints[0].id;
    }
    if (
      this.activeEndpointId &&
      !this.endpoints.find((endpoint) => endpoint.id === this.activeEndpointId)
    ) {
      this.activeEndpointId = this.endpoints[0]?.id || null;
    }
  }

  isCoolingDown(endpoint) {
    return endpoint.cooldownUntilMs > nowMs(this.nowFn);
  }

  pickNextHealthyEndpoint(excluded = new Set()) {
    const ordered = this.endpoints;
    const activeId = this.activeEndpointId;
    const startIdx = activeId
      ? Math.max(ordered.findIndex((endpoint) => endpoint.id === activeId), 0)
      : 0;
    const rotated = ordered
      .slice(startIdx + 1)
      .concat(ordered.slice(0, startIdx + 1));

    return (
      rotated.find((endpoint) => !excluded.has(endpoint.id) && !this.isCoolingDown(endpoint)) ||
      null
    );
  }

  pickNextRotationCandidate(excluded = new Set()) {
    if (this.endpoints.length <= 1) return null;
    const ordered = this.endpoints;
    const activeId = this.activeEndpointId;
    const startIdx = activeId
      ? Math.max(ordered.findIndex((endpoint) => endpoint.id === activeId), 0)
      : 0;
    const rotated = ordered
      .slice(startIdx + 1)
      .concat(ordered.slice(0, startIdx + 1));

    return (
      rotated.find(
        (endpoint) =>
          endpoint.id !== activeId &&
          !excluded.has(endpoint.id) &&
          !endpoint.disabled &&
          !this.isCoolingDown(endpoint),
      ) || null
    );
  }

  recordHealthy(endpoint) {
    endpoint.healthy = true;
    endpoint.consecutiveFailures = 0;
    endpoint.lastFailureReason = "";
    endpoint.cooldownUntilMs = 0;
    endpoint.lastValidation = isoFromMs(nowMs(this.nowFn));
  }

  setActiveEndpoint(endpoint, mode = "failover", { expectedVersion = null, expectedId } = {}) {
    if (
      expectedVersion !== null &&
      (this.activeEndpointVersion !== expectedVersion || this.activeEndpointId !== expectedId)
    ) {
      return false;
    }
    const previousId = this.activeEndpointId;
    const previous =
      previousId ? this.endpoints.find((item) => item.id === previousId) : null;
    const previousFailure = previous?.lastFailureReason || "";
    this.activeEndpointId = endpoint.id;
    if (previousId !== endpoint.id) {
      this.activeEndpointVersion += 1;
    }
    if (previousId && previousId !== endpoint.id) {
      if (mode === "scheduled") {
        this.logger("pool:active-endpoint:scheduled", {
          message: `活跃节点定时切换：${previousId} → ${endpoint.id} (${endpoint.name || ""})`,
          id: endpoint.id,
          name: endpoint.name,
          baseUrl: endpoint.baseUrl,
          model: endpoint.model,
          previousId,
        });
      } else {
        this.logger("pool:active-endpoint", {
          message: `活跃节点切换：${previousId} → ${endpoint.id} (${endpoint.name || ""})，上一个节点失败原因：${previousFailure || "未知"}`,
          id: endpoint.id,
          name: endpoint.name,
          baseUrl: endpoint.baseUrl,
          model: endpoint.model,
          previousId,
          previousFailure,
        });
      }
    }
    return true;
  }

  markSuccess(endpoint, options = {}) {
    this.recordHealthy(endpoint);
    return this.setActiveEndpoint(endpoint, "failover", options);
  }

  markScheduledSwitch(endpoint) {
    this.recordHealthy(endpoint);
    return this.setActiveEndpoint(endpoint, "scheduled");
  }

  markFailure(endpoint, category, reason) {
    endpoint.healthy = false;
    endpoint.consecutiveFailures += 1;
    endpoint.lastFailureReason = `${category}:${reason}`;
    const cooldownSeconds = COOLDOWN_SECONDS[category] || COOLDOWN_SECONDS.invalid;
    endpoint.cooldownUntilMs = nowMs(this.nowFn) + cooldownSeconds * 1000;
  }

  classifyProbeFailure({ status = 0, detail = "" }) {
    return classifyFailure({ status, detail });
  }

  resolveProbeRequest(endpoint) {
    if (endpoint.probePath) {
      return {
        method: "GET",
        path: endpoint.probePath,
        headers: {},
        body: null,
      };
    }

    if (endpoint.type === "claude-code") {
      if (prefersOpenAICompatibility(endpoint)) {
        return {
          method: "GET",
          path: "/v1/models",
          headers: {},
          body: null,
        };
      }
      if (endpoint.model) {
        return {
          method: "POST",
          path: "/v1/messages",
          headers: {
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: endpoint.model,
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
          }),
        };
      }
      return {
        method: "GET",
        path: "/v1/models",
        headers: {},
        body: null,
      };
    }

    return {
      method: "GET",
      path: "/v1/models",
      headers: {},
      body: null,
    };
  }

  async probeEndpoint(endpoint, options = {}) {
    const activateOnSuccess = options.activateOnSuccess !== false;
    const activationMode = options.activationMode || "failover";
    const probe = this.resolveProbeRequest(endpoint);
    const url = new URL(probe.path, endpoint.baseUrl.endsWith("/") ? endpoint.baseUrl : `${endpoint.baseUrl}/`);

    this.logger("probe:start", {
      id: endpoint.id,
      provider: endpoint.type,
      url: url.toString(),
    });

    let response;
    try {
      response = await this.fetchFn(url, {
        method: probe.method,
        headers: {
          authorization: `Bearer ${endpoint.apiKey}`,
          "x-api-key": endpoint.apiKey,
          ...probe.headers,
        },
        body: probe.body,
      });
    } catch (error) {
      const detail = error?.message || String(error);
      this.markFailure(endpoint, "network", detail);
      return {
        ok: false,
        status: 0,
        category: "network",
        reason: "network",
        detail,
      };
    }

    if (response.ok) {
      this.recordHealthy(endpoint);
      if (activateOnSuccess) {
        this.setActiveEndpoint(endpoint, activationMode);
      }
      return { ok: true, status: response.status, category: "ok", reason: "probe-ok" };
    }

    const detail = await response.text();
    const classified = this.classifyProbeFailure({ status: response.status, detail });
    this.markFailure(endpoint, classified.category, detail || classified.reason);
    return {
      ok: false,
      status: response.status,
      category: classified.category,
      reason: classified.reason,
      detail,
    };
  }

  async getInitialEndpoint() {
    if (this.endpoints.length === 0) return null;

    const excluded = new Set();
    for (let i = 0; i < this.endpoints.length; i += 1) {
      const currentActive = this.getActiveEndpoint();
      const candidate =
        i === 0 && currentActive && !excluded.has(currentActive.id)
          ? currentActive
          : this.pickNextHealthyEndpoint(excluded);
      if (!candidate) break;

      excluded.add(candidate.id);
      if (this.isCoolingDown(candidate)) continue;

      const probe = await this.probeEndpoint(candidate, {
        activateOnSuccess: true,
        activationMode: "initial",
      });
      if (probe.ok) {
        this.activeEndpointId = candidate.id;
        return candidate;
      }
    }

    return null;
  }
}

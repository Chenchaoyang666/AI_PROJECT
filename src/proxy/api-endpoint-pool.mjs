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
  }) {
    this.poolDir = poolDir;
    this.provider = normalizeProvider(provider);
    this.fetchFn = fetchFn;
    this.nowFn = nowFn;
    this.logger = logger;
    this.endpoints = [];
    this.activeEndpointId = null;
  }

  listEndpoints() {
    return [...this.endpoints];
  }

  getActiveEndpoint() {
    if (!this.activeEndpointId) return null;
    return this.endpoints.find((endpoint) => endpoint.id === this.activeEndpointId) || null;
  }

  async load() {
    const dirEntries = await fs.readdir(this.poolDir, { withFileTypes: true });
    const files = dirEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(this.poolDir, entry.name))
      .sort((left, right) => left.localeCompare(right));

    const loaded = [];
    for (const filePath of files) {
      let raw;
      try {
        raw = JSON.parse(await fs.readFile(filePath, "utf8"));
      } catch {
        continue;
      }
      const endpoint = makeEndpoint(raw, filePath);
      if (!isEndpointStructurallyEligible(endpoint, this.provider)) {
        this.logger("load:skip", {
          file: path.basename(filePath),
          reason: "structurally-ineligible",
        });
        continue;
      }
      loaded.push(endpoint);
      this.logger("load:endpoint", {
        file: path.basename(filePath),
        provider: endpoint.type,
        baseUrl: endpoint.baseUrl,
      });
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

  markSuccess(endpoint) {
    endpoint.healthy = true;
    endpoint.consecutiveFailures = 0;
    endpoint.lastFailureReason = "";
    endpoint.cooldownUntilMs = 0;
    endpoint.lastValidation = isoFromMs(nowMs(this.nowFn));
    this.activeEndpointId = endpoint.id;
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

  async probeEndpoint(endpoint) {
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
      this.markSuccess(endpoint);
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

      const probe = await this.probeEndpoint(candidate);
      if (probe.ok) {
        this.activeEndpointId = candidate.id;
        return candidate;
      }
    }

    return null;
  }
}

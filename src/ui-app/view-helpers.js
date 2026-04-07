export const TOOL_ORDER = ["pool.manage", "api-pool.start", "proxy.start", "llm.probe"];

export const API_POOL_SUBTABS = [
  { id: "codex", label: "Codex API 池", poolId: "codex-api", port: 8790 },
  { id: "claude-code", label: "Claude Code API 池", poolId: "claude-code-api", port: 8789 },
];

export const POOL_CATEGORY_ORDER = [
  { id: "accounts", label: "账号池" },
  { id: "api", label: "API 池" },
];

export function friendlyToolName(toolId) {
  if (toolId === "pool.manage") return "池管理";
  if (toolId === "api-pool.start") return "API 池代理";
  if (toolId === "proxy.start") return "Codex 账号池代理";
  if (toolId === "llm.probe") return "LLM 探测";
  return toolId;
}

export function formatStatus(status) {
  if (status === "running") return "运行中";
  if (status === "succeeded") return "成功";
  if (status === "failed") return "失败";
  if (status === "queued") return "排队中";
  return status || "未知";
}

export function statusTagColor(status) {
  if (status === "running") return "processing";
  if (status === "succeeded") return "success";
  if (status === "failed") return "error";
  if (status === "queued") return "warning";
  return "default";
}

export function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function maskValue(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 10) return "*".repeat(text.length);
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function summarizeProxyAccounts(proxyState) {
  const accounts = proxyState?.proxyStatus?.body?.accounts;
  if (!Array.isArray(accounts)) return { total: 0, healthy: 0, cooling: 0 };
  return {
    total: accounts.length,
    healthy: accounts.filter((account) => account.healthy).length,
    cooling: accounts.filter((account) => account.cooldownUntil).length,
  };
}

export function summarizeApiPoolEndpoints(apiPoolState) {
  const endpoints = apiPoolState?.proxyStatus?.body?.endpoints;
  if (!Array.isArray(endpoints)) return { total: 0, healthy: 0, cooling: 0 };
  return {
    total: endpoints.length,
    healthy: endpoints.filter((endpoint) => endpoint.healthy).length,
    cooling: endpoints.filter((endpoint) => endpoint.cooldownUntil).length,
  };
}

export function collectDefaults(tools) {
  const defaults = {};
  for (const tool of tools) {
    defaults[tool.id] = { ...tool.defaults };
  }
  return defaults;
}

export function buildPreview(tool, params) {
  if (tool.virtual) return "内置页面";
  const hidden = new Set(["apiKey", "key", "localApiKey"]);
  const cliMap = {
    "proxy.start": {
      host: "host",
      port: "port",
      tokensDir: "tokens-dir",
      upstreamBase: "upstream-base",
      refreshEndpoint: "refresh-endpoint",
      probeUrl: "probe-url",
      localApiKey: "local-api-key",
      maxSwitchAttempts: "max-switch-attempts",
      requestTimeoutMs: "request-timeout-ms",
      proxyUrl: "proxy-url",
    },
    "api-pool.start": {
      provider: "provider",
      host: "host",
      port: "port",
      poolDir: "pool-dir",
      localApiKey: "local-api-key",
      maxSwitchAttempts: "max-switch-attempts",
      requestTimeoutMs: "request-timeout-ms",
      enableScheduledSwitch: "enable-scheduled-switch",
      scheduledSwitchIntervalMs: "scheduled-switch-interval-ms",
      proxyUrl: "proxy-url",
    },
    "llm.probe": {
      baseUrl: "baseUrl",
      key: "key",
      skipAnthropic: "skipAnthropic",
      skipOpenAI: "skipOpenAI",
      skipPublic: "skipPublic",
    },
  };
  const scriptPaths = {
    "proxy.start": "src/scripts/codex-local-proxy.mjs",
    "api-pool.start": "src/scripts/api-pool-proxy.mjs",
    "llm.probe": "src/scripts/probe-llm-endpoint.mjs",
  };
  const parts = ["node", scriptPaths[tool.id]];
  for (const field of tool.argsSchema) {
    const value = params[field.name];
    const argName = cliMap[tool.id]?.[field.name];
    if (!argName) continue;
    if (field.type === "checkbox") {
      if (value === true) parts.push(`--${argName}`);
      continue;
    }
    if (value === "" || value == null) continue;
    parts.push(`--${argName}=${hidden.has(field.name) ? "***" : value}`);
  }
  return parts.join(" ");
}

export function makeNewPoolItem(poolId) {
  if (poolId === "codex-accounts") {
    return {
      type: "codex",
      disabled: false,
      email: "",
      name: "",
      last_refresh: "",
      expired: "",
      tokens: {
        access_token: "",
        account_id: "",
        id_token: "",
        refresh_token: "",
      },
    };
  }
  return {
    name: "",
    type: poolId === "claude-code-api" ? "claude-code" : "codex",
    baseUrl: "",
    apiKey: "",
    model: "",
    probePath: "",
    disabled: false,
  };
}

export function copyPoolItem(item) {
  return JSON.parse(JSON.stringify(item));
}

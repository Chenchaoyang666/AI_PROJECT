import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

function scriptPath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function field({
  name,
  label,
  type = "text",
  defaultValue = "",
  required = false,
  placeholder = "",
  description = "",
  options = [],
}) {
  return {
    name,
    label,
    type,
    defaultValue,
    required,
    placeholder,
    description,
    options,
  };
}

export const TOOL_DEFINITIONS = [
  {
    id: "proxy.start",
    tabTitle: "本地代理",
    description:
      "启动 Codex 本地代理，负责账号池加载、探活、刷新和请求转发。这个功能是长驻进程，会持续运行直到你手动停止。",
    riskNotes: [
      "会占用本地端口并持续输出运行日志",
      "不会直接改 ~/.codex 配置，但一旦客户端指向它，请求就会走账号池逻辑",
    ],
    scriptPath: scriptPath("src/scripts/codex-local-proxy.mjs"),
    command: "node",
    argsSchema: [
      field({ name: "host", label: "监听地址", defaultValue: "127.0.0.1" }),
      field({ name: "port", label: "监听端口", type: "number", defaultValue: 8787 }),
      field({ name: "tokensDir", label: "账号目录", defaultValue: "acc_pool" }),
      field({
        name: "upstreamBase",
        label: "上游地址",
        defaultValue: "https://chatgpt.com/backend-api/codex",
      }),
      field({
        name: "refreshEndpoint",
        label: "刷新地址",
        defaultValue: "https://auth.openai.com/oauth/token",
      }),
      field({
        name: "probeUrl",
        label: "探活地址",
        defaultValue:
          "https://chatgpt.com/backend-api/codex/models?client_version=0.117.0",
      }),
      field({
        name: "localApiKey",
        label: "本地 API Key",
        type: "password",
        defaultValue: "local-codex-proxy-key",
      }),
      field({
        name: "maxSwitchAttempts",
        label: "最大切换次数",
        type: "number",
        defaultValue: 3,
      }),
      field({
        name: "requestTimeoutMs",
        label: "请求超时毫秒",
        type: "number",
        defaultValue: 60000,
      }),
      field({
        name: "proxyUrl",
        label: "上游 HTTP 代理",
        defaultValue: "http://127.0.0.1:8118",
        placeholder: "http://127.0.0.1:8118",
      }),
    ],
    dangerLevel: "low",
    confirmRequired: false,
    longRunning: true,
  },
  {
    id: "api-pool.start",
    tabTitle: "API 池代理",
    description:
      "启动 Claude Code 或 Codex 的 apiUrl/apiKey 轮询代理。这个功能是长驻进程，会持续运行直到你手动停止。",
    riskNotes: [
      "会占用新的本地端口并持续输出运行日志",
      "会把请求转发到 API 池中的上游地址，并在失败后自动切换节点",
    ],
    scriptPath: scriptPath("src/scripts/api-pool-proxy.mjs"),
    command: "node",
    argsSchema: [
      field({
        name: "provider",
        label: "Provider",
        type: "select",
        defaultValue: "codex",
        options: [
          { label: "Codex", value: "codex" },
          { label: "Claude Code", value: "claude-code" },
        ],
      }),
      field({ name: "host", label: "监听地址", defaultValue: "127.0.0.1" }),
      field({ name: "port", label: "监听端口", type: "number", defaultValue: 8789 }),
      field({
        name: "poolDir",
        label: "池目录",
        defaultValue: "api_pool/codex",
        description: "建议分别使用 api_pool/codex 和 api_pool/claude-code。",
      }),
      field({
        name: "localApiKey",
        label: "本地 API Key",
        type: "password",
        defaultValue: "local-api-pool-proxy-key",
      }),
      field({
        name: "maxSwitchAttempts",
        label: "最大切换次数",
        type: "number",
        defaultValue: 3,
      }),
      field({
        name: "requestTimeoutMs",
        label: "请求超时毫秒",
        type: "number",
        defaultValue: 60000,
      }),
      field({
        name: "proxyUrl",
        label: "上游 HTTP 代理",
        defaultValue: "http://127.0.0.1:8118",
        placeholder: "http://127.0.0.1:8118",
      }),
    ],
    dangerLevel: "low",
    confirmRequired: false,
    longRunning: true,
  },
  {
    id: "codex.configure",
    tabTitle: "配置 Codex",
    description:
      "把本机 Codex 配置到本地代理，会写入 ~/.codex/auth.json 和 ~/.codex/config.toml，并自动备份旧文件。",
    riskNotes: [
      "这是写操作，会改本机 ~/.codex 配置",
      "运行前需要确认",
    ],
    scriptPath: scriptPath("src/scripts/configure-codex-local-proxy.mjs"),
    command: "node",
    argsSchema: [
      field({ name: "baseUrl", label: "代理基地址", defaultValue: "http://127.0.0.1:8787" }),
      field({
        name: "apiKey",
        label: "代理 API Key",
        type: "password",
        defaultValue: "local-codex-proxy-key",
      }),
      field({ name: "model", label: "模型", defaultValue: "gpt-5.4" }),
      field({ name: "authPath", label: "auth.json 路径", defaultValue: "~/.codex/auth.json" }),
      field({
        name: "configPath",
        label: "config.toml 路径",
        defaultValue: "~/.codex/config.toml",
      }),
      field({
        name: "backupDir",
        label: "备份目录",
        defaultValue: "~/.codex/backups/configure-codex-local-proxy",
      }),
    ],
    dangerLevel: "high",
    confirmRequired: true,
    longRunning: false,
  },
  {
    id: "codex.switch-account",
    tabTitle: "切换账号",
    description:
      "从 acc_pool 里选择一个当前可用账号。默认以 dry-run 方式先验证，不实际写回本机配置。",
    riskNotes: [
      "dry-run 关闭时会写 ~/.codex/auth.json 和 ~/.codex/config.toml",
      "建议先保留 dry-run 验证账号可用性",
    ],
    scriptPath: scriptPath("src/scripts/switch-codex-account.mjs"),
    command: "node",
    argsSchema: [
      field({ name: "tokensDir", label: "账号目录", defaultValue: "acc_pool" }),
      field({ name: "authPath", label: "auth.json 路径", defaultValue: "~/.codex/auth.json" }),
      field({
        name: "configPath",
        label: "config.toml 路径",
        defaultValue: "~/.codex/config.toml",
      }),
      field({
        name: "backupDir",
        label: "备份目录",
        defaultValue: "~/.codex/backups/switch-codex-account",
      }),
      field({
        name: "validateUrl",
        label: "验证地址",
        defaultValue: "https://api.openai.com/v1/models",
      }),
      field({ name: "model", label: "模型", defaultValue: "gpt-5.4" }),
      field({ name: "timeout", label: "超时秒数", type: "number", defaultValue: 20 }),
      field({ name: "dryRun", label: "仅验证不写回", type: "checkbox", defaultValue: true }),
    ],
    dangerLevel: "medium",
    confirmRequired: false,
    longRunning: false,
  },
  {
    id: "llm.probe",
    tabTitle: "LLM 探测",
    description:
      "探测某个地址对 OpenAI 和 Anthropic 协议的兼容性，并生成 JSON / Markdown 报告。",
    riskNotes: [
      "会主动请求目标接口并把结果写入 reports/llm-probe",
      "不会改 ~/.codex 配置",
    ],
    scriptPath: scriptPath("src/scripts/probe-llm-endpoint.mjs"),
    command: "node",
    argsSchema: [
      field({
        name: "baseUrl",
        label: "目标 Base URL",
        required: true,
        placeholder: "https://example.com",
      }),
      field({
        name: "key",
        label: "API Key / Token",
        type: "password",
        required: true,
      }),
      field({
        name: "skipAnthropic",
        label: "跳过 Anthropic 探测",
        type: "checkbox",
        defaultValue: false,
      }),
      field({
        name: "skipOpenAI",
        label: "跳过 OpenAI 探测",
        type: "checkbox",
        defaultValue: false,
      }),
      field({
        name: "skipPublic",
        label: "跳过公开信息探测",
        type: "checkbox",
        defaultValue: false,
      }),
    ],
    dangerLevel: "low",
    confirmRequired: false,
    longRunning: false,
  },
];

const FIELD_TO_ARG = {
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
    proxyUrl: "proxy-url",
  },
  "codex.configure": {
    baseUrl: "base-url",
    apiKey: "api-key",
    model: "model",
    authPath: "auth-path",
    configPath: "config-path",
    backupDir: "backup-dir",
  },
  "codex.switch-account": {
    tokensDir: "tokens-dir",
    authPath: "auth-path",
    configPath: "config-path",
    backupDir: "backup-dir",
    validateUrl: "validate-url",
    model: "model",
    timeout: "timeout",
    dryRun: "dry-run",
  },
  "llm.probe": {
    baseUrl: "baseUrl",
    key: "key",
    skipAnthropic: "skipAnthropic",
    skipOpenAI: "skipOpenAI",
    skipPublic: "skipPublic",
  },
};

function normalizeValue(fieldDef, value) {
  if (fieldDef.type === "checkbox") {
    return value === true || value === "true";
  }
  if (fieldDef.type === "number") {
    if (value === "" || value == null) return "";
    return Number(value);
  }
  return value == null ? "" : String(value);
}

export function getToolDefinition(toolId) {
  return TOOL_DEFINITIONS.find((tool) => tool.id === toolId) || null;
}

export function getDefaultParams(tool) {
  return Object.fromEntries(
    tool.argsSchema.map((fieldDef) => [fieldDef.name, fieldDef.defaultValue]),
  );
}

export function sanitizeParams(tool, rawParams = {}) {
  const defaults = getDefaultParams(tool);
  const params = {};
  for (const fieldDef of tool.argsSchema) {
    const rawValue = rawParams[fieldDef.name] ?? defaults[fieldDef.name];
    params[fieldDef.name] = normalizeValue(fieldDef, rawValue);
  }
  return params;
}

export function validateRequiredFields(tool, params) {
  return tool.argsSchema
    .filter((fieldDef) => fieldDef.required)
    .filter((fieldDef) => {
      const value = params[fieldDef.name];
      return value === "" || value == null;
    })
    .map((fieldDef) => fieldDef.label);
}

export function requiresConfirmation(tool, params) {
  if (tool.id === "codex.configure") return true;
  if (tool.id === "codex.switch-account") {
    return params.dryRun !== true;
  }
  return tool.confirmRequired;
}

export function buildCliArgs(tool, params) {
  const argMap = FIELD_TO_ARG[tool.id] || {};
  const args = [tool.scriptPath];
  for (const fieldDef of tool.argsSchema) {
    const cliKey = argMap[fieldDef.name];
    const value = params[fieldDef.name];
    if (!cliKey) continue;
    if (fieldDef.type === "checkbox") {
      if (value === true) {
        args.push(`--${cliKey}`);
      }
      continue;
    }
    if (value === "" || value == null) continue;
    args.push(`--${cliKey}=${value}`);
  }
  return args;
}

export function buildCommandPreview(tool, params, options = {}) {
  const argMap = FIELD_TO_ARG[tool.id] || {};
  const hiddenFields = new Set(options.hiddenFields || []);
  const parts = [tool.command, tool.scriptPath];
  for (const fieldDef of tool.argsSchema) {
    const cliKey = argMap[fieldDef.name];
    const value = params[fieldDef.name];
    if (!cliKey) continue;
    if (fieldDef.type === "checkbox") {
      if (value === true) {
        parts.push(`--${cliKey}`);
      }
      continue;
    }
    if (value === "" || value == null) continue;
    const displayValue = hiddenFields.has(fieldDef.name) ? "***" : value;
    parts.push(`--${cliKey}=${displayValue}`);
  }
  return parts.join(" ");
}

export function serializeTool(tool) {
  const defaults = getDefaultParams(tool);
  return {
    id: tool.id,
    tabTitle: tool.tabTitle,
    description: tool.description,
    riskNotes: tool.riskNotes,
    argsSchema: tool.argsSchema,
    defaults,
    dangerLevel: tool.dangerLevel,
    confirmRequired: tool.confirmRequired,
    longRunning: tool.longRunning,
    defaultCommandPreview: buildCommandPreview(tool, defaults, {
      hiddenFields: ["apiKey", "key", "localApiKey"],
    }),
  };
}

export function createToolPayload() {
  return TOOL_DEFINITIONS.map(serializeTool);
}

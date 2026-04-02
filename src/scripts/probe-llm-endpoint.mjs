#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_OPENAI_CANDIDATES = [
  "gpt-5.4",
  "gpt-5",
  "gpt-4.1",
  "gpt-4o",
  "gpt-4o-mini",
];

const DEFAULT_ANTHROPIC_CANDIDATES = [
  "claude-sonnet-4-20250514",
  "claude-3-5-sonnet-20241022",
  "anthropic/claude-sonnet-4.6",
  "google/gemini-3-flash",
];

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "reports", "llm-probe");

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function sanitizeBaseUrl(baseUrl) {
  const trimmed = baseUrl.trim();
  if (!trimmed) return trimmed;
  return trimmed.replace(/\/+(v1)?\/?$/, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function requestJson(url, options = {}) {
  const startedAt = Date.now();
  const method = options.method || "GET";
  const headers = options.headers || {};
  const body = options.body;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = ["-sS", "-i", "-m", String(Math.ceil(timeoutMs / 1000)), "-X", method, url];

  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }

  if (body) {
    args.push("--data", body);
  }

  try {
    const { stdout } = await execFileAsync("curl", args, {
      maxBuffer: 1024 * 1024 * 5,
    });
    const normalized = stdout.replace(/\r\n/g, "\n");
    const separator = normalized.lastIndexOf("\n\n");
    const rawHeaders = separator >= 0 ? normalized.slice(0, separator) : "";
    const text = separator >= 0 ? normalized.slice(separator + 2) : normalized;
    const statusLine = rawHeaders
      .split("\n")
      .filter(Boolean)
      .find((line) => line.startsWith("HTTP/"));
    const statusMatch = statusLine?.match(/^HTTP\/\S+\s+(\d+)\s*(.*)$/);
    const status = statusMatch ? Number(statusMatch[1]) : 0;
    const statusText = statusMatch?.[2] || "";
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      json,
      text,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const detail = [error?.stdout, error?.stderr, error?.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    return {
      ok: false,
      status: 0,
      statusText: "NETWORK_ERROR",
      json: null,
      text: detail || String(error),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

function anthropicHeaders(apiKey) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
}

function openaiHeaders(apiKey) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
}

function extractModelsFromList(payload) {
  if (!payload || !Array.isArray(payload.data)) return [];
  return payload.data
    .map((item) => item?.id || item?.model_name)
    .filter((id) => typeof id === "string" && id.length > 0);
}

function pickSnippet(text, max = 220) {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function hasAnthropicUsage(payload) {
  return Boolean(payload?.usage && typeof payload.usage.input_tokens === "number");
}

function hasOpenAIOutput(payload) {
  if (!payload) return false;
  if (Array.isArray(payload.output)) return true;
  return typeof payload.id === "string" && typeof payload.model === "string";
}

function hasChatCompletionOutput(payload) {
  return Array.isArray(payload?.choices) && payload.choices.length > 0;
}

function extractPricingModels(payload) {
  if (!payload || !Array.isArray(payload.data)) return [];
  return payload.data
    .map((item) => ({
      model: item?.model_name,
      groups: Array.isArray(item?.enable_groups) ? item.enable_groups : [],
      endpoints: Array.isArray(item?.supported_endpoint_types)
        ? item.supported_endpoint_types
        : [],
      vendorId: item?.vendor_id ?? null,
    }))
    .filter((item) => item.model);
}

function extractPricingEndpointSummary(payload) {
  if (!payload || typeof payload.supported_endpoint !== "object") return {};
  return payload.supported_endpoint;
}

function extractPricingGroups(payload) {
  if (!payload || typeof payload.usable_group !== "object") return {};
  return payload.usable_group;
}

async function testOpenAIModels(baseUrl, apiKey, candidateModels) {
  const modelsUrl = joinUrl(baseUrl, "/v1/models");
  const modelsResponse = await requestJson(modelsUrl, {
    method: "GET",
    headers: openaiHeaders(apiKey),
  });

  const discoveredModels = extractModelsFromList(modelsResponse.json);
  const candidates = unique([...discoveredModels, ...candidateModels]);
  const reachableModels = [];
  const chatReachableModels = [];
  const failures = [];

  for (const model of candidates.slice(0, 12)) {
    const responsesProbe = await requestJson(joinUrl(baseUrl, "/v1/responses"), {
      method: "POST",
      headers: openaiHeaders(apiKey),
      body: JSON.stringify({
        model,
        input: "Reply with OK.",
        max_output_tokens: 16,
      }),
    });

    if (responsesProbe.ok && hasOpenAIOutput(responsesProbe.json)) {
      reachableModels.push({
        model,
        kind: "responses",
        elapsedMs: responsesProbe.elapsedMs,
      });
      continue;
    }

    const chatProbe = await requestJson(joinUrl(baseUrl, "/v1/chat/completions"), {
      method: "POST",
      headers: openaiHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 16,
      }),
    });

    if (chatProbe.ok && hasChatCompletionOutput(chatProbe.json)) {
      chatReachableModels.push({
        model,
        kind: "chat_completions",
        elapsedMs: chatProbe.elapsedMs,
      });
    } else {
      failures.push({
        model,
        status: chatProbe.status || responsesProbe.status,
        responsesDetail: pickSnippet(responsesProbe.text),
        chatDetail: pickSnippet(chatProbe.text),
      });
    }
  }

  return {
    modelsResponse,
    discoveredModels,
    reachableModels,
    chatReachableModels,
    failures,
  };
}

async function collectPublicInfo(baseUrl) {
  const [statusResponse, pricingResponse] = await Promise.all([
    requestJson(joinUrl(baseUrl, "/api/status"), { method: "GET" }),
    requestJson(joinUrl(baseUrl, "/api/pricing"), { method: "GET" }),
  ]);

  return {
    statusResponse,
    pricingResponse,
    pricingModels: extractPricingModels(pricingResponse.json),
    pricingEndpointSummary: extractPricingEndpointSummary(pricingResponse.json),
    usableGroups: extractPricingGroups(pricingResponse.json),
  };
}

async function testAnthropicModels(baseUrl, apiKey, candidateModels) {
  const modelsUrl = joinUrl(baseUrl, "/v1/models");
  const modelsResponse = await requestJson(modelsUrl, {
    method: "GET",
    headers: anthropicHeaders(apiKey),
  });

  const discoveredModels = extractModelsFromList(modelsResponse.json);
  const candidates = unique([...discoveredModels, ...candidateModels]);
  const basicModels = [];
  const toolModels = [];
  const failures = [];

  for (const model of candidates.slice(0, 12)) {
    const basic = await requestJson(joinUrl(baseUrl, "/v1/messages"), {
      method: "POST",
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({
        model,
        max_tokens: 32,
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
    });

    if (basic.ok && hasAnthropicUsage(basic.json)) {
      basicModels.push({
        model,
        elapsedMs: basic.elapsedMs,
      });
    } else {
      failures.push({
        model,
        stage: "basic",
        status: basic.status,
        detail: pickSnippet(basic.text),
      });
      continue;
    }

    const toolCall = await requestJson(joinUrl(baseUrl, "/v1/messages"), {
      method: "POST",
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({
        model,
        max_tokens: 128,
        tools: [
          {
            name: "echo",
            description: "Echo input text",
            input_schema: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
              required: ["text"],
            },
          },
        ],
        messages: [
          {
            role: "user",
            content: "Call the echo tool with text hi.",
          },
        ],
      }),
    });

    if (toolCall.ok && hasAnthropicUsage(toolCall.json)) {
      toolModels.push({
        model,
        elapsedMs: toolCall.elapsedMs,
      });
    } else {
      failures.push({
        model,
        stage: "tools",
        status: toolCall.status,
        detail: pickSnippet(toolCall.text),
      });
    }
  }

  const countTokensResponse = await requestJson(joinUrl(baseUrl, "/v1/messages/count_tokens"), {
    method: "POST",
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify({
      model: basicModels[0]?.model || candidates[0] || "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "hi" }],
    }),
  });

  return {
    modelsResponse,
    discoveredModels,
    basicModels,
    toolModels,
    failures,
    countTokensResponse,
  };
}

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}

function printResultLine(label, value) {
  console.log(`${label}: ${value}`);
}

function formatModelList(items) {
  if (!items.length) return "(none)";
  return items.map((item) => item.model || item).join(", ");
}

function nowStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 10) return "*".repeat(value.length);
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function buildConfigSuggestions(baseUrl, apiKey, anthropicResult, openaiResult) {
  const result = {
    claudeCode: {
      supported: anthropicResult.toolModels.length > 0,
      reason:
        anthropicResult.toolModels.length > 0
          ? "存在通过 tools 兼容性测试的模型"
          : "没有任何模型通过 Anthropic tools 兼容性测试",
      env: null,
    },
    codex: {
      supported: openaiResult.reachableModels.length > 0,
      reason:
        openaiResult.reachableModels.length > 0
          ? "存在通过 /v1/responses 探测的模型"
          : "没有任何模型通过 OpenAI /v1/responses 探测",
      configToml: null,
      authJson: null,
    },
  };

  if (anthropicResult.toolModels.length > 0) {
    const model = anthropicResult.toolModels[0].model;
    result.claudeCode.env = {
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    };
  }

  if (openaiResult.reachableModels.length > 0) {
    const model = openaiResult.reachableModels[0].model;
    result.codex.configToml = [
      'model_provider = "OpenAI"',
      `model = "${model}"`,
      `review_model = "${model}"`,
      "",
      "[model_providers.OpenAI]",
      'name = "OpenAI"',
      `base_url = "${baseUrl}"`,
      'wire_api = "responses"',
      "requires_openai_auth = true",
      `api_key = "${apiKey}"`,
    ].join("\n");
    result.codex.authJson = {
      OPENAI_API_KEY: apiKey,
    };
  } else if (openaiResult.chatReachableModels.length > 0) {
    const model = openaiResult.chatReachableModels[0].model;
    result.codex.supported = true;
    result.codex.reason = "存在通过 /v1/chat/completions 探测的模型";
    result.codex.configToml = [
      'model_provider = "OpenAI"',
      `model = "${model}"`,
      `review_model = "${model}"`,
      "",
      "[model_providers.OpenAI]",
      'name = "OpenAI"',
      `base_url = "${baseUrl}"`,
      'wire_api = "chat_completions"',
      "requires_openai_auth = true",
      `api_key = "${apiKey}"`,
    ].join("\n");
    result.codex.authJson = {
      OPENAI_API_KEY: apiKey,
    };
  }

  return result;
}

function printJsonBlock(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printConfigSuggestions(configSuggestions) {
  printHeader("推荐配置");

  if (configSuggestions.claudeCode.supported) {
    console.log("Claude Code：支持");
    printJsonBlock(configSuggestions.claudeCode.env);
  } else {
    console.log("Claude Code：不建议接入这个地址");
    console.log(`原因：${configSuggestions.claudeCode.reason}`);
  }

  if (configSuggestions.codex.supported) {
    console.log("\nCodex 的 config.toml：");
    console.log(configSuggestions.codex.configToml);
    console.log("\nCodex 的 auth.json：");
    printJsonBlock(configSuggestions.codex.authJson);
  } else {
    console.log("\nCodex：这个地址当前没有探测到可用的 OpenAI /v1/responses 模型");
    console.log(`原因：${configSuggestions.codex.reason}`);
  }
}

function printModelSection(title, models) {
  console.log(`${title}:`);
  if (!models.length) {
    console.log("- (空)");
    return;
  }

  for (const model of models) {
    console.log(`- ${model}`);
  }
}

function summarizeCompatibility(anthropicResult, openaiResult) {
  return {
    codex:
      openaiResult.reachableModels.length > 0
        ? "supported-via-responses"
        : openaiResult.chatReachableModels.length > 0
          ? "supported-via-chat-completions"
          : "not-confirmed",
    claudeCode:
      anthropicResult.toolModels.length > 0 ? "supported-via-anthropic-tools" : "not-confirmed",
  };
}

function buildMarkdownReport(report) {
  const compatibility = report.summary.compatibility;
  const publicModels = report.public.pricingModels.map((item) => item.model);
  const pricingGroupLines = Object.entries(report.public.usableGroups).map(
    ([group, note]) => `- \`${group}\`: ${note}`,
  );
  const endpointLines = Object.entries(report.public.pricingEndpointSummary).map(
    ([name, value]) => `- \`${name}\`: \`${value.method} ${value.path}\``,
  );
  const openaiResponsesLines = report.openai.reachableModels.map(
    (item) => `- \`${item.model}\` (${item.elapsedMs} ms)`,
  );
  const openaiChatLines = report.openai.chatReachableModels.map(
    (item) => `- \`${item.model}\` (${item.elapsedMs} ms)`,
  );
  const anthropicBasicLines = report.anthropic.basicModels.map(
    (item) => `- \`${item.model}\` (${item.elapsedMs} ms)`,
  );
  const anthropicToolsLines = report.anthropic.toolModels.map(
    (item) => `- \`${item.model}\` (${item.elapsedMs} ms)`,
  );
  const failureLines = [
    ...report.anthropic.failures.slice(0, 6).map(
      (item) =>
        `- Anthropic \`${item.model}\` [${item.stage}] -> ${item.status}: ${item.detail || "(empty)"}`,
    ),
    ...report.openai.failures.slice(0, 6).map(
      (item) =>
        `- OpenAI \`${item.model}\` -> ${item.status}: responses=${item.responsesDetail || "(empty)"}; chat=${item.chatDetail || "(empty)"}`,
    ),
  ];

  return [
    "# LLM Endpoint Probe Report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Base URL: ${report.baseUrl}`,
    `- API key: ${report.summary.maskedApiKey}`,
    "",
    "## Compatibility Summary",
    "",
    `- Codex: ${compatibility.codex}`,
    `- Claude Code: ${compatibility.claudeCode}`,
    "",
    "## Public Metadata",
    "",
    `- Public pricing endpoint available: ${report.public.pricing.ok}`,
    `- Public status endpoint available: ${report.public.status.ok}`,
    `- Public models discovered: ${publicModels.length > 0 ? publicModels.map((item) => `\`${item}\``).join(", ") : "(none)"}`,
    "",
    "### Supported Endpoint Types",
    "",
    ...(endpointLines.length > 0 ? endpointLines : ["- (none)"]),
    "",
    "### Public Group Notes",
    "",
    ...(pricingGroupLines.length > 0 ? pricingGroupLines : ["- (none)"]),
    "",
    "## OpenAI Compatibility",
    "",
    `- /v1/models: ${report.openai.modelsListOk ? "ok" : `failed (${report.openai.modelsListStatus})`}`,
    `- /v1/responses reachable models: ${report.openai.reachableModels.length}`,
    `- /v1/chat/completions reachable models: ${report.openai.chatReachableModels.length}`,
    "",
    "### /v1/responses",
    "",
    ...(openaiResponsesLines.length > 0 ? openaiResponsesLines : ["- (none)"]),
    "",
    "### /v1/chat/completions",
    "",
    ...(openaiChatLines.length > 0 ? openaiChatLines : ["- (none)"]),
    "",
    "## Anthropic Compatibility",
    "",
    `- /v1/models: ${report.anthropic.modelsListOk ? "ok" : `failed (${report.anthropic.modelsListStatus})`}`,
    `- /v1/messages basic reachable models: ${report.anthropic.basicModels.length}`,
    `- /v1/messages tool reachable models: ${report.anthropic.toolModels.length}`,
    `- /v1/messages/count_tokens: ${report.anthropic.countTokens.ok ? "ok" : `failed (${report.anthropic.countTokens.status})`}`,
    "",
    "### Basic /v1/messages",
    "",
    ...(anthropicBasicLines.length > 0 ? anthropicBasicLines : ["- (none)"]),
    "",
    "### Tools /v1/messages",
    "",
    ...(anthropicToolsLines.length > 0 ? anthropicToolsLines : ["- (none)"]),
    "",
    "## Recent Failures",
    "",
    ...(failureLines.length > 0 ? failureLines : ["- (none)"]),
    "",
    "## Suggested Config",
    "",
    "### Codex",
    "",
    "```toml",
    report.recommendations.codex.configToml || "# not available",
    "```",
    "",
    "### Claude Code",
    "",
    "```json",
    JSON.stringify(report.recommendations.claudeCode.env || { supported: false }, null, 2),
    "```",
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {};
  for (const entry of argv) {
    if (!entry.startsWith("--")) continue;
    const [rawKey, ...rest] = entry.slice(2).split("=");
    if (rest.length > 0) {
      parsed[rawKey] = rest.join("=");
      continue;
    }
    parsed[rawKey] = "true";
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage:
  npm run probe:llm -- --baseUrl=https://example.com --key=sk-xxx
  node src/scripts/probe-llm-endpoint.mjs --baseUrl=https://example.com --key=sk-xxx

Options:
  --baseUrl=URL    API base URL, for example https://jiuuij.de5.net
  --key=VALUE      API key or token
  --help           Show this help text

Outputs:
  - reports/llm-probe/llm-probe-report-YYYYMMDD-HHMMSS.json
  - reports/llm-probe/llm-probe-report-YYYYMMDD-HHMMSS.md
`);
}

async function getInputs() {
  const args = parseArgs(process.argv.slice(2));

  let key = args.key || args.apiKey || args.sk || args.token;
  let baseUrl = args.baseUrl || args.baseURL || args.url;

  if (key && baseUrl) {
    return {
      apiKey: key.trim(),
      baseUrl: sanitizeBaseUrl(baseUrl),
    };
  }

  const rl = readline.createInterface({ input, output });
  try {
    if (!baseUrl) {
      baseUrl = await rl.question("API base URL: ");
    }
    if (!key) {
      key = await rl.question("API key: ");
    }
  } finally {
    rl.close();
  }

  return {
    apiKey: key.trim(),
    baseUrl: sanitizeBaseUrl(baseUrl),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    printUsage();
    return;
  }

  const { apiKey, baseUrl } = await getInputs();

  if (!apiKey || !baseUrl) {
    console.error("Both API key and base URL are required.");
    process.exitCode = 1;
    return;
  }

  console.log(`Probing endpoint: ${baseUrl}`);

  const publicInfo = await collectPublicInfo(baseUrl);

  const anthropicResult = await testAnthropicModels(
    baseUrl,
    apiKey,
    DEFAULT_ANTHROPIC_CANDIDATES,
  );

  const openaiResult = await testOpenAIModels(
    baseUrl,
    apiKey,
    DEFAULT_OPENAI_CANDIDATES,
  );

  const configSuggestions = buildConfigSuggestions(
    baseUrl,
    apiKey,
    anthropicResult,
    openaiResult,
  );

  const compatibility = summarizeCompatibility(anthropicResult, openaiResult);

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    public: {
      status: {
        ok: publicInfo.statusResponse.ok,
        status: publicInfo.statusResponse.status,
        body: publicInfo.statusResponse.json || publicInfo.statusResponse.text,
      },
      pricing: {
        ok: publicInfo.pricingResponse.ok,
        status: publicInfo.pricingResponse.status,
      },
      pricingModels: publicInfo.pricingModels,
      pricingEndpointSummary: publicInfo.pricingEndpointSummary,
      usableGroups: publicInfo.usableGroups,
    },
    anthropic: {
      modelsListOk: anthropicResult.modelsResponse.ok,
      modelsListStatus: anthropicResult.modelsResponse.status,
      modelsFromEndpoint: anthropicResult.discoveredModels,
      basicModels: anthropicResult.basicModels,
      toolModels: anthropicResult.toolModels,
      countTokens: {
        ok: anthropicResult.countTokensResponse.ok,
        status: anthropicResult.countTokensResponse.status,
        body: anthropicResult.countTokensResponse.json || anthropicResult.countTokensResponse.text,
      },
      failures: anthropicResult.failures,
    },
    openai: {
      modelsListOk: openaiResult.modelsResponse.ok,
      modelsListStatus: openaiResult.modelsResponse.status,
      modelsFromEndpoint: openaiResult.discoveredModels,
      reachableModels: openaiResult.reachableModels,
      chatReachableModels: openaiResult.chatReachableModels,
      failures: openaiResult.failures,
    },
    recommendations: configSuggestions,
    summary: {
      compatibility,
      maskedApiKey: maskSecret(apiKey),
    },
  };

  await fs.mkdir(DEFAULT_REPORT_DIR, { recursive: true });

  const jsonReportPath = path.resolve(
    DEFAULT_REPORT_DIR,
    `llm-probe-report-${nowStamp()}.json`,
  );
  const markdownReportPath = jsonReportPath.replace(/\.json$/, ".md");
  await fs.writeFile(jsonReportPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(markdownReportPath, buildMarkdownReport(report), "utf8");

  printHeader("探测报告");
  printResultLine("JSON 报告", jsonReportPath);
  printResultLine("Markdown 报告", markdownReportPath);

  printHeader("公开信息");
  printResultLine(
    "公开 pricing",
    publicInfo.pricingResponse.ok
      ? `成功，共 ${publicInfo.pricingModels.length} 个模型`
      : `失败，状态码 ${publicInfo.pricingResponse.status}`,
  );
  printModelSection(
    "公开 pricing 返回的模型",
    publicInfo.pricingModels.map((item) => item.model),
  );

  printHeader("Anthropic 兼容性");
  printResultLine(
    "模型列表接口",
    anthropicResult.modelsResponse.ok
      ? `成功，共 ${anthropicResult.discoveredModels.length} 个模型`
      : `失败，状态码 ${anthropicResult.modelsResponse.status}`,
  );
  printModelSection("接口返回的模型", anthropicResult.discoveredModels);
  printResultLine(
    "基础 /v1/messages 可用模型",
    anthropicResult.basicModels.length > 0
      ? formatModelList(anthropicResult.basicModels)
      : "(空)",
  );
  printResultLine(
    "可用于 Claude Code 的 tools 模型",
    anthropicResult.toolModels.length > 0
      ? formatModelList(anthropicResult.toolModels)
      : "(空)",
  );
  printResultLine(
    "count_tokens",
    anthropicResult.countTokensResponse.ok
      ? pickSnippet(anthropicResult.countTokensResponse.text)
      : `失败，状态码 ${anthropicResult.countTokensResponse.status}`,
  );

  if (anthropicResult.failures.length > 0) {
    console.log("最近失败记录:");
    for (const failure of anthropicResult.failures.slice(0, 6)) {
      console.log(
        `- ${failure.model} [${failure.stage}] -> ${failure.status}: ${failure.detail}`,
      );
    }
  }

  printHeader("OpenAI 兼容性");
  printResultLine(
    "模型列表接口",
    openaiResult.modelsResponse.ok
      ? `成功，共 ${openaiResult.discoveredModels.length} 个模型`
      : `失败，状态码 ${openaiResult.modelsResponse.status}`,
  );
  printModelSection("接口返回的模型", openaiResult.discoveredModels);
  printResultLine(
    "可用于 Codex 的 /v1/responses 模型",
    openaiResult.reachableModels.length > 0
      ? formatModelList(openaiResult.reachableModels)
      : "(空)",
  );
  printResultLine(
    "可用于 Codex 的 /v1/chat/completions 模型",
    openaiResult.chatReachableModels.length > 0
      ? formatModelList(openaiResult.chatReachableModels)
      : "(空)",
  );

  if (openaiResult.failures.length > 0) {
    console.log("最近失败记录:");
    for (const failure of openaiResult.failures.slice(0, 6)) {
      console.log(
        `- ${failure.model} -> ${failure.status}: responses=${failure.responsesDetail}; chat=${failure.chatDetail}`,
      );
    }
  }

  printConfigSuggestions(configSuggestions);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

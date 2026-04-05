import { useEffect, useState } from "react";

const TOOL_ORDER = [
  "proxy.start",
  "api-pool.start",
  "codex.configure",
  "codex.switch-account",
  "llm.probe",
];

function friendlyToolName(toolId) {
  if (toolId === "proxy.start") return "本地代理";
  if (toolId === "api-pool.start") return "API 池代理";
  if (toolId === "codex.configure") return "配置 Codex";
  if (toolId === "codex.switch-account") return "切换账号";
  if (toolId === "llm.probe") return "LLM 探测";
  return toolId;
}

function formatStatus(status) {
  if (status === "running") return "运行中";
  if (status === "succeeded") return "成功";
  if (status === "failed") return "失败";
  if (status === "queued") return "排队中";
  return status || "未知";
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function summarizeProxyAccounts(proxyState) {
  const accounts = proxyState?.proxyStatus?.body?.accounts;
  if (!Array.isArray(accounts)) {
    return {
      total: 0,
      healthy: 0,
      cooling: 0,
    };
  }

  return {
    total: accounts.length,
    healthy: accounts.filter((account) => account.healthy).length,
    cooling: accounts.filter((account) => account.cooldownUntil).length,
  };
}

function summarizeApiPoolEndpoints(apiPoolState) {
  const endpoints = apiPoolState?.proxyStatus?.body?.endpoints;
  if (!Array.isArray(endpoints)) {
    return {
      total: 0,
      healthy: 0,
      cooling: 0,
    };
  }

  return {
    total: endpoints.length,
    healthy: endpoints.filter((endpoint) => endpoint.healthy).length,
    cooling: endpoints.filter((endpoint) => endpoint.cooldownUntil).length,
  };
}

function collectDefaults(tools) {
  const defaults = {};
  for (const tool of tools) {
    defaults[tool.id] = { ...tool.defaults };
  }
  return defaults;
}

function buildPreview(tool, params) {
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

  const scriptPaths = {
    "proxy.start": "src/scripts/codex-local-proxy.mjs",
    "api-pool.start": "src/scripts/api-pool-proxy.mjs",
    "codex.configure": "src/scripts/configure-codex-local-proxy.mjs",
    "codex.switch-account": "src/scripts/switch-codex-account.mjs",
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

function HistoryList({ items }) {
  if (!items.length) {
    return <div className="empty-state">最近还没有运行记录。</div>;
  }

  return (
    <div className="history-list">
      {items.map((item) => (
        <div key={item.id} className="history-item">
          <div className="history-line">
            <strong>{friendlyToolName(item.toolId)}</strong>
            <span className={`pill pill-${item.status}`}>{formatStatus(item.status)}</span>
          </div>
          <div className="history-meta">{item.paramsSummary || item.commandPreview}</div>
          <div className="history-meta">
            {formatTime(item.startedAt)} · exit={item.exitCode == null ? "-" : item.exitCode}
          </div>
        </div>
      ))}
    </div>
  );
}

function LogPanel({ logs }) {
  if (!logs.length) {
    return <div className="empty-state">当前还没有日志输出。</div>;
  }

  return (
    <div className="log-panel">
      {logs.map((entry, index) => (
        <div key={`${entry.timestamp}-${index}`} className={`log-line log-${entry.stream}`}>
          <span className="log-time">{formatTime(entry.timestamp)}</span>
          <span className="log-stream">{entry.stream}</span>
          <span>{entry.text}</span>
        </div>
      ))}
    </div>
  );
}

function FieldEditor({ field, value, onChange }) {
  if (field.type === "checkbox") {
    return (
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="field">
        <span className="field-label">{field.label}</span>
        <select
          className="field-input"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        >
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.description ? <span className="field-help">{field.description}</span> : null}
      </label>
    );
  }

  const inputType =
    field.type === "password" ? "password" : field.type === "number" ? "number" : "text";

  return (
    <label className="field">
      <span className="field-label">{field.label}</span>
      <input
        className="field-input"
        type={inputType}
        value={value ?? ""}
        required={field.required}
        placeholder={field.placeholder || ""}
        onChange={(event) =>
          onChange(field.type === "number" ? Number(event.target.value) : event.target.value)
        }
      />
      {field.description ? <span className="field-help">{field.description}</span> : null}
    </label>
  );
}

export default function App() {
  const [tools, setTools] = useState([]);
  const [activeTab, setActiveTab] = useState("proxy.start");
  const [forms, setForms] = useState({});
  const [history, setHistory] = useState([]);
  const [runState, setRunState] = useState({});
  const [proxyState, setProxyState] = useState({
    running: false,
    recentLogs: [],
  });
  const [apiPoolState, setApiPoolState] = useState({
    running: false,
    recentLogs: [],
  });
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      const [toolsRes, historyRes, proxyRes, apiPoolRes] = await Promise.all([
        fetch("/api/tools"),
        fetch("/api/history"),
        fetch("/api/proxy/status"),
        fetch("/api/api-pool/status"),
      ]);
      const toolsData = await toolsRes.json();
      const historyData = await historyRes.json();
      const proxyData = await proxyRes.json();
      const apiPoolData = await apiPoolRes.json();
      if (cancelled) return;

      const sortedTools = [...toolsData.tools].sort(
        (left, right) => TOOL_ORDER.indexOf(left.id) - TOOL_ORDER.indexOf(right.id),
      );
      setTools(sortedTools);
      setForms(collectDefaults(sortedTools));
      setHistory(historyData.items || []);
      setProxyState(proxyData);
      setApiPoolState(apiPoolData);
    }

    loadInitialData().catch((error) => {
      if (!cancelled) {
        setErrors((current) => ({ ...current, global: error.message }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      const activeRuns = Object.entries(runState).filter(([, value]) =>
        value?.runId && (value.status === "queued" || value.status === "running"),
      );

      for (const [toolId, item] of activeRuns) {
        const [runRes, logsRes] = await Promise.all([
          fetch(`/api/runs/${item.runId}`),
          fetch(`/api/runs/${item.runId}/logs`),
        ]);
        const runData = await runRes.json();
        const logsData = await logsRes.json();
        setRunState((current) => ({
          ...current,
          [toolId]: {
            ...current[toolId],
            status: runData.run.status,
            exitCode: runData.run.exitCode,
            error: runData.run.error,
            logs: logsData.logs || [],
          },
        }));

        if (runData.run.status === "succeeded" || runData.run.status === "failed") {
          const historyRes = await fetch("/api/history");
          const historyData = await historyRes.json();
          setHistory(historyData.items || []);
        }
      }

      const [proxyRes, apiPoolRes] = await Promise.all([
        fetch("/api/proxy/status"),
        fetch("/api/api-pool/status"),
      ]);
      const proxyData = await proxyRes.json();
      const apiPoolData = await apiPoolRes.json();
      setProxyState(proxyData);
      setApiPoolState(apiPoolData);
    }, 1500);

    return () => clearInterval(timer);
  }, [runState]);

  const activeTool = tools.find((tool) => tool.id === activeTab);
  const activeForm = forms[activeTab] || {};
  const activeRun = runState[activeTab] || { logs: [] };
  const activeHistory = history.filter((item) => item.toolId === activeTab).slice(0, 5);
  const proxyAccounts = summarizeProxyAccounts(proxyState);
  const activeProxyAccount = proxyState?.proxyStatus?.body?.active || null;
  const apiPoolEndpoints = summarizeApiPoolEndpoints(apiPoolState);
  const activeApiPoolEndpoint = apiPoolState?.proxyStatus?.body?.active || null;

  function updateField(toolId, fieldName, value) {
    if (toolId === "api-pool.start" && fieldName === "provider") {
      const nextPoolDir = value === "claude-code" ? "api_pool/claude-code" : "api_pool/codex";
      setForms((current) => ({
        ...current,
        [toolId]: {
          ...current[toolId],
          provider: value,
          poolDir: nextPoolDir,
        },
      }));
      return;
    }
    setForms((current) => ({
      ...current,
      [toolId]: {
        ...current[toolId],
        [fieldName]: value,
      },
    }));
  }

  async function refreshHistory() {
    const response = await fetch("/api/history");
    const data = await response.json();
    setHistory(data.items || []);
  }

  async function runTool(tool) {
    const params = forms[tool.id] || {};
    const needsConfirm =
      tool.id === "codex.configure" || (tool.id === "codex.switch-account" && params.dryRun !== true);
    if (needsConfirm) {
      const ok = window.confirm("这个操作会写本机配置或账号信息，确认继续吗？");
      if (!ok) return;
    }

    setBusy((current) => ({ ...current, [tool.id]: true }));
    setErrors((current) => ({ ...current, [tool.id]: "" }));

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          toolId: tool.id,
          params,
          confirmed: needsConfirm,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "运行失败");
      }

      setRunState((current) => ({
        ...current,
        [tool.id]: {
          toolId: tool.id,
          runId: payload.runId,
          status: payload.status,
          logs: [],
          exitCode: null,
          error: null,
        },
      }));
      await refreshHistory();
    } catch (error) {
      setErrors((current) => ({ ...current, [tool.id]: error.message }));
    } finally {
      setBusy((current) => ({ ...current, [tool.id]: false }));
    }
  }

  async function startProxy() {
    setBusy((current) => ({ ...current, "proxy.start": true }));
    setErrors((current) => ({ ...current, "proxy.start": "" }));
    try {
      const response = await fetch("/api/proxy/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ params: forms["proxy.start"] || {} }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "启动代理失败");
      }
      setProxyState(payload.status);
      await refreshHistory();
    } catch (error) {
      setErrors((current) => ({ ...current, "proxy.start": error.message }));
    } finally {
      setBusy((current) => ({ ...current, "proxy.start": false }));
    }
  }

  async function stopProxy() {
    setBusy((current) => ({ ...current, "proxy.start": true }));
    try {
      const response = await fetch("/api/proxy/stop", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "停止代理失败");
      }
      setProxyState(payload.status);
      await refreshHistory();
    } catch (error) {
      setErrors((current) => ({ ...current, "proxy.start": error.message }));
    } finally {
      setBusy((current) => ({ ...current, "proxy.start": false }));
    }
  }

  async function startApiPoolProxy() {
    setBusy((current) => ({ ...current, "api-pool.start": true }));
    setErrors((current) => ({ ...current, "api-pool.start": "" }));
    try {
      const response = await fetch("/api/api-pool/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ params: forms["api-pool.start"] || {} }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "启动 API 池代理失败");
      }
      setApiPoolState(payload.status);
      await refreshHistory();
    } catch (error) {
      setErrors((current) => ({ ...current, "api-pool.start": error.message }));
    } finally {
      setBusy((current) => ({ ...current, "api-pool.start": false }));
    }
  }

  async function stopApiPoolProxy() {
    setBusy((current) => ({ ...current, "api-pool.start": true }));
    try {
      const response = await fetch("/api/api-pool/stop", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "停止 API 池代理失败");
      }
      setApiPoolState(payload.status);
      await refreshHistory();
    } catch (error) {
      setErrors((current) => ({ ...current, "api-pool.start": error.message }));
    } finally {
      setBusy((current) => ({ ...current, "api-pool.start": false }));
    }
  }

  function clearLocalLog(toolId) {
    if (toolId === "proxy.start") {
      setProxyState((current) => ({ ...current, recentLogs: [] }));
      return;
    }
    if (toolId === "api-pool.start") {
      setApiPoolState((current) => ({ ...current, recentLogs: [] }));
      return;
    }
    setRunState((current) => ({
      ...current,
      [toolId]: {
        ...current[toolId],
        logs: [],
      },
    }));
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local Ops Console</p>
          <h1>本地脚本管理台</h1>
          <p className="hero-copy">
            用一个多 Tab 面板统一管理代理、配置、账号切换和 LLM 探测，减少反复手敲命令。
          </p>
        </div>
        <div className="hero-side">
          <div className="hero-stat">
            <span>运行方式</span>
            <strong>本地 Node + React</strong>
          </div>
          <div className="hero-stat">
            <span>历史记录</span>
            <strong>最近 20 条</strong>
          </div>
        </div>
      </header>

      {errors.global ? <div className="error-banner">{errors.global}</div> : null}

      <nav className="tab-bar">
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={tool.id === activeTab ? "tab active" : "tab"}
            onClick={() => setActiveTab(tool.id)}
            type="button"
          >
            {tool.tabTitle}
          </button>
        ))}
      </nav>

      {activeTool ? (
        <main className="tab-layout">
          <section className="card card-description">
            <div className="card-header">
              <div>
                <h2>{activeTool.tabTitle}</h2>
                <p>{activeTool.description}</p>
              </div>
              <span className={`risk risk-${activeTool.dangerLevel}`}>风险：{activeTool.dangerLevel}</span>
            </div>
            <ul className="risk-list">
              {activeTool.riskNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <div className="preview-box">
              <span className="preview-label">命令预览</span>
              <code>{buildPreview(activeTool, activeForm)}</code>
            </div>
            {activeTool.id === "proxy.start" ? (
              <>
                <div className="proxy-summary-grid">
                  <div className="summary-tile">
                    <span>运行状态</span>
                    <strong>{proxyState.running ? "运行中" : "未运行"}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>PID</span>
                    <strong>{proxyState.pid || "-"}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>代理地址</span>
                    <strong>{proxyState.endpoint || "-"}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>启动时间</span>
                    <strong>{formatTime(proxyState.startedAt)}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>账号总数</span>
                    <strong>{proxyAccounts.total}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>健康账号</span>
                    <strong>{proxyAccounts.healthy}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>冷却中账号</span>
                    <strong>{proxyAccounts.cooling}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>上游代理</span>
                    <strong>{activeForm.proxyUrl || "-"}</strong>
                  </div>
                </div>

                <div className="proxy-account-card">
                  <div className="proxy-account-heading">
                    <h3>当前活跃账号</h3>
                    <span className={activeProxyAccount?.healthy ? "badge badge-ok" : "badge"}>
                      {activeProxyAccount?.healthy ? "healthy" : "unknown"}
                    </span>
                  </div>
                  <div className="proxy-account-grid">
                    <div>
                      <span>账号文件</span>
                      <strong>{activeProxyAccount?.id || "-"}</strong>
                    </div>
                    <div>
                      <span>Account ID</span>
                      <strong>{activeProxyAccount?.accountId || "-"}</strong>
                    </div>
                    <div>
                      <span>最近验证时间</span>
                      <strong>{formatTime(activeProxyAccount?.lastValidation)}</strong>
                    </div>
                    <div>
                      <span>最近失败原因</span>
                      <strong>{activeProxyAccount?.lastFailureReason || "-"}</strong>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
            {activeTool.id === "api-pool.start" ? (
              <>
                <div className="proxy-summary-grid">
                  <div className="summary-tile">
                    <span>当前 Provider</span>
                    <strong>{activeForm.provider || apiPoolState?.proxyStatus?.body?.provider || "-"}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>运行状态</span>
                    <strong>{apiPoolState.running ? "运行中" : "未运行"}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>PID</span>
                    <strong>{apiPoolState.pid || "-"}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>代理地址</span>
                    <strong>{apiPoolState.endpoint || "-"}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>启动时间</span>
                    <strong>{formatTime(apiPoolState.startedAt)}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>节点总数</span>
                    <strong>{apiPoolEndpoints.total}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>健康节点</span>
                    <strong>{apiPoolEndpoints.healthy}</strong>
                  </div>
                  <div className="summary-tile">
                    <span>冷却中节点</span>
                    <strong>{apiPoolEndpoints.cooling}</strong>
                  </div>
                </div>

                <div className="proxy-account-card">
                  <div className="proxy-account-heading">
                    <h3>当前活跃节点</h3>
                    <span className={activeApiPoolEndpoint?.healthy ? "badge badge-ok" : "badge"}>
                      {activeApiPoolEndpoint?.healthy ? "healthy" : "unknown"}
                    </span>
                  </div>
                  <div className="proxy-account-grid">
                    <div>
                      <span>节点名</span>
                      <strong>{activeApiPoolEndpoint?.name || activeApiPoolEndpoint?.id || "-"}</strong>
                    </div>
                    <div>
                      <span>Provider</span>
                      <strong>{activeApiPoolEndpoint?.type || "-"}</strong>
                    </div>
                    <div>
                      <span>Base URL</span>
                      <strong>{activeApiPoolEndpoint?.baseUrl || "-"}</strong>
                    </div>
                    <div>
                      <span>最近验证时间</span>
                      <strong>{formatTime(activeApiPoolEndpoint?.lastValidation)}</strong>
                    </div>
                    <div>
                      <span>最近失败原因</span>
                      <strong>{activeApiPoolEndpoint?.lastFailureReason || "-"}</strong>
                    </div>
                    <div>
                      <span>模型</span>
                      <strong>{activeApiPoolEndpoint?.model || "-"}</strong>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </section>

          <section className="card card-form">
            <div className="card-header">
              <div>
                <h3>参数表单</h3>
                <p>填写脚本支持的入参后即可运行。</p>
              </div>
            </div>
            <div className="field-grid">
              {activeTool.argsSchema.map((field) => (
                <FieldEditor
                  key={field.name}
                  field={field}
                  value={activeForm[field.name]}
                  onChange={(value) => updateField(activeTool.id, field.name, value)}
                />
              ))}
            </div>
            <div className="action-row">
              {activeTool.id === "proxy.start" ? (
                <>
                  <button type="button" className="primary" onClick={startProxy} disabled={busy["proxy.start"]}>
                    {proxyState.running ? "刷新代理状态" : "启动代理"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={stopProxy}
                    disabled={!proxyState.running || busy["proxy.start"]}
                  >
                    停止代理
                  </button>
                </>
              ) : activeTool.id === "api-pool.start" ? (
                <>
                  <button
                    type="button"
                    className="primary"
                    onClick={startApiPoolProxy}
                    disabled={busy["api-pool.start"]}
                  >
                    {apiPoolState.running ? "刷新代理状态" : "启动 API 池代理"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={stopApiPoolProxy}
                    disabled={!apiPoolState.running || busy["api-pool.start"]}
                  >
                    停止代理
                  </button>
                </>
              ) : (
                <button type="button" className="primary" onClick={() => runTool(activeTool)} disabled={busy[activeTool.id]}>
                  {busy[activeTool.id] ? "运行中..." : "运行脚本"}
                </button>
              )}
              <button type="button" className="ghost" onClick={() => clearLocalLog(activeTool.id)}>
                清空当前日志视图
              </button>
            </div>
            {errors[activeTool.id] ? <div className="error-banner">{errors[activeTool.id]}</div> : null}
          </section>

          <section className="card card-logs">
            <div className="card-header">
              <div>
                <h3>运行输出</h3>
                <p>
                  {activeTool.id === "proxy.start"
                    ? "查看代理最近日志和在线状态。"
                    : `状态：${formatStatus(activeRun.status)}`}
                </p>
              </div>
              {activeTool.id !== "proxy.start" && activeRun.runId ? (
                <span className={`pill pill-${activeRun.status}`}>{formatStatus(activeRun.status)}</span>
              ) : null}
            </div>
            {activeTool.id === "proxy.start" ? (
              <>
                <div className="status-strip">
                  <span>healthz：{proxyState.health?.ok ? "ok" : proxyState.health?.error || proxyState.health?.status || "-"}</span>
                  <span>
                    当前账号：{proxyState.proxyStatus?.body?.active?.id || proxyState.proxyStatus?.error || "-"}
                  </span>
                  <span>
                    账号池：{proxyAccounts.healthy}/{proxyAccounts.total} healthy
                  </span>
                </div>
                <LogPanel logs={proxyState.recentLogs || []} />
              </>
            ) : activeTool.id === "api-pool.start" ? (
              <>
                <div className="status-strip">
                  <span>
                    healthz：{apiPoolState.health?.ok ? "ok" : apiPoolState.health?.error || apiPoolState.health?.status || "-"}
                  </span>
                  <span>
                    当前节点：{apiPoolState.proxyStatus?.body?.active?.name || apiPoolState.proxyStatus?.error || "-"}
                  </span>
                  <span>
                    节点池：{apiPoolEndpoints.healthy}/{apiPoolEndpoints.total} healthy
                  </span>
                </div>
                <LogPanel logs={apiPoolState.recentLogs || []} />
              </>
            ) : (
              <LogPanel logs={activeRun.logs || []} />
            )}
          </section>

          <section className="card card-history">
            <div className="card-header">
              <div>
                <h3>最近记录</h3>
                <p>按当前 Tab 过滤展示最近的运行历史。</p>
              </div>
            </div>
            <HistoryList items={activeHistory} />
          </section>
        </main>
      ) : (
        <div className="empty-state">正在加载工具定义...</div>
      )}
    </div>
  );
}

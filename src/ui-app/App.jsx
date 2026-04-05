import { useEffect, useState } from "react";

const TOOL_ORDER = ["pool.manage", "api-pool.start", "proxy.start", "llm.probe"];
const API_POOL_SUBTABS = [
  { id: "codex", label: "Codex API 池", poolId: "codex-api", port: 8790 },
  { id: "claude-code", label: "Claude Code API 池", poolId: "claude-code-api", port: 8789 },
];
const POOL_CATEGORY_ORDER = [
  { id: "accounts", label: "账号池" },
  { id: "api", label: "API 池" },
];

function friendlyToolName(toolId) {
  if (toolId === "pool.manage") return "池管理";
  if (toolId === "api-pool.start") return "API 池代理";
  if (toolId === "proxy.start") return "Codex 账号池代理";
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

function maskValue(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 10) return "*".repeat(text.length);
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function summarizeProxyAccounts(proxyState) {
  const accounts = proxyState?.proxyStatus?.body?.accounts;
  if (!Array.isArray(accounts)) {
    return { total: 0, healthy: 0, cooling: 0 };
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
    return { total: 0, healthy: 0, cooling: 0 };
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

function HistoryList({ items }) {
  if (!items.length) {
    return <div className="empty-state">最近还没有运行记录。</div>;
  }
  return (
    <div className="history-list">
      {items.map((item) => (
        <div key={`${item.id}-${item.startedAt || ""}`} className="history-item">
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
        <select className="field-input" value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
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

function makeNewPoolItem(poolId) {
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

function copyPoolItem(item) {
  return JSON.parse(JSON.stringify(item));
}

function PoolEditorModal({
  poolId,
  item,
  visibleSecrets,
  onToggleSecret,
  onChange,
  onClose,
  onSave,
}) {
  if (!item) return null;
  const isAccount = poolId === "codex-accounts";

  function secretInput(secretId, label, value, updater) {
    const visible = Boolean(visibleSecrets[secretId]);
    return (
      <label className="field">
        <span className="field-label">{label}</span>
        <div className="secret-row">
          <input
            className="field-input"
            type={visible ? "text" : "password"}
            value={value || ""}
            onChange={(event) => updater(event.target.value)}
          />
          <button type="button" className="ghost small" onClick={() => onToggleSecret(secretId)}>
            {visible ? "隐藏" : "显示"}
          </button>
        </div>
      </label>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="card-header">
          <div>
            <h3>{isAccount ? "编辑账号" : "编辑节点"}</h3>
            <p>{isAccount ? "修改 Codex 账号池条目。" : "修改 API 池条目。"}</p>
          </div>
          <button type="button" className="ghost small" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="field-grid">
          {isAccount ? (
            <>
              <label className="field">
                <span className="field-label">展示名</span>
                <input className="field-input" value={item.name || ""} onChange={(e) => onChange("name", e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">邮箱</span>
                <input className="field-input" value={item.email || ""} onChange={(e) => onChange("email", e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">类型</span>
                <input className="field-input" value={item.type || "codex"} onChange={(e) => onChange("type", e.target.value)} />
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={item.disabled === true} onChange={(e) => onChange("disabled", e.target.checked)} />
                <span>禁用</span>
              </label>
              <label className="field">
                <span className="field-label">last_refresh</span>
                <input
                  className="field-input"
                  value={item.last_refresh || ""}
                  onChange={(e) => onChange("last_refresh", e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">expired</span>
                <input className="field-input" value={item.expired || ""} onChange={(e) => onChange("expired", e.target.value)} />
              </label>
              {secretInput("access_token", "access_token", item.tokens?.access_token, (value) =>
                onChange("tokens.access_token", value),
              )}
              <label className="field">
                <span className="field-label">account_id</span>
                <input
                  className="field-input"
                  value={item.tokens?.account_id || ""}
                  onChange={(e) => onChange("tokens.account_id", e.target.value)}
                />
              </label>
              {secretInput("id_token", "id_token", item.tokens?.id_token, (value) =>
                onChange("tokens.id_token", value),
              )}
              {secretInput("refresh_token", "refresh_token", item.tokens?.refresh_token, (value) =>
                onChange("tokens.refresh_token", value),
              )}
            </>
          ) : (
            <>
              <label className="field">
                <span className="field-label">名称</span>
                <input className="field-input" value={item.name || ""} onChange={(e) => onChange("name", e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">类型</span>
                <input className="field-input" value={item.type || ""} onChange={(e) => onChange("type", e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Base URL</span>
                <input className="field-input" value={item.baseUrl || ""} onChange={(e) => onChange("baseUrl", e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">模型</span>
                <input className="field-input" value={item.model || ""} onChange={(e) => onChange("model", e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">probePath</span>
                <input className="field-input" value={item.probePath || ""} onChange={(e) => onChange("probePath", e.target.value)} />
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={item.disabled === true} onChange={(e) => onChange("disabled", e.target.checked)} />
                <span>禁用</span>
              </label>
              {secretInput("apiKey", "apiKey", item.apiKey, (value) => onChange("apiKey", value))}
            </>
          )}
        </div>

        <div className="action-row">
          <button type="button" className="primary" onClick={onSave}>
            应用到列表
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

function PoolManageView({
  pools,
  activePoolCategory,
  activePoolId,
  setActivePoolCategory,
  setActivePoolId,
  onReload,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onSavePool,
  saveBusy,
  poolError,
  validationErrors,
}) {
  const activePool = pools[activePoolId] || null;
  const activeItems = activePool?.items || [];
  const activeMeta = activePool?.pool || null;
  const categoryPools = Object.values(pools)
    .filter((item) => item.pool?.category === activePoolCategory)
    .sort((left, right) => left.pool.label.localeCompare(right.pool.label, "zh-CN"));

  return (
    <main className="tab-layout">
      <section className="card card-description">
        <div className="card-header">
          <div>
            <h2>池管理</h2>
            <p>统一维护账号池和 API 池的 `pool.json`，支持新增、编辑、删除和保存。</p>
          </div>
          <span className="risk risk-medium">风险：medium</span>
        </div>
        <ul className="risk-list">
          <li>保存会直接改写对应的 `pool.json`，并自动生成备份。</li>
          <li>运行中的代理不会自动热重载，保存后通常需要手动刷新或重启对应代理。</li>
        </ul>

        <div className="status-strip">
          {POOL_CATEGORY_ORDER.map((category) => (
            <button
              key={category.id}
              type="button"
              className={activePoolCategory === category.id ? "tab active" : "tab"}
              onClick={() => setActivePoolCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>

        <div className="status-strip">
          {categoryPools.map((poolData) => (
            <button
              key={poolData.pool.id}
              type="button"
              className={activePoolId === poolData.pool.id ? "tab active" : "tab"}
              onClick={() => setActivePoolId(poolData.pool.id)}
            >
              {poolData.pool.label}
            </button>
          ))}
        </div>

        {activeMeta ? (
          <div className="proxy-summary-grid">
            <div className="summary-tile">
              <span>当前池</span>
              <strong>{activeMeta.label}</strong>
            </div>
            <div className="summary-tile">
              <span>文件路径</span>
              <strong>{activeMeta.filePath}</strong>
            </div>
            <div className="summary-tile">
              <span>条目总数</span>
              <strong>{activeItems.length}</strong>
            </div>
            <div className="summary-tile">
              <span>最近保存</span>
              <strong>{formatTime(activePool.savedAt)}</strong>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card card-description">
        <div className="card-header">
          <div>
            <h3>条目列表</h3>
            <p>先在本地列表修改，确认后再保存到 `pool.json`。</p>
          </div>
        </div>

        <div className="action-row">
          <button type="button" className="primary" onClick={() => onAddItem(activePoolId)}>
            新增条目
          </button>
          <button type="button" className="ghost" onClick={() => onReload(activePoolId)}>
            重新加载
          </button>
          <button type="button" className="ghost" onClick={() => onSavePool(activePoolId)} disabled={saveBusy}>
            {saveBusy ? "保存中..." : "保存到 pool.json"}
          </button>
        </div>

        {poolError ? <div className="error-banner">{poolError}</div> : null}
        {validationErrors.length ? (
          <div className="error-banner">
            {validationErrors.map((item) => `${item.path}: ${item.message}`).join(" | ")}
          </div>
        ) : null}

        {!activeItems.length ? (
          <div className="empty-state">当前池还没有条目。</div>
        ) : (
          <div className="table-shell">
            <table className="pool-table">
              <thead>
                <tr>
                  {activePoolId === "codex-accounts" ? (
                    <>
                      <th>展示名</th>
                      <th>邮箱</th>
                      <th>Account ID</th>
                      <th>Access Token</th>
                      <th>状态</th>
                      <th>操作</th>
                    </>
                  ) : (
                    <>
                      <th>名称</th>
                      <th>Base URL</th>
                      <th>模型</th>
                      <th>API Key</th>
                      <th>状态</th>
                      <th>操作</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {activeItems.map((item, index) => {
                  const isAccount = activePoolId === "codex-accounts";
                  const accountId = item.tokens?.account_id || item.account_id || "-";
                  return (
                    <tr key={`${activePoolId}-${index}`}>
                      {isAccount ? (
                        <>
                          <td>{item.name || "-"}</td>
                          <td>{item.email || "-"}</td>
                          <td>{accountId}</td>
                          <td>{item.tokens?.access_token ? maskValue(item.tokens.access_token) : "(未配置)"}</td>
                          <td>
                            <span className={item.disabled ? "badge" : "badge badge-ok"}>
                              {item.disabled ? "disabled" : "enabled"}
                            </span>
                          </td>
                          <td>
                            <div className="table-actions">
                              <button type="button" className="ghost small" onClick={() => onEditItem(activePoolId, index)}>
                                编辑
                              </button>
                              <button type="button" className="ghost small" onClick={() => onDeleteItem(activePoolId, index)}>
                                删除
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{item.name || "-"}</td>
                          <td>{item.baseUrl || "-"}</td>
                          <td>{item.model || "-"}</td>
                          <td>{item.apiKey ? maskValue(item.apiKey) : "(未配置)"}</td>
                          <td>
                            <span className={item.disabled ? "badge" : "badge badge-ok"}>
                              {item.disabled ? "disabled" : "enabled"}
                            </span>
                          </td>
                          <td>
                            <div className="table-actions">
                              <button type="button" className="ghost small" onClick={() => onEditItem(activePoolId, index)}>
                                编辑
                              </button>
                              <button type="button" className="ghost small" onClick={() => onDeleteItem(activePoolId, index)}>
                                删除
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default function App() {
  const [tools, setTools] = useState([]);
  const [activeTab, setActiveTab] = useState("pool.manage");
  const [forms, setForms] = useState({});
  const [history, setHistory] = useState([]);
  const [runState, setRunState] = useState({});
  const [proxyState, setProxyState] = useState({ running: false, recentLogs: [] });
  const [activeApiPoolSubTab, setActiveApiPoolSubTab] = useState("codex");
  const [apiPoolStateCodex, setApiPoolStateCodex] = useState({ running: false, recentLogs: [] });
  const [apiPoolStateClaude, setApiPoolStateClaude] = useState({ running: false, recentLogs: [] });
  const [pools, setPools] = useState({});
  const [activePoolCategory, setActivePoolCategory] = useState("accounts");
  const [activePoolId, setActivePoolId] = useState("codex-accounts");
  const [editingPool, setEditingPool] = useState(null);
  const [editingDraft, setEditingDraft] = useState(null);
  const [visibleSecrets, setVisibleSecrets] = useState({});
  const [poolValidationErrors, setPoolValidationErrors] = useState([]);
  const [poolSaveBusy, setPoolSaveBusy] = useState(false);
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});

  async function loadPool(poolId) {
    const response = await fetch(`/api/pools/${poolId}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "加载池失败");
    }
    setPools((current) => ({ ...current, [poolId]: payload }));
    return payload;
  }

  async function loadAllPools() {
    const response = await fetch("/api/pools");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "加载池清单失败");
    const poolItems = payload.items || [];
    const loaded = await Promise.all(poolItems.map((item) => fetch(`/api/pools/${item.id}`).then((res) => res.json())));
    const nextPools = {};
    for (const item of loaded) {
      nextPools[item.pool.id] = item;
    }
    setPools(nextPools);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      const [toolsRes, historyRes, proxyRes, apiPoolCodexRes, apiPoolClaudeRes, poolsRes] =
        await Promise.all([
          fetch("/api/tools"),
          fetch("/api/history"),
          fetch("/api/proxy/status"),
          fetch("/api/api-pool/codex/status"),
          fetch("/api/api-pool/claude-code/status"),
          fetch("/api/pools"),
        ]);

      const toolsData = await toolsRes.json();
      const historyData = await historyRes.json();
      const proxyData = await proxyRes.json();
      const apiPoolCodexData = await apiPoolCodexRes.json();
      const apiPoolClaudeData = await apiPoolClaudeRes.json();
      const poolsData = await poolsRes.json();
      const poolDetails = await Promise.all(
        (poolsData.items || []).map((item) => fetch(`/api/pools/${item.id}`).then((res) => res.json())),
      );

      if (cancelled) return;

      const sortedTools = [...toolsData.tools].sort(
        (left, right) => TOOL_ORDER.indexOf(left.id) - TOOL_ORDER.indexOf(right.id),
      );
      const baseForms = collectDefaults(sortedTools);
      if (baseForms["api-pool.start"]) {
        baseForms["api-pool.start"] = {
          ...baseForms["api-pool.start"],
          provider: "codex",
          port: 8790,
          poolDir: "api_pool/codex",
        };
      }
      const nextPools = {};
      for (const item of poolDetails) {
        nextPools[item.pool.id] = item;
      }

      setTools(sortedTools);
      setForms(baseForms);
      setHistory(historyData.items || []);
      setProxyState(proxyData);
      setApiPoolStateCodex(apiPoolCodexData);
      setApiPoolStateClaude(apiPoolClaudeData);
      setPools(nextPools);
    }

    loadInitialData().catch((error) => {
      if (!cancelled) setErrors((current) => ({ ...current, global: error.message }));
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

      const [proxyRes, apiPoolCodexRes, apiPoolClaudeRes] = await Promise.all([
        fetch("/api/proxy/status"),
        fetch("/api/api-pool/codex/status"),
        fetch("/api/api-pool/claude-code/status"),
      ]);
      setProxyState(await proxyRes.json());
      setApiPoolStateCodex(await apiPoolCodexRes.json());
      setApiPoolStateClaude(await apiPoolClaudeRes.json());
    }, 1500);

    return () => clearInterval(timer);
  }, [runState]);

  const activeTool = tools.find((tool) => tool.id === activeTab);
  const activeForm = forms[activeTab] || {};
  const activeRun = runState[activeTab] || { logs: [] };
  const currentApiPoolState =
    activeApiPoolSubTab === "claude-code" ? apiPoolStateClaude : apiPoolStateCodex;
  const apiPoolEndpoints = summarizeApiPoolEndpoints(currentApiPoolState);
  const activeApiPoolEndpoint = currentApiPoolState?.proxyStatus?.body?.active || null;
  const proxyAccounts = summarizeProxyAccounts(proxyState);
  const activeProxyAccount = proxyState?.proxyStatus?.body?.active || null;

  const activeHistory = history
    .filter((item) => {
      if (activeTab === "pool.manage") return false;
      if (activeTab === "api-pool.start") {
        return (
          item.toolId === "api-pool.start" &&
          String(item.paramsSummary || "").includes(`provider=${activeApiPoolSubTab}`)
        );
      }
      return item.toolId === activeTab;
    })
    .slice(0, 5);

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
    setBusy((current) => ({ ...current, [tool.id]: true }));
    setErrors((current) => ({ ...current, [tool.id]: "" }));
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolId: tool.id,
          params: forms[tool.id] || {},
          confirmed: false,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "运行失败");
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params: forms["proxy.start"] || {} }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "启动代理失败");
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
      if (!response.ok) throw new Error(payload.error || "停止代理失败");
      setProxyState(payload.status);
      await refreshHistory();
    } catch (error) {
      setErrors((current) => ({ ...current, "proxy.start": error.message }));
    } finally {
      setBusy((current) => ({ ...current, "proxy.start": false }));
    }
  }

  async function startApiPoolProxy(provider) {
    setBusy((current) => ({ ...current, "api-pool.start": true }));
    setErrors((current) => ({ ...current, "api-pool.start": "" }));
    try {
      const params = {
        ...(forms["api-pool.start"] || {}),
        provider,
        port: provider === "claude-code" ? 8789 : 8790,
        poolDir: provider === "claude-code" ? "api_pool/claude-code" : "api_pool/codex",
      };
      const response = await fetch("/api/api-pool/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "启动 API 池代理失败");
      if (provider === "claude-code") setApiPoolStateClaude(payload.status);
      else setApiPoolStateCodex(payload.status);
      await refreshHistory();
    } catch (error) {
      setErrors((current) => ({ ...current, "api-pool.start": error.message }));
    } finally {
      setBusy((current) => ({ ...current, "api-pool.start": false }));
    }
  }

  async function stopApiPoolProxy(provider) {
    setBusy((current) => ({ ...current, "api-pool.start": true }));
    try {
      const response = await fetch("/api/api-pool/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params: { provider } }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "停止 API 池代理失败");
      if (provider === "claude-code") setApiPoolStateClaude(payload.status);
      else setApiPoolStateCodex(payload.status);
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
      if (activeApiPoolSubTab === "claude-code") {
        setApiPoolStateClaude((current) => ({ ...current, recentLogs: [] }));
      } else {
        setApiPoolStateCodex((current) => ({ ...current, recentLogs: [] }));
      }
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

  function switchApiPoolSubTab(nextTab) {
    setActiveApiPoolSubTab(nextTab);
    setForms((current) => ({
      ...current,
      "api-pool.start": {
        ...(current["api-pool.start"] || {}),
        provider: nextTab,
        port: nextTab === "claude-code" ? 8789 : 8790,
        poolDir: nextTab === "claude-code" ? "api_pool/claude-code" : "api_pool/codex",
      },
    }));
  }

  function mutateActivePool(updater) {
    setPools((current) => {
      const target = current[activePoolId];
      if (!target) return current;
      return {
        ...current,
        [activePoolId]: {
          ...target,
          items: updater(target.items || []),
        },
      };
    });
  }

  function openEditor(poolId, index = null) {
    const poolData = pools[poolId];
    const item = index == null ? makeNewPoolItem(poolId) : copyPoolItem(poolData.items[index]);
    setEditingPool({ poolId, index });
    setEditingDraft(item);
    setVisibleSecrets({});
  }

  function updateDraft(pathName, value) {
    setEditingDraft((current) => {
      const next = copyPoolItem(current);
      if (pathName.startsWith("tokens.")) {
        next.tokens = { ...(next.tokens || {}) };
        next.tokens[pathName.split(".")[1]] = value;
        return next;
      }
      next[pathName] = value;
      return next;
    });
  }

  function applyDraft() {
    if (!editingPool || !editingDraft) return;
    const { poolId, index } = editingPool;
    setPools((current) => {
      const target = current[poolId];
      const items = [...(target?.items || [])];
      if (index == null) items.push(copyPoolItem(editingDraft));
      else items[index] = copyPoolItem(editingDraft);
      return {
        ...current,
        [poolId]: {
          ...target,
          items,
        },
      };
    });
    setEditingPool(null);
    setEditingDraft(null);
    setVisibleSecrets({});
  }

  function deletePoolItem(poolId, index) {
    if (!window.confirm("确认删除这个条目吗？")) return;
    setPools((current) => {
      const target = current[poolId];
      const items = [...(target?.items || [])];
      items.splice(index, 1);
      return {
        ...current,
        [poolId]: {
          ...target,
          items,
        },
      };
    });
  }

  async function savePool(poolId) {
    setPoolSaveBusy(true);
    setPoolValidationErrors([]);
    setErrors((current) => ({ ...current, poolManage: "" }));
    try {
      const items = pools[poolId]?.items || [];
      const validationRes = await fetch(`/api/pools/${poolId}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const validation = await validationRes.json();
      if (!validationRes.ok) {
        setPoolValidationErrors(validation.errors || []);
        throw new Error("校验未通过，请先修正条目。");
      }

      const saveRes = await fetch(`/api/pools/${poolId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok) throw new Error(saved.error || "保存失败");
      setPools((current) => ({ ...current, [poolId]: saved }));
    } catch (error) {
      setErrors((current) => ({ ...current, poolManage: error.message }));
    } finally {
      setPoolSaveBusy(false);
    }
  }

  const activePoolError = errors.poolManage || "";
  const poolTool = activeTool;

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local Ops Console</p>
          <h1>本地脚本管理台</h1>
          <p className="hero-copy">统一管理池文件、代理和探测，减少反复手敲命令。</p>
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

      {activeTab === "pool.manage" ? (
        <PoolManageView
          pools={pools}
          activePoolCategory={activePoolCategory}
          activePoolId={activePoolId}
          setActivePoolCategory={(nextCategory) => {
            setActivePoolCategory(nextCategory);
            setActivePoolId(nextCategory === "accounts" ? "codex-accounts" : "codex-api");
          }}
          setActivePoolId={setActivePoolId}
          onReload={loadPool}
          onAddItem={openEditor}
          onEditItem={openEditor}
          onDeleteItem={deletePoolItem}
          onSavePool={savePool}
          saveBusy={poolSaveBusy}
          poolError={activePoolError}
          validationErrors={poolValidationErrors}
        />
      ) : poolTool ? (
        <main className="tab-layout">
          <section className="card card-description">
            <div className="card-header">
              <div>
                <h2>{poolTool.tabTitle}</h2>
                <p>{poolTool.description}</p>
              </div>
              <span className={`risk risk-${poolTool.dangerLevel}`}>风险：{poolTool.dangerLevel}</span>
            </div>
            <ul className="risk-list">
              {poolTool.riskNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <div className="preview-box">
              <span className="preview-label">命令预览</span>
              <code>{buildPreview(poolTool, activeForm)}</code>
            </div>

            {poolTool.id === "proxy.start" ? (
              <>
                <div className="proxy-summary-grid">
                  <div className="summary-tile"><span>运行状态</span><strong>{proxyState.running ? "运行中" : "未运行"}</strong></div>
                  <div className="summary-tile"><span>PID</span><strong>{proxyState.pid || "-"}</strong></div>
                  <div className="summary-tile"><span>代理地址</span><strong>{proxyState.endpoint || "-"}</strong></div>
                  <div className="summary-tile"><span>启动时间</span><strong>{formatTime(proxyState.startedAt)}</strong></div>
                  <div className="summary-tile"><span>账号总数</span><strong>{proxyAccounts.total}</strong></div>
                  <div className="summary-tile"><span>健康账号</span><strong>{proxyAccounts.healthy}</strong></div>
                  <div className="summary-tile"><span>冷却中账号</span><strong>{proxyAccounts.cooling}</strong></div>
                  <div className="summary-tile"><span>池文件</span><strong>{pools["codex-accounts"]?.pool?.filePath || "-"}</strong></div>
                </div>

                <div className="proxy-account-card">
                  <div className="proxy-account-heading">
                    <h3>当前活跃账号</h3>
                    <span className={activeProxyAccount?.healthy ? "badge badge-ok" : "badge"}>
                      {activeProxyAccount?.healthy ? "healthy" : "unknown"}
                    </span>
                  </div>
                  <div className="proxy-account-grid">
                    <div><span>账号文件</span><strong>{activeProxyAccount?.id || "-"}</strong></div>
                    <div><span>Account ID</span><strong>{activeProxyAccount?.accountId || "-"}</strong></div>
                    <div><span>最近验证时间</span><strong>{formatTime(activeProxyAccount?.lastValidation)}</strong></div>
                    <div><span>最近失败原因</span><strong>{activeProxyAccount?.lastFailureReason || "-"}</strong></div>
                  </div>
                </div>
              </>
            ) : null}

            {poolTool.id === "api-pool.start" ? (
              <>
                <div className="proxy-summary-grid">
                  <div className="summary-tile"><span>当前池</span><strong>{activeApiPoolSubTab === "claude-code" ? "Claude Code API 池" : "Codex API 池"}</strong></div>
                  <div className="summary-tile"><span>运行状态</span><strong>{currentApiPoolState.running ? "运行中" : "未运行"}</strong></div>
                  <div className="summary-tile"><span>PID</span><strong>{currentApiPoolState.pid || "-"}</strong></div>
                  <div className="summary-tile"><span>代理地址</span><strong>{currentApiPoolState.endpoint || "-"}</strong></div>
                  <div className="summary-tile"><span>启动时间</span><strong>{formatTime(currentApiPoolState.startedAt)}</strong></div>
                  <div className="summary-tile"><span>节点总数</span><strong>{apiPoolEndpoints.total}</strong></div>
                  <div className="summary-tile"><span>健康节点</span><strong>{apiPoolEndpoints.healthy}</strong></div>
                  <div className="summary-tile"><span>池文件</span><strong>{pools[activeApiPoolSubTab === "claude-code" ? "claude-code-api" : "codex-api"]?.pool?.filePath || "-"}</strong></div>
                </div>

                <div className="proxy-account-card">
                  <div className="proxy-account-heading">
                    <h3>当前活跃节点</h3>
                    <span className={activeApiPoolEndpoint?.healthy ? "badge badge-ok" : "badge"}>
                      {activeApiPoolEndpoint?.healthy ? "healthy" : "unknown"}
                    </span>
                  </div>
                  <div className="proxy-account-grid">
                    <div><span>节点名</span><strong>{activeApiPoolEndpoint?.name || activeApiPoolEndpoint?.id || "-"}</strong></div>
                    <div><span>Provider</span><strong>{activeApiPoolEndpoint?.type || "-"}</strong></div>
                    <div><span>Base URL</span><strong>{activeApiPoolEndpoint?.baseUrl || "-"}</strong></div>
                    <div><span>最近验证时间</span><strong>{formatTime(activeApiPoolEndpoint?.lastValidation)}</strong></div>
                    <div><span>最近失败原因</span><strong>{activeApiPoolEndpoint?.lastFailureReason || "-"}</strong></div>
                    <div><span>模型</span><strong>{activeApiPoolEndpoint?.model || "-"}</strong></div>
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
              {poolTool.id === "api-pool.start" ? (
                <div className="status-strip">
                  {API_POOL_SUBTABS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={activeApiPoolSubTab === item.id ? "tab active" : "tab"}
                      onClick={() => switchApiPoolSubTab(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="field-grid">
              {poolTool.argsSchema.map((field) => (
                <FieldEditor
                  key={field.name}
                  field={field}
                  value={activeForm[field.name]}
                  onChange={(value) => updateField(poolTool.id, field.name, value)}
                />
              ))}
            </div>

            <div className="action-row">
              {poolTool.id === "proxy.start" ? (
                <>
                  <button type="button" className="primary" onClick={startProxy} disabled={busy["proxy.start"]}>
                    {proxyState.running ? "刷新代理状态" : "启动代理"}
                  </button>
                  <button type="button" className="ghost" onClick={stopProxy} disabled={!proxyState.running || busy["proxy.start"]}>
                    停止代理
                  </button>
                </>
              ) : poolTool.id === "api-pool.start" ? (
                <>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => startApiPoolProxy(activeApiPoolSubTab)}
                    disabled={busy["api-pool.start"]}
                  >
                    {currentApiPoolState.running ? "刷新当前池状态" : "启动当前 API 池"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => stopApiPoolProxy(activeApiPoolSubTab)}
                    disabled={!currentApiPoolState.running || busy["api-pool.start"]}
                  >
                    停止当前 API 池
                  </button>
                </>
              ) : (
                <button type="button" className="primary" onClick={() => runTool(poolTool)} disabled={busy[poolTool.id]}>
                  {busy[poolTool.id] ? "运行中..." : "运行脚本"}
                </button>
              )}
              <button type="button" className="ghost" onClick={() => clearLocalLog(poolTool.id)}>
                清空当前日志视图
              </button>
            </div>

            {errors[poolTool.id] ? <div className="error-banner">{errors[poolTool.id]}</div> : null}
          </section>

          <section className="card card-logs">
            <div className="card-header">
              <div>
                <h3>运行输出</h3>
                <p>
                  {poolTool.id === "proxy.start"
                    ? "查看代理最近日志和在线状态。"
                    : poolTool.id === "api-pool.start"
                      ? "查看 API 池代理最近日志和在线状态。"
                      : `状态：${formatStatus(activeRun.status)}`}
                </p>
              </div>
              {poolTool.id === "llm.probe" && activeRun.runId ? (
                <span className={`pill pill-${activeRun.status}`}>{formatStatus(activeRun.status)}</span>
              ) : null}
            </div>
            {poolTool.id === "proxy.start" ? (
              <>
                <div className="status-strip">
                  <span>healthz：{proxyState.health?.ok ? "ok" : proxyState.health?.error || proxyState.health?.status || "-"}</span>
                  <span>当前账号：{proxyState.proxyStatus?.body?.active?.id || proxyState.proxyStatus?.error || "-"}</span>
                  <span>账号池：{proxyAccounts.healthy}/{proxyAccounts.total} healthy</span>
                </div>
                <LogPanel logs={proxyState.recentLogs || []} />
              </>
            ) : poolTool.id === "api-pool.start" ? (
              <>
                <div className="status-strip">
                  <span>当前池：{activeApiPoolSubTab === "claude-code" ? "Claude Code API 池" : "Codex API 池"}</span>
                  <span>healthz：{currentApiPoolState.health?.ok ? "ok" : currentApiPoolState.health?.error || currentApiPoolState.health?.status || "-"}</span>
                  <span>当前节点：{currentApiPoolState.proxyStatus?.body?.active?.name || currentApiPoolState.proxyStatus?.error || "-"}</span>
                  <span>节点池：{apiPoolEndpoints.healthy}/{apiPoolEndpoints.total} healthy</span>
                </div>
                <LogPanel logs={currentApiPoolState.recentLogs || []} />
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

      <PoolEditorModal
        poolId={editingPool?.poolId}
        item={editingDraft}
        visibleSecrets={visibleSecrets}
        onToggleSecret={(secretId) =>
          setVisibleSecrets((current) => ({ ...current, [secretId]: !current[secretId] }))
        }
        onChange={updateDraft}
        onClose={() => {
          setEditingPool(null);
          setEditingDraft(null);
          setVisibleSecrets({});
        }}
        onSave={applyDraft}
      />
    </div>
  );
}

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Alert, Button, Form, InputNumber, Layout, Menu, Segmented, Select, Space, Spin, Switch, Tabs, Tag, Tooltip, Typography, message } from "antd";
import {
  ApiOutlined,
  AppstoreOutlined,
  BugOutlined,
  DatabaseOutlined,
  RadarChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";

import { PoolEditorDrawer, PoolImportModal, ProbeLogModal } from "./components/UiShared.jsx";
import {
  API_POOL_SUBTABS,
  TOOL_ORDER,
  buildPreview,
  collectDefaults,
  copyPoolItem,
  friendlyToolName,
  formatTime,
  inferScheduledSwitchPreset,
  makeNewPoolItem,
  presetValueToIntervalMs,
  SCHEDULED_SWITCH_PRESET_OPTIONS,
  summarizeApiPoolEndpoints,
  summarizeProxyAccounts,
} from "./view-helpers.js";

const PoolManagePage = lazy(() => import("./pages/PoolManagePage.jsx"));
const ProxyPage = lazy(() => import("./pages/ProxyPage.jsx"));
const ProbePage = lazy(() => import("./pages/ProbePage.jsx"));
const RemoteServicePage = lazy(() => import("./pages/RemoteServicePage.jsx"));

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

function iconForTool(toolId) {
  if (toolId === "pool.manage") return <DatabaseOutlined />;
  if (toolId === "api-pool.start") return <ApiOutlined />;
  if (toolId === "proxy.start") return <RadarChartOutlined />;
  if (toolId === "llm.probe") return <BugOutlined />;
  return <AppstoreOutlined />;
}

function contentFallback() {
  return (
    <div className="page-loading">
      <Spin size="large" />
    </div>
  );
}

function inferApiBase() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/admin")) {
    return "/admin/api";
  }
  return "/api";
}

function mergeSecretPreservingDraft(poolId, previous, next) {
  if (!previous) return copyPoolItem(next);

  if (poolId === "codex-accounts") {
    return {
      ...previous,
      ...next,
      OPENAI_API_KEY:
        next?.OPENAI_API_KEY || previous?.OPENAI_API_KEY || "",
      OPENAI_API_KEY_MASKED:
        previous?.OPENAI_API_KEY_MASKED || next?.OPENAI_API_KEY_MASKED || "",
      tokens: {
        ...(previous?.tokens || {}),
        ...(next?.tokens || {}),
        access_token:
          next?.tokens?.access_token || previous?.tokens?.access_token || "",
        id_token:
          next?.tokens?.id_token || previous?.tokens?.id_token || "",
        refresh_token:
          next?.tokens?.refresh_token || previous?.tokens?.refresh_token || "",
        access_token_masked:
          previous?.tokens?.access_token_masked || next?.tokens?.access_token_masked || "",
        id_token_masked:
          previous?.tokens?.id_token_masked || next?.tokens?.id_token_masked || "",
        refresh_token_masked:
          previous?.tokens?.refresh_token_masked || next?.tokens?.refresh_token_masked || "",
      },
    };
  }

  return {
    ...previous,
    ...next,
    apiKey: next?.apiKey || previous?.apiKey || "",
    apiKeyMasked: previous?.apiKeyMasked || next?.apiKeyMasked || "",
  };
}

export default function App() {
  const defaultApiBase = inferApiBase();
  const [messageApi, contextHolder] = message.useMessage();
  const [tools, setTools] = useState([]);
  const [activeTab, setActiveTab] = useState("pool.manage");
  const [appConfig, setAppConfig] = useState({
    mode: "local",
    apiBase: defaultApiBase,
    environment: "Local Node + React",
    user: null,
    readOnly: false,
    readOnlyReason: "",
  });
  const [forms, setForms] = useState({});
  const [history, setHistory] = useState([]);
  const [runState, setRunState] = useState({});
  const [proxyState, setProxyState] = useState({ running: false, recentLogs: [] });
  const [activeApiPoolSubTab, setActiveApiPoolSubTab] = useState("codex");
  const [apiPoolStateCodex, setApiPoolStateCodex] = useState({ running: false, recentLogs: [] });
  const [apiPoolStateClaude, setApiPoolStateClaude] = useState({ running: false, recentLogs: [] });
  const [apiPoolRemoteConfig, setApiPoolRemoteConfig] = useState({
    enableScheduledSwitch: true,
    scheduledSwitchIntervalMs: 900000,
    scheduledSwitchPreset: "custom",
  });
  const [pools, setPools] = useState({});
  const [activePoolCategory, setActivePoolCategory] = useState("accounts");
  const [activePoolId, setActivePoolId] = useState("codex-accounts");
  const [editingPool, setEditingPool] = useState(null);
  const [editingDraft, setEditingDraft] = useState(null);
  const [poolValidationErrors, setPoolValidationErrors] = useState([]);
  const [poolSaveBusy, setPoolSaveBusy] = useState(false);
  const [poolProbeModal, setPoolProbeModal] = useState({
    open: false,
    title: "",
    runId: null,
    status: "",
    logs: [],
    error: "",
  });
  const [poolImportModal, setPoolImportModal] = useState({
    open: false,
    poolId: "",
    text: "",
    busy: false,
    error: "",
  });
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});
  const [navCollapsed, setNavCollapsed] = useState(true);
  const apiBase = appConfig.apiBase || defaultApiBase;
  const isRemoteMode = appConfig.mode === "remote";

  function apiPath(relativePath) {
    return `${apiBase}${relativePath}`;
  }

  async function loadPool(poolId) {
    const response = await fetch(apiPath(`/pools/${poolId}`));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "加载池失败");
    setPools((current) => ({ ...current, [poolId]: payload }));
    return payload;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      const baseRequests = [
        fetch(`${defaultApiBase}/app-config`),
        fetch(`${defaultApiBase}/tools`),
        fetch(`${defaultApiBase}/history`),
        fetch(`${defaultApiBase}/proxy/status`),
        fetch(`${defaultApiBase}/api-pool/codex/status`),
        fetch(`${defaultApiBase}/api-pool/claude-code/status`),
        fetch(`${defaultApiBase}/pools`),
      ];
      const remoteConfigRequest = defaultApiBase.startsWith("/admin")
        ? fetch(`${defaultApiBase}/api-pool/config`)
        : Promise.resolve(null);
      const [configRes, toolsRes, historyRes, proxyRes, apiPoolCodexRes, apiPoolClaudeRes, poolsRes, apiPoolConfigRes] =
        await Promise.all([
          ...baseRequests,
          remoteConfigRequest,
        ]);

      const configData = await configRes.json();
      const toolsData = await toolsRes.json();
      const historyData = await historyRes.json();
      const proxyData = await proxyRes.json();
      const apiPoolCodexData = await apiPoolCodexRes.json();
      const apiPoolClaudeData = await apiPoolClaudeRes.json();
      const poolsData = await poolsRes.json();
      const apiPoolConfigData = apiPoolConfigRes ? await apiPoolConfigRes.json() : null;
      const poolDetails = await Promise.all(
        (poolsData.items || []).map((item) =>
          fetch(`${defaultApiBase}/pools/${item.id}`).then((res) => res.json()),
        ),
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
          scheduledSwitchPreset: inferScheduledSwitchPreset(
            baseForms["api-pool.start"].scheduledSwitchIntervalMs,
          ),
        };
      }
      const nextPools = {};
      for (const item of poolDetails) {
        nextPools[item.pool.id] = item;
      }

      setAppConfig((current) => ({
        ...current,
        ...configData,
        apiBase: configData.apiBase || defaultApiBase,
      }));
      setTools(sortedTools);
      setForms(baseForms);
      setHistory(historyData.items || []);
      setProxyState(proxyData);
      setApiPoolStateCodex(apiPoolCodexData);
      setApiPoolStateClaude(apiPoolClaudeData);
      if (apiPoolConfigData && !apiPoolConfigData.error) {
        setApiPoolRemoteConfig({
          ...apiPoolConfigData,
          scheduledSwitchPreset: inferScheduledSwitchPreset(
            apiPoolConfigData.scheduledSwitchIntervalMs,
          ),
        });
      }
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
      if (isRemoteMode) {
        const [proxyRes, apiPoolCodexRes, apiPoolClaudeRes] = await Promise.all([
          fetch(apiPath("/proxy/status")),
          fetch(apiPath("/api-pool/codex/status")),
          fetch(apiPath("/api-pool/claude-code/status")),
        ]);
        setProxyState(await proxyRes.json());
        setApiPoolStateCodex(await apiPoolCodexRes.json());
        setApiPoolStateClaude(await apiPoolClaudeRes.json());
        return;
      }

      const activeRuns = Object.entries(runState).filter(([, value]) =>
        value?.runId && (value.status === "queued" || value.status === "running"),
      );

      for (const [toolId, item] of activeRuns) {
        const [runRes, logsRes] = await Promise.all([
          fetch(apiPath(`/runs/${item.runId}`)),
          fetch(apiPath(`/runs/${item.runId}/logs`)),
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
          const historyRes = await fetch(apiPath("/history"));
          const historyData = await historyRes.json();
          setHistory(historyData.items || []);
        }
      }

      const [proxyRes, apiPoolCodexRes, apiPoolClaudeRes] = await Promise.all([
        fetch(apiPath("/proxy/status")),
        fetch(apiPath("/api-pool/codex/status")),
        fetch(apiPath("/api-pool/claude-code/status")),
      ]);
      setProxyState(await proxyRes.json());
      setApiPoolStateCodex(await apiPoolCodexRes.json());
      setApiPoolStateClaude(await apiPoolClaudeRes.json());

      if (
        poolProbeModal.open &&
        poolProbeModal.runId &&
        (poolProbeModal.status === "queued" || poolProbeModal.status === "running")
      ) {
        const [runRes, logsRes] = await Promise.all([
          fetch(apiPath(`/runs/${poolProbeModal.runId}`)),
          fetch(apiPath(`/runs/${poolProbeModal.runId}/logs`)),
        ]);
        const runData = await runRes.json();
        const logsData = await logsRes.json();
        setPoolProbeModal((current) => ({
          ...current,
          status: runData.run.status,
          error: runData.run.error || "",
          logs: logsData.logs || [],
        }));
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [apiBase, isRemoteMode, runState, poolProbeModal.open, poolProbeModal.runId, poolProbeModal.status]);

  const activeTool = tools.find((tool) => tool.id === activeTab);
  const activeForm = forms[activeTab] || {};
  const activeRun = runState[activeTab] || { logs: [] };
  const currentApiPoolState =
    activeApiPoolSubTab === "claude-code" ? apiPoolStateClaude : apiPoolStateCodex;
  const apiPoolEndpoints = summarizeApiPoolEndpoints(currentApiPoolState);
  const activeApiPoolEndpoint = currentApiPoolState?.proxyStatus?.body?.active || null;
  const apiPoolSchedule = currentApiPoolState?.proxyStatus?.body || {};
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
    .slice(0, 8);

  const menuItems = useMemo(
    () =>
      tools.map((tool) => ({
        key: tool.id,
        icon: iconForTool(tool.id),
        label: tool.tabTitle,
      })),
    [tools],
  );

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
    const response = await fetch(apiPath("/history"));
    const data = await response.json();
    setHistory(data.items || []);
  }

  async function runTool(tool) {
    setBusy((current) => ({ ...current, [tool.id]: true }));
    setErrors((current) => ({ ...current, [tool.id]: "" }));
    try {
      const response = await fetch(apiPath("/runs"), {
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
      const response = await fetch(apiPath("/proxy/start"), {
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
      const response = await fetch(apiPath("/proxy/stop"), { method: "POST" });
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
      const response = await fetch(apiPath("/api-pool/start"), {
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
      const response = await fetch(apiPath("/api-pool/stop"), {
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

  async function loadPoolAndStore(poolId) {
    try {
      const payload = await loadPool(poolId);
      const poolLabel = payload?.pool?.label || pools[poolId]?.pool?.label || "当前池";
      messageApi.success(`${poolLabel} 已重新加载`);
    } catch (error) {
      setErrors((current) => ({ ...current, poolManage: error.message }));
    }
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

  function openEditor(poolId, index = null) {
    const poolData = pools[poolId];
    const item = index == null ? makeNewPoolItem(poolId) : copyPoolItem(poolData.items[index]);
    setEditingPool({ poolId, index });
    setEditingDraft(item);
  }

  function applyDraft(values) {
    if (!editingPool) return;
    const { poolId, index } = editingPool;
    setPools((current) => {
      const target = current[poolId];
      const items = [...(target?.items || [])];
      if (index == null) {
        items.push(copyPoolItem(values));
      } else {
        const previous = items[index];
        items[index] = mergeSecretPreservingDraft(poolId, previous, values);
      }
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
  }

  function deletePoolItem(poolId, index) {
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

  async function probePoolItem(poolId, index) {
    const item = pools[poolId]?.items?.[index];
    if (!item?.baseUrl || !item?.apiKey) {
      setPoolProbeModal({
        open: true,
        title: "LLM 探测日志",
        runId: null,
        status: "failed",
        logs: [],
        error: "该条目缺少 baseUrl 或 apiKey，无法探测。",
      });
      return;
    }

    try {
      const response = await fetch(apiPath("/runs"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolId: "llm.probe",
          params: {
            baseUrl: item.baseUrl,
            key: item.apiKey,
            skipAnthropic: false,
            skipOpenAI: false,
            skipPublic: false,
          },
          confirmed: false,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "启动 LLM 探测失败");
      }

      setPoolProbeModal({
        open: true,
        title: `${item.name || item.baseUrl} · LLM 探测日志`,
        runId: payload.runId,
        status: payload.status,
        logs: [],
        error: "",
      });
    } catch (error) {
      setPoolProbeModal({
        open: true,
        title: `${item.name || item.baseUrl} · LLM 探测日志`,
        runId: null,
        status: "failed",
        logs: [],
        error: error.message,
      });
    }
  }

  async function savePool(poolId) {
    setPoolSaveBusy(true);
    setPoolValidationErrors([]);
    setErrors((current) => ({ ...current, poolManage: "" }));
    try {
      const items = pools[poolId]?.items || [];
      const validationRes = await fetch(apiPath(`/pools/${poolId}/validate`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const validation = await validationRes.json();
      if (!validationRes.ok) {
        setPoolValidationErrors(validation.errors || []);
        throw new Error("校验未通过，请先修正条目。");
      }

      const saveRes = await fetch(apiPath(`/pools/${poolId}`), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok) throw new Error(saved.error || "保存失败");
      setPools((current) => ({ ...current, [poolId]: saved }));
      const poolLabel = saved?.pool?.label || pools[poolId]?.pool?.label || "当前池";
      messageApi.success(`${poolLabel} 已保存`);
    } catch (error) {
      setErrors((current) => ({ ...current, poolManage: error.message }));
    } finally {
      setPoolSaveBusy(false);
    }
  }

  function openImportPool(poolId) {
    setPoolImportModal({
      open: true,
      poolId,
      text: "",
      busy: false,
      error: "",
    });
  }

  async function importPool() {
    if (!poolImportModal.poolId) return;
    setPoolImportModal((current) => ({ ...current, busy: true, error: "" }));
    try {
      const parsed = JSON.parse(poolImportModal.text || "[]");
      if (!Array.isArray(parsed)) {
        throw new Error("导入内容必须是 JSON 数组。");
      }
      const response = await fetch(apiPath(`/pools/${poolImportModal.poolId}/import`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: parsed }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "导入失败");
      setPools((current) => ({ ...current, [poolImportModal.poolId]: payload }));
      setPoolImportModal({
        open: false,
        poolId: "",
        text: "",
        busy: false,
        error: "",
      });
    } catch (error) {
      setPoolImportModal((current) => ({ ...current, busy: false, error: error.message }));
    }
  }

  async function reloadRemoteServices() {
    const busyKey = activeTab === "api-pool.start" ? "api-pool.start" : "proxy.start";
    setBusy((current) => ({ ...current, [busyKey]: true }));
    setErrors((current) => ({ ...current, [busyKey]: "" }));
    try {
      const response = await fetch(apiPath("/reload"), {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "reload 失败");
      if (payload.results?.["codex-account"]) {
        setProxyState(payload.results["codex-account"]);
      }
      if (payload.results?.["codex-api"]) {
        setApiPoolStateCodex(payload.results["codex-api"]);
      }
      if (payload.results?.["claude-api"]) {
        setApiPoolStateClaude(payload.results["claude-api"]);
      }
    } catch (error) {
      setErrors((current) => ({ ...current, [busyKey]: error.message }));
    } finally {
      setBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function saveRemoteApiPoolConfig() {
    setBusy((current) => ({ ...current, "api-pool.start": true }));
    setErrors((current) => ({ ...current, "api-pool.start": "" }));
    try {
      const { scheduledSwitchPreset, ...configToSave } = apiPoolRemoteConfig;
      const response = await fetch(apiPath("/api-pool/config"), {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...configToSave,
          provider: activeApiPoolSubTab,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存远端 API 池配置失败");
      setApiPoolRemoteConfig((current) => ({
        ...current,
        ...(payload.config || configToSave),
        scheduledSwitchPreset: inferScheduledSwitchPreset(
          (payload.config || configToSave).scheduledSwitchIntervalMs,
        ),
      }));
      if (activeApiPoolSubTab === "claude-code") setApiPoolStateClaude(payload.status);
      else setApiPoolStateCodex(payload.status);
    } catch (error) {
      setErrors((current) => ({ ...current, "api-pool.start": error.message }));
    } finally {
      setBusy((current) => ({ ...current, "api-pool.start": false }));
    }
  }

  const activePoolError = errors.poolManage || "";
  const poolTool = activeTool;

  const proxySummaryItems = [
    { title: "运行状态", value: proxyState.running ? "运行中" : "未运行" },
    { title: "监听地址", value: proxyState.endpoint || "-" },
    { title: "账号总数", value: proxyAccounts.total },
    { title: "健康账号", value: proxyAccounts.healthy },
  ];

  const apiSummaryItems = [
    { title: "运行状态", value: currentApiPoolState.running ? "运行中" : "未运行" },
    { title: "监听地址", value: currentApiPoolState.endpoint || "-" },
    { title: "节点总数", value: apiPoolEndpoints.total },
    { title: "健康节点", value: apiPoolEndpoints.healthy },
    { title: "在途请求", value: apiPoolSchedule.inflightRequests ?? 0 },
    {
      title: "定时切换",
      value: apiPoolSchedule.scheduledSwitchEnabled === false ? "关闭" : "开启",
    },
    {
      title: "下次切换",
      value: formatTime(apiPoolSchedule.nextScheduledSwitchAt),
      plain: true,
      singleLine: true,
    },
    {
      title: "最近切换",
      value: formatTime(apiPoolSchedule.lastScheduledSwitchAt),
      plain: true,
      singleLine: true,
    },
  ];

  return (
    <Layout className="dashboard-layout">
      {contextHolder}
      <Sider
        width={280}
        collapsedWidth={88}
        collapsible
        trigger={null}
        collapsed={navCollapsed}
        className="dashboard-sider"
      >
        <div className="brand-panel">
          <div className="brand-mark">AI</div>
          <div className={navCollapsed ? "brand-copy brand-copy-hidden" : "brand-copy"}>
            <Title level={3} style={{ margin: 0 }}>AI 控制台</Title>
            <Text type="secondary">Local Ops Console</Text>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activeTab]}
          items={menuItems}
          onClick={({ key }) => setActiveTab(key)}
          className="dashboard-menu"
        />
        <div className="sider-footer">
          <Tooltip title={navCollapsed ? "展开导航" : "收起导航"} placement="right">
            <Button
              type="text"
              className={navCollapsed ? "nav-toggle nav-toggle-sider nav-toggle-collapsed" : "nav-toggle nav-toggle-sider"}
              icon={navCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setNavCollapsed((current) => !current)}
            >
              {navCollapsed ? null : "收起导航"}
            </Button>
          </Tooltip>
        </div>
      </Sider>

      <Layout>
        <Header className="dashboard-header">
          <div className="dashboard-header-main">
            <div className="header-title-center">
              <Title level={3} style={{ margin: 10 }}>{friendlyToolName(activeTab)}</Title>
              <Text type="secondary">
                {isRemoteMode ? "统一管理远端加密池和常驻代理" : "统一管理池文件、代理和探测"}
              </Text>
            </div>
          </div>
          <Space size={16}>
            <Tag color="cyan">{appConfig.environment || "Local Node + React"}</Tag>
            {isRemoteMode ? (
              <Tag color="gold">管理员 {appConfig.user?.displayName || appConfig.user?.username || "-"}</Tag>
            ) : (
              <Tag color="geekblue">最近 {history.length} 条记录</Tag>
            )}
          </Space>
        </Header>

        <Content className="dashboard-content">
          {errors.global ? <Alert type="error" showIcon message={errors.global} style={{ marginBottom: 20 }} /> : null}
          {!poolTool ? (
            contentFallback()
          ) : (
            <Suspense fallback={contentFallback()}>
              {activeTab === "pool.manage" ? (
                <PoolManagePage
                  pools={pools}
                  activePoolCategory={activePoolCategory}
                  activePoolId={activePoolId}
                  setActivePoolCategory={(nextCategory) => {
                    setActivePoolCategory(nextCategory);
                    setActivePoolId(nextCategory === "accounts" ? "codex-accounts" : "codex-api");
                  }}
                  setActivePoolId={setActivePoolId}
                  onReload={loadPoolAndStore}
                  onAddItem={openEditor}
                  onEditItem={openEditor}
                  onDeleteItem={deletePoolItem}
                  onProbeItem={probePoolItem}
                  onSavePool={savePool}
                  onImportPool={isRemoteMode ? openImportPool : null}
                  saveBusy={poolSaveBusy}
                  poolError={activePoolError}
                  validationErrors={poolValidationErrors}
                  readOnly={Boolean(appConfig.readOnly)}
                  readOnlyReason={appConfig.readOnlyReason}
                  remoteMode={isRemoteMode}
                  importBusy={poolImportModal.busy}
                  allowProbe={!isRemoteMode}
                />
              ) : isRemoteMode && activeTab === "proxy.start" ? (
                <RemoteServicePage
                  title={poolTool.tabTitle}
                  description={poolTool.description}
                  onReload={reloadRemoteServices}
                  reloadBusy={busy["proxy.start"]}
                  error={errors["proxy.start"] || proxyState.lastError}
                  summaryItems={proxySummaryItems}
                  activeInfo={{
                    "公开路径": proxyState.endpoint || "/proxy/codex-account",
                    "鉴权 Key": proxyState.authEnvName || "CODEX_ACCOUNT_PROXY_KEY",
                    "当前账号": activeProxyAccount?.email || activeProxyAccount?.id || "-",
                    "Account ID": activeProxyAccount?.accountId || "-",
                    "最近验证时间": formatTime(activeProxyAccount?.lastValidation),
                    "最近失败原因": activeProxyAccount?.lastFailureReason || "-",
                  }}
                  logs={proxyState.recentLogs || []}
                  note="客户端 base URL 应指向 /proxy/codex-account，对应 Bearer Key 单独配置。"
                />
              ) : activeTab === "proxy.start" ? (
                <ProxyPage
                  tool={poolTool}
                  formValues={activeForm}
                  onFieldChange={(field, value) => updateField(poolTool.id, field, value)}
                  onStart={startProxy}
                  onStop={stopProxy}
                  runningState={proxyState}
                  summaryItems={proxySummaryItems}
                  activeInfo={{
                    "账号文件": activeProxyAccount?.id || "-",
                    "Account ID": activeProxyAccount?.accountId || "-",
                    "最近验证时间": formatTime(activeProxyAccount?.lastValidation),
                    "最近失败原因": activeProxyAccount?.lastFailureReason || "-",
                    "池文件": pools["codex-accounts"]?.pool?.filePath || "-",
                  }}
                  actionBusy={busy["proxy.start"]}
                  error={errors["proxy.start"]}
                  logs={proxyState.recentLogs || []}
                  historyItems={activeHistory}
                />
              ) : isRemoteMode && activeTab === "api-pool.start" ? (
                <RemoteServicePage
                  title={poolTool.tabTitle}
                  description={poolTool.description}
                  onReload={reloadRemoteServices}
                  reloadBusy={busy["api-pool.start"]}
                  error={errors["api-pool.start"] || currentApiPoolState.lastError}
                  summaryItems={apiSummaryItems}
                  activeInfo={{
                    "公开路径": currentApiPoolState.endpoint || (activeApiPoolSubTab === "claude-code" ? "/proxy/claude-api" : "/proxy/codex-api"),
                    "鉴权 Key": currentApiPoolState.authEnvName || (activeApiPoolSubTab === "claude-code" ? "CLAUDE_API_PROXY_KEY" : "CODEX_API_PROXY_KEY"),
                    "当前池": activeApiPoolSubTab === "claude-code" ? "Claude Code API 池" : "Codex API 池",
                    "节点名": activeApiPoolEndpoint?.name || "-",
                    "Base URL": activeApiPoolEndpoint?.baseUrl || "-",
                    "定时切换间隔": apiPoolSchedule.scheduledSwitchIntervalMs ? `${apiPoolSchedule.scheduledSwitchIntervalMs} ms` : "-",
                    "最近跳过原因": apiPoolSchedule.lastScheduledSwitchReason || "-",
                    "最近验证时间": formatTime(activeApiPoolEndpoint?.lastValidation),
                    "最近失败原因": activeApiPoolEndpoint?.lastFailureReason || "-",
                  }}
                  subHeader={
                    <Tabs
                      activeKey={activeApiPoolSubTab}
                      items={API_POOL_SUBTABS.map((item) => ({ key: item.id, label: item.label }))}
                      onChange={switchApiPoolSubTab}
                    />
                  }
                  logs={currentApiPoolState.recentLogs || []}
                  operations={
                    <Form
                      layout="vertical"
                      style={{ maxWidth: 420 }}
                    >
                      <Form.Item label="启用定时切换" style={{ marginBottom: 12 }}>
                        <Switch
                          checked={apiPoolRemoteConfig.enableScheduledSwitch !== false}
                          onChange={(checked) =>
                            setApiPoolRemoteConfig((current) => ({
                              ...current,
                              enableScheduledSwitch: checked,
                            }))
                          }
                        />
                      </Form.Item>
                      <Form.Item label="定时切换间隔" style={{ marginBottom: 12 }}>
                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          <Select
                            value={
                              apiPoolRemoteConfig.scheduledSwitchPreset ||
                              inferScheduledSwitchPreset(apiPoolRemoteConfig.scheduledSwitchIntervalMs)
                            }
                            options={SCHEDULED_SWITCH_PRESET_OPTIONS.map((option) => ({
                              label: option.label,
                              value: option.value,
                            }))}
                            onChange={(value) =>
                              setApiPoolRemoteConfig((current) => ({
                                ...current,
                                scheduledSwitchPreset: value,
                                scheduledSwitchIntervalMs:
                                  value === "custom"
                                    ? Number(current.scheduledSwitchIntervalMs || 900000)
                                    : presetValueToIntervalMs(value, current.scheduledSwitchIntervalMs),
                              }))
                            }
                          />
                          {(apiPoolRemoteConfig.scheduledSwitchPreset ||
                            inferScheduledSwitchPreset(apiPoolRemoteConfig.scheduledSwitchIntervalMs)) === "custom" ? (
                            <InputNumber
                              min={1000}
                              step={1000}
                              style={{ width: "100%" }}
                              addonAfter="毫秒"
                              value={apiPoolRemoteConfig.scheduledSwitchIntervalMs}
                              onChange={(value) =>
                                setApiPoolRemoteConfig((current) => ({
                                  ...current,
                                  scheduledSwitchPreset: "custom",
                                  scheduledSwitchIntervalMs: Number(value || 900000),
                                }))
                              }
                            />
                          ) : null}
                        </Space>
                      </Form.Item>
                      <Button type="primary" onClick={saveRemoteApiPoolConfig} loading={busy["api-pool.start"]}>
                        保存并重载当前服务
                      </Button>
                    </Form>
                  }
                  note={
                    activeApiPoolSubTab === "claude-code"
                      ? "Claude 客户端请指向 /proxy/claude-api，并使用 CLAUDE_API_PROXY_KEY。"
                      : "OpenAI/Codex 客户端请指向 /proxy/codex-api，并使用 CODEX_API_PROXY_KEY。"
                  }
                />
              ) : activeTab === "api-pool.start" ? (
                <ProxyPage
                  tool={poolTool}
                  formValues={activeForm}
                  onFieldChange={(field, value) => updateField(poolTool.id, field, value)}
                  onStart={() => startApiPoolProxy(activeApiPoolSubTab)}
                  onStop={() => stopApiPoolProxy(activeApiPoolSubTab)}
                  runningState={currentApiPoolState}
                  summaryItems={apiSummaryItems}
                  activeInfo={{
                    "当前池": activeApiPoolSubTab === "claude-code" ? "Claude Code API 池" : "Codex API 池",
                    "节点名": activeApiPoolEndpoint?.name || "-",
                    "Base URL": activeApiPoolEndpoint?.baseUrl || "-",
                    "定时切换间隔": apiPoolSchedule.scheduledSwitchIntervalMs ? `${apiPoolSchedule.scheduledSwitchIntervalMs} ms` : "-",
                    "最近跳过原因": apiPoolSchedule.lastScheduledSwitchReason || "-",
                    "最近验证时间": formatTime(activeApiPoolEndpoint?.lastValidation),
                    "最近失败原因": activeApiPoolEndpoint?.lastFailureReason || "-",
                  }}
                  actionBusy={busy["api-pool.start"]}
                  error={errors["api-pool.start"]}
                  subHeader={
                    <Tabs
                      activeKey={activeApiPoolSubTab}
                      items={API_POOL_SUBTABS.map((item) => ({ key: item.id, label: item.label }))}
                      onChange={switchApiPoolSubTab}
                    />
                  }
                  extraControls={
                    <Segmented
                      value={activeApiPoolSubTab}
                      options={API_POOL_SUBTABS.map((item) => ({ label: item.label, value: item.id }))}
                      onChange={(value) => switchApiPoolSubTab(String(value))}
                    />
                  }
                  logs={currentApiPoolState.recentLogs || []}
                  historyItems={activeHistory}
                />
              ) : (
                <ProbePage
                  tool={poolTool}
                  formValues={activeForm}
                  onFieldChange={(field, value) => updateField(poolTool.id, field, value)}
                  onRun={() => runTool(poolTool)}
                  busy={busy[poolTool.id]}
                  error={errors[poolTool.id]}
                  logs={activeRun.logs || []}
                  historyItems={activeHistory}
                  activeRun={activeRun}
                />
              )}
            </Suspense>
          )}
        </Content>
      </Layout>

      <PoolEditorDrawer
        poolId={editingPool?.poolId}
        item={editingDraft}
        visible={Boolean(editingDraft)}
        remoteMode={isRemoteMode}
        onClose={() => {
          setEditingPool(null);
          setEditingDraft(null);
        }}
        onSave={applyDraft}
      />
      <ProbeLogModal
        open={poolProbeModal.open}
        title={poolProbeModal.title}
        status={poolProbeModal.status}
        logs={poolProbeModal.logs}
        error={poolProbeModal.error}
        onClose={() =>
          setPoolProbeModal({
            open: false,
            title: "",
            runId: null,
            status: "",
            logs: [],
            error: "",
          })
        }
      />
      <PoolImportModal
        open={poolImportModal.open}
        poolLabel={pools[poolImportModal.poolId]?.pool?.label}
        importText={poolImportModal.text}
        onChange={(text) => setPoolImportModal((current) => ({ ...current, text, error: "" }))}
        onClose={() =>
          setPoolImportModal({
            open: false,
            poolId: "",
            text: "",
            busy: false,
            error: "",
          })
        }
        onImport={importPool}
        busy={poolImportModal.busy}
        error={poolImportModal.error}
      />
    </Layout>
  );
}

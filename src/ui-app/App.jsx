import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Alert, Button, Layout, Menu, Segmented, Space, Spin, Tabs, Tag, Tooltip, Typography } from "antd";
import {
  ApiOutlined,
  AppstoreOutlined,
  BugOutlined,
  DatabaseOutlined,
  RadarChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";

import { PoolEditorDrawer } from "./components/UiShared.jsx";
import {
  API_POOL_SUBTABS,
  TOOL_ORDER,
  buildPreview,
  collectDefaults,
  copyPoolItem,
  friendlyToolName,
  formatTime,
  makeNewPoolItem,
  summarizeApiPoolEndpoints,
  summarizeProxyAccounts,
} from "./view-helpers.js";

const PoolManagePage = lazy(() => import("./pages/PoolManagePage.jsx"));
const ProxyPage = lazy(() => import("./pages/ProxyPage.jsx"));
const ProbePage = lazy(() => import("./pages/ProbePage.jsx"));

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
  const [poolValidationErrors, setPoolValidationErrors] = useState([]);
  const [poolSaveBusy, setPoolSaveBusy] = useState(false);
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});
  const [navCollapsed, setNavCollapsed] = useState(true);

  async function loadPool(poolId) {
    const response = await fetch(`/api/pools/${poolId}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "加载池失败");
    setPools((current) => ({ ...current, [poolId]: payload }));
    return payload;
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

  async function loadPoolAndStore(poolId) {
    try {
      await loadPool(poolId);
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
      if (index == null) items.push(copyPoolItem(values));
      else items[index] = copyPoolItem(values);
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
  ];

  return (
    <Layout className="dashboard-layout">
      <Sider
        width={280}
        collapsedWidth={88}
        collapsible
        trigger={null}
        collapsed={navCollapsed}
        className="dashboard-sider"
      >
        <div className="brand-panel">
          <div className="brand-mark">A</div>
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
              <Text type="secondary">统一管理池文件、代理和探测</Text>
            </div>
          </div>
          <Space size={16}>
            <Tag color="cyan">本地 Node + React</Tag>
            <Tag color="geekblue">最近 {history.length} 条记录</Tag>
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
                  onSavePool={savePool}
                  saveBusy={poolSaveBusy}
                  poolError={activePoolError}
                  validationErrors={poolValidationErrors}
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
        onClose={() => {
          setEditingPool(null);
          setEditingDraft(null);
        }}
        onSave={applyDraft}
      />
    </Layout>
  );
}

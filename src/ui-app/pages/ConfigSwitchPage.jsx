import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  PoweroffOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import { formatTime } from "../view-helpers.js";

const { Title, Paragraph, Text } = Typography;

const PROVIDER_TABS = [
  { key: "codex", label: "Codex 配置" },
  { key: "claude-code", label: "Claude Code 配置" },
];

function splitLines(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  if (parts.length > 1 && parts.at(-1) === "") parts.pop();
  return parts.length ? parts : [""];
}

function buildAlignedDiffRows(leftText, rightText) {
  const leftLines = splitLines(leftText);
  const rightLines = splitLines(rightText);
  const rows = [];
  const dp = Array.from({ length: leftLines.length + 1 }, () =>
    Array(rightLines.length + 1).fill(0),
  );

  for (let i = leftLines.length - 1; i >= 0; i -= 1) {
    for (let j = rightLines.length - 1; j >= 0; j -= 1) {
      if (leftLines[i] === rightLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = 0;
  let j = 0;
  while (i < leftLines.length && j < rightLines.length) {
    if (leftLines[i] === rightLines[j]) {
      rows.push({
        leftText: leftLines[i],
        rightText: rightLines[j],
        leftType: "same",
        rightType: "same",
      });
      i += 1;
      j += 1;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({
        leftText: leftLines[i],
        rightText: "",
        leftType: "removed",
        rightType: "empty",
      });
      i += 1;
    } else {
      rows.push({
        leftText: "",
        rightText: rightLines[j],
        leftType: "empty",
        rightType: "added",
      });
      j += 1;
    }
  }

  while (i < leftLines.length) {
    rows.push({
      leftText: leftLines[i],
      rightText: "",
      leftType: "removed",
      rightType: "empty",
    });
    i += 1;
  }

  while (j < rightLines.length) {
    rows.push({
      leftText: "",
      rightText: rightLines[j],
      leftType: "empty",
      rightType: "added",
    });
    j += 1;
  }

  const mergedRows = [];
  for (let index = 0; index < rows.length; index += 1) {
    const current = rows[index];
    const next = rows[index + 1];
    if (
      current.leftType === "removed" &&
      current.rightType === "empty" &&
      next?.leftType === "empty" &&
      next?.rightType === "added"
    ) {
      mergedRows.push({
        leftText: current.leftText,
        rightText: next.rightText,
        leftType: "changed",
        rightType: "changed",
      });
      index += 1;
      continue;
    }
    mergedRows.push(current);
  }

  let leftLineNumber = 1;
  let rightLineNumber = 1;
  return mergedRows.map((row) => {
    const nextRow = {
      ...row,
      leftLineNumber: row.leftType === "empty" ? null : leftLineNumber,
      rightLineNumber: row.rightType === "empty" ? null : rightLineNumber,
    };
    if (row.leftType !== "empty") leftLineNumber += 1;
    if (row.rightType !== "empty") rightLineNumber += 1;
    return nextRow;
  });
}

function emptyDraft(provider) {
  return provider === "codex"
    ? {
        id: "",
        name: "",
        provider,
        payload: {
          authJsonText: "",
          configTomlText: "",
        },
      }
    : {
        id: "",
        name: "",
        provider,
        payload: {
          settingsJsonText: "",
        },
      };
}

function statusTag(status, statusText) {
  if (status === "active") return <Tag color="success">{statusText}</Tag>;
  if (status === "drifted") return <Tag color="warning">{statusText}</Tag>;
  return <Tag>{statusText}</Tag>;
}

function DiffViewerModal({ open, preset, providerConfig, onClose }) {
  if (!open || !preset) return null;

  const isCodex = preset.provider === "codex";
  const targetPathByKey = Object.fromEntries(
    (providerConfig?.targetPaths || []).map((item) => [item.key, item.path]),
  );

  function renderCompareBlock(title, presetText, currentText, targetPath) {
    const rows = buildAlignedDiffRows(presetText, currentText);
    return (
      <Card title={title} bordered={false}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Text type="secondary">{targetPath}</Text>
          <div className="config-switch-diff-grid">
            <div>
              <div className="config-switch-diff-title">预设配置</div>
              <div className="config-switch-diff-box">
                {rows.map((row, index) => (
                  <div
                    key={`${title}-left-${index}`}
                    className={`config-switch-diff-line config-switch-diff-line-${row.leftType}`}
                  >
                    <span className="config-switch-diff-line-number">
                      {row.leftLineNumber ?? ""}
                    </span>
                    <span className="config-switch-diff-line-text">
                      {row.leftText || " "}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="config-switch-diff-title">本机当前配置</div>
              <div className="config-switch-diff-box">
                {rows.map((row, index) => (
                  <div
                    key={`${title}-right-${index}`}
                    className={`config-switch-diff-line config-switch-diff-line-${row.rightType}`}
                  >
                    <span className="config-switch-diff-line-number">
                      {row.rightLineNumber ?? ""}
                    </span>
                    <span className="config-switch-diff-line-text">
                      {row.rightText || " "}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Space>
      </Card>
    );
  }

  return (
    <Modal
      open={open}
      title={`查看差异 · ${preset.name}`}
      onCancel={onClose}
      footer={null}
      width={1180}
      destroyOnClose
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Alert
          type="warning"
          showIcon
          message="当前本机文件内容和这条已启用预设不一致，下面展示预设内容与本机当前内容的并排对比。"
        />
        {isCodex
          ? (
            <>
              {renderCompareBlock(
                "auth.json",
                preset.payload?.authJsonText || "",
                preset.currentPayload?.authJsonText || "",
                targetPathByKey.authJsonText || "~/.codex/auth.json",
              )}
              {renderCompareBlock(
                "config.toml",
                preset.payload?.configTomlText || "",
                preset.currentPayload?.configTomlText || "",
                targetPathByKey.configTomlText || "~/.codex/config.toml",
              )}
            </>
            )
          : renderCompareBlock(
            "settings.json",
            preset.payload?.settingsJsonText || "",
            preset.currentPayload?.settingsJsonText || "",
            targetPathByKey.settingsJsonText || "~/.claude/settings.json",
          )}
      </Space>
    </Modal>
  );
}

function ConfigPresetDrawer({ open, draft, providerConfig, saving, onClose, onSave }) {
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const provider = draft?.provider || providerConfig?.provider || "codex";

  useEffect(() => {
    if (!open || !draft) return;
    form.setFieldsValue({
      name: draft.name || "",
      authJsonText: draft.payload?.authJsonText || "",
      configTomlText: draft.payload?.configTomlText || "",
      settingsJsonText: draft.payload?.settingsJsonText || "",
    });
  }, [draft, form, open]);

  function formatJsonField(fieldName) {
    try {
      const value = form.getFieldValue(fieldName) || "";
      const formatted = `${JSON.stringify(JSON.parse(value), null, 2)}\n`;
      form.setFieldValue(fieldName, formatted);
      messageApi.success("JSON 已格式化");
    } catch {
      messageApi.error("当前内容不是合法 JSON，无法格式化");
    }
  }

  function handleSubmit() {
    form.validateFields().then((values) => {
      const nextDraft =
        provider === "codex"
          ? {
              ...draft,
              name: values.name,
              payload: {
                authJsonText: values.authJsonText,
                configTomlText: values.configTomlText,
              },
            }
          : {
              ...draft,
              name: values.name,
              payload: {
                settingsJsonText: values.settingsJsonText,
              },
            };
      onSave(nextDraft);
    });
  }

  const targetPathByKey = Object.fromEntries(
    (providerConfig?.targetPaths || []).map((item) => [item.key, item.path]),
  );

  return (
    <>
      {contextHolder}
      <Drawer
        open={open}
        width={provider === "codex" ? 920 : 820}
        destroyOnClose
        onClose={onClose}
        title={draft?.id ? `编辑${provider === "codex" ? " Codex" : " Claude Code"}配置` : `新增${provider === "codex" ? " Codex" : " Claude Code"}配置`}
        extra={
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={handleSubmit}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: "请输入名称" }]}
          >
            <Input placeholder="例如：HF 代理 / 备用节点 / 本地直连" />
          </Form.Item>

          {provider === "codex" ? (
            <>
              <Form.Item
                label="auth.json (JSON)"
                extra={targetPathByKey.authJsonText || "~/.codex/auth.json"}
                name="authJsonText"
                rules={[
                  { required: true, message: "请输入 auth.json 内容" },
                  {
                    validator: async (_, value) => {
                      try {
                        JSON.parse(String(value || ""));
                      } catch {
                        throw new Error("请输入合法 JSON");
                      }
                    },
                  },
                ]}
              >
                <Input.TextArea
                  className="config-switch-codearea"
                  autoSize={{ minRows: 10, maxRows: 18 }}
                  placeholder={`{\n  "OPENAI_API_KEY": "sk-xxx"\n}`}
                />
              </Form.Item>
              <Button
                type="text"
                className="config-switch-format-button"
                onClick={() => formatJsonField("authJsonText")}
              >
                格式化
              </Button>

              <Form.Item
                label="config.toml (TOML)"
                extra={targetPathByKey.configTomlText || "~/.codex/config.toml"}
                name="configTomlText"
                rules={[{ required: true, message: "请输入 config.toml 内容" }]}
              >
                <Input.TextArea
                  className="config-switch-codearea"
                  autoSize={{ minRows: 14, maxRows: 24 }}
                  placeholder={'model_provider = "OpenAI"\nmodel = "gpt-5.4"'}
                />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item
                label="settings.json (JSON)"
                extra={targetPathByKey.settingsJsonText || "~/.claude/settings.json"}
                name="settingsJsonText"
                rules={[
                  { required: true, message: "请输入 settings.json 内容" },
                  {
                    validator: async (_, value) => {
                      try {
                        JSON.parse(String(value || ""));
                      } catch {
                        throw new Error("请输入合法 JSON");
                      }
                    },
                  },
                ]}
              >
                <Input.TextArea
                  className="config-switch-codearea"
                  autoSize={{ minRows: 18, maxRows: 26 }}
                  placeholder={`{\n  "env": {\n    "ANTHROPIC_AUTH_TOKEN": "sk-xxx"\n  }\n}`}
                />
              </Form.Item>
              <Button
                type="text"
                className="config-switch-format-button"
                onClick={() => formatJsonField("settingsJsonText")}
              >
                格式化
              </Button>
            </>
          )}
        </Form>
      </Drawer>
    </>
  );
}

export default function ConfigSwitchPage({ apiBase }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [modalApi, modalContextHolder] = Modal.useModal();
  const [activeProvider, setActiveProvider] = useState("codex");
  const [configData, setConfigData] = useState({ providers: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [actionBusyKey, setActionBusyKey] = useState("");
  const [drawerState, setDrawerState] = useState({
    open: false,
    draft: null,
  });
  const [diffViewerState, setDiffViewerState] = useState({
    open: false,
    provider: "",
    presetId: "",
  });

  const providerConfig = configData.providers?.[activeProvider] || null;
  const presets = providerConfig?.presets || [];
  const diffProviderConfig = configData.providers?.[diffViewerState.provider] || null;
  const diffPreset =
    diffProviderConfig?.presets?.find((item) => item.id === diffViewerState.presetId) || null;

  async function loadConfigSwitch(showSuccess = false) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/config-switch`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "加载配置切换失败");
      setConfigData(payload);
      if (showSuccess) messageApi.success("配置切换列表已刷新");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfigSwitch();
  }, [apiBase]);

  async function persistPreset(nextDraft) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/config-switch/${nextDraft.provider}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextDraft),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存配置失败");
      setConfigData(payload);
      setDrawerState({ open: false, draft: null });
      messageApi.success(nextDraft.id ? "配置已更新" : "配置已新增");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  }

  async function runAction(actionKey, request) {
    setActionBusyKey(actionKey);
    setError("");
    try {
      const response = await request();
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "操作失败");
      setConfigData(payload);
      return payload;
    } catch (nextError) {
      setError(nextError.message);
      throw nextError;
    } finally {
      setActionBusyKey("");
    }
  }

  function openCreate() {
    setDrawerState({
      open: true,
      draft: emptyDraft(activeProvider),
    });
  }

  function openEdit(preset) {
    setDrawerState({
      open: true,
      draft: JSON.parse(JSON.stringify(preset)),
    });
  }

  function handleDelete(preset) {
    modalApi.confirm({
      title: `删除“${preset.name}”`,
      content: "删除后不会回滚当前本机文件，只会移除这条预设。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        await runAction(`delete:${preset.id}`, () =>
          fetch(`${apiBase}/config-switch/${preset.provider}/${preset.id}`, {
            method: "DELETE",
          }),
        );
        messageApi.success("配置预设已删除");
      },
    });
  }

  function handleCopy(preset) {
    runAction(`copy:${preset.id}`, () =>
      fetch(`${apiBase}/config-switch/${preset.provider}/${preset.id}/copy`, {
        method: "POST",
      }),
    )
      .then(() => {
        messageApi.success("配置预设已复制");
      })
      .catch(() => {});
  }

  function handleActivate(preset) {
    const fileList = (providerConfig?.targetPaths || [])
      .map((item) => item.path)
      .join("\n");
    modalApi.confirm({
      title: `启用“${preset.name}”`,
      content: (
        <Space direction="vertical" size={8}>
          <Text>这会直接覆盖以下本机配置文件：</Text>
          <pre className="config-switch-confirm-paths">{fileList}</pre>
        </Space>
      ),
      okText: "确认启用",
      cancelText: "取消",
      onOk: async () => {
        const payload = await runAction(`activate:${preset.id}`, () =>
          fetch(`${apiBase}/config-switch/${preset.provider}/${preset.id}/activate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ confirmed: true }),
          }),
        );
        const targetPaths = payload.activation?.targetPaths || [];
        messageApi.success(`已写入 ${targetPaths.length} 个本机配置文件`);
      },
    });
  }

  function openDiffViewer(preset) {
    setDiffViewerState({
      open: true,
      provider: preset.provider,
      presetId: preset.id,
    });
  }

  const columns = useMemo(
    () => [
      {
        title: "名称",
        dataIndex: "name",
        key: "name",
        ellipsis: true,
      },
      {
        title: "目标文件",
        key: "targetPaths",
        render: () => (
          <div className="config-switch-targets">
            {(providerConfig?.targetPaths || []).map((item) => (
              <div key={item.key}>
                <div className="config-switch-target-label">{item.label}</div>
                <div className="config-switch-target-path">{item.path}</div>
              </div>
            ))}
          </div>
        ),
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 160,
        render: (_, record) => (
          <Space size={6}>
            {statusTag(record.status, record.statusText)}
            {record.status === "drifted" ? (
              <Button
                type="text"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => openDiffViewer(record)}
                title="查看当前配置与本机配置差异"
              />
            ) : null}
          </Space>
        ),
      },
      {
        title: "最近更新",
        dataIndex: "updatedAt",
        key: "updatedAt",
        width: 180,
        render: (value) => formatTime(value),
      },
      {
        title: "操作",
        key: "actions",
        width: 280,
        fixed: "right",
        render: (_, record) => (
          <Space wrap>
            <Button
              size="small"
              type={record.status === "active" ? "default" : "primary"}
              icon={<PoweroffOutlined />}
              loading={actionBusyKey === `activate:${record.id}`}
              onClick={() => handleActivate(record)}
            >
              启用
            </Button>
            <Button
              size="small"
              icon={<CopyOutlined />}
              loading={actionBusyKey === `copy:${record.id}`}
              onClick={() => handleCopy(record)}
            >
              复制
            </Button>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
              编辑
            </Button>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>
              删除
            </Button>
          </Space>
        ),
      },
    ],
    [actionBusyKey, providerConfig],
  );

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <Card className="dashboard-hero-card" bordered={false}>
          <Title level={2} style={{ marginTop: 0 }}>配置切换</Title>
          <Paragraph>
            统一管理 Codex 和 Claude Code 的本机配置预设，支持新增、编辑、复制、删除和启用。
          </Paragraph>
          <Text type="secondary">
            启用时会直接写本机配置文件；状态会根据当前本机文件内容判断是否已偏离。
          </Text>
        </Card>

        <Card
          bordered={false}
          extra={
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={() => loadConfigSwitch(true)} loading={loading}>
                重新加载
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新增
              </Button>
            </Space>
          }
        >
          {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
          <Tabs
            activeKey={activeProvider}
            onChange={setActiveProvider}
            items={PROVIDER_TABS.map((item) => ({
              key: item.key,
              label: item.label,
              children: (
                <Table
                  rowKey="id"
                  loading={loading}
                  columns={columns}
                  dataSource={presets}
                  pagination={{ pageSize: 8 }}
                  scroll={{ x: 1180 }}
                  locale={{ emptyText: "当前还没有配置预设。" }}
                />
              ),
            }))}
          />
        </Card>
      </Space>

      <ConfigPresetDrawer
        open={drawerState.open}
        draft={drawerState.draft}
        providerConfig={configData.providers?.[drawerState.draft?.provider || activeProvider] || providerConfig}
        saving={saving}
        onClose={() => setDrawerState({ open: false, draft: null })}
        onSave={persistPreset}
      />
      <DiffViewerModal
        open={diffViewerState.open}
        preset={diffPreset}
        providerConfig={diffProviderConfig}
        onClose={() =>
          setDiffViewerState({
            open: false,
            provider: "",
            presetId: "",
          })
        }
      />
    </>
  );
}

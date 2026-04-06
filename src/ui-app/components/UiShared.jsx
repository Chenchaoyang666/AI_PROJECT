import React from "react";
import { Alert, Button, Card, Checkbox, Descriptions, Drawer, Form, Input, Modal, Space, Statistic, Table, Tag, Tooltip, Typography, message } from "antd";
import { BugOutlined, CopyOutlined } from "@ant-design/icons";
import { formatStatus, formatTime, friendlyToolName, maskValue, statusTagColor } from "../view-helpers.js";

const { Text } = Typography;

function CopyValue({ value, masked }) {
  const [messageApi, contextHolder] = message.useMessage();

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(String(value));
      messageApi.success("已复制");
    } catch {
      messageApi.error("复制失败");
    }
  }

  return (
    <>
      {contextHolder}
      <div className="copy-value">
        <span className="copy-value-text" title={value ? String(value) : undefined}>
          {masked || value || "-"}
        </span>
        {value ? (
          <Tooltip title="复制">
            <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} />
          </Tooltip>
        ) : null}
      </div>
    </>
  );
}

export function StatisticsRow({ items }) {
  return (
    <div className="stats-grid">
      {items.map((item) => (
        <Card key={item.title} className="stats-card" bordered={false}>
          {item.plain ? (
            <div className="stats-plain">
              <div className="stats-plain-title">{item.title}</div>
              <div
                className={item.singleLine ? "stats-plain-value stats-plain-value-single" : "stats-plain-value"}
                title={typeof item.value === "string" ? item.value : undefined}
              >
                {item.value}
              </div>
              {item.extra ? <div className="stats-extra">{item.extra}</div> : null}
            </div>
          ) : (
            <>
              <Statistic title={item.title} value={item.value} suffix={item.suffix} />
              {item.extra ? <div className="stats-extra">{item.extra}</div> : null}
            </>
          )}
        </Card>
      ))}
    </div>
  );
}

export function HistoryTable({ items }) {
  const columns = [
    {
      title: "工具",
      dataIndex: "toolId",
      key: "toolId",
      render: (value) => friendlyToolName(value),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (value) => <Tag color={statusTagColor(value)}>{formatStatus(value)}</Tag>,
    },
    {
      title: "参数摘要",
      dataIndex: "paramsSummary",
      key: "paramsSummary",
      ellipsis: true,
      render: (_, record) => record.paramsSummary || record.commandPreview,
    },
    {
      title: "开始时间",
      dataIndex: "startedAt",
      key: "startedAt",
      render: (value) => formatTime(value),
    },
    {
      title: "Exit",
      dataIndex: "exitCode",
      key: "exitCode",
      render: (value) => (value == null ? "-" : value),
      width: 80,
    },
  ];
  return (
    <Table
      rowKey={(record) => `${record.id}-${record.startedAt || ""}`}
      columns={columns}
      dataSource={items}
      pagination={false}
      locale={{ emptyText: "最近还没有运行记录。" }}
      size="middle"
    />
  );
}

export function LogCard({ logs }) {
  if (!logs.length) {
    return <Alert type="info" showIcon message="当前还没有日志输出。" />;
  }
  return (
    <div className="terminal-card">
      {logs.map((entry, index) => (
        <div key={`${entry.timestamp}-${index}`} className={`terminal-line terminal-${entry.stream}`}>
          <span className="terminal-time">{formatTime(entry.timestamp)}</span>
          <span className="terminal-stream">{entry.stream}</span>
          <span>{entry.text}</span>
        </div>
      ))}
    </div>
  );
}

export function ProbeLogModal({ open, title, status, logs, error, onClose }) {
  return (
    <Modal
      open={open}
      title={title || "LLM 探测日志"}
      onCancel={onClose}
      footer={null}
      width={860}
      destroyOnClose
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {status ? <Tag color={statusTagColor(status)}>{formatStatus(status)}</Tag> : null}
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <LogCard logs={logs} />
      </Space>
    </Modal>
  );
}

export function InfoCard({ title, activeInfo }) {
  return (
    <Card title={title} bordered={false}>
      <Descriptions column={1} size="small">
        {Object.entries(activeInfo).map(([label, value]) => (
          <Descriptions.Item key={label} label={label}>
            {value || "-"}
          </Descriptions.Item>
        ))}
      </Descriptions>
    </Card>
  );
}

export function PoolEditorDrawer({ poolId, item, visible, onClose, onSave }) {
  const [form] = Form.useForm();
  const isAccount = poolId === "codex-accounts";

  React.useEffect(() => {
    if (!visible || !item) return;
    form.setFieldsValue(
      isAccount
        ? {
            ...item,
            tokens: {
              access_token: item.tokens?.access_token || "",
              account_id: item.tokens?.account_id || "",
              id_token: item.tokens?.id_token || "",
              refresh_token: item.tokens?.refresh_token || "",
            },
          }
        : { ...item },
    );
  }, [form, item, visible, isAccount]);

  function submit() {
    form.validateFields().then((values) => {
      onSave(values);
    });
  }

  return (
    <Drawer
      open={visible}
      onClose={onClose}
      width={720}
      title={isAccount ? "编辑账号池条目" : "编辑 API 池条目"}
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={submit}>
            应用
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        {isAccount ? (
          <>
            <div className="drawer-grid">
              <Form.Item label="展示名" name="name">
                <Input />
              </Form.Item>
              <Form.Item label="邮箱" name="email">
                <Input />
              </Form.Item>
              <Form.Item label="类型" name="type" initialValue="codex">
                <Input />
              </Form.Item>
              <Form.Item label="禁用" name="disabled" valuePropName="checked">
                <Checkbox />
              </Form.Item>
              <Form.Item label="last_refresh" name="last_refresh">
                <Input />
              </Form.Item>
              <Form.Item label="expired" name="expired">
                <Input />
              </Form.Item>
            </div>
            <Card title="Token 信息" className="drawer-section-card">
              <div className="drawer-grid">
                <Form.Item label="access_token" name={["tokens", "access_token"]}>
                  <Input.Password visibilityToggle />
                </Form.Item>
                <Form.Item label="account_id" name={["tokens", "account_id"]}>
                  <Input />
                </Form.Item>
                <Form.Item label="id_token" name={["tokens", "id_token"]}>
                  <Input.Password visibilityToggle />
                </Form.Item>
                <Form.Item label="refresh_token" name={["tokens", "refresh_token"]}>
                  <Input.Password visibilityToggle />
                </Form.Item>
              </div>
            </Card>
          </>
        ) : (
          <div className="drawer-grid">
            <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
              <Input />
            </Form.Item>
            <Form.Item label="类型" name="type">
              <Input />
            </Form.Item>
            <Form.Item label="Base URL" name="baseUrl" rules={[{ required: true, message: "请输入 Base URL" }]}>
              <Input placeholder="https://example.com 或 https://example.com/v1" />
            </Form.Item>
            <Form.Item label="模型" name="model">
              <Input placeholder="例如 gpt-5.4 / claude-sonnet-4-20250514" />
            </Form.Item>
            <Form.Item
              label="探活路径（可选）"
              name="probePath"
              extra="留空时自动选择默认探活接口；仅在目标站点需要自定义探活地址时填写，例如 /v1/models。"
            >
              <Input placeholder="/v1/models" />
            </Form.Item>
              <Form.Item label="禁用" name="disabled" valuePropName="checked">
                <Checkbox />
              </Form.Item>
            <Form.Item
              label="API Key"
              name="apiKey"
              rules={[{ required: true, message: "请输入 API Key" }]}
            >
              <Input.Password visibilityToggle />
            </Form.Item>
          </div>
        )}
      </Form>
    </Drawer>
  );
}

export function PoolColumns(activePoolId, onEditItem, onDeleteItem, onProbeItem) {
  if (activePoolId === "codex-accounts") {
    return [
      { title: "展示名", dataIndex: "name", key: "name", ellipsis: true, render: (value) => value || "-" },
      { title: "邮箱", dataIndex: "email", key: "email", ellipsis: true, render: (value) => value || "-" },
      {
        title: "Account ID",
        dataIndex: ["tokens", "account_id"],
        key: "accountId",
        ellipsis: true,
        render: (value) => value || "-",
      },
      {
        title: "Token 状态",
        dataIndex: ["tokens", "access_token"],
        key: "token",
        ellipsis: true,
        render: (value) => (value ? maskValue(value) : "(未配置)"),
      },
      {
        title: "状态",
        dataIndex: "disabled",
        key: "disabled",
        render: (value) => <Tag color={value ? "default" : "success"}>{value ? "disabled" : "enabled"}</Tag>,
        width: 110,
      },
      {
        title: "操作",
        key: "actions",
        width: 160,
        fixed: "right",
        render: (_, record, index) => (
          <Space>
            <Button size="small" onClick={() => onEditItem(activePoolId, index)}>编辑</Button>
            <Button size="small" danger onClick={() => onDeleteItem(activePoolId, index)}>删除</Button>
          </Space>
        ),
      },
    ];
  }

  return [
    { title: "名称", dataIndex: "name", key: "name", ellipsis: true },
    {
      title: "Base URL",
      dataIndex: "baseUrl",
      key: "baseUrl",
      ellipsis: true,
      render: (value) => <CopyValue value={value} />,
    },
    { title: "模型", dataIndex: "model", key: "model", ellipsis: true, render: (value) => value || "-" },
    {
      title: "API Key 状态",
      dataIndex: "apiKey",
      key: "apiKey",
      render: (value) => (
        <CopyValue value={value} masked={value ? maskValue(value) : "(未配置)"} />
      ),
    },
    {
      title: "状态",
      dataIndex: "disabled",
      key: "disabled",
      render: (value) => <Tag color={value ? "default" : "success"}>{value ? "disabled" : "enabled"}</Tag>,
      width: 110,
    },
    {
      title: "操作",
      key: "actions",
      width: 240,
      fixed: "right",
      render: (_, record, index) => (
        <Space>
          <Button size="small" icon={<BugOutlined />} onClick={() => onProbeItem?.(activePoolId, index)}>探测</Button>
          <Button size="small" onClick={() => onEditItem(activePoolId, index)}>编辑</Button>
          <Button size="small" danger onClick={() => onDeleteItem(activePoolId, index)}>删除</Button>
        </Space>
      ),
    },
  ];
}

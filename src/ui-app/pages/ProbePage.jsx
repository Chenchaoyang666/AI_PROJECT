import { Alert, Button, Card, Form, Input, Segmented, Space, Tag, Typography } from "antd";
import { BugOutlined } from "@ant-design/icons";

import { LogCard, HistoryTable } from "../components/UiShared.jsx";
import { formatStatus, statusTagColor } from "../view-helpers.js";

const { Title, Paragraph } = Typography;

export default function ProbePage({ tool, formValues, onFieldChange, onRun, busy, error, logs, historyItems, activeRun }) {
  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card className="dashboard-hero-card" bordered={false}>
        <Title level={2} style={{ marginTop: 0 }}>{tool.tabTitle}</Title>
        <Paragraph>{tool.description}</Paragraph>
      </Card>

      <Card title="探测参数" bordered={false}>
        <Form layout="vertical">
          <div className="form-grid">
            {tool.argsSchema.map((field) => {
              if (field.type === "checkbox") {
                return (
                  <Form.Item key={field.name} label={field.label}>
                    <Segmented
                      value={formValues[field.name] === true ? "on" : "off"}
                      options={[
                        { label: "关闭", value: "off" },
                        { label: "开启", value: "on" },
                      ]}
                      onChange={(next) => onFieldChange(field.name, next === "on")}
                    />
                  </Form.Item>
                );
              }
              return (
                <Form.Item key={field.name} label={field.label}>
                  <Input
                    type={field.type === "password" ? "password" : "text"}
                    value={formValues[field.name] ?? ""}
                    placeholder={field.placeholder || ""}
                    onChange={(event) => onFieldChange(field.name, event.target.value)}
                  />
                </Form.Item>
              );
            })}
          </div>
          <Space>
            <Button type="primary" icon={<BugOutlined />} onClick={onRun} loading={busy}>
              运行脚本
            </Button>
            {activeRun.runId ? <Tag color={statusTagColor(activeRun.status)}>{formatStatus(activeRun.status)}</Tag> : null}
          </Space>
          {error ? <Alert showIcon type="error" message={error} style={{ marginTop: 16 }} /> : null}
        </Form>
      </Card>

      <Card title="运行输出" bordered={false}>
        <LogCard logs={logs} />
      </Card>

      <Card title="最近记录" bordered={false}>
        <HistoryTable items={historyItems} />
      </Card>
    </Space>
  );
}

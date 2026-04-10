import { Alert, Button, Card, Form, Input, InputNumber, Segmented, Select, Space, Typography } from "antd";
import { PlayCircleOutlined, StopOutlined } from "@ant-design/icons";

import { LogCard, HistoryTable, InfoCard, StatisticsRow } from "../components/UiShared.jsx";
import {
  inferScheduledSwitchPreset,
  presetValueToIntervalMs,
  SCHEDULED_SWITCH_PRESET_OPTIONS,
} from "../view-helpers.js";

const { Title, Paragraph, Text } = Typography;

export default function ProxyPage({
  tool,
  formValues,
  onFieldChange,
  onStart,
  onStop,
  runningState,
  summaryItems,
  activeInfo,
  actionBusy,
  error,
  subHeader,
  extraControls,
  logs,
  historyItems,
}) {
  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card className="dashboard-hero-card" bordered={false}>
        <Title level={2} style={{ marginTop: 0 }}>{tool.tabTitle}</Title>
        <Paragraph>{tool.description}</Paragraph>
        {subHeader ? <Text type="secondary">{subHeader}</Text> : null}
      </Card>

      <StatisticsRow items={summaryItems} />

      <div className="content-grid">
        <Card title="参数表单" bordered={false} extra={extraControls}>
          <Form layout="vertical">
            <div className="form-grid">
              {tool.argsSchema.map((field) => {
                const value = formValues[field.name];
                if (field.type === "checkbox") {
                  return (
                    <Form.Item key={field.name} label={field.label} className="full-span">
                      <Segmented
                        value={value === true ? "on" : "off"}
                        options={[
                          { label: "关闭", value: "off" },
                          { label: "开启", value: "on" },
                        ]}
                        onChange={(next) => onFieldChange(field.name, next === "on")}
                      />
                    </Form.Item>
                  );
                }
                if (field.type === "select") {
                  return (
                    <Form.Item key={field.name} label={field.label}>
                      <Segmented
                        block
                        value={value}
                        options={(field.options || []).map((option) => ({
                          label: option.label,
                          value: option.value,
                        }))}
                        onChange={(next) => onFieldChange(field.name, next)}
                      />
                    </Form.Item>
                  );
                }
                if (field.type === "number") {
                  if (tool.id === "api-pool.start" && field.name === "scheduledSwitchIntervalMs") {
                    const presetValue =
                      formValues.scheduledSwitchPreset || inferScheduledSwitchPreset(value);
                    return (
                      <Form.Item key={field.name} label="定时切换间隔" className="full-span">
                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          <Select
                            value={presetValue}
                            options={SCHEDULED_SWITCH_PRESET_OPTIONS.map((option) => ({
                              label: option.label,
                              value: option.value,
                            }))}
                            onChange={(next) => {
                              onFieldChange("scheduledSwitchPreset", next);
                              if (next !== "custom") {
                                onFieldChange(
                                  "scheduledSwitchIntervalMs",
                                  presetValueToIntervalMs(next, value),
                                );
                              }
                            }}
                          />
                          {presetValue === "custom" ? (
                            <InputNumber
                              min={1000}
                              step={1000}
                              style={{ width: "100%" }}
                              value={value}
                              addonAfter="毫秒"
                              onChange={(next) => onFieldChange(field.name, Number(next || 900000))}
                            />
                          ) : null}
                        </Space>
                      </Form.Item>
                    );
                  }
                  return (
                    <Form.Item key={field.name} label={field.label}>
                      <InputNumber style={{ width: "100%" }} value={value} onChange={(next) => onFieldChange(field.name, next)} />
                    </Form.Item>
                  );
                }
                return (
                  <Form.Item key={field.name} label={field.label}>
                    <Input
                      value={value ?? ""}
                      placeholder={field.placeholder || ""}
                      type={field.type === "password" ? "password" : "text"}
                      onChange={(event) => onFieldChange(field.name, event.target.value)}
                    />
                  </Form.Item>
                );
              })}
            </div>
            <Space wrap>
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={onStart} loading={actionBusy}>
                {runningState.running ? "刷新状态" : "启动"}
              </Button>
              <Button icon={<StopOutlined />} onClick={onStop} disabled={!runningState.running || actionBusy}>
                停止
              </Button>
            </Space>
            {error ? <Alert showIcon type="error" message={error} style={{ marginTop: 16 }} /> : null}
          </Form>
        </Card>

        <InfoCard title={tool.id === "proxy.start" ? "当前活跃账号" : "当前活跃节点"} activeInfo={activeInfo} />
      </div>

      <Card title="运行输出" bordered={false}>
        <LogCard logs={logs} />
      </Card>

      <Card title="最近记录" bordered={false}>
        <HistoryTable items={historyItems} />
      </Card>
    </Space>
  );
}

import { Alert, Button, Card, Space, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

import { InfoCard, LogCard, StatisticsRow } from "../components/UiShared.jsx";

const { Title, Paragraph, Text } = Typography;

export default function RemoteServicePage({
  title,
  description,
  summaryItems,
  activeInfo,
  logs,
  onReload,
  reloadBusy,
  error,
  subHeader,
  note,
  operations,
}) {
  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card className="dashboard-hero-card" bordered={false}>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Title level={2} style={{ marginTop: 0 }}>{title}</Title>
          <Paragraph style={{ marginBottom: 0 }}>{description}</Paragraph>
          {note ? <Text type="secondary">{note}</Text> : null}
          {subHeader}
        </Space>
      </Card>

      <StatisticsRow items={summaryItems} />

      <div className="content-grid">
        <Card
          title="运维操作"
          bordered={false}
          extra={
            <Button type="primary" icon={<ReloadOutlined />} onClick={onReload} loading={reloadBusy}>
              Reload 配置
            </Button>
          }
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              message={
                operations
                  ? "当前服务由 Hugging Face 常驻托管，配置修改会先保存到远端存储，再自动 reload 生效。"
                  : "当前服务由 Hugging Face 常驻托管，管理台只提供状态查看和手动 reload。"
              }
            />
            {operations}
            {error ? <Alert type="error" showIcon message={error} /> : null}
          </Space>
        </Card>

        <InfoCard title="当前活跃信息" activeInfo={activeInfo} />
      </div>

      <Card title="最近日志" bordered={false}>
        <LogCard logs={logs} />
      </Card>
    </Space>
  );
}

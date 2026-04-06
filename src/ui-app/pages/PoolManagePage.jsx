import { Alert, Button, Card, Segmented, Space, Table, Typography } from "antd";
import { PlayCircleOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";

import { POOL_CATEGORY_ORDER, formatTime } from "../view-helpers.js";
import { PoolColumns, StatisticsRow } from "../components/UiShared.jsx";

const { Title, Paragraph } = Typography;

export default function PoolManagePage({
  pools,
  activePoolCategory,
  activePoolId,
  setActivePoolCategory,
  setActivePoolId,
  onReload,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onProbeItem,
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
  const columns = PoolColumns(activePoolId, onEditItem, onDeleteItem, onProbeItem);

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card className="dashboard-hero-card" bordered={false}>
        <Title level={2} style={{ marginTop: 0 }}>池管理</Title>
        <Paragraph>统一维护账号池和 API 池的 `pool.json`，支持新增、编辑、删除和保存。</Paragraph>
        <Space wrap size={12}>
          {POOL_CATEGORY_ORDER.map((category) => (
            <Button
              key={category.id}
              type={activePoolCategory === category.id ? "primary" : "default"}
              onClick={() => setActivePoolCategory(category.id)}
            >
              {category.label}
            </Button>
          ))}
        </Space>
        <div style={{ marginTop: 16 }}>
          <Segmented
            block
            value={activePoolId}
            options={categoryPools.map((poolData) => ({
              label: poolData.pool.label,
              value: poolData.pool.id,
            }))}
            onChange={(value) => setActivePoolId(String(value))}
          />
        </div>
      </Card>

      {activeMeta ? (
        <StatisticsRow
          items={[
            { title: "当前池", value: activeMeta.label, plain: true, singleLine: true },
            { title: "文件路径", value: activeMeta.filePath, extra: "本地 pool.json", plain: true, singleLine: true },
            { title: "条目总数", value: activeItems.length },
            { title: "最近保存", value: formatTime(activePool.savedAt), plain: true, singleLine: true },
          ]}
        />
      ) : null}

      <Card
        title="条目列表"
        bordered={false}
        extra={
          <Space wrap>
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => onAddItem(activePoolId)}>
              新增
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => onReload(activePoolId)}>
              重新加载
            </Button>
            <Button icon={<SaveOutlined />} onClick={() => onSavePool(activePoolId)} loading={saveBusy}>
              保存
            </Button>
          </Space>
        }
      >
        {poolError ? <Alert showIcon type="error" message={poolError} style={{ marginBottom: 16 }} /> : null}
        {validationErrors.length ? (
          <Alert
            showIcon
            type="warning"
            message={validationErrors.map((item) => `${item.path}: ${item.message}`).join(" | ")}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Table
          rowKey={(_, index) => `${activePoolId}-${index}`}
          columns={columns}
          dataSource={activeItems}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 980 }}
          locale={{ emptyText: "当前池还没有条目。" }}
        />
      </Card>
    </Space>
  );
}

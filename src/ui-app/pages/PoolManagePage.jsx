import { Alert, Button, Card, Segmented, Space, Table, Typography } from "antd";
import { ImportOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";

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
  onUpdateLocalToken,
  onImportPool,
  poolError,
  validationErrors,
  readOnly,
  readOnlyReason,
  remoteMode,
  importBusy,
  allowProbe = true,
}) {
  const activePool = pools[activePoolId] || null;
  const activeItems = activePool?.items || [];
  const tableItems = activeItems.map((item, index) => ({
    ...item,
    __sourceIndex: index,
  }));
  const activeMeta = activePool?.pool || null;
  const categoryPools = Object.values(pools)
    .filter((item) => item.pool?.category === activePoolCategory)
    .sort((left, right) => left.pool.label.localeCompare(right.pool.label, "zh-CN"));
  const columns = PoolColumns(activePoolId, onEditItem, onDeleteItem, onProbeItem, onUpdateLocalToken, {
    remoteMode,
    allowProbe,
    readOnly,
  });

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card className="dashboard-hero-card" bordered={false}>
        <Title level={2} style={{ marginTop: 0 }}>池管理</Title>
        <Paragraph>统一维护账号池和 API 池的 `pool.json`，新增、编辑、删除会自动保存。</Paragraph>
        {readOnly ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={readOnlyReason || "当前远端存储不可写，不能写入加密池文件。"}
          />
        ) : null}
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
            <Button type="primary" icon={<PlusOutlined />} onClick={() => onAddItem(activePoolId)} disabled={readOnly}>
              新增
            </Button>
            {onImportPool ? (
              <Button icon={<ImportOutlined />} onClick={() => onImportPool(activePoolId)} loading={importBusy} disabled={readOnly}>
                导入 JSON
              </Button>
            ) : null}
            <Button icon={<ReloadOutlined />} onClick={() => onReload(activePoolId)}>
              重新加载
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
          rowKey={(record) => `${activePoolId}-${record.__sourceIndex}`}
          columns={columns}
          dataSource={tableItems}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 980 }}
          locale={{ emptyText: "当前池还没有条目。" }}
        />
      </Card>
    </Space>
  );
}

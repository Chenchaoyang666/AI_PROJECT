# src

`src/` 现在承载两套运行时的源码：

- 本地模式
  - 本地代理脚本
  - 本地管理台后端 / 前端
- Hugging Face 模式
  - 单进程远端安全服务
  - OAuth 保护的 `/admin`
  - 写入挂载到 `/data` 的 Bucket 的加密池存储

## 当前目录结构

```text
src/
├── README.md
├── hf-space/
│   ├── admin-auth.mjs
│   ├── encrypted-pool-store.mjs
│   ├── encrypted-pool-store.test.mjs
│   ├── server.mjs
│   └── server.test.mjs
├── proxy/
│   ├── api-endpoint-pool.mjs
│   ├── api-endpoint-pool.test.mjs
│   ├── codex-account-pool.mjs
│   └── codex-account-pool.test.mjs
├── scripts/
│   ├── api-pool-proxy.mjs
│   ├── check-symlink-skills.sh
│   ├── clean-codex-home.sh
│   ├── codex-local-proxy.mjs
│   ├── configure-codex-local-proxy.mjs
│   ├── migrate-codex-acc-pool.mjs
│   ├── probe-llm-endpoint.mjs
│   └── switch-codex-account.mjs
├── shared/
│   ├── pool-crypto.mjs
│   └── secret-sanitizer.mjs
├── ui-app/
│   ├── App.jsx
│   ├── components/
│   ├── main.jsx
│   ├── pages/
│   ├── styles.css
│   └── view-helpers.js
└── ui-server/
    ├── api-pool-proxy-manager.mjs
    ├── api-pool-proxy-manager.test.mjs
    ├── dev.mjs
    ├── history-store.mjs
    ├── pool-store.mjs
    ├── pool-store.test.mjs
    ├── proxy-manager.mjs
    ├── run-manager.mjs
    ├── server.mjs
    ├── tool-registry.mjs
    └── tool-registry.test.mjs
```

## 模块说明

### `proxy/`

- `proxy/codex-account-pool.mjs`
  - 账号池核心模块
  - 负责：
    - 加载 `acc_pool/pool.json`
    - 识别账号结构
    - 预检账号完整性
    - refresh token 刷新
    - 上游探活
    - 失败分类与冷却
    - 当前账号切换
    - 支持可注入的快照加载 / 持久化接口，供远端模式复用

- `proxy/codex-account-pool.test.mjs`
  - 账号池核心测试
  - 覆盖：
    - 失败分类
    - JWT 解析
    - refresh token 必填规则
    - `auth.json` 结构账号加载
    - `pool.json` 数组加载
    - `pool.json` 刷新持久化

- `proxy/api-endpoint-pool.mjs`
  - API 节点池核心模块
  - 负责：
    - 加载 `api_pool/codex/pool.json` 和 `api_pool/claude-code/pool.json`
    - 校验 `apiUrl + apiKey` 节点结构
    - 支持数组格式和旧的单文件单节点格式
    - 当目录里存在 `pool.json` 时优先只读取它
    - 按 provider 过滤可用节点
    - 探活、失败分类、冷却和顺序轮询切换
    - 支持可注入快照源，供远端模式复用

- `proxy/api-endpoint-pool.test.mjs`
  - API 节点池测试

### `scripts/`

- `scripts/codex-local-proxy.mjs`
  - 本地 Codex 账号池代理入口
  - 默认监听 `127.0.0.1:8787`
  - 同时导出可复用的 `createProxyService` / `createProxyServer`

- `scripts/api-pool-proxy.mjs`
  - 本地 API 池轮询代理入口
  - 默认监听 `127.0.0.1:8789`
  - 同时导出可复用的 `createApiPoolProxyService` / `createApiPoolProxyServer`

- `scripts/configure-codex-local-proxy.mjs`
  - 把本机 Codex 配置改为指向某个 OpenAI 兼容代理
  - 会写入：
    - `~/.codex/auth.json`
    - `~/.codex/config.toml`

- `scripts/switch-codex-account.mjs`
  - 单账号切换脚本

- `scripts/migrate-codex-acc-pool.mjs`
  - 把旧的 `acc_pool/*.json` 合并成 `acc_pool/pool.json`

- `scripts/probe-llm-endpoint.mjs`
  - LLM 地址兼容性探测脚本

- `scripts/clean-codex-home.sh`
  - 保守清理 `~/.codex`

### `shared/`

- `shared/secret-sanitizer.mjs`
  - 敏感信息打码和日志脱敏
  - 处理：
    - `Authorization`
    - `x-api-key`
    - `access_token`
    - `refresh_token`
    - `apiKey`
    - `OPENAI_API_KEY`

- `shared/pool-crypto.mjs`
  - AES-GCM 加密 / 解密池文件

### `ui-server/`

- `ui-server/server.mjs`
  - 本地脚本管理台后端入口
  - 提供：
    - `/api/tools`
    - `/api/pools`
    - `/api/runs`
    - `/api/history`
    - `/api/proxy/*`
    - `/api/api-pool/*`
    - `/api/app-config`

- `ui-server/tool-registry.mjs`
  - 本地模式工具注册表

- `ui-server/proxy-manager.mjs`
  - 本地 Codex 账号池代理子进程管理器

- `ui-server/api-pool-proxy-manager.mjs`
  - 本地 API 池代理子进程管理器

- `ui-server/run-manager.mjs`
  - 本地短时脚本执行和日志收集

- `ui-server/pool-store.mjs`
  - 本地 `pool.json` 读写和校验

### `ui-app/`

- `ui-app/App.jsx`
  - 管理台主入口
  - 同时支持：
    - 本地模式
    - 远端 `/admin` 模式

- `ui-app/pages/PoolManagePage.jsx`
  - 池管理页
  - 远端模式下支持导入 JSON、保存加密池、显示只读提示

- `ui-app/pages/ProxyPage.jsx`
  - 本地代理页

- `ui-app/pages/RemoteServicePage.jsx`
  - Hugging Face 远端服务页
  - 用于展示状态、日志和 `Reload 配置`

- `ui-app/components/UiShared.jsx`
  - 共享表格、编辑器、导入弹窗、日志卡片

### `hf-space/`

- `hf-space/server.mjs`
  - Hugging Face 单进程远端服务入口
  - 负责：
    - `/healthz`
    - `/admin`
    - `/oauth/start`
    - `/admin/api/*`
    - `/proxy/codex-account/*`
    - `/proxy/codex-api/*`
    - `/proxy/claude-api/*`

- `hf-space/admin-auth.mjs`
  - 管理员会话签名、OAuth state 处理、白名单检查
  - 当前登录逻辑会先显示中转页，再要求用户在新标签页中完成 OAuth

- `hf-space/encrypted-pool-store.mjs`
  - 远端池存储层
  - 把池数据加密后写到挂载在 `/data` 的 Bucket
  - 路径：
    - `/data/pools/codex-accounts.enc`
    - `/data/pools/codex-api.enc`
    - `/data/pools/claude-code-api.enc`
  - 如果 `/data` 没挂 Bucket，会自动退化为只读

- `hf-space/*.test.mjs`
  - 远端模式测试
  - 覆盖：
    - 管理员鉴权隔离
    - 代理 Bearer Key 隔离
    - 导入 / 保存加密池
    - reload
    - 公网隐藏 `/proxy/status`

## 常用命令

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 迁移 Codex 账号池 | `npm run migrate:codex-pool` | 生成 `acc_pool/pool.json` 并备份旧文件 |
| 启动本地 Codex 代理 | `npm run proxy:codex` | 默认监听 `127.0.0.1:8787` |
| 启动本地 API 池代理 | `npm run proxy:api-pool -- --provider=codex --pool-dir=api_pool/codex --port=8789` | 默认监听 `127.0.0.1:8789` |
| 启动本地脚本管理台 | `npm run ui:dev` | 启动本地 Web 管理台开发环境 |
| 构建管理台前端 | `npm run ui:build` | 构建 React 界面产物 |
| 启动 HF 远端服务 | `npm run hf:server` | 启动 Hugging Face 单进程安全代理和管理台 |
| 测试代理逻辑 | `npm run test:proxy` | 只跑 `src/proxy/*.test.mjs` 和 `src/scripts/*.test.mjs` |
| 运行全部测试 | `npm test` | 运行仓库内全部测试，包括 `src/hf-space/*.test.mjs` |

## 设计备注

- 本地模式和远端模式共享同一套池逻辑，不重复维护两份切换策略
- 远端模式不暴露本地 `start/stop` 风格接口，而是改成常驻托管服务 + 手动 `reload`
- 远端模式下的池数据永远以加密文件形式落到 `/data`
- 公开代理入口和管理员登录是两套完全独立的鉴权边界

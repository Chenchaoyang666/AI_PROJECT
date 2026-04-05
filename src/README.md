# src

`src/` 现在只承载两类内容：

- `proxy/`
  - Codex 账号池与 API 节点池逻辑
- `scripts/`
  - 启动代理、API 池代理、账号池迁移、本地切号、接口探测等命令行入口
- `ui-server/` + `ui-app/`
  - 本地脚本管理台的后端和前端

## 当前目录结构

```text
src/
├── README.md
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
│   ├── migrate-codex-acc-pool.mjs
│   ├── configure-codex-local-proxy.mjs
│   ├── probe-llm-endpoint.mjs
│   └── switch-codex-account.mjs
├── ui-app/
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
└── ui-server/
    ├── dev.mjs
    ├── api-pool-proxy-manager.mjs
    ├── api-pool-proxy-manager.test.mjs
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

- `proxy/codex-account-pool.test.mjs`
  - 账号池核心测试
  - 覆盖：
    - 失败分类
    - JWT 解析
    - refresh token 必填规则
    - 扁平格式账号加载
    - `auth.json` 结构账号加载
    - `pool.json` 数组加载
    - `pool.json` 刷新持久化

- `proxy/api-endpoint-pool.mjs`
  - API 节点池核心模块
  - 负责：
    - 加载 `api_pool/codex/pool.json` 和 `api_pool/claude-code/pool.json`
    - 校验 `apiUrl + apiKey` 节点结构
    - 支持单文件数组格式，并兼容旧的单文件单节点格式
    - 当目录里存在 `pool.json` 时，优先只读取 `pool.json`
    - 按 provider 过滤可用节点
    - 探活、失败分类、冷却和顺序轮询切换

- `proxy/api-endpoint-pool.test.mjs`
  - API 节点池测试
  - 覆盖：
    - 节点结构校验
    - provider 过滤
    - 失败后切换
    - 全部节点冷却时无可用节点

- `scripts/codex-local-proxy.mjs`
  - 本地 OpenAI 兼容代理入口
  - 默认监听 `127.0.0.1:8787`
  - 支持：
    - `GET /models`
    - `POST /responses`
    - `GET /v1/models`
    - `POST /v1/responses`
    - `POST /v1/chat/completions`
  - 启动时会输出账号池加载、refresh、probe、初始账号选择等阶段日志

- `scripts/api-pool-proxy.mjs`
  - API 池轮询代理入口
  - 默认监听 `127.0.0.1:8789`
  - 支持：
    - `provider=codex` 时转发 `/models`、`/responses`、`/v1/models`、`/v1/responses`、`/v1/chat/completions`
    - `provider=claude-code` 时转发 `/v1/messages`、`/messages`、`/v1/models`
  - 失败后会自动切换到下一个可用节点

- `scripts/configure-codex-local-proxy.mjs`
  - 把本机 Codex 配置改为指向本地代理
  - 会写入：
    - `~/.codex/auth.json`
    - `~/.codex/config.toml`

- `scripts/switch-codex-account.mjs`
  - 单账号切换脚本
  - 从 `acc_pool/pool.json` 中顺序挑选可用账号
  - 验证通过后回写本机 Codex 配置

- `scripts/migrate-codex-acc-pool.mjs`
  - 把旧的 `acc_pool/*.json` 合并成 `acc_pool/pool.json`
  - 并把旧文件移动到 `acc_pool/_backup/<timestamp>/`

- `scripts/probe-llm-endpoint.mjs`
  - LLM 地址兼容性探测脚本
  - 输出 JSON 和 Markdown 报告

- `scripts/check-symlink-skills.sh`
  - 本地辅助检查脚本

- `scripts/clean-codex-home.sh`
  - 保守清理 `~/.codex` 的脚本
  - 默认删除：
    - `.tmp/`
    - `tmp/`
    - `cache/`
    - `shell_snapshots/`
    - `models_cache.json`
    - `version.json`
    - 所有 `.DS_Store`
  - 加 `--with-logs` 时会额外删除：
    - `logs_1.sqlite`
    - `logs_1.sqlite-shm`
    - `logs_1.sqlite-wal`
  - 结束时会输出清理前后大小和释放空间

- `ui-server/server.mjs`
  - 本地脚本管理台后端入口
  - 提供：
    - `GET /api/tools`
    - `GET /api/pools`
    - `GET /api/pools/:id`
    - `PUT /api/pools/:id`
    - `POST /api/pools/:id/validate`
    - `POST /api/runs`
    - `GET /api/runs/:id`
    - `GET /api/runs/:id/logs`
    - `GET /api/history`
    - `POST /api/proxy/start`
    - `POST /api/proxy/stop`
    - `GET /api/proxy/status`
    - `POST /api/api-pool/start`
    - `POST /api/api-pool/stop`
    - `GET /api/api-pool/status`

- `ui-server/tool-registry.mjs`
  - 管理台工具注册表
  - 当前定义了：
    - 池管理
    - 本地代理
    - API 池代理
    - LLM 探测
  - 其中本地代理的 `proxyUrl` 默认值已设为 `http://127.0.0.1:8118`

- `ui-app/App.jsx`
  - 管理台主界面
  - “池管理”页支持：
    - 编辑 Codex 账号池和 API 池的 `pool.json`
    - 新增、编辑、删除和保存
    - 敏感字段遮罩显示
  - 当前“本地代理”页会展示：
    - 运行状态、PID、代理地址、启动时间
    - 账号总数、健康账号数、冷却中账号数
    - 当前活跃账号信息
    - 实时日志和最近历史
  - “API 池代理”页会展示：
    - provider、运行状态、PID、代理地址、启动时间
    - 节点总数、健康节点数、冷却中节点数
    - 当前活跃节点信息
    - 实时日志和最近历史

## 常用命令

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 迁移 Codex 账号池 | `npm run migrate:codex-pool` | 生成 `acc_pool/pool.json` 并备份旧文件 |
| 启动本地代理 | `npm run proxy:codex` | 默认监听 `127.0.0.1:8787` |
| 启动 API 池代理 | `npm run proxy:api-pool -- --provider=codex --pool-dir=api_pool/codex --port=8789` | 默认监听 `127.0.0.1:8789` |
| 通过代理访问 OpenAI 上游 | `npm run proxy:codex -- --proxy-url=http://127.0.0.1:8118` | 适用于本机访问上游必须先过 HTTP 代理的情况 |
| 测试账号池逻辑 | `npm run test:proxy` | 只跑 `src/proxy/*.test.mjs` |
| 切换单个可用账号到本机 Codex | `npm run switch:codex -- --dry-run` | 先验证账号，不实际写回本机配置 |
| 探测 LLM 地址兼容性 | `npm run probe:llm -- --baseUrl=https://example.com --key=sk-xxx` | 输出 JSON 和 Markdown 探测报告 |
| 保守清理 `~/.codex` | `npm run clean:codex-home` | 清理缓存、临时文件和 shell 快照 |
| 保守清理并删除日志数据库 | `npm run clean:codex-home -- --with-logs` | 额外删除 `logs_1.sqlite*` |
| 启动本地脚本管理台 | `npm run ui:dev` | 启动本地 Web 管理台开发环境 |
| 构建本地脚本管理台 | `npm run ui:build` | 构建 React 界面产物，供本地后端静态托管 |

默认上游现在是 `https://chatgpt.com/backend-api/codex`，用于当前这类 `auth_mode=chatgpt` 的 Codex 登录态账号。
在这个模式下，优先支持：

- `GET /models`
- `POST /responses`
- `GET /v1/models`
- `POST /v1/responses`

`/v1/chat/completions` 暂时不走这类上游。

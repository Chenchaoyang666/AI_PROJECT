# src

`src/` 现在只承载两类内容：

- `proxy/`
  - Codex 账号池与切换逻辑
- `scripts/`
  - 启动代理、配置 Codex、本地切号、接口探测等命令行入口
- `ui-server/` + `ui-app/`
  - 本地脚本管理台的后端和前端

## 当前目录结构

```text
src/
├── README.md
├── proxy/
│   ├── codex-account-pool.mjs
│   └── codex-account-pool.test.mjs
├── scripts/
│   ├── check-symlink-skills.sh
│   ├── clean-codex-home.sh
│   ├── codex-local-proxy.mjs
│   ├── configure-codex-local-proxy.mjs
│   ├── probe-llm-endpoint.mjs
│   └── switch-codex-account.mjs
├── ui-app/
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
└── ui-server/
    ├── dev.mjs
    ├── history-store.mjs
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
    - 加载 `acc_pool/*.json`
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

- `scripts/configure-codex-local-proxy.mjs`
  - 把本机 Codex 配置改为指向本地代理
  - 会写入：
    - `~/.codex/auth.json`
    - `~/.codex/config.toml`

- `scripts/switch-codex-account.mjs`
  - 单账号切换脚本
  - 从 `acc_pool/*.json` 中顺序挑选可用账号
  - 验证通过后回写本机 Codex 配置

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
    - `POST /api/runs`
    - `GET /api/runs/:id`
    - `GET /api/runs/:id/logs`
    - `GET /api/history`
    - `POST /api/proxy/start`
    - `POST /api/proxy/stop`
    - `GET /api/proxy/status`

- `ui-server/tool-registry.mjs`
  - 管理台工具注册表
  - 当前定义了：
    - 本地代理
    - 配置 Codex
    - 切换账号
    - LLM 探测
  - 其中本地代理的 `proxyUrl` 默认值已设为 `http://127.0.0.1:8118`

- `ui-app/App.jsx`
  - 管理台主界面
  - 当前“本地代理”页会展示：
    - 运行状态、PID、代理地址、启动时间
    - 账号总数、健康账号数、冷却中账号数
    - 当前活跃账号信息
    - 实时日志和最近历史

## 常用命令

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 启动本地代理 | `npm run proxy:codex` | 默认监听 `127.0.0.1:8787` |
| 通过代理访问 OpenAI 上游 | `npm run proxy:codex -- --proxy-url=http://127.0.0.1:8118` | 适用于本机访问上游必须先过 HTTP 代理的情况 |
| 把 Codex 配置到本地代理 | `npm run proxy:codex:configure` | 回写 `~/.codex/auth.json` 和 `~/.codex/config.toml` |
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

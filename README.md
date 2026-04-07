---
title: AI Project Secure Proxy
emoji: 🛡️
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
hf_oauth: true
---

# AI_PROJECT

这个仓库现在维护两套运行形态：

- 本地模式：`Codex 账号池 + API 池 + 本地管理台`
- Hugging Face 模式：`单个 Docker Space + OAuth 保护的管理台 + private dataset 持久化`

核心目标：

- 从 `acc_pool/` 加载多个 Codex ChatGPT 登录态账号
- 从 `api_pool/` 加载 Claude Code / Codex 的 `apiUrl + apiKey` 节点池
- 校验账号可用性并管理 refresh / cooldown / 切换
- 提供本地和远端两种 OpenAI / Anthropic 兼容代理入口
- 用同一套管理台维护池配置、状态和日志
- 让 API 池节点按周期轮换，避免长期只有单个节点承接真实流量

## 当前目录结构

```text
AI_PROJECT/
├── acc_pool/
│   ├── _backup/
│   └── pool.json
├── api_pool/
│   ├── claude-code/
│   │   └── pool.json
│   └── codex/
│       └── pool.json
├── dist/
│   └── ui/
├── reports/
│   ├── architecture/
│   └── llm-probe/
├── src/
│   ├── README.md
│   ├── hf-space/
│   │   ├── admin-auth.mjs
│   │   ├── encrypted-pool-store.mjs
│   │   ├── encrypted-pool-store.test.mjs
│   │   ├── server.mjs
│   │   └── server.test.mjs
│   ├── proxy/
│   │   ├── api-endpoint-pool.mjs
│   │   ├── api-endpoint-pool.test.mjs
│   │   ├── codex-account-pool.mjs
│   │   └── codex-account-pool.test.mjs
│   ├── shared/
│   │   ├── pool-crypto.mjs
│   │   └── secret-sanitizer.mjs
│   ├── scripts/
│   │   ├── api-pool-proxy.mjs
│   │   ├── check-symlink-skills.sh
│   │   ├── clean-codex-home.sh
│   │   ├── codex-local-proxy.mjs
│   │   ├── configure-codex-local-proxy.mjs
│   │   ├── migrate-codex-acc-pool.mjs
│   │   ├── probe-llm-endpoint.mjs
│   │   └── switch-codex-account.mjs
│   ├── ui-app/
│   └── ui-server/
├── .dockerignore
├── Dockerfile
├── package.json
├── package-lock.json
└── README.md
```

## 模块说明

- `src/proxy/`
  - 账号池和 API 节点池核心逻辑
  - 负责：
    - 账号 / 节点加载
    - 预检与探活
    - refresh / cooldown / 故障切换
    - 当前活跃账号 / 节点切换
    - API 池定时切活跃节点

- `src/scripts/`
  - 本地模式脚本入口
  - 包含：
    - 本地代理启动
    - API 池代理启动
    - 账号池迁移
    - 本机 Codex 配置
    - 单账号切换
    - LLM 探测
    - `~/.codex` 保守清理

- `src/ui-server/` + `src/ui-app/`
  - 本地模式管理台
  - 支持池管理、代理启停、日志查看和 LLM 探测

- `src/hf-space/`
  - Hugging Face 远端运行时
  - 负责：
    - `/admin` 管理台登录和 OAuth 中转
    - `/proxy/codex-account`
    - `/proxy/codex-api`
    - `/proxy/claude-api`
    - 把池数据加密后写入 private hf dataset
    - 隔离管理员会话和代理 Bearer Key

- `src/shared/`
  - 本地 / 远端共用的底层能力
  - 目前包含：
    - 敏感信息打码
    - AES-GCM 池文件加密 / 解密

## 常用命令

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 安装依赖 | `npm install` | 安装项目依赖 |
| 迁移 Codex 账号池到 `pool.json` | `npm run migrate:codex-pool` | 合并 `acc_pool/*.json` 到 `acc_pool/pool.json` 并备份旧文件 |
| 启动本地 Codex 账号池代理 | `npm run proxy:codex` | 启动本地 OpenAI 兼容代理 |
| 启动本地 API 池代理 | `npm run proxy:api-pool -- --provider=codex --pool-dir=api_pool/codex --port=8789` | 轮询 `apiUrl + apiKey` 节点池 |
| 启动本地脚本管理台 | `npm run ui:dev` | 同时启动本地 Node 后端和 React 前端 |
| 构建管理台前端 | `npm run ui:build` | 构建到 `dist/ui` |
| 启动 HF 远端安全服务 | `npm run hf:server` | 运行 Hugging Face 单进程安全代理和管理台 |
| 单独测试代理逻辑 | `npm run test:proxy` | 只运行账号池 / API 池相关测试 |
| 运行全部测试 | `npm test` | 运行仓库内全部测试 |
| 探测某个 LLM 地址 | `npm run probe:llm -- --baseUrl=https://example.com --key=sk-xxx` | 输出兼容性探测结果 |
| 保守清理 `~/.codex` | `npm run clean:codex-home` | 清理缓存、临时文件和 shell 快照 |

## 本地模式

本地模式下，管理台是一个减少重复手敲命令的 Web 界面。

支持的页面：

| 页面 | 能力 |
| --- | --- |
| 池管理 | 编辑 `acc_pool/pool.json`、`api_pool/codex/pool.json`、`api_pool/claude-code/pool.json` |
| API 池代理 | 启动 / 停止 Claude Code 或 Codex 的 API 池代理 |
| Codex 账号池代理 | 启动 / 停止 Codex 账号池代理 |
| LLM 探测 | 探测目标地址兼容性并查看报告 |

开发时启动：

```bash
npm run ui:dev
```

构建静态前端：

```bash
npm run ui:build
```

## 池文件格式

Codex 账号池推荐使用单个 `acc_pool/pool.json`：

```json
[
  {
    "type": "codex",
    "disabled": false,
    "email": "user@example.com",
    "last_refresh": "2026-04-05T10:00:00.000Z",
    "tokens": {
      "access_token": "eyJ...",
      "account_id": "acc-123",
      "id_token": "eyJ...",
      "refresh_token": "rt_123"
    }
  }
]
```

API 池推荐使用单个 `pool.json` 文件：

```json
[
  {
    "name": "codex-main-1",
    "type": "codex",
    "baseUrl": "https://example.com/v1",
    "apiKey": "sk-xxx",
    "model": "gpt-5.4",
    "disabled": false
  },
  {
    "name": "codex-backup-1",
    "type": "codex",
    "baseUrl": "https://backup.example.com/v1",
    "apiKey": "sk-yyy",
    "model": "gpt-5.4",
    "disabled": false
  }
]
```

Claude Code 节点只需要把 `type` 改成 `claude-code`，目录放到 `api_pool/claude-code/pool.json`。

## API 池定时切换

API 池现在不再只在“失败时切换”。

默认行为：

- 默认开启定时切换
- 默认每 `15 分钟` 尝试把当前活跃节点切到下一个健康节点
- 如果当前存在在途请求，则先延后，等空闲窗口再切
- 切换前会先对候选节点做轻量探活
- 如果没有可切换的健康节点，则保持当前活跃节点不变

这样做的目的，是让所有 API 节点都能周期性承接真实业务流量，避免某些节点长期轮不到。

本地模式可配置项：

- `enableScheduledSwitch`
- `scheduledSwitchIntervalMs`

Hugging Face 模式环境变量：

- `API_POOL_SCHEDULED_SWITCH_ENABLED`
- `API_POOL_SCHEDULED_SWITCH_INTERVAL_MS`

Hugging Face 远端管理台可配置项：

- `API 池代理` 页面支持直接修改 `启用定时切换` 和 `定时切换间隔（毫秒）`
- 保存后会把远端运行配置写入 private hf dataset 的 `config/api-pool-runtime.json`
- 保存完成后会自动 reload 当前选中的远端 API 池服务
- 这份配置独立于池条目本身，主要控制远端常驻代理的运行参数

## Hugging Face 安全部署

这个仓库支持部署成单个 Docker Space。

### 必需的 Secrets

- `ADMIN_HF_USERNAMES`
- `ADMIN_SESSION_SECRET`
- `POOL_CRYPTO_KEY`
- `HF_TOKEN`
- `CODEX_ACCOUNT_PROXY_KEY`
- `CODEX_API_PROXY_KEY`
- `CLAUDE_API_PROXY_KEY`

### 平台配置

- 在 README frontmatter 里保持 `hf_oauth: true`
- 配置 `HF_DATASET_REPO=<user-or-org>/<private-dataset-name>`
- 可选：配置 `HF_DATASET_BRANCH`，默认 `main`
- 可选：配置 `POOL_STORAGE_BACKEND=hf-dataset`；如果设置了 `HF_DATASET_REPO`，服务会默认走 dataset 后端
- `DATA_DIR` 现在只作为本地缓存目录使用，默认会在其中维护 `.hf-dataset-cache`

### 可直接上线的环境变量清单

Secrets：

- `HF_TOKEN`：用于读写 private Space repo 和 private dataset
- `HF_DATASET_REPO`：格式为 `<user-or-org>/<private-dataset-name>`
- `POOL_CRYPTO_KEY`：用于加密 `pools/*.enc`
- `ADMIN_SESSION_SECRET`：管理员登录态签名密钥
- `ADMIN_HF_USERNAMES`：允许进入 `/admin` 的 HF 用户名，多个用逗号分隔
- `CODEX_ACCOUNT_PROXY_KEY`：`/proxy/codex-account` 的 Bearer Key
- `CODEX_API_PROXY_KEY`：`/proxy/codex-api` 的 Bearer Key
- `CLAUDE_API_PROXY_KEY`：`/proxy/claude-api` 的 Bearer Key

Variables：

- `POOL_STORAGE_BACKEND=hf-dataset`
- `HF_DATASET_BRANCH=main`
- `DATA_DIR=/tmp/hf-space-data`
- `PORT=7860`

可选 Variables：

- `CODEX_PROXY_UPSTREAM_BASE`
- `CODEX_PROXY_REFRESH_ENDPOINT`
- `CODEX_PROXY_PROBE_URL`
- `CODEX_PROXY_MAX_SWITCH_ATTEMPTS`
- `CODEX_PROXY_REQUEST_TIMEOUT_MS`
- `CODEX_PROXY_UPSTREAM_PROXY`
- `CODEX_PROXY_CLIENT_VERSION`
- `API_POOL_MAX_SWITCH_ATTEMPTS`
- `API_POOL_REQUEST_TIMEOUT_MS`
- `API_POOL_SCHEDULED_SWITCH_ENABLED`
- `API_POOL_SCHEDULED_SWITCH_INTERVAL_MS`
- `API_POOL_PROXY_URL`

说明：

- `OAUTH_CLIENT_ID`
- `OAUTH_CLIENT_SECRET`
- `OPENID_PROVIDER_URL`

这些变量在 `hf_oauth: true` 打开后会由 Hugging Face 自动注入，不需要你手动填写。

### 远端路由

- 管理台：`/admin`
- Codex 账号池代理：`/proxy/codex-account`
- Codex API 池代理：`/proxy/codex-api`
- Claude API 池代理：`/proxy/claude-api`

### 远端模式注意事项

- 不要把 `acc_pool/`、`api_pool/`、`.local-ui-data/` 上传到 Space 仓库
- 池数据会加密后写入 private hf dataset 里的 `pools/*.enc`
- 代理 Bearer Key 和管理员会话是两套独立鉴权，不能混用
- 未登录访问 `/admin` 时，会先显示一个登录中转页；请在新标签页完成 OAuth
- 如果 `HF_TOKEN` 或 `HF_DATASET_REPO` 缺失，远端池管理会自动退化为只读
- API 池的定时切换在远端模式下同样默认开启
- 远端模式下可以在管理台直接调整 API 池定时切换开关和间隔；配置会持久化到 private hf dataset 的 `config/api-pool-runtime.json`

### 远端模式推荐使用流程

1. 打开 `https://<space>.hf.space/admin`
2. 在登录中转页点击“在新标签页登录”
3. 登录后进入池管理
4. 导入账号池或 API 池 JSON
5. 如需调整远端 API 池轮换策略，进入 `API 池代理` 页面修改定时切换开关或间隔，并点击“保存并重载当前服务”
6. 如果只改了池文件内容，再点击 `Reload 配置`
7. 再把本地客户端指向对应 `/proxy/*` 路由

### 本地客户端固定接入形态

- Codex 账号池：`https://<space>.hf.space/proxy/codex-account`
- Codex API 池：`https://<space>.hf.space/proxy/codex-api`
- Claude API 池：`https://<space>.hf.space/proxy/claude-api`

## 接手建议

如果你是第一次接手这个仓库，建议阅读顺序：

1. 先看本文件，了解仓库的本地 / 远端两种运行方式
2. 再看 [src/README.md](/Users/chenchaoyang/my-project/AI_PROJECT/src/README.md)，了解脚本入口和池格式
3. 看 [server.mjs](/Users/chenchaoyang/my-project/AI_PROJECT/src/hf-space/server.mjs)，了解远端安全代理和管理台入口
4. 最后看 [codex-account-pool.mjs](/Users/chenchaoyang/my-project/AI_PROJECT/src/proxy/codex-account-pool.mjs)，理解账号池和切换逻辑

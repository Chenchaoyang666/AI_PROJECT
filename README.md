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

这个仓库现在专门用于维护一套本地 `Codex 账号池 + OpenAI 兼容代理` 工作流。

核心目标：

- 从 `acc_pool/` 加载多个 Codex ChatGPT 登录态账号
- 从 `api_pool/` 加载 Claude Code / Codex 的 `apiUrl + apiKey` 节点池
- 校验账号可用性并管理 refresh / cooldown / 切换
- 启动一个本地 OpenAI 兼容代理，供 Codex 或其他客户端接入
- 提供本机配置脚本，把 Codex 指向本地代理

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
├── reports/
│   └── llm-probe/
├── src/
│   ├── README.md
│   ├── proxy/
│   │   ├── api-endpoint-pool.mjs
│   │   ├── api-endpoint-pool.test.mjs
│   │   ├── codex-account-pool.mjs
│   │   └── codex-account-pool.test.mjs
│   └── scripts/
│       ├── api-pool-proxy.mjs
│       ├── codex-local-proxy.mjs
│       ├── migrate-codex-acc-pool.mjs
│       ├── configure-codex-local-proxy.mjs
│       ├── probe-llm-endpoint.mjs
│       ├── switch-codex-account.mjs
│       └── check-symlink-skills.sh
├── package.json
├── package-lock.json
└── README.md
```

## 目录说明

- `acc_pool/`
  - 账号池目录
  - 默认使用 `pool.json` 数组格式管理多个 Codex 账号
  - 运行时只读取 `pool.json`
  - 旧的散文件可迁移到 `_backup/` 目录保留备份

- `src/proxy/`
  - 账号池核心逻辑
  - 负责账号加载、预检、refresh、探活、失败分类、冷却和切换策略
  - 其中：
    - `codex-account-pool.mjs` 管理 `acc_pool/` 的登录态账号
    - `api-endpoint-pool.mjs` 管理 `api_pool/` 的 `apiUrl + apiKey` 节点池

- `src/scripts/`
  - 可直接执行的脚本入口
  - 目前主要包含：
    - 本地代理启动脚本
    - API 池轮询代理启动脚本
    - Codex 账号池迁移脚本
    - Codex 本机配置脚本
    - 单账号切换脚本
    - LLM 接口探测脚本
    - `~/.codex` 保守清理脚本

- `reports/`
  - 脚本输出目录
  - 当前用于保存 LLM 探测报告

- `src/ui-server/`
  - 本地脚本管理台后端
  - 负责：
    - 暴露工具定义接口
    - 执行脚本并收集日志
    - 管理本地代理进程
    - 保存最近运行历史

- `src/ui-app/`
  - 本地脚本管理台前端
  - 当前包含 4 个 Tab：
    - 池管理
    - API 池代理
    - Codex 账号池代理
    - LLM 探测

## 常用命令

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 安装依赖 | `npm install` | 安装项目依赖 |
| 迁移 Codex 账号池到 `pool.json` | `npm run migrate:codex-pool` | 合并 `acc_pool/*.json` 到 `acc_pool/pool.json` 并备份旧文件 |
| 启动本地代理 | `npm run proxy:codex` | 启动本地 OpenAI 兼容代理 |
| 启动 API 池代理 | `npm run proxy:api-pool -- --provider=codex --pool-dir=api_pool/codex --port=8789` | 默认用于 `apiUrl + apiKey` 节点池轮询 |
| 启动本地代理并走上游代理 | `npm run proxy:codex -- --proxy-url=http://127.0.0.1:8118` | 第一个 `--` 表示后面的参数传给脚本本身；适用于本机访问上游必须走 HTTP 代理的情况 |
| 单独测试账号池逻辑 | `npm run test:proxy` | 只运行账号池相关测试 |
| 运行全部测试 | `npm test` | 运行仓库内全部测试 |
| 探测某个 LLM 地址 | `npm run probe:llm -- --baseUrl=https://example.com --key=sk-xxx` | 输出兼容性探测结果 |
| 保守清理 `~/.codex` | `npm run clean:codex-home` | 清理缓存、临时文件和 shell 快照 |
| 保守清理并删除日志数据库 | `npm run clean:codex-home -- --with-logs` | 额外删除 `logs_1.sqlite*`；脚本会输出清理前后体积和释放空间 |
| 启动本地脚本管理台 | `npm run ui:dev` | 同时启动本地 Node 后端和 React 界面 |
| 构建本地脚本管理台 | `npm run ui:build` | 构建 React 界面产物到 `dist/ui` |
| 启动 HF 远端安全服务 | `npm run hf:server` | 运行 Hugging Face 单进程安全代理和管理台 |

脚本会在结束时输出清理前后体积，以及大概释放了多少空间。

## 本地脚本管理台

本地脚本管理台是这个仓库新增的一层 Web 界面，用来减少反复手敲命令。

当前支持的 Tab：

| Tab | 能力 |
| --- | --- |
| 池管理 | 编辑 `acc_pool/pool.json`、`api_pool/codex/pool.json`、`api_pool/claude-code/pool.json`，支持新增 / 修改 / 删除 / 保存 |
| API 池代理 | 启动 / 停止 Claude Code 或 Codex 的 API 池代理，查看节点状态、活跃节点和实时日志 |
| Codex 账号池代理 | 启动 / 停止代理，查看状态、实时日志、账号池摘要和当前活跃账号 |
| LLM 探测 | 探测目标地址兼容性，并查看报告输出路径 |

关于“池管理”页，当前支持：

- 账号池和 API 池的两级切换
- 列表化查看当前池条目
- 新增、编辑、删除条目
- 校验后手动保存到对应 `pool.json`
- 敏感字段默认遮罩，编辑时可显示 / 替换

关于“Codex 账号池代理”页，当前已经补上的信息有：

- 默认上游 HTTP 代理是 `http://127.0.0.1:8118`
- 运行状态、PID、代理地址、启动时间
- 账号总数、健康账号数、冷却中账号数
- 当前活跃账号的文件名、`accountId`、最近验证时间、最近失败原因
- `healthz` 和 `/proxy/status` 联动得到的在线状态

Codex 账号池推荐使用单个 `acc_pool/pool.json` 文件，里面放数组：

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

关于“API 池代理”页，当前支持：

- 在 `codex` 和 `claude-code` 两种 provider 间切换
- 默认使用不冲突的 `8789` 端口
- 从 `api_pool/codex/pool.json` 或 `api_pool/claude-code/pool.json` 加载节点数组
- 失败后顺序轮询切换，节点进入 cooldown 后会自动跳过
- 展示当前活跃节点的名称、Base URL、模型、最近验证时间和最近失败原因

API 池推荐使用单个 `pool.json` 文件，里面放数组，后续直接追加对象即可。目录中如果存在 `pool.json`，加载器会优先只读取它：

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

如果是 Claude Code 节点，把 `type` 改为 `claude-code`，目录放到 `api_pool/claude-code/pool.json` 即可。当前也兼容旧的“一个文件一个节点”格式，但后续建议统一改成数组文件。

开发时启动：

```bash
npm run ui:dev
```

构建静态前端产物：

```bash
npm run ui:build
```

## Hugging Face 安全部署

这个仓库现在也支持以单个 Docker Space 方式部署到 Hugging Face。

部署前需要准备这些 Secrets：

- `ADMIN_HF_USERNAMES`
- `ADMIN_SESSION_SECRET`
- `POOL_CRYPTO_KEY`
- `CODEX_ACCOUNT_PROXY_KEY`
- `CODEX_API_PROXY_KEY`
- `CLAUDE_API_PROXY_KEY`
- `OAUTH_CLIENT_ID`
- `OAUTH_CLIENT_SECRET`
- `OPENID_PROVIDER_URL`
- `HF_OAUTH=1`

推荐把 Hugging Face Storage Bucket 以 `Read & Write` 模式挂载到 `/data`，并把 `DATA_DIR` 设为 `/data`。

远端部署后：

- 管理台入口：`/admin`
- Codex 账号池代理：`/proxy/codex-account`
- Codex API 池代理：`/proxy/codex-api`
- Claude API 池代理：`/proxy/claude-api`

注意：

- 不要把 `acc_pool/`、`api_pool/`、`.local-ui-data/` 上传到 Space 仓库
- 池数据会加密后写入挂载在 `/data` 下的 Bucket：`/data/pools/*.enc`
- 代理 Bearer Key 和管理员会话是两套独立鉴权，不能混用

## 接手建议

如果你是第一次接手这个仓库，建议阅读顺序：

1. 先看本文件，了解仓库用途和顶层结构
2. 再看 [src/README.md](/Users/chenchaoyang/my-project/AI_PROJECT/src/README.md)，了解各脚本入口和账号池支持格式
3. 最后看 [codex-account-pool.mjs](/Users/chenchaoyang/my-project/AI_PROJECT/src/proxy/codex-account-pool.mjs)，理解账号池和切换逻辑

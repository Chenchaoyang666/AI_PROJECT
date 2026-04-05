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
│   └── *.json
├── api_pool/
│   ├── claude-code/
│   │   └── *.json
│   └── codex/
│       └── *.json
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
  - 每个 JSON 文件对应一个可轮换的 Codex 账号
  - 当前支持两种结构：
    - 扁平 token 结构
    - 带 `tokens` 字段的 `auth.json` 结构

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
  - 当前包含 5 个 Tab：
    - 本地代理
    - API 池代理
    - 配置 Codex
    - 切换账号
    - LLM 探测

## 常用命令

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 安装依赖 | `npm install` | 安装项目依赖 |
| 启动本地代理 | `npm run proxy:codex` | 启动本地 OpenAI 兼容代理 |
| 启动 API 池代理 | `npm run proxy:api-pool -- --provider=codex --pool-dir=api_pool/codex --port=8789` | 默认用于 `apiUrl + apiKey` 节点池轮询 |
| 启动本地代理并走上游代理 | `npm run proxy:codex -- --proxy-url=http://127.0.0.1:8118` | 第一个 `--` 表示后面的参数传给脚本本身；适用于本机访问上游必须走 HTTP 代理的情况 |
| 把 Codex 指到本地代理 | `npm run proxy:codex:configure` | 回写本机 Codex 配置，让请求走本地代理 |
| 单独测试账号池逻辑 | `npm run test:proxy` | 只运行账号池相关测试 |
| 运行全部测试 | `npm test` | 运行仓库内全部测试 |
| 探测某个 LLM 地址 | `npm run probe:llm -- --baseUrl=https://example.com --key=sk-xxx` | 输出兼容性探测结果 |
| 保守清理 `~/.codex` | `npm run clean:codex-home` | 清理缓存、临时文件和 shell 快照 |
| 保守清理并删除日志数据库 | `npm run clean:codex-home -- --with-logs` | 额外删除 `logs_1.sqlite*`；脚本会输出清理前后体积和释放空间 |
| 启动本地脚本管理台 | `npm run ui:dev` | 同时启动本地 Node 后端和 React 界面 |
| 构建本地脚本管理台 | `npm run ui:build` | 构建 React 界面产物到 `dist/ui` |

脚本会在结束时输出清理前后体积，以及大概释放了多少空间。

## 本地脚本管理台

本地脚本管理台是这个仓库新增的一层 Web 界面，用来减少反复手敲命令。

当前支持的 Tab：

| Tab | 能力 |
| --- | --- |
| 本地代理 | 启动 / 停止代理，查看状态、实时日志、账号池摘要和当前活跃账号 |
| API 池代理 | 启动 / 停止 Claude Code 或 Codex 的 API 池代理，查看节点状态、活跃节点和实时日志 |
| 配置 Codex | 写入 `~/.codex/auth.json` 和 `~/.codex/config.toml`，运行前会二次确认 |
| 切换账号 | 从 `acc_pool/*.json` 中挑选可用账号，默认 `dryRun` 验证 |
| LLM 探测 | 探测目标地址兼容性，并查看报告输出路径 |

关于“本地代理”页，当前已经补上的信息有：

- 默认上游 HTTP 代理是 `http://127.0.0.1:8118`
- 运行状态、PID、代理地址、启动时间
- 账号总数、健康账号数、冷却中账号数
- 当前活跃账号的文件名、`accountId`、最近验证时间、最近失败原因
- `healthz` 和 `/proxy/status` 联动得到的在线状态

关于“API 池代理”页，当前支持：

- 在 `codex` 和 `claude-code` 两种 provider 间切换
- 默认使用不冲突的 `8789` 端口
- 从 `api_pool/codex` 或 `api_pool/claude-code` 加载 JSON 节点
- 失败后顺序轮询切换，节点进入 cooldown 后会自动跳过
- 展示当前活跃节点的名称、Base URL、模型、最近验证时间和最近失败原因

API 池单条配置示例：

```json
{
  "name": "codex-main-1",
  "type": "codex",
  "baseUrl": "https://example.com/v1",
  "apiKey": "sk-xxx",
  "model": "gpt-5.4",
  "disabled": false
}
```

如果是 Claude Code 节点，把 `type` 改为 `claude-code`，目录放到 `api_pool/claude-code/` 即可。

开发时启动：

```bash
npm run ui:dev
```

构建静态前端产物：

```bash
npm run ui:build
```

## 接手建议

如果你是第一次接手这个仓库，建议阅读顺序：

1. 先看本文件，了解仓库用途和顶层结构
2. 再看 [src/README.md](/Users/chenchaoyang/my-project/AI_PROJECT/src/README.md)，了解各脚本入口和账号池支持格式
3. 最后看 [codex-account-pool.mjs](/Users/chenchaoyang/my-project/AI_PROJECT/src/proxy/codex-account-pool.mjs)，理解账号池和切换逻辑

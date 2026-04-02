# src

`src/` 现在只承载两类内容：

- `proxy/`
  - Codex 账号池与切换逻辑
- `scripts/`
  - 启动代理、配置 Codex、本地切号、接口探测等命令行入口

## 当前目录结构

```text
src/
├── README.md
├── proxy/
│   ├── codex-account-pool.mjs
│   └── codex-account-pool.test.mjs
└── scripts/
    ├── check-symlink-skills.sh
    ├── codex-local-proxy.mjs
    ├── configure-codex-local-proxy.mjs
    ├── probe-llm-endpoint.mjs
    └── switch-codex-account.mjs
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
    - `GET /v1/models`
    - `POST /v1/responses`
    - `POST /v1/chat/completions`

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

## 常用命令

启动本地代理：

```bash
npm run proxy:codex
```

通过代理访问 OpenAI 上游：

```bash
npm run proxy:codex -- --proxy-url=http://127.0.0.1:8118
```

把 Codex 配置到本地代理：

```bash
npm run proxy:codex:configure
```

测试账号池逻辑：

```bash
npm run test:proxy
```

切换单个可用账号到本机 Codex：

```bash
npm run switch:codex -- --dry-run
```

探测 LLM 地址兼容性：

```bash
npm run probe:llm -- --baseUrl=https://example.com --key=sk-xxx
```

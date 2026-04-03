# AI_PROJECT

这个仓库现在专门用于维护一套本地 `Codex 账号池 + OpenAI 兼容代理` 工作流。

核心目标：

- 从 `acc_pool/` 加载多个 Codex ChatGPT 登录态账号
- 校验账号可用性并管理 refresh / cooldown / 切换
- 启动一个本地 OpenAI 兼容代理，供 Codex 或其他客户端接入
- 提供本机配置脚本，把 Codex 指向本地代理

## 当前目录结构

```text
AI_PROJECT/
├── acc_pool/
│   └── *.json
├── reports/
│   └── llm-probe/
├── src/
│   ├── README.md
│   ├── proxy/
│   │   ├── codex-account-pool.mjs
│   │   └── codex-account-pool.test.mjs
│   └── scripts/
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

- `src/scripts/`
  - 可直接执行的脚本入口
  - 目前主要包含：
    - 本地代理启动脚本
    - Codex 本机配置脚本
    - 单账号切换脚本
    - LLM 接口探测脚本
    - `~/.codex` 保守清理脚本

- `reports/`
  - 脚本输出目录
  - 当前用于保存 LLM 探测报告

## 常用命令

安装依赖：

```bash
npm install
```

启动本地代理：

```bash
npm run proxy:codex
```

如果本机网络必须走代理：

<!-- 第一个 -- 表示后面的参数不是传给 npm，而是传给脚本本身 -->
<!-- 告诉这个本地代理：它访问 OpenAI 上游时，不要直连，而是走你本机的 HTTP 代理 127.0.0.1:8118 -->

```bash
npm run proxy:codex -- --proxy-url=http://127.0.0.1:8118
```

把 Codex 配置到本地代理：

```bash
npm run proxy:codex:configure
```

单独测试账号池逻辑：

```bash
npm run test:proxy
```

运行全部测试：

```bash
npm test
```

探测某个 LLM 地址的兼容性：

```bash
npm run probe:llm -- --baseUrl=https://example.com --key=sk-xxx
```

保守清理 `~/.codex` 缓存、临时文件和 shell 快照：

```bash
npm run clean:codex-home
```

如果你也想顺手删除日志数据库：

```bash
npm run clean:codex-home -- --with-logs
```

脚本会在结束时输出清理前后体积，以及大概释放了多少空间。

## 接手建议

如果你是第一次接手这个仓库，建议阅读顺序：

1. 先看本文件，了解仓库用途和顶层结构
2. 再看 [src/README.md](/Users/chenchaoyang/my-project/AI_PROJECT/src/README.md)，了解各脚本入口和账号池支持格式
3. 最后看 [codex-account-pool.mjs](/Users/chenchaoyang/my-project/AI_PROJECT/src/proxy/codex-account-pool.mjs)，理解账号池和切换逻辑

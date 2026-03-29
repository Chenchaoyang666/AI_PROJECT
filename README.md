# AI_PROJECT

这个仓库目前可以按下面的结构理解：

- `ai-video/`
  - AI 视频相关代码与素材目录
  - 包含入口脚本、流水线实现、测试、示例故事和输出目录
  - 具体功能说明见 [ai-video/README.md](/Users/chenchaoyang/my-project/AI_PROJECT/ai-video/README.md)
- `src/`
  - 项目内的通用脚本和工具代码
  - 目前主要包含小数精度工具与辅助脚本
  - 具体说明见 [src/README.md](/Users/chenchaoyang/my-project/AI_PROJECT/src/README.md)
- `package.json`
  - Node.js 项目配置
  - 目前提供测试脚本与项目依赖声明

## 目录结构

```text
AI_PROJECT/
├── ai-video/
│   ├── README.md
│   ├── run.mjs
│   ├── run.command
│   ├── pipeline.mjs
│   ├── create-beginner-starter.mjs
│   ├── jimeng-renderer.mjs
│   ├── ffmpeg-assembler.mjs
│   ├── *.test.mjs
│   ├── stories/
│   └── output/
├── src/
│   ├── README.md
│   ├── scripts/
│   └── utils/
├── package.json
├── package-lock.json
└── README.md
```

## 开发说明

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

如果你是第一次接手这个仓库，建议阅读顺序：

1. 先看本文件，了解顶层结构
2. 再看 [ai-video/README.md](/Users/chenchaoyang/my-project/AI_PROJECT/ai-video/README.md)，理解主业务模块
3. 最后看 [src/README.md](/Users/chenchaoyang/my-project/AI_PROJECT/src/README.md)，补充通用工具和脚本信息

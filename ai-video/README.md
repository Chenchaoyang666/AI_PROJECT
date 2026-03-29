# ai-video

`ai-video/` 是这个仓库当前最主要的业务目录，负责 AI 视频生成相关流程。

## 目录说明

- `run.mjs`
  - 最简运行入口
- `run.command`
  - macOS 下的双击启动脚本
- `pipeline.mjs`
  - 主流水线编排
- `create-beginner-starter.mjs`
  - starter 配置与中间文档生成
- `jimeng-renderer.mjs`
  - 即梦 / 火山引擎渲染相关封装
- `ffmpeg-assembler.mjs`
  - 视频归一化与拼接相关封装
- `*.test.mjs`
  - 这一目录下各模块的测试
- `stories/`
  - 输入故事文本目录
- `output/`
  - 生成结果目录

## 使用方式

安装依赖后，可通过以下方式运行：

```bash
node ai-video/run.mjs
```

或指定故事内容 / 文件：

```bash
node ai-video/run.mjs --story "你的故事"
node ai-video/run.mjs --story-file ./ai-video/stories/example.txt
```

## 说明

这一目录下的实现包含：

- 故事输入解析
- starter 配置生成
- 视频生成流程编排
- 外部渲染服务调用
- 最终视频拼接

如果后续还要继续补文档，建议优先在这个目录下继续细化：

- 运行参数
- 环境变量
- 输出目录说明
- 故障排查

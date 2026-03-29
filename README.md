# AI_PROJECT

## decimalMul：解决 JS 小数相乘精度问题

文件：`src/utils/decimal.js`

```js
// CommonJS
const { decimalMul } = require("./src/utils/decimal.js");

decimalMul(0.1, 0.2); // 0.02
decimalMul("19.9", "100"); // 1990
decimalMul("1.23e2", "0.1"); // 12.3

// 超小数建议用字符串输出，避免 Number 再次丢精度
decimalMul("0.0000001", "0.0000002", { asString: true }); // "0.00000000000002"
```

如果你用 ESModule：

```js
import { decimalMul } from "./src/utils/decimal.mjs";
```

## AI 剧情短片 Starter Kit

文件：`ai-video/run.mjs`

这是现在唯一保留的入口，面向小白使用。你只需要写故事文本，脚本会自动：

- 选择最接近的风格预设
- 补出人物外观和服装
- 自动生成 `3` 个镜头
- 保存你输入的原始故事文本
- 先写出一个可编辑的 `00-story-config.json`
- 生成即梦关键图和镜头视频
- 用 `ffmpeg` 自动拼接成最终 mp4

如果你希望像产品一样双击运行，也可以直接使用：

- `ai-video/run.command`

在 macOS 里双击它，就会自动读取 `ai-video/stories` 里最新的故事文本并生成结果。

运行前需要：

- 设置环境变量 `VOLC_ACCESSKEY`
- 设置环境变量 `VOLC_SECRETKEY`
- 本机安装 `ffmpeg` 和 `ffprobe`
- 先执行一次 `npm install`

```bash
node ai-video/run.mjs \
  --story "雨夜里，一个女孩站在城市街头，最后转身离开。" \
  --output ./ai-video/output/beginner-neon
```

如果你更想像写提纲那样工作，可以直接准备一个文本文件：

```bash
node ai-video/run.mjs \
  --story-file ./ai-video/stories/my-first-story.txt \
  --output ./ai-video/output/my-first-ai-video
```

脚本会把原始输入另存为 `00-story.txt`，方便你回头继续改。

你也可以手动指定风格和角色名：

```bash
node ai-video/run.mjs \
  --story "黄昏里，一个人站在海边，像在回忆过去。" \
  --preset sunset-memory \
  --name Ming \
  --title "回忆的风" \
  --output ./ai-video/output/sunset-memory
```

现在也支持更省事的默认模式：

1. 把故事文本放进 `./ai-video/stories/*.txt`
2. 直接运行脚本

```bash
node ai-video/run.mjs
```

或者直接双击：

- `ai-video/run.command`

脚本会自动：

- 扫描 `./ai-video/stories`
- 选最新修改的 `.txt`
- 生成到 `./ai-video/output/<故事文件名>/`
- 下载关键图到 `assets/images`
- 下载镜头视频到 `assets/clips`
- 归一化片段到 `assets/clips-normalized`
- 导出最终视频到 `final/<故事名>.mp4`

如果你想换目录，也可以：

```bash
node ai-video/run.mjs --stories-dir ./my-stories
```

当前内置预设：

- `neon-rain`
- `sunset-memory`
- `quiet-sci-fi`

建议你的故事文本先控制在 `1-3` 句话，描述：

- 谁
- 在什么地方
- 发生了什么变化

### 运行测试

```bash
node --test ai-video/*.test.mjs
```

### 适合的第一条片子

为了提高成功率，starter 默认假设：

- 只做 `15-30 秒`
- 只做 `3-6 个镜头`
- 只保留 `1 个主角 + 1 个主要场景`
- 每个镜头只保留 `1 个核心动作`
- 默认输出 `9:16` 竖版

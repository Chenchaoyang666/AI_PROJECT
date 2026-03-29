# src

`src/` 用来存放项目中的通用脚本和工具代码，目前不是主业务入口，但承载了一些可复用能力。

## 目录说明

- `utils/`
  - 通用工具函数
  - 目前主要是小数精度处理相关实现
- `scripts/`
  - 辅助脚本
  - 目前主要是目录检查相关脚本

## 当前内容概览

- `utils/decimal.js`
  - CommonJS 版本的小数乘法工具
- `utils/decimal.mjs`
  - ES Module 版本导出
- `scripts/check-symlink-skills.sh`
  - 用于检查 skills 目录中符号链接情况的脚本

如果后续 `src/` 内容继续增长，建议再往下补：

- `src/utils/README.md`
- `src/scripts/README.md`

这样可以把每类工具和脚本的说明继续拆开维护。

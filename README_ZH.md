# Ghostty Config 简体中文汉化版

> [English README](./README.md) | **简体中文**

本项目是 [zerebos/ghostty-config](https://github.com/zerebos/ghostty-config) 的简体中文汉化版本。
Ghostty Config 是一个为 [Ghostty](https://ghostty.org) 终端打造的精美配置生成器，功能包括轻松修改设置、字体演练场，以及光标、选区、调色板的大量实时预览。

**🚀 在线使用（汉化版）**: https://stdari.github.io/ghostty-config-zh/
**英文原版**: https://ghostty.zerebos.com

## 汉化机制

本仓库采用「零上游改动」设计：上游英文源码保持原样提交，所有译文存放在
[`i18n/zh-CN.json`](./i18n/zh-CN.json) 词典中，构建时由脚本临时应用。
因此可以每周自动合并上游更新而不产生冲突。详见 [I18N.md](./I18N.md)。

- **每周一/四**自动同步上游并机器翻译新增字符串（Google Translate）
- 翻译覆盖所有设置项的名称与说明（约 500 条）

## 反馈

- **功能性 Bug / 新功能建议** → 请去[原项目](https://github.com/zerebos/ghostty-config)提 Issue
- **翻译错误 / 汉化建议** → 欢迎在本仓库提 Issue，或直接编辑
  [`i18n/zh-CN.json`](./i18n/zh-CN.json) 提交 PR（修改译文后下次部署自动生效）

## 本地运行

需要 [Bun](https://bun.sh) ≥ 1.3：

```bash
git clone https://github.com/stdAri/ghostty-config-zh.git
cd ghostty-config-zh
bun install
node scripts/i18n/zh.mjs apply   # 应用中文翻译到工作区
bun run dev
```

注意：`apply` 会直接改写工作区源码，提交前请还原：

```bash
git checkout -- src/ svelte.config.js
```

## 致谢与许可

- 原项目：[zerebos/ghostty-config](https://github.com/zerebos/ghostty-config)，作者 [Zerebos](https://github.com/zerebos)
- 本仓库遵循原项目的 [Apache License 2.0](./LICENSE)

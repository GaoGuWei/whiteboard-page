# Services

本目录封装后端业务入口，供 controller 调用。

当前 service 以复用既有模块为主：图片能力复用 `assets.mjs`，AI 能力复用 `ai/pipeline.mjs`，Word 导出复用 `export/docx.mjs`。

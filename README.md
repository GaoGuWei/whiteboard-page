# 逐字稿生成工作台

本项目是一个本地运行的教学逐字稿生成工具。它保留“左侧白板编排 + 右侧图片素材栏”的工作台布局，支持把本地题目截图/知识点截图放入不同教学环节，再一键生成课堂逐字稿。

## 运行

开发模式需要分别启动后端 Express API 和前端 Vite：

```bash
pnpm run dev:api
pnpm run dev:web
```

默认访问地址：

```text
前端页面：http://127.0.0.1:5173
后端 API：http://127.0.0.1:3000
```

Vite 会把 `/api` 代理到 Express 服务。生产构建后可运行：

```bash
pnpm run build
pnpm run start
```

后端唯一推荐入口是 `server/index.mjs`；根目录 `server.mjs` 仅保留为 deprecated 兼容入口。

默认图片目录：

```text
/Users/gao/Pictures/逐字稿test/因式分解
```

也可以通过环境变量覆盖：

```bash
IMAGE_DIR="/Users/gao/Pictures/逐字稿test/因式分解" PORT=3000 pnpm run dev:api
```

## AI 生成

未配置 `YI_API_KEY` 时，系统会返回本地示例逐字稿，方便先验证完整工作流。

配置后端环境变量后，会尝试调用 AI 生成：

```bash
YI_API_KEY="你的密钥" OPENAI_MODEL="gpt-4.1-mini" pnpm run dev:api
```

默认 API 路由为：

```text
https://api.apiyi.com/v1
```

也可以覆盖：

```bash
AI_BASE_URL="https://api.apiyi.com/v1" YI_API_KEY="你的密钥" pnpm run dev:api
```

API Key 只在本地 Node 后端读取，不会写入前端页面。不要把真实密钥写入 README 或前端代码。

## 功能

- 读取本地图片目录，支持中文文件名。
- 图片缩略图可拖拽到白板板块，也可先点选图片再点击板块。
- 每个板块可填写教学目标或提示。
- 一键生成逐字稿，并在页面内继续编辑。
- 支持风险校验、导出 Markdown、导出 Word `.docx`。

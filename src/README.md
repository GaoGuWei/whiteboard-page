# Frontend App

Vite + React + TypeScript 前端入口。

- `App.tsx`：工作台总状态和主布局。
- `components/`：白板、右侧边栏、风险校验、逐字稿等 UI 组件。
- `lib/`：API 封装、Markdown/数学公式/函数图像预览等纯逻辑。
- `styles/`：全局样式和工作台样式。

前端不能读取 `.env` 中的真实 API key，也不直接请求 AI 服务；所有 AI 调用必须通过本地后端 `/api/*`。

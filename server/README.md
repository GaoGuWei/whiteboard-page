# Server Modules

本目录承载本地 Express 后端，使用 ESM 模块。

- `index.mjs`：唯一推荐启动入口，负责监听端口。
- `app.mjs`：创建 Express app，并按 `express.json -> /api routes -> static dist -> SPA fallback -> notFound -> errorHandler` 顺序挂载。
- `routes/`：只定义 API 路径和 HTTP method。
- `controllers/`：只读取请求、调用 service、返回响应。
- `services/`：封装图片读取、AI pipeline、导出等业务入口。
- `middlewares/`：异步错误捕获、404 和统一错误响应。
- `config.mjs`：端口、默认图片目录、MIME、教学模块等常量。
- `assets.mjs`：本地图片目录、图片读取、尺寸识别、文件夹选择的底层实现。
- `ai/`：AI 调用、prompt、识图校验和逐字稿生成流程。
- `export/`：Word 导出底层实现。

不要在本目录写入真实 API key；密钥只从 `.env` 或进程环境变量读取。

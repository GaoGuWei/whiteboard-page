# 逐字稿生成工作台

本项目是一个教学逐字稿生成工具。它保留“左侧白板编排 + 右侧图片素材栏”的工作台布局，支持把题目截图/知识点截图放入不同教学环节，再一键生成课堂逐字稿。它既可以本地运行，也可以部署到云端；云端用户通过浏览器选择本机图片或文件夹上传素材。

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

云端部署可参考：

```text
docs/deploy-aliyun-hk.md
```

云端版本更新顺序也在同一份文档的“更新部署”章节中：本地提交推送 GitHub、服务器拉取、检查 `.env`、重新构建、PM2 重启和线上验证。

默认图片目录：

```text
/Users/gao/Pictures/逐字稿test/因式分解
```

运行模式由前端构建时变量控制：

```bash
VITE_APP_MODE=cloud pnpm run build
VITE_APP_MODE=local pnpm run build
```

`cloud` 是默认值，会加载服务器预置素材并支持访客上传；`local` 初始不加载预置素材，只提示用户选择本机图片或文件夹。修改 `VITE_APP_MODE` 后必须重新构建前端。

本地开发或服务器预置素材时，可以通过后端环境变量覆盖默认图片目录：

```bash
IMAGE_DIR="/Users/gao/Pictures/逐字稿test/因式分解" PORT=3000 pnpm run dev:api
```

云端部署时，浏览器不能直接读取访客电脑里的文件夹路径。用户需要在页面中点击“图片”或“文件夹”选择本机素材，前端会上传图片到后端临时目录。上传目录可以配置：

```bash
UPLOAD_DIR="/srv/whiteboard/uploads" pnpm run start
```

本地开发时可以不配置 `UPLOAD_DIR`，后端会默认写入项目目录下的 `.whiteboard-uploads/`，该目录已被 `.gitignore` 忽略。

上传素材默认只作为临时素材使用，不作为永久素材库保存。

修改后端 `.env` 中的 `IMAGE_DIR`、`UPLOAD_DIR`、`YI_API_KEY`、`AI_BASE_URL` 等运行时变量后，生产环境需要重启服务并更新 PM2 环境：

```bash
pm2 restart whiteboard-page --update-env
```

云端生成请求可能比普通网页请求更久，建议 Nginx 代理配置保留 `proxy_read_timeout 300s;`。后端 AI 请求超时可用 `AI_REQUEST_TIMEOUT_MS` 配置，默认 `240000` 毫秒。

几何证明、圆锥曲线等复杂题解可以单独配置 `GEOMETRY_MODEL`；未配置时默认使用 `OPENAI_MODEL`。

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

## 访问保护

公开部署时建议配置简单访问口令，避免他人消耗你的 AI API 额度：

```bash
BASIC_AUTH_USER="whiteboard" BASIC_AUTH_PASSWORD="换成一个足够长的密码" pnpm run start
```

未配置 `BASIC_AUTH_USER` 或 `BASIC_AUTH_PASSWORD` 时，访问保护不会启用，适合本地开发。

## 功能

- 支持读取服务器预置图片目录，也支持浏览器上传本机图片或文件夹。
- 图片缩略图可拖拽到白板板块，也可先点选图片再点击板块。
- 每个板块可填写教学目标或提示。
- 一键生成逐字稿，并在页面内继续编辑。
- 支持风险校验、导出 Markdown、导出 Word `.docx`。

# Controllers

本目录负责 Express 请求和响应的薄适配。

Controller 只读取 `req`、调用 service、返回 `res`；不要在这里重写 AI 调用、prompt、docx zip、图片扫描或图片安全路径逻辑。

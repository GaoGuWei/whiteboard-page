# AI Service

负责所有 AI 相关逻辑：

- `client.mjs`：读取 API key/base URL/model，调用 Responses API，并做错误脱敏。
- `prompts.mjs`：集中维护识图、逐图校验、整体分析、逐字稿生成 prompt。
- `pipeline.mjs`：组合 prompt、图片输入、校验解析、mock fallback 和 `/api/analyze` `/api/generate` 的业务流程。

约束：

- 真实密钥不能写进源码或 README。
- 前端只接触后端 API，不直接调用 AI 服务。
- 人工确认后的 `confirmedImages` 优先级高于模型重新识别。

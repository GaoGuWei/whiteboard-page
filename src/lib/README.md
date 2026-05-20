# Frontend Libraries

前端共享逻辑目录：

- `api.ts`：封装本地后端 `/api/*` 调用。
- `markdown.ts`：Markdown 预览解析。
- `mathPreview.ts`：类 LaTeX 公式预览。
- `graphPreview.ts`：`graph` 代码块 SVG 函数图像预览。
- `types.ts`：前端共享类型。

这里尽量保持无 UI 副作用，方便未来单独测试。

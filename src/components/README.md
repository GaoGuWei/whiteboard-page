# Components

前端组件按业务区域拆分：

- `Whiteboard.tsx`：左侧教学白板，负责模块、截图绑定、模块内排序和备注。
- `side/AssetPanel.tsx`：右侧图片素材页，负责路径、文件夹选择和图片列表。
- `side/TranscriptPanel.tsx`：右侧逐字稿页，负责编辑/预览、导出、生成状态。
- `side/RiskValidation.tsx`：风险校验视图和风险点编辑弹窗。

组件只处理 UI 和交互状态；后端请求统一从 `src/lib/api.ts` 进入。

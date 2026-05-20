import { buildDocx } from "../export/docx.mjs";

export function buildDocxExport(payload = {}) {
  const title = payload.title || "transcript";
  return {
    body: buildDocx(payload.markdown, payload.title),
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    contentDisposition: `attachment; filename="${encodeURIComponent(title)}.docx"`,
  };
}

import { buildDocxExport } from "../services/export.service.mjs";

export async function exportDocx(req, res) {
  const file = buildDocxExport(req.body);
  res
    .status(200)
    .type(file.contentType)
    .set("content-disposition", file.contentDisposition)
    .send(file.body);
}

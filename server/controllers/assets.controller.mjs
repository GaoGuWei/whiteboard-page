import {
  getAssetList,
  getImageStream,
  selectAssetFolder,
  uploadAssetImages,
} from "../services/assets.service.mjs";

export async function getAssets(req, res) {
  res.json(await getAssetList(req.query.dir));
}

export async function selectFolder(req, res) {
  res.json({ dir: await selectAssetFolder(req.query.dir) });
}

export async function uploadAssets(req, res) {
  res.json(await uploadAssetImages(req));
}

export async function getImage(req, res) {
  const result = getImageStream(req.query.dir, req.query.name);
  if (result.jsonError) {
    res.status(result.status).json({ error: result.jsonError });
    return;
  }
  if (result.error) {
    res.status(result.status).type("text/plain; charset=utf-8").send(result.error);
    return;
  }
  res.type(result.contentType);
  result.stream.pipe(res);
}

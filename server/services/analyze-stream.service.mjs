import { randomUUID } from "node:crypto";
import { callAnalyzeImage } from "../ai/pipeline.mjs";
import { ANALYZE_CONCURRENCY } from "../config.mjs";

const jobs = new Map();
const JOB_TTL_MS = 60_000;
function imageRefsFromPayload(payload) {
  const refs = [];
  const seen = new Set();
  for (const section of payload.sections || []) {
    (section.assets || []).forEach((asset, index) => {
      const ref = { sectionId: section.id, assetName: asset.name, order: index + 1 };
      const key = `${ref.sectionId}:${ref.assetName}:${ref.order}`;
      if (seen.has(key)) return;
      seen.add(key);
      refs.push(ref);
    });
  }
  return refs;
}

function placeholderImage(payload, ref, status, summary) {
  const section = (payload.sections || []).find((item) => item.id === ref.sectionId);
  const asset = section?.assets?.[ref.order - 1];
  return {
    imageId: `${ref.sectionId}:${ref.order - 1}:${ref.assetName}`,
    sectionId: ref.sectionId,
    sectionTitle: section?.title || ref.sectionId,
    assetName: ref.assetName,
    order: ref.order,
    width: asset?.width || 0,
    height: asset?.height || 0,
    ocrText: "",
    riskItems: status === "failed" ? [{
      id: "analysis-failed",
      field: "其他",
      currentText: "",
      suggestedText: "",
      reason: summary,
      severity: "high",
    }] : [],
    summary,
    status,
  };
}

function writeSse(res, event) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

function emit(job, type, data) {
  const event = { type, data };
  job.events.push(event);
  for (const client of job.clients) writeSse(client, event);
}

async function runPool(items, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function finishJob(job) {
  job.done = true;
  for (const client of job.clients) client.end();
  job.clients.clear();
  setTimeout(() => jobs.delete(job.id), JOB_TTL_MS);
}

async function runJob(job) {
  const refs = imageRefsFromPayload(job.payload);
  const images = new Array(refs.length);
  let done = 0;

  emit(job, "job-start", { jobId: job.id, total: refs.length, done: 0 });

  try {
    await runPool(refs, ANALYZE_CONCURRENCY, async (ref, index) => {
      emit(job, "image-start", { ...ref, imageId: `${ref.sectionId}:${ref.order - 1}:${ref.assetName}`, done, total: refs.length });
      try {
        const image = await callAnalyzeImage({ ...job.payload, image: ref });
        images[index] = image;
        done += 1;
        emit(job, "image-done", { image, done, total: refs.length });
      } catch (error) {
        const message = error?.message || "图片识别失败";
        const image = placeholderImage(job.payload, ref, "failed", message);
        images[index] = image;
        done += 1;
        emit(job, "image-error", { image, error: message, done, total: refs.length });
      }
    });

    const pendingCount = images.filter((image) => image.status === "needs_review" || image.status === "failed" || image.riskItems?.length).length;
    emit(job, "job-done", {
      images,
      pendingCount,
      confirmedCount: images.length - pendingCount,
    });
  } catch (error) {
    emit(job, "job-error", { error: error?.message || "识别任务失败", done, total: refs.length });
  } finally {
    finishJob(job);
  }
}

export function startAnalyzeStreamJob(payload) {
  const id = randomUUID();
  const job = {
    id,
    payload,
    events: [],
    clients: new Set(),
    done: false,
  };
  jobs.set(id, job);
  setTimeout(() => runJob(job), 0);
  return { jobId: id };
}

export function subscribeAnalyzeStream(jobId, res) {
  const job = jobs.get(jobId);
  if (!job) {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Analyze stream job not found" }));
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  job.clients.add(res);
  for (const event of job.events) writeSse(res, event);
  if (job.done) {
    res.end();
    return;
  }

  res.on("close", () => {
    job.clients.delete(res);
  });
}

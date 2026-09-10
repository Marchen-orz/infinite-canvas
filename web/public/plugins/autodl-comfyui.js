export default function createAutoDlComfyUiPlugin() {
  const normalizeSize = (value) => value === "auto" ? "auto" : /^\d+x\d+$/.test(value || "") ? value : ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
  const normalizeResolution = (value) => {
    const requested = String(value || "").trim();
    if (["736p竖", "736p横", "736p(1:1)"].includes(requested)) return requested;
    const numeric = requested.replace(/p$/i, "");
    return ["480", "768", "1080"].includes(numeric) ? numeric : "768";
  };
  const normalizeSeconds = (value) => {
    const seconds = Math.round(Number(value));
    return String(Number.isFinite(seconds) ? Math.max(1, Math.min(15, seconds)) : 5);
  };
  const transformMediaUrl = (url) => {
    try {
      const target = new URL(url);
      return target.hostname === "codewithgpu-image-1310972338.cos.ap-beijing.myqcloud.com" ? `/autodl-media${target.pathname}${target.search}${target.hash}` : url;
    } catch { return url; }
  };
  return {
    id: "autodl-comfyui",
    name: "AutoDL ComfyUI",
    version: "1.1.0",
    description: "为模型脚本编辑器提供 AutoDL ComfyUI 视频模板、专属参数和媒体代理。",
    autoEnable: true,
    nodes: [],
    modelPlugins: [{
      id: "autodl-comfyui",
      marker: "AutoDL ComfyUI",
      transformMediaUrl,
      templates: [
        { label: "AutoDL ComfyUI（参考图）", script: `// AutoDL ComfyUI video API: submit a task, then poll until it completes.
// Set Base URL to the AutoDL API host, for example https://api.autodl.com
// params.refImagesDataUrls and params.refAudiosDataUrls are complete Data URLs prepared by the canvas.
const root = baseUrl.trim().replace(/\\/+$/, "").replace(/\\/api$/i, "");
const proxyAutoDlVideo = (url) => {
  try {
    const target = new URL(url);
    return target.hostname === "codewithgpu-image-1310972338.cos.ap-beijing.myqcloud.com" ? \`\${window.location.origin}/autodl-media\${target.pathname}\${target.search}\` : url;
  } catch {
    return url;
  }
};
const headers = { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` };
// AutoDL supports only 480/768/1080p in horizontal or vertical orientation.
// The canvas's generic 720p setting maps to AutoDL's 768p; square and auto map to vertical.
const autoDlVideoSettings = (params) => {
  const requestedResolution = String(params.resolution || "").toLowerCase();
  const resolutionMatch = requestedResolution.match(/(?:^|\\D)(480|768|1080)(?:\\D|$)/);
  const resolutionNumber = resolutionMatch ? resolutionMatch[1] : requestedResolution.includes("480") ? "480" : requestedResolution.includes("1080") ? "1080" : "768";
  const ratio = String(params.ratio || params.size || "");
  const ratioMatch = ratio.match(/(\\d+)\\s*[:x]\\s*(\\d+)/i);
  const orientation = ratioMatch && Number(ratioMatch[1]) > Number(ratioMatch[2]) ? "横" : "竖";
  const requestedDuration = Number(params.seconds);
  const duration = Number.isFinite(requestedDuration) ? Math.max(1, Math.min(10, Math.round(requestedDuration))) : 5;
  return { duration, resolution: \`\${resolutionNumber}p\${orientation}\` };
};
const { duration, resolution } = autoDlVideoSettings(params);
const body = {
  seed: Number.isInteger(Number(params.seed)) ? Number(params.seed) : undefined,
  prompt: String(prompt || "").slice(0, 10000),
  duration,
  resolution,
};
const toDataUrl = (value) => String(value || "").replace(/\\s/g, "");
const referenceImages = Array.isArray(params.refImagesDataUrls) ? params.refImagesDataUrls : images;
const referenceAudios = Array.isArray(params.refAudiosDataUrls) ? params.refAudiosDataUrls : audios;
for (let index = 0; index < Math.min(9, referenceImages.length); index += 1) {
  const dataUrl = toDataUrl(referenceImages[index]);
  if (dataUrl) body["ref_image_" + index] = dataUrl;
}
for (let index = 0; index < Math.min(3, referenceAudios.length); index += 1) {
  const dataUrl = toDataUrl(referenceAudios[index]);
  if (dataUrl) body["ref_audio_" + index] = dataUrl;
}
const created = await request({
  method: "post",
  url: \`\${root}/api/v1/comfyui/comfyui_workflow/\${encodeURIComponent(model)}\`,
  headers,
  data: body,
});
const taskId = created?.data?.task_id || created?.task_id;
if (!taskId) throw new Error(created?.msg || "AutoDL 未返回 task_id");
return await poll(
  () => request({
    method: "get",
    url: \`\${root}/api/v1/comfyui/comfyui_workflow/result/\${encodeURIComponent(taskId)}\`,
    headers: { Authorization: \`Bearer \${apiKey}\` },
  }),
  (response) => {
    const data = response?.data || response;
    const status = String(data?.status || "").toLowerCase();
    if (["failed", "failure", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(response?.msg || data?.msg || \`AutoDL 任务失败：\${status}\`);
    }
    if (!["completed", "success", "succeeded", "finished"].includes(status)) return null;
    const result = Array.isArray(data?.results) ? data.results.find((item) => item?.url) : null;
    if (!result?.url) throw new Error("AutoDL 任务完成但未返回视频 URL");
    return { url: proxyAutoDlVideo(result.url) };
  },
  { intervalMs: 3000, timeoutMs: 600000 },
);` },
        { label: "AutoDL ComfyUI（文生视频）", script: `// AutoDL ComfyUI text-to-video API: submit a prompt, then poll until it completes.
// Set Base URL to the AutoDL API host, for example https://api.autodl.com
const root = baseUrl.trim().replace(/\\/+$/, "").replace(/\\/api$/i, "");
const proxyAutoDlVideo = (url) => {
  try {
    const target = new URL(url);
    return target.hostname === "codewithgpu-image-1310972338.cos.ap-beijing.myqcloud.com" ? \`\${window.location.origin}/autodl-media\${target.pathname}\${target.search}\` : url;
  } catch {
    return url;
  }
};
const headers = { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` };
// AutoDL supports only 480/768/1080p in horizontal or vertical orientation.
// The canvas's generic 720p setting maps to AutoDL's 768p; square and auto map to vertical.
const autoDlVideoSettings = (params) => {
  const requestedResolution = String(params.resolution || "").toLowerCase();
  const resolutionMatch = requestedResolution.match(/(?:^|\\D)(480|768|1080)(?:\\D|$)/);
  const resolutionNumber = resolutionMatch ? resolutionMatch[1] : requestedResolution.includes("480") ? "480" : requestedResolution.includes("1080") ? "1080" : "768";
  const ratio = String(params.ratio || params.size || "");
  const ratioMatch = ratio.match(/(\\d+)\\s*[:x]\\s*(\\d+)/i);
  const orientation = ratioMatch && Number(ratioMatch[1]) > Number(ratioMatch[2]) ? "横" : "竖";
  const requestedDuration = Number(params.seconds);
  const duration = Number.isFinite(requestedDuration) ? Math.max(1, Math.min(10, Math.round(requestedDuration))) : 5;
  return { duration, resolution: \`\${resolutionNumber}p\${orientation}\` };
};
const { duration, resolution } = autoDlVideoSettings(params);
const created = await request({
  method: "post",
  url: \`\${root}/api/v1/comfyui/comfyui_workflow/\${encodeURIComponent(model)}\`,
  headers,
  data: {
    prompt: String(prompt || "").slice(0, 10000),
    duration,
    resolution,
  },
});
const taskId = created?.data?.task_id || created?.task_id;
if (!taskId) throw new Error(created?.msg || "AutoDL 未返回 task_id");
return await poll(
  () => request({
    method: "get",
    url: \`\${root}/api/v1/comfyui/comfyui_workflow/result/\${encodeURIComponent(taskId)}\`,
    headers: { Authorization: \`Bearer \${apiKey}\` },
  }),
  (response) => {
    const data = response?.data || response;
    const status = String(data?.status || "").toLowerCase();
    if (["failed", "failure", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(response?.msg || data?.msg || \`AutoDL 任务失败：\${status}\`);
    }
    if (!["completed", "success", "succeeded", "finished"].includes(status)) return null;
    const result = Array.isArray(data?.results) ? data.results.find((item) => item?.url) : null;
    if (!result?.url) throw new Error("AutoDL 任务完成但未返回视频 URL");
    return { url: proxyAutoDlVideo(result.url) };
  },
  { intervalMs: 3000, timeoutMs: 600000 },
);` },
        { label: "AutoDL ComfyUI（MiniMax H3 首尾帧视频）", script: `// AutoDL ComfyUI MiniMax H3 first-and-last-frame video API.
// This template uses /api/v1/comfyui/comfyui_workflow/minimax_h3_b99_002.
// Connect exactly two publicly reachable image URLs in order: first frame, then last frame.
const root = baseUrl.trim().replace(/\\/+$/, "").replace(/\\/api$/i, "");
const proxyAutoDlVideo = (url) => {
  try {
    const target = new URL(url);
    return target.hostname === "codewithgpu-image-1310972338.cos.ap-beijing.myqcloud.com" ? \`\${window.location.origin}/autodl-media\${target.pathname}\${target.search}\` : url;
  } catch { return url; }
};
const headers = { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` };
const frameUrls = Array.isArray(params.refImageUrls) ? params.refImageUrls : [];
const firstFrame = String(frameUrls[0] || "").trim();
const lastFrame = String(frameUrls[1] || "").trim();
if (!/^https?:\\/\\//i.test(firstFrame) || !/^https?:\\/\\//i.test(lastFrame)) {
  throw new Error("首尾帧模板需要按顺序连接两张可公网访问的图片 URL：第 1 张为首帧，第 2 张为尾帧。");
}
const rawSeed = String(params.seed || "").trim();
if (rawSeed && !/^-?\\d+$/.test(rawSeed)) throw new Error("随机种子必须是整数，或留空使用随机结果。");
const requestedResolution = String(params.resolution || "").trim();
const resolution = ["736p竖", "736p横", "736p(1:1)"].includes(requestedResolution) ? requestedResolution : "736p竖";
const requestedDuration = Math.round(Number(params.seconds));
const duration = Number.isFinite(requestedDuration) ? Math.max(1, Math.min(15, requestedDuration)) : 5;
const created = await request({
  method: "post",
  url: \`\${root}/api/v1/comfyui/comfyui_workflow/minimax_h3_b99_002\`,
  headers,
  data: {
    ...(rawSeed ? { seed: Number(rawSeed) } : {}),
    prompt: String(prompt || "").slice(0, 10000),
    duration,
    last_frame: lastFrame,
    resolution,
    first_frame: firstFrame,
  },
});
const resultOf = (response) => {
  const data = response?.data || response || {};
  const status = String(data.status || "").toLowerCase();
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(status)) throw new Error(response?.msg || data?.msg || \`AutoDL 任务失败：\${status}\`);
  if (!["completed", "success", "succeeded", "finished"].includes(status)) return null;
  const item = Array.isArray(data.results) ? data.results.find((value) => value?.url && (value.type === "video" || value.file_type === "mp4")) : null;
  if (!item?.url) throw new Error("AutoDL 任务完成但未返回视频 URL");
  return { url: proxyAutoDlVideo(item.url) };
};
const immediate = resultOf(created);
if (immediate) return immediate;
const taskId = created?.data?.task_id || created?.task_id;
if (!taskId) throw new Error(created?.msg || "AutoDL 未返回 task_id");
return await poll(
  () => request({
    method: "get",
    url: \`\${root}/api/v1/comfyui/comfyui_workflow/result/\${encodeURIComponent(taskId)}\`,
    headers: { Authorization: \`Bearer \${apiKey}\` },
  }),
  resultOf,
  { intervalMs: 3000, timeoutMs: 900000 },
);` },
      ],
      settings: {
        resolutions: [{ value: "480", label: "480p" }, { value: "768", label: "768p" }, { value: "1080", label: "1080p" }, { value: "736p竖", label: "736p竖" }, { value: "736p横", label: "736p横" }, { value: "736p(1:1)", label: "736p(1:1)" }],
        seconds: [1, 3, 5, 6, 8, 10, 15], minSeconds: 1, maxSeconds: 15,
        sizeMode: "dimensions", allowCustomResolution: true,
        seed: true,
        normalizeResolution, normalizeSeconds, normalizeSize,
        resolutionLabel: (value) => { const resolved = normalizeResolution(value); return /p/i.test(resolved) ? resolved : `${resolved}p`; },
      },
    }],
  };
}

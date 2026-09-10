export default function createCompShareMiniMaxH3Plugin() {
  const ratios = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
  const normalizeResolution = (value) => {
    const requested = String(value || "").toUpperCase().replace(/P$/, "");
    return requested === "1080" || requested === "2K" ? requested : "768";
  };
  const normalizeSeconds = (value) => {
    const seconds = Math.round(Number(value));
    return String(Number.isFinite(seconds) ? Math.max(4, Math.min(30, seconds)) : 5);
  };
  const normalizeSize = (value) => ratios.includes(value) ? value : "16:9";
  const marker = "CompShare MiniMax H3 video API";
  const versionMarker = "CompShare MiniMax H3 plugin v1.4.0";
  const template = `// ${marker}.
// ${versionMarker}
// Base URL: https://cp.compshare.cn
const root = "https://cp.compshare.cn";
const requestId = globalThis.crypto?.randomUUID?.() || String(Date.now()) + "-" + Math.random().toString(36).slice(2);
const headers = { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + apiKey, "Idempotency-Key": requestId };
const parsePayload = (value) => {
  let payload = value;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return payload; }
  }
  if (payload?.data !== undefined && payload?.data !== null) {
    const nested = payload.data;
    if (typeof nested === "string") {
      try { return JSON.parse(nested); } catch { return nested; }
    }
    if (typeof nested === "object") return nested;
  }
  return payload;
};
const readError = (error) => {
  const payload = parsePayload(error?.response?.data ?? error);
  return payload?.error?.message || payload?.error?.type || payload?.Message || payload?.message || payload?.msg || error?.message || "";
};
const call = async (options) => {
  try { return await request(options); }
  catch (error) { throw new Error(readError(error) || "优云智算请求失败"); }
};
const content = [];
if (String(prompt || "").trim()) content.push({ type: "text", text: String(prompt).slice(0, 7000) });
const ensureDataUrlMime = (url, mime) => typeof url === "string" && url.startsWith("data:;base64,") ? "data:" + mime + ";base64," + url.slice("data:;base64,".length) : url;
const imageDataUrls = Array.isArray(params.refImagesDataUrls) ? params.refImagesDataUrls : images;
const videoDataUrls = Array.isArray(params.refVideosDataUrls) ? params.refVideosDataUrls : videos;
const audioDataUrls = Array.isArray(params.refAudiosDataUrls) ? params.refAudiosDataUrls : audios;
const imageUrls = Array.isArray(params.refImageUrls) ? params.refImageUrls : [];
const videoUrls = Array.isArray(params.refVideoUrls) ? params.refVideoUrls : [];
const audioUrls = Array.isArray(params.refAudioUrls) ? params.refAudioUrls : [];
const referenceImages = imageDataUrls.map((url, index) => imageUrls[index] || ensureDataUrlMime(url, "image/png")).filter(Boolean).slice(0, 9);
const referenceVideos = videoDataUrls.map((url, index) => videoUrls[index] || ensureDataUrlMime(url, "video/mp4")).filter(Boolean).slice(0, 3);
const referenceAudios = audioDataUrls.map((url, index) => audioUrls[index] || ensureDataUrlMime(url, "audio/mpeg")).filter(Boolean).slice(0, 3);
const useFirstFrame = referenceImages.length === 1 && !referenceVideos.length && !referenceAudios.length;
referenceImages.forEach((url) => content.push({ type: "image_url", image_url: { url }, role: useFirstFrame ? "first_frame" : "reference_image" }));
referenceVideos.forEach((url) => content.push({ type: "video_url", video_url: { url }, role: "reference_video" }));
referenceAudios.forEach((url) => content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" }));
if (!content.length) throw new Error("请填写提示词或添加参考素材");
if (referenceAudios.length && !referenceImages.length && !referenceVideos.length) throw new Error("参考音频必须与参考图片或参考视频一起使用");
if (referenceImages.length + referenceVideos.length + referenceAudios.length > 12) throw new Error("参考素材合计不能超过 12 个");
const requestedResolution = String(params.resolution || "").toUpperCase().replace(/P$/, "");
const resolution = requestedResolution === "1080" ? "1080P" : requestedResolution === "2K" ? "2K" : "768P";
const allowedRatios = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const ratio = allowedRatios.includes(String(params.ratio)) ? String(params.ratio) : referenceImages.length ? "adaptive" : "16:9";
const duration = Math.max(4, Math.min(30, Math.round(Number(params.seconds) || 5)));
const useContextIr = params.useContextIr === true;
const skillId = String(params.skillId || "").trim();
const normalizedSeed = String(params.seed || "").trim();
if (normalizedSeed !== "random" && normalizedSeed && !/^[1-9]\\d*$/.test(normalizedSeed)) throw new Error("固定 Seed 必须是大于 0 的整数。");
const seed = /^[1-9]\\d*$/.test(normalizedSeed) ? Number(normalizedSeed) : Math.floor(Math.random() * 2147483647) + 1;
const created = await call({
  method: "post",
  url: root + "/minimax/v2/video_generation",
  headers,
  data: {
    model: ["MiniMax-H3", "minimax-h3-lite"].includes(model) ? model : "MiniMax-H3",
    content,
    resolution,
    duration,
    ratio,
    seed,
    use_context_ir: useContextIr,
    ...(skillId && useContextIr ? { skill_id: skillId } : {}),
    mute_audio: params.generateAudio === false,
    aigc_watermark: params.watermark === true,
  },
});
const payload = parsePayload(created);
const taskId = payload?.task_id || payload?.taskId || payload?.TaskId || payload?.TaskID || payload?.task?.id || payload?.result?.task_id || payload?.id;
if (!taskId) {
  const detail = readError(payload);
  const preview = (() => { try { return JSON.stringify(payload).slice(0, 500); } catch { return String(payload); } })();
  throw new Error(detail || "优云智算未返回 task_id：" + (preview || "空响应"));
}
// The canvas abort signal means the user pressed “停止生成”. Use a detached
// request because ordinary request() correctly inherits that already-aborted signal.
const cancelTask = () => requestDetached({
  method: "delete",
  url: root + "/minimax/v2/video_generation/" + encodeURIComponent(taskId),
  headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
}).catch(() => undefined);
signal?.addEventListener("abort", cancelTask, { once: true });
return await poll(
  () => call({ method: "get", url: root + "/minimax/v2/query/video_generation/" + encodeURIComponent(taskId), headers }),
  (response) => {
    const payload = parsePayload(response);
    const task = payload?.task || (payload?.status ? payload : null);
    const responseError = readError(payload);
    if (!task && responseError) throw new Error(responseError);
    const status = String(task?.status || "").toLowerCase();
    if (["failed", "failure", "error", "cancelled", "canceled"].includes(status)) throw new Error(task?.error?.message || task?.Message || task?.message || "MiniMax H3 任务失败：" + status);
    if (!["succeeded", "completed", "success"].includes(status)) return null;
    const url = task?.content?.url || task?.content?.video_url || task?.url || task?.video_url;
    if (!url) throw new Error("MiniMax H3 任务完成但未返回视频 URL");
    return { url };
  },
  { intervalMs: 3000, timeoutMs: 900000 },
);`;
  const migrateScript = (script) => script.includes(marker) && !script.includes(versionMarker) ? template : script;

  return {
    id: "comp-share-minimax-h3",
    name: "优云智算 MiniMax H3",
    version: "1.4.0",
    description: "为模型脚本编辑器提供优云智算 MiniMax H3 视频 API 模板和专属配置项。",
    autoEnable: true,
    nodes: [],
    modelPlugins: [{
      id: "comp-share-minimax-h3",
      marker,
      migrateScript,
      templates: [{ label: "优云智算 MiniMax H3", script: template }],
      settings: {
        resolutions: [{ value: "768", label: "768P" }, { value: "1080", label: "1080P" }, { value: "2K", label: "2K" }],
        seconds: [4, 5, 10, 15, 20, 30], minSeconds: 4, maxSeconds: 30,
        sizeMode: "ratios", ratios, allowCustomResolution: false,
        outputFields: ["generateAudio", "watermark", "contextIr"], skillId: true, seed: true,
        normalizeResolution, normalizeSeconds, normalizeSize,
        resolutionLabel: (value) => `${normalizeResolution(value)}${normalizeResolution(value) === "2K" ? "" : "P"}`,
      },
    }],
  };
}

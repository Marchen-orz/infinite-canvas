export default function createMediaEditorPlugin(runtime) {
  const { React, jsx } = runtime;
  const { useEffect, useMemo, useState } = React;

  const typeName = { video: "视频", audio: "音频" };
  const operationName = { trim: "区间截取", concat: "简单拼接", "extract-audio": "提取音频", mute: "移除声音", "audio-adjust": "音量与淡入淡出", "video-speed": "变速" };
  const isMedia = (node) => ["video", "audio"].includes(node.type) && Boolean(node.metadata?.content);
  const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const time = (seconds) => {
    const value = Math.max(0, number(seconds));
    const minutes = Math.floor(value / 60);
    const remainder = value % 60;
    return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
  };
  const nodeDuration = (node) => Math.max(0, number(node?.metadata?.durationMs) / 1000);
  const sourceLabel = (node) => `${typeName[node.type] || "素材"} · ${node.title || "未命名素材"}`;
  const initialEditorData = (node) => (node.metadata?.pluginData && typeof node.metadata.pluginData === "object" ? node.metadata.pluginData : {});

  function EditorContent({ ctx }) {
    const inputs = ctx.getUpstream().filter(isMedia);
    const data = initialEditorData(ctx.node);
    const count = Array.isArray(data.sourceIds) ? data.sourceIds.length : inputs.length;
    return jsx("div", { className: "media-editor-card" },
      jsx("div", { className: "media-editor-card-icon" }, "✂"),
      jsx("div", { className: "media-editor-card-copy" },
        jsx("strong", null, "音频视频剪辑台"),
        jsx("span", null, count ? `已选 ${count} 个素材 · ${operationName[data.operation] || "区间截取"}` : "连接或选择音频、视频素材"),
      ),
      jsx("button", { type: "button", className: "media-editor-open", onPointerDown: (event) => event.stopPropagation(), onClick: () => ctx.openPanel() }, "打开"),
    );
  }

  function SourceChip({ node, active, onClick }) {
    return jsx("button", { type: "button", onClick, className: `media-editor-source ${active ? "is-active" : ""}`, title: node.title },
      jsx("span", { className: "media-editor-source-kind" }, node.type === "video" ? "▣" : "♪"),
      jsx("span", { className: "media-editor-source-name" }, node.title || "未命名素材"),
      jsx("span", { className: "media-editor-source-time" }, time(nodeDuration(node))),
    );
  }

  function Field({ label, children, hint }) {
    return jsx("label", { className: "media-editor-field" }, jsx("span", null, label), children, hint ? jsx("small", null, hint) : null);
  }

  function MediaEditorPanel({ ctx, onClose }) {
    const saved = initialEditorData(ctx.node);
    const connected = ctx.getUpstream().filter(isMedia);
    const allMedia = ctx.getNodes().filter(isMedia);
    const defaultIds = Array.isArray(saved.sourceIds) && saved.sourceIds.length ? saved.sourceIds : connected.map((node) => node.id);
    const [sourceIds, setSourceIds] = useState(defaultIds);
    const [operation, setOperation] = useState(saved.operation || (defaultIds.length > 1 ? "concat" : "trim"));
    const [fps, setFps] = useState(number(saved.fps, 30));
    const [startFrame, setStartFrame] = useState(number(saved.startFrame, 0));
    const [endFrame, setEndFrame] = useState(number(saved.endFrame, 0));
    const [speed, setSpeed] = useState(number(saved.speed, 1));
    const [volume, setVolume] = useState(number(saved.volume, 1));
    const [fadeIn, setFadeIn] = useState(number(saved.fadeIn, 0));
    const [fadeOut, setFadeOut] = useState(number(saved.fadeOut, 0));
    const [working, setWorking] = useState(false);
    const [error, setError] = useState("");
    const [done, setDone] = useState("");

    const selected = useMemo(() => sourceIds.map((id) => ctx.getNode(id)).filter(isMedia), [ctx, sourceIds]);
    const primary = selected[0];
    const primaryKind = primary?.type || "video";
    const duration = nodeDuration(primary);
    const maxFrame = Math.max(0, Math.round(duration * fps));
    const startSeconds = Math.max(0, startFrame / Math.max(1, fps));
    const endSeconds = Math.max(startSeconds, endFrame / Math.max(1, fps));
    const validConcatenation = selected.length > 1 && selected.every((node) => node.type === primaryKind);

    useEffect(() => {
      if (!primary || endFrame > 0) return;
      setEndFrame(Math.max(1, maxFrame));
    }, [primary?.id, maxFrame]);

    const save = (patch) => {
      ctx.updateMetadata({ pluginData: { ...initialEditorData(ctx.node), sourceIds, operation, fps, startFrame, endFrame, speed, volume, fadeIn, fadeOut, ...patch } });
    };
    const toggleSource = (id) => {
      const next = sourceIds.includes(id) ? sourceIds.filter((item) => item !== id) : [...sourceIds, id];
      setSourceIds(next);
      ctx.updateMetadata({ pluginData: { ...initialEditorData(ctx.node), sourceIds: next, operation, fps, startFrame, endFrame, speed, volume, fadeIn, fadeOut } });
      setDone("");
      setError("");
    };
    const chooseOperation = (value) => {
      setOperation(value);
      ctx.updateMetadata({ pluginData: { ...initialEditorData(ctx.node), sourceIds, operation: value, fps, startFrame, endFrame, speed, volume, fadeIn, fadeOut } });
      setError("");
      setDone("");
    };
    const run = async () => {
      setError("");
      setDone("");
      if (!selected.length) return setError("请先连接或选择一个音频、视频素材。");
      if (operation === "concat" && !validConcatenation) return setError("拼接需要至少两个相同类型的素材。");
      if (operation === "trim" && !(endFrame > startFrame)) return setError("结束帧必须大于开始帧。");
      if (["extract-audio", "mute", "video-speed"].includes(operation) && primaryKind !== "video") return setError("此操作仅适用于视频素材。");
      try {
        setWorking(true);
        const blob = await ctx.media.edit({
          operation,
          sources: selected.map((node) => ({ content: node.metadata.content, storageKey: node.metadata.storageKey, mimeType: node.metadata.mimeType, kind: node.type })),
          startSeconds,
          endSeconds: operation === "trim" || operation === "audio-adjust" ? endSeconds : undefined,
          speed,
          volume,
          fadeInSeconds: fadeIn,
          fadeOutSeconds: fadeOut,
        });
        const outputKind = operation === "extract-audio" || (operation !== "concat" && primaryKind === "audio") ? "audio" : primaryKind;
        const stored = await ctx.storeMedia(blob, outputKind);
        const outputId = `media-edit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const title = `${operationName[operation]} · ${primary.title || typeName[outputKind]}`;
        ctx.applyOps([
          {
            type: "add_node",
            id: outputId,
            nodeType: outputKind,
            title,
            x: ctx.node.position.x + ctx.node.width + 72,
            y: ctx.node.position.y,
            width: outputKind === "video" ? 480 : 360,
            height: outputKind === "video" ? 270 : 160,
            metadata: { ...stored, pluginData: { editorOperation: operation, sourceIds } },
          },
          { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: outputId },
        ]);
        save({ lastOutputId: outputId });
        setDone("处理完成，结果已添加到剪辑台右侧。");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "剪辑处理失败，请稍后重试。");
      } finally {
        setWorking(false);
      }
    };

    const options = primaryKind === "audio"
      ? [["trim", "截取"], ["concat", "拼接"], ["audio-adjust", "音量 / 淡化"]]
      : [["trim", "截取"], ["concat", "拼接"], ["extract-audio", "提取音频"], ["mute", "静音"], ["video-speed", "变速"]];

    return jsx("div", { className: "media-editor-panel", "data-canvas-no-zoom": true, onWheelCapture: (event) => event.stopPropagation() },
      jsx("div", { className: "media-editor-panel-head" },
        jsx("div", null, jsx("div", { className: "media-editor-kicker" }, "LOCAL EDITOR"), jsx("h3", null, "音频视频剪辑台"), jsx("p", null, "所有处理在浏览器本地完成，不会上传素材。")),
        jsx("button", { type: "button", className: "media-editor-close", onClick: onClose, title: "关闭" }, "×"),
      ),
      jsx("div", { className: "media-editor-section" },
        jsx("div", { className: "media-editor-section-title" }, "选择素材", jsx("span", null, "可连接节点或从画布素材中点选")),
        jsx("div", { className: "media-editor-sources" }, allMedia.length ? allMedia.map((node) => jsx(SourceChip, { key: node.id, node, active: sourceIds.includes(node.id), onClick: () => toggleSource(node.id) })) : jsx("div", { className: "media-editor-empty" }, "画布中还没有音频或视频素材")),
      ),
      primary ? jsx("div", { className: "media-editor-preview" }, primary.type === "video" ? jsx("video", { src: primary.metadata.content, controls: true, preload: "metadata" }) : jsx("audio", { src: primary.metadata.content, controls: true }), jsx("span", null, `${sourceLabel(primary)}${duration ? ` · ${time(duration)}` : ""}`)) : null,
      jsx("div", { className: "media-editor-section" },
        jsx("div", { className: "media-editor-section-title" }, "操作"),
        jsx("div", { className: "media-editor-tabs" }, options.map(([value, label]) => jsx("button", { key: value, type: "button", onClick: () => chooseOperation(value), className: operation === value ? "is-active" : "" }, label))),
      ),
      operation === "trim" ? jsx("div", { className: "media-editor-grid" },
        jsx(Field, { label: "帧率", hint: "按此帧率换算，导出时会重编码以保证切点准确" }, jsx("select", { value: fps, onChange: (event) => setFps(number(event.target.value, 30)) }, [24, 25, 30, 50, 60].map((value) => jsx("option", { key: value, value }, `${value} FPS`)))),
        jsx(Field, { label: "开始帧", hint: `${time(startSeconds)}` }, jsx("input", { type: "number", min: 0, max: maxFrame || undefined, value: startFrame, onChange: (event) => setStartFrame(Math.max(0, number(event.target.value))) })),
        jsx(Field, { label: "结束帧", hint: `${time(endSeconds)}${maxFrame ? ` / ${maxFrame} 帧` : ""}` }, jsx("input", { type: "number", min: 1, max: maxFrame || undefined, value: endFrame, onChange: (event) => setEndFrame(Math.max(0, number(event.target.value))) })),
      ) : null,
      operation === "concat" ? jsx("div", { className: "media-editor-note" }, "直接拼接会保留原始编码与清晰度，速度最快。请使用相同类型、分辨率和编码参数的素材；不一致时请先分别导出。") : null,
      operation === "audio-adjust" ? jsx("div", { className: "media-editor-grid" },
        jsx(Field, { label: "音量", hint: `${Math.round(volume * 100)}%` }, jsx("input", { type: "range", min: 0, max: 2, step: 0.05, value: volume, onChange: (event) => setVolume(number(event.target.value, 1)) })),
        jsx(Field, { label: "淡入（秒）" }, jsx("input", { type: "number", min: 0, step: 0.1, value: fadeIn, onChange: (event) => setFadeIn(Math.max(0, number(event.target.value))) })),
        jsx(Field, { label: "淡出（秒）", hint: "需填写素材时长；截取时会自动使用选区末尾" }, jsx("input", { type: "number", min: 0, step: 0.1, value: fadeOut, onChange: (event) => setFadeOut(Math.max(0, number(event.target.value))) })),
      ) : null,
      operation === "video-speed" ? jsx("div", { className: "media-editor-grid one" }, jsx(Field, { label: "播放速度", hint: "会同步调整视频和原始音频速度" }, jsx("select", { value: speed, onChange: (event) => setSpeed(number(event.target.value, 1)) }, [[0.5, "0.5× 慢放"], [0.75, "0.75×"], [1, "1× 原速"], [1.25, "1.25×"], [1.5, "1.5×"], [2, "2× 快放"]].map(([value, label]) => jsx("option", { key: value, value }, label))))) : null,
      error ? jsx("div", { className: "media-editor-message error" }, error) : null,
      done ? jsx("div", { className: "media-editor-message success" }, done) : null,
      jsx("div", { className: "media-editor-actions" }, jsx("span", null, working ? "正在加载剪辑引擎并处理素材…" : "首次使用会下载约 31 MB 的本地剪辑引擎"), jsx("button", { type: "button", className: "media-editor-run", disabled: working || !selected.length, onClick: run }, working ? "处理中…" : `生成${operation === "extract-audio" ? "音频" : typeName[primaryKind] || "结果"}`)),
    );
  }

  return {
    id: "media-editor",
    name: "音频视频剪辑台",
    version: "1.0.0",
    description: "在画布中本地截取、拼接、静音、提取音频和调整音视频速度。支持按帧精确截取。",
    autoEnable: true,
    css: `
      .media-editor-card{height:100%;box-sizing:border-box;padding:20px;display:flex;align-items:center;gap:13px;background:linear-gradient(135deg,#0d1728,#142641);color:#eff6ff;font-family:ui-sans-serif,system-ui,sans-serif}.media-editor-card-icon{display:grid;place-items:center;width:40px;height:40px;border-radius:13px;background:linear-gradient(135deg,#38bdf8,#6366f1);font-size:21px;box-shadow:0 8px 20px #0ea5e955}.media-editor-card-copy{min-width:0;display:grid;gap:4px}.media-editor-card-copy strong{font-size:14px}.media-editor-card-copy span{color:#b9c8dc;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.media-editor-open{margin-left:auto;border:1px solid #ffffff3d;border-radius:8px;background:#ffffff18;color:#fff;padding:6px 10px;font-size:12px;cursor:pointer}.media-editor-panel{width:min(860px,calc(100vw - 40px));box-sizing:border-box;padding:20px 22px 18px;border:1px solid #d8e2f0;border-radius:18px;background:#fff;color:#172033;box-shadow:0 20px 60px #17203324;font-family:ui-sans-serif,system-ui,sans-serif}.dark .media-editor-panel{background:#141b28;color:#edf3ff;border-color:#314056}.media-editor-panel-head{display:flex;justify-content:space-between;gap:20px;margin-bottom:18px}.media-editor-panel h3{margin:2px 0 4px;font-size:19px;letter-spacing:-.02em}.media-editor-panel p{margin:0;color:#758197;font-size:12px}.media-editor-kicker{font-size:10px;font-weight:700;letter-spacing:.14em;color:#4f7cff}.media-editor-close{width:30px;height:30px;border:0;border-radius:9px;background:#eef3fa;color:#56647a;font-size:22px;line-height:1;cursor:pointer}.dark .media-editor-close{background:#263246;color:#b9c8dc}.media-editor-section{margin-top:16px}.media-editor-section-title{display:flex;align-items:baseline;gap:8px;margin-bottom:8px;font-size:13px;font-weight:700}.media-editor-section-title span{font-size:11px;font-weight:400;color:#8490a4}.media-editor-sources{display:flex;gap:8px;max-height:116px;overflow:auto;padding-bottom:2px}.media-editor-source{min-width:164px;max-width:220px;display:grid;grid-template-columns:18px minmax(0,1fr);gap:2px 7px;text-align:left;padding:9px 10px;border:1px solid #dbe4f0;border-radius:10px;background:#f8faff;color:inherit;cursor:pointer}.dark .media-editor-source{border-color:#334157;background:#192334}.media-editor-source.is-active{border-color:#5b86ff;background:#edf3ff;box-shadow:0 0 0 2px #5b86ff22}.dark .media-editor-source.is-active{background:#1d3157}.media-editor-source-kind{grid-row:span 2;color:#5680f5;font-size:13px}.media-editor-source-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:650}.media-editor-source-time{font-size:10px;color:#8490a4}.media-editor-empty,.media-editor-note{border-radius:10px;background:#f5f7fb;color:#758197;padding:10px 12px;font-size:12px;line-height:1.55}.dark .media-editor-empty,.dark .media-editor-note{background:#1b2637;color:#aab8cd}.media-editor-preview{display:flex;align-items:center;gap:10px;padding:10px 12px;margin-top:14px;border-radius:12px;background:#f5f8fd}.dark .media-editor-preview{background:#1a2638}.media-editor-preview video{width:180px;height:102px;border-radius:8px;background:#000;object-fit:contain}.media-editor-preview audio{width:250px;max-width:60%}.media-editor-preview span{font-size:11px;color:#718097}.media-editor-tabs{display:flex;flex-wrap:wrap;gap:6px}.media-editor-tabs button{border:1px solid #dbe4f0;border-radius:8px;padding:6px 10px;background:#fff;color:#56647a;font-size:12px;cursor:pointer}.dark .media-editor-tabs button{background:#192334;border-color:#334157;color:#b8c7dd}.media-editor-tabs button.is-active{border-color:#5b86ff;background:#5b86ff;color:#fff}.media-editor-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}.media-editor-grid.one{grid-template-columns:minmax(0,280px)}.media-editor-field{display:grid;gap:5px;font-size:12px;font-weight:650}.media-editor-field input,.media-editor-field select{width:100%;box-sizing:border-box;border:1px solid #d7e0ec;border-radius:8px;padding:8px 9px;background:#fff;color:inherit;font:inherit;outline:none}.dark .media-editor-field input,.dark .media-editor-field select{border-color:#334157;background:#192334}.media-editor-field input:focus,.media-editor-field select:focus{border-color:#5b86ff;box-shadow:0 0 0 3px #5b86ff1d}.media-editor-field small{font-size:10px;line-height:1.3;font-weight:400;color:#8490a4}.media-editor-note{margin-top:14px}.media-editor-message{margin-top:14px;border-radius:9px;padding:9px 11px;font-size:12px}.media-editor-message.error{background:#fff1f0;color:#cf3c37}.media-editor-message.success{background:#ecfdf3;color:#16844d}.media-editor-actions{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:18px;padding-top:14px;border-top:1px solid #e4eaf2}.dark .media-editor-actions{border-color:#2e3c50}.media-editor-actions>span{font-size:11px;color:#8490a4}.media-editor-run{border:0;border-radius:9px;padding:9px 14px;background:linear-gradient(135deg,#3978f5,#635bdf);color:#fff;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 7px 16px #3978f540}.media-editor-run:disabled{cursor:not-allowed;opacity:.55}@media(max-width:640px){.media-editor-panel{width:calc(100vw - 22px);padding:16px}.media-editor-grid{grid-template-columns:1fr 1fr}.media-editor-preview{align-items:flex-start;flex-direction:column}.media-editor-preview audio{width:100%;max-width:100%}.media-editor-actions{align-items:flex-start;flex-direction:column}.media-editor-run{width:100%}}
    `,
    nodes: [{ type: "media-editor:editor", title: "音频视频剪辑台", icon: "✂", description: "本地完成按帧截取、拼接和常用音视频处理。", defaultSize: { width: 360, height: 130 }, minimapColor: "#4f7cff", autoOpenPanel: true, Content: EditorContent, Panel: MediaEditorPanel }],
  };
}

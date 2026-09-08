export default function createMediaEditorPlugin(runtime) {
  const { React, jsx } = runtime;
  const { useEffect, useMemo, useRef, useState } = React;

  const names = { trim: "截取", concat: "拼接", crop: "裁剪", "extract-audio": "提取音频", mute: "静音", "audio-adjust": "音量", "video-speed": "变速" };
  const typeName = { image: "图片", video: "视频", audio: "音频" };
  const isMedia = (node) => ["image", "video", "audio"].includes(node.type) && Boolean(node.metadata?.content);
  const isAudioVideo = (node) => ["video", "audio"].includes(node?.type);
  const toNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const durationOf = (node) => Math.max(0, toNumber(node?.metadata?.durationMs) / 1000);
  const timecode = (seconds) => {
    const value = Math.max(0, toNumber(seconds));
    const minutes = Math.floor(value / 60);
    const remainder = value % 60;
    return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
  };
  const pluginData = (node) => node.metadata?.pluginData && typeof node.metadata.pluginData === "object" ? node.metadata.pluginData : {};
  const icon = (name) => ({ cut: "✂", join: "↔", audio: "♪", mute: "⌁", speed: "›", play: "▶", pause: "Ⅱ", back: "↶", close: "×", video: "▣" }[name] || "•");

  function EditorContent({ ctx }) {
    const data = pluginData(ctx.node);
    const count = Array.isArray(data.sourceIds) ? data.sourceIds.length : ctx.getUpstream().filter(isMedia).length;
    return jsx("div", { className: "cutdesk-node" },
      jsx("div", { className: "cutdesk-node-mark" }, icon("cut")),
      jsx("div", { className: "cutdesk-node-copy" }, jsx("strong", null, "剪辑台"), jsx("span", null, count ? `${count} 段素材 · ${names[data.operation] || "截取"}` : "连接图片、音频或视频开始剪辑")),
      jsx("button", { type: "button", className: "cutdesk-node-open", onPointerDown: (event) => event.stopPropagation(), onClick: () => ctx.openPanel() }, "剪辑"),
    );
  }

  function MediaBinItem({ node, active, onClick, index, onCreateNode }) {
    return jsx("button", { type: "button", className: `cutdesk-media-item ${active ? "active" : ""}`, onClick, title: node.title || "未命名素材", onContextMenu: (event) => { event.preventDefault(); event.stopPropagation(); onCreateNode(node); } },
      jsx("span", { className: "cutdesk-media-thumb" }, node.type === "video" ? icon("video") : node.type === "image" ? "▧" : icon("audio")),
      jsx("span", { className: "cutdesk-media-copy" }, jsx("b", null, node.title || "未命名素材"), jsx("small", null, `${typeName[node.type]} · ${timecode(durationOf(node))}`)),
      active ? jsx("span", { className: "cutdesk-media-order" }, index + 1) : null,
    );
  }

  function ToolButton({ active, label, glyph, onClick, disabled }) {
    return jsx("button", { type: "button", disabled, onClick, className: `cutdesk-tool ${active ? "active" : ""}` }, jsx("i", null, glyph), jsx("span", null, label));
  }

  function Clip({ node, index, selected, onClick }) {
    const length = Math.max(18, Math.min(100, durationOf(node) * 9));
    return jsx("button", { type: "button", onClick, className: `cutdesk-track-clip ${selected ? "selected" : ""}`, style: { width: `${length}px` }, title: node.title },
      jsx("span", { className: "cutdesk-clip-handle left" }), jsx("span", { className: "cutdesk-clip-body" }, `${index + 1}. ${node.title || "未命名素材"}`), jsx("span", { className: "cutdesk-clip-handle right" }),
    );
  }

  function Timeline({ primary, selected, fps, startFrame, endFrame, cursor, onStart, onEnd, onCursor, onClipClick }) {
    const duration = durationOf(primary);
    const frames = Math.max(1, Math.round(duration * fps));
    const startPercent = Math.max(0, Math.min(100, startFrame / frames * 100));
    const endPercent = Math.max(startPercent, Math.min(100, endFrame / frames * 100));
    const cursorPercent = Math.max(0, Math.min(100, cursor / Math.max(.001, duration) * 100));
    const marks = [0, .25, .5, .75, 1];
    return jsx("div", { className: "cutdesk-timeline" },
      jsx("div", { className: "cutdesk-ruler" }, marks.map((mark) => jsx("span", { key: mark, style: { left: `${mark * 100}%` } }, timecode(duration * mark)))),
      jsx("div", { className: "cutdesk-track" },
        jsx("span", { className: "cutdesk-track-label" }, primary?.type === "audio" ? "A1" : "V1"),
        jsx("div", { className: "cutdesk-track-lane" },
          selected.length ? selected.map((node, index) => jsx(Clip, { key: node.id, node, index, selected: node.id === primary?.id, onClick: () => onClipClick(node.id) })) : jsx("span", { className: "cutdesk-track-placeholder" }, "从左侧素材箱选择素材，或将节点连接至剪辑台"),
          primary ? jsx("div", { className: "cutdesk-selection", style: { left: `${startPercent}%`, width: `${Math.max(1, endPercent - startPercent)}%` } }) : null,
          primary ? jsx("input", { className: "cutdesk-trim-range start", type: "range", min: 0, max: frames, value: Math.min(startFrame, frames), onChange: (event) => onStart(Math.min(toNumber(event.target.value), Math.max(0, endFrame - 1))) }) : null,
          primary ? jsx("input", { className: "cutdesk-trim-range end", type: "range", min: 1, max: frames, value: Math.min(Math.max(1, endFrame), frames), onChange: (event) => onEnd(Math.max(toNumber(event.target.value), startFrame + 1)) }) : null,
          primary ? jsx("input", { className: "cutdesk-cursor-range", type: "range", min: 0, max: Math.max(.001, duration), step: 1 / Math.max(1, fps), value: cursor, onChange: (event) => onCursor(toNumber(event.target.value)) }) : null,
          primary ? jsx("span", { className: "cutdesk-playhead", style: { left: `${cursorPercent}%` } }) : null,
        ),
      ),
      primary?.type === "video" ? jsx("div", { className: "cutdesk-track audio" }, jsx("span", { className: "cutdesk-track-label" }, "A1"), jsx("div", { className: "cutdesk-track-lane waveform" }, jsx("span", null, "原始音频"))) : null,
    );
  }

  function CutDeskPanel({ ctx, onClose }) {
    const saved = pluginData(ctx.node);
    const connected = ctx.getUpstream().filter(isMedia);
    const [cropAssets, setCropAssets] = useState(Array.isArray(saved.cropAssets) ? saved.cropAssets : []);
    const mediaNodes = useMemo(() => [...connected, ...cropAssets], [connected, cropAssets]);
    const availableIds = useMemo(() => new Set(mediaNodes.map((node) => node.id)), [mediaNodes]);
    const defaultIds = (Array.isArray(saved.sourceIds) && saved.sourceIds.length ? saved.sourceIds : connected.map((node) => node.id)).filter((id) => availableIds.has(id));
    const [sourceIds, setSourceIds] = useState(defaultIds);
    const [operation, setOperation] = useState(saved.operation || (defaultIds.length > 1 ? "concat" : mediaNodes[0]?.type === "image" ? "crop" : "trim"));
    const [fps, setFps] = useState(toNumber(saved.fps, 30));
    const [startFrame, setStartFrame] = useState(toNumber(saved.startFrame, 0));
    const [endFrame, setEndFrame] = useState(toNumber(saved.endFrame, 0));
    const [cursor, setCursor] = useState(0);
    const [speed, setSpeed] = useState(toNumber(saved.speed, 1));
    const [volume, setVolume] = useState(toNumber(saved.volume, 1));
    const [fadeIn, setFadeIn] = useState(toNumber(saved.fadeIn, 0));
    const [fadeOut, setFadeOut] = useState(toNumber(saved.fadeOut, 0));
    const [crop, setCrop] = useState(saved.crop || { left: 0, top: 0, width: 1, height: 1 });
    const [working, setWorking] = useState(false);
    const [message, setMessage] = useState("");
    const previewRef = useRef(null);
    const selected = useMemo(() => sourceIds.map((id) => mediaNodes.find((node) => node.id === id)).filter(isMedia), [mediaNodes, sourceIds]);
    const primary = selected[0];
    const duration = durationOf(primary);
    const maxFrame = Math.max(1, Math.round(duration * fps));
    const kind = primary?.type || "video";
    const startSeconds = startFrame / Math.max(1, fps);
    const endSeconds = endFrame / Math.max(1, fps);
    const validConcat = selected.length > 1 && selected.every((node) => node.type === kind);
    const save = (patch = {}) => ctx.updateMetadata({ pluginData: { ...pluginData(ctx.node), sourceIds, cropAssets, operation, fps, startFrame, endFrame, speed, volume, fadeIn, fadeOut, crop, ...patch } });
    const createNode = (asset) => ctx.applyOps([{ type: "add_node", id: `media-asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, nodeType: asset.type, title: asset.title || `${typeName[asset.type]}素材`, x: ctx.node.position.x + ctx.node.width + 80, y: ctx.node.position.y, width: asset.type === "image" ? Math.min(480, Math.max(240, (asset.metadata?.naturalWidth || 1) * 240 / Math.max(1, asset.metadata?.naturalHeight || 1))) : asset.type === "video" ? 480 : 360, height: asset.type === "image" ? Math.min(420, Math.max(160, (asset.metadata?.naturalHeight || 1) * 240 / Math.max(1, asset.metadata?.naturalWidth || 1))) : asset.type === "video" ? 270 : 160, metadata: asset.metadata }]);

    useEffect(() => {
      if (!cropAssets.length) return;
      let cancelled = false;
      void Promise.all(cropAssets.map(async (asset) => {
        if (asset.metadata?.content || !asset.metadata?.storageKey) return asset;
        try { return { ...asset, metadata: { ...asset.metadata, content: await ctx.media.resolveImage(asset.metadata) } }; } catch { return asset; }
      })).then((next) => { if (!cancelled && next.some((asset, index) => asset.metadata?.content !== cropAssets[index]?.metadata?.content)) setCropAssets(next); });
      return () => { cancelled = true; };
    }, [ctx, cropAssets]);
    useEffect(() => {
      if (!primary || endFrame > 0) return;
      setEndFrame(maxFrame);
    }, [primary?.id, maxFrame]);
    useEffect(() => {
      const element = previewRef.current;
      if (!element || Math.abs(element.currentTime - cursor) < .08) return;
      element.currentTime = Math.min(cursor, duration || 0);
    }, [cursor, duration]);

    const updateSources = (next) => {
      setSourceIds(next);
      ctx.updateMetadata({ pluginData: { ...pluginData(ctx.node), sourceIds: next, cropAssets, operation, fps, startFrame, endFrame, speed, volume, fadeIn, fadeOut, crop } });
      setMessage("");
    };
    const toggleSource = (id) => updateSources(sourceIds.includes(id) ? sourceIds.filter((item) => item !== id) : [...sourceIds, id]);
    const setActiveSource = (id) => {
      const next = [id, ...sourceIds.filter((item) => item !== id)];
      updateSources(next);
      setCursor(0);
      const active = mediaNodes.find((node) => node.id === id);
      if (active?.type === "image") setOperation("crop");
      else if (operation === "crop") setOperation("trim");
      setEndFrame(Math.max(1, Math.round(durationOf(active) * fps)));
    };
    const updateCrop = (key, value) => {
      const next = { ...crop, [key]: Math.max(0.01, Math.min(1, value)) };
      if (key === "left") next.left = Math.min(next.left, 1 - next.width);
      if (key === "top") next.top = Math.min(next.top, 1 - next.height);
      if (key === "width") next.width = Math.min(next.width, 1 - next.left);
      if (key === "height") next.height = Math.min(next.height, 1 - next.top);
      setCrop(next);
      save({ crop: next });
    };
    const chooseOperation = (value) => {
      setOperation(value);
      ctx.updateMetadata({ pluginData: { ...pluginData(ctx.node), sourceIds, cropAssets, operation: value, fps, startFrame, endFrame, speed, volume, fadeIn, fadeOut, crop } });
      setMessage("");
    };
    const play = () => {
      const element = previewRef.current;
      if (!element) return;
      if (element.paused) void element.play(); else element.pause();
    };
    const run = async () => {
      setMessage("");
      if (!selected.length) return setMessage("请先从素材箱选择已连线的素材。");
      if (operation === "crop" && kind !== "image") return setMessage("图片裁剪只能用于图片素材。");
      if (operation === "concat" && (!validConcat || !selected.every(isAudioVideo))) return setMessage("拼接需要两个及以上相同类型的音频或视频素材。");
      if (operation === "trim" && (!(endFrame > startFrame) || !selected.every(isAudioVideo))) return setMessage("请在时间轴上拉开有效的截取区间，并选择音频或视频素材。");
      if (["extract-audio", "mute", "video-speed"].includes(operation) && kind !== "video") return setMessage("此工具仅适用于视频素材。");
      try {
        setWorking(true);
        if (operation === "crop") {
          const blob = await ctx.media.cropImage({ content: primary.metadata.content, storageKey: primary.metadata.storageKey }, crop);
          const stored = await ctx.storeImage(blob);
          const cropId = `crop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const asset = { id: cropId, type: "image", title: `裁剪 · ${primary.title || "图片"}`, metadata: stored };
          const nextAssets = [...cropAssets, asset];
          setCropAssets(nextAssets);
          setSourceIds([...sourceIds, cropId]);
          save({ cropAssets: nextAssets, sourceIds: [...sourceIds, cropId], lastCropId: cropId });
          setMessage("裁剪完成，已加入素材箱和时间轴；右键该素材可创建图片节点。");
          return;
        }
        const blob = await ctx.media.edit({ operation, sources: selected.map((node) => ({ content: node.metadata.content, storageKey: node.metadata.storageKey, mimeType: node.metadata.mimeType, kind: node.type })), startSeconds, endSeconds: operation === "trim" || operation === "audio-adjust" ? endSeconds : undefined, speed, volume, fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut });
        const outputKind = operation === "extract-audio" || (operation !== "concat" && kind === "audio") ? "audio" : kind;
        const stored = await ctx.storeMedia(blob, outputKind);
        const outputId = `cutdesk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        ctx.applyOps([
          { type: "add_node", id: outputId, nodeType: outputKind, title: `${names[operation]} · ${primary.title || typeName[outputKind]}`, x: ctx.node.position.x + ctx.node.width + 72, y: ctx.node.position.y, width: outputKind === "video" ? 480 : 360, height: outputKind === "video" ? 270 : 160, metadata: { ...stored, pluginData: { editorOperation: operation, sourceIds } } },
          { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: outputId },
        ]);
        save({ lastOutputId: outputId });
        setMessage("已完成，结果节点已添加到剪辑台右侧。");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "处理失败，请检查素材格式后重试。");
      } finally { setWorking(false); }
    };
    const tools = kind === "image" ? [["crop", "裁剪", icon("cut")]] : kind === "audio" ? [["trim", "截取", icon("cut")], ["concat", "拼接", icon("join")], ["audio-adjust", "音量", icon("audio")]] : [["trim", "截取", icon("cut")], ["concat", "拼接", icon("join")], ["extract-audio", "提取音频", icon("audio")], ["mute", "静音", icon("mute")], ["video-speed", "变速", icon("speed")]];
    const noticeIsError = message && !message.startsWith("已完成");

    return jsx("div", { className: "cutdesk", "data-canvas-no-zoom": true, onWheelCapture: (event) => event.stopPropagation() },
      jsx("header", { className: "cutdesk-header" }, jsx("div", { className: "cutdesk-brand" }, jsx("i", null, icon("cut")), jsx("div", null, jsx("b", null, "剪辑台"), jsx("small", null, "本地音频 · 视频编辑"))), jsx("div", { className: "cutdesk-header-center" }, primary ? `${primary.title || "未命名序列"}  ·  ${timecode(cursor)}` : "未打开素材"), jsx("button", { type: "button", className: "cutdesk-close", onClick: onClose, title: "关闭" }, icon("close"))),
      jsx("main", { className: "cutdesk-workspace" },
        jsx("aside", { className: "cutdesk-bin" }, jsx("div", { className: "cutdesk-pane-title" }, "素材箱", jsx("span", null, `${mediaNodes.length}`)), jsx("p", null, "点击加入序列；点击时间轴片段可设为预览主素材。"), jsx("div", { className: "cutdesk-media-list" }, mediaNodes.length ? mediaNodes.map((node) => jsx(MediaBinItem, { key: node.id, node, active: sourceIds.includes(node.id), index: sourceIds.indexOf(node.id), onClick: () => toggleSource(node.id), onCreateNode: createNode })) : jsx("div", { className: "cutdesk-empty" }, "暂无已连线素材"))),
        jsx("section", { className: "cutdesk-viewer" },
          jsx("div", { className: "cutdesk-viewer-top" }, jsx("span", null, "节目监看"), jsx("span", null, primary ? `${typeName[kind]} · ${timecode(duration)}` : "选择一段素材")),
          jsx("div", { className: `cutdesk-preview ${kind}` }, primary ? (kind === "image" ? jsx("img", { src: primary.metadata.content, alt: primary.title || "图片素材" }) : kind === "video" ? jsx("video", { ref: previewRef, src: primary.metadata.content, preload: "metadata", onTimeUpdate: (event) => setCursor(event.currentTarget.currentTime), onEnded: () => setCursor(0) }) : jsx("div", { className: "cutdesk-audio-preview" }, jsx("span", null, icon("audio")), jsx("div", { className: "cutdesk-audio-wave" }, Array.from({ length: 50 }).map((_, index) => jsx("i", { key: index, style: { height: `${20 + (index * 37 % 66)}%` } }))), jsx("audio", { ref: previewRef, src: primary.metadata.content, preload: "metadata", onTimeUpdate: (event) => setCursor(event.currentTarget.currentTime), onEnded: () => setCursor(0) }))) : jsx("div", { className: "cutdesk-no-preview" }, jsx("i", null, icon("video")), jsx("span", null, "从素材箱选择素材开始"))),
          jsx("div", { className: "cutdesk-transport" }, jsx("button", { type: "button", onClick: () => { setCursor(0); if (previewRef.current) previewRef.current.currentTime = 0; } }, icon("back")), jsx("button", { type: "button", className: "play", onClick: play }, icon("play")), jsx("span", null, `${timecode(cursor)} / ${timecode(duration)}`)),
          jsx("div", { className: "cutdesk-toolstrip" }, tools.map(([value, label, glyph]) => jsx(ToolButton, { key: value, active: operation === value, label, glyph, onClick: () => chooseOperation(value), disabled: !primary })),),
          jsx("div", { className: "cutdesk-inspector" },
            operation === "trim" ? jsx("div", { className: "cutdesk-inspector-row" }, jsx("label", null, "帧率", jsx("select", { value: fps, onChange: (event) => { const value = toNumber(event.target.value, 30); setFps(value); save({ fps: value }); } }, [24, 25, 30, 50, 60].map((value) => jsx("option", { key: value, value }, `${value} FPS`)))), jsx("label", null, "起始", jsx("b", null, `${startFrame} 帧 / ${timecode(startSeconds)}`)), jsx("label", null, "结束", jsx("b", null, `${endFrame} 帧 / ${timecode(endSeconds)}`)), jsx("small", null, "时间轴截取将按所选帧率精确重编码")) : null,
            operation === "crop" ? jsx("div", { className: "cutdesk-inspector-row controls crop" }, ["left", "top", "width", "height"].map((key) => jsx("label", { key }, key === "left" ? "左" : key === "top" ? "上" : key === "width" ? "宽" : "高", jsx("input", { type: "number", min: 0.01, max: 1, step: 0.01, value: crop[key], onChange: (event) => updateCrop(key, toNumber(event.target.value, crop[key])) }))), jsx("span", null, "范围 0–1")) : null,
            operation === "concat" ? jsx("div", { className: "cutdesk-inspector-row note" }, jsx("b", null, "无损直接拼接"), jsx("span", null, "保持原编码，要求选中的素材具有相同类型、分辨率和编码参数。")) : null,
            operation === "audio-adjust" ? jsx("div", { className: "cutdesk-inspector-row controls" }, jsx("label", null, "音量", jsx("input", { type: "range", min: 0, max: 2, step: .05, value: volume, onChange: (event) => setVolume(toNumber(event.target.value, 1)) }), `${Math.round(volume * 100)}%`), jsx("label", null, "淡入", jsx("input", { type: "number", min: 0, step: .1, value: fadeIn, onChange: (event) => setFadeIn(Math.max(0, toNumber(event.target.value))) }), "秒"), jsx("label", null, "淡出", jsx("input", { type: "number", min: 0, step: .1, value: fadeOut, onChange: (event) => setFadeOut(Math.max(0, toNumber(event.target.value))) }), "秒")) : null,
            operation === "video-speed" ? jsx("div", { className: "cutdesk-inspector-row controls" }, jsx("label", null, "播放速度", jsx("select", { value: speed, onChange: (event) => setSpeed(toNumber(event.target.value, 1)) }, [[.5, "0.5× 慢放"], [.75, "0.75×"], [1, "1× 原速"], [1.25, "1.25×"], [1.5, "1.5×"], [2, "2× 快放"]].map(([value, label]) => jsx("option", { key: value, value }, label)))), jsx("span", null, "会同步调整视频和原始音频")) : null,
            ["extract-audio", "mute"].includes(operation) ? jsx("div", { className: "cutdesk-inspector-row note" }, jsx("b", null, operation === "mute" ? "导出无声视频" : "导出 MP3 音轨"), jsx("span", null, "原始素材不会被修改，处理结果将作为新节点添加。")) : null,
          ),
        ),
      ),
      jsx("footer", { className: "cutdesk-footer" }, jsx("span", { className: noticeIsError ? "error" : "" }, message || (working ? "正在调用本地剪辑引擎…" : "所有处理均在当前浏览器完成")), jsx("div", null, jsx("span", null, "首次处理需加载约 31 MB 引擎"), jsx("button", { type: "button", disabled: working || !primary, onClick: run }, working ? "处理中…" : `导出${operation === "crop" ? "裁剪素材" : operation === "extract-audio" ? "音频" : "结果"}`))),
      jsx("section", { className: "cutdesk-sequence" }, jsx("div", { className: "cutdesk-sequence-title" }, jsx("b", null, "时间轴"), jsx("span", null, primary ? `${fps} FPS · ${selected.length} 段素材` : "选择素材后开始编辑")), jsx(Timeline, { primary, selected, fps, startFrame, endFrame: endFrame || maxFrame, cursor, onStart: setStartFrame, onEnd: setEndFrame, onCursor: setCursor, onClipClick: setActiveSource })),
    );
  }

  return {
    id: "media-editor",
    name: "音频视频剪辑台",
    version: "2.2.1",
    description: "黑色时间轴剪辑台：本地按帧截取、拼接、静音、提取音频和音视频调整。",
    autoEnable: true,
    css: `
      .cutdesk-node{width:100%;height:100%;min-width:0;box-sizing:border-box;border-radius:inherit;overflow:hidden;display:flex;align-items:center;gap:12px;padding:18px 20px;background:#292524;color:#f5f5f4;font-family:ui-sans-serif,system-ui,sans-serif}.cutdesk-node-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:#3a3631;color:#f5f5f4;font-size:20px}.cutdesk-node-copy{display:grid;min-width:0;gap:4px}.cutdesk-node-copy strong{font-size:14px}.cutdesk-node-copy span{overflow:hidden;color:#a8a29e;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.cutdesk-node-open{margin-left:auto;border:1px solid #57534e;border-radius:7px;background:#292524;padding:6px 11px;color:#e7e5e4;font-size:12px;cursor:pointer}.cutdesk{width:min(1000px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:hidden;border:1px solid #44403c;border-radius:14px;background:#181715;color:#f5f5f4;box-shadow:0 26px 80px #0008;font-family:ui-sans-serif,system-ui,sans-serif}.cutdesk,.cutdesk *{box-sizing:border-box}.cutdesk button,.cutdesk select,.cutdesk input{font:inherit}.cutdesk-header{height:52px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 15px;border-bottom:1px solid #35312d;background:#1f1d1a}.cutdesk-brand{display:flex;align-items:center;gap:9px}.cutdesk-brand>i{display:grid;width:26px;height:26px;place-items:center;border-radius:7px;background:#3a3631;color:#fafaf9;font-style:normal}.cutdesk-brand b{display:block;font-size:13px}.cutdesk-brand small{display:block;margin-top:1px;color:#a8a29e;font-size:10px}.cutdesk-header-center{color:#d6d3d1;font-size:11px}.cutdesk-close{justify-self:end;width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:#d6d3d1;font-size:19px;cursor:pointer}.cutdesk-close:hover{background:#35312d;color:#fff}.cutdesk-workspace{display:grid;grid-template-columns:196px minmax(0,1fr);height:390px;min-height:0;overflow:hidden}.cutdesk-bin{min-height:0;overflow:hidden;border-right:1px solid #35312d;background:#181715;padding:13px}.cutdesk-pane-title,.cutdesk-viewer-top,.cutdesk-sequence-title{display:flex;align-items:center;justify-content:space-between;color:#e7e5e4;font-size:12px;font-weight:700}.cutdesk-pane-title span{display:grid;min-width:18px;place-items:center;border-radius:9px;background:#3a3631;color:#d6d3d1;font-size:10px}.cutdesk-bin>p{margin:7px 0 13px;color:#a8a29e;font-size:10px;line-height:1.5}.cutdesk-media-list{display:grid;align-content:start;grid-auto-rows:42px;gap:7px;height:calc(100% - 62px);overflow:auto}.cutdesk-media-item{position:relative;display:grid;align-items:center;grid-template-columns:25px minmax(0,1fr);gap:6px;width:100%;height:42px;min-height:42px;max-height:42px;overflow:hidden;padding:4px 5px;border:1px solid transparent;border-radius:6px;background:transparent;color:#e7e5e4;text-align:left;cursor:pointer}.cutdesk-media-item:hover{background:#292524}.cutdesk-media-item.active{border-color:#78716c;background:#3a3631}.cutdesk-media-thumb{display:grid;height:25px;place-items:center;border-radius:6px;background:#3a3631;color:#f5f5f4;font-size:14px}.cutdesk-media-copy{min-width:0}.cutdesk-media-copy b,.cutdesk-media-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cutdesk-media-copy b{font-size:10px;font-weight:600}.cutdesk-media-copy small{margin-top:1px;color:#a8a29e;font-size:8px}.cutdesk-media-order{position:absolute;right:5px;top:5px;display:grid;width:14px;height:14px;place-items:center;border-radius:50%;background:#f5f5f4;color:#151515;font-size:9px;font-weight:800}.cutdesk-empty{padding:16px 5px;color:#78716c;font-size:11px;text-align:center}.cutdesk-viewer{min-width:0;min-height:0;height:390px;display:grid;grid-template-rows:auto minmax(0,280px) auto auto;padding:14px 16px 0;background:#0f0e0d}.cutdesk-viewer-top{margin:0 2px 10px;color:#a8a29e;font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}.cutdesk-preview{position:relative;display:grid;width:100%;height:100%;min-height:0;max-width:680px;max-height:280px;justify-self:center;place-items:center;overflow:hidden;border:1px solid #35312d;border-radius:8px;background:#0c0a09}.cutdesk-preview video,.cutdesk-preview img{display:block;width:100%;height:100%;max-width:100%;max-height:280px;object-fit:contain}.cutdesk-no-preview{display:grid;place-items:center;gap:10px;color:#78716c;font-size:12px}.cutdesk-no-preview i{display:grid;width:42px;height:42px;place-items:center;border:1px solid #35312d;border-radius:12px;color:#a8a29e;font-size:21px;font-style:normal}.cutdesk-audio-preview{display:grid;width:72%;place-items:center;gap:17px}.cutdesk-audio-preview>span{display:grid;width:48px;height:48px;place-items:center;border-radius:50%;background:#292524;color:#fafaf9;font-size:23px}.cutdesk-audio-wave{display:flex;height:84px;width:100%;align-items:center;justify-content:center;gap:3px}.cutdesk-audio-wave i{width:3px;border-radius:4px;background:linear-gradient(#fafaf9,#cc7540);opacity:.8}.cutdesk-audio-preview audio{width:100%}.cutdesk-transport{display:flex;align-items:center;justify-content:center;gap:10px;height:43px}.cutdesk-transport button{display:grid;width:27px;height:27px;place-items:center;border:0;border-radius:6px;background:transparent;color:#d6d3d1;cursor:pointer}.cutdesk-transport button:hover{background:#35312d;color:#fff}.cutdesk-transport .play{background:#f5f5f4;color:#1f1d1a}.cutdesk-transport span{min-width:112px;color:#a8a29e;font-family:ui-monospace,SFMono-Regular,monospace;font-size:10px;text-align:center}.cutdesk-toolstrip{display:flex;justify-content:center;gap:4px;padding-bottom:13px}.cutdesk-tool{display:flex;align-items:center;gap:5px;border:1px solid transparent;border-radius:6px;background:transparent;padding:6px 8px;color:#a8a29e;font-size:10px;cursor:pointer}.cutdesk-tool:hover{background:#292524;color:#f5f5f4}.cutdesk-tool.active{border-color:#78716c;background:#3a3631;color:#fafaf9}.cutdesk-tool:disabled{opacity:.35;cursor:not-allowed}.cutdesk-tool i{font-size:14px;font-style:normal}.cutdesk-inspector{min-height:54px;border-top:1px solid #35312d;padding:10px 1px}.cutdesk-inspector-row{display:flex;align-items:center;gap:14px;color:#d6d3d1;font-size:10px}.cutdesk-inspector-row label{display:flex;align-items:center;gap:6px;color:#a8a29e}.cutdesk-inspector-row label b{color:#e7e5e4;font-family:ui-monospace,SFMono-Regular,monospace;font-size:10px;font-weight:500}.cutdesk-inspector-row select,.cutdesk-inspector-row input[type=number]{border:1px solid #44403c;border-radius:5px;background:#292524;padding:4px 6px;color:#f5f5f4;font-size:10px}.cutdesk-inspector-row input[type=range]{width:90px;accent-color:#f5f5f4}.cutdesk-inspector-row small{margin-left:auto;color:#78716c;font-size:10px}.cutdesk-inspector-row.note b{color:#f5f5f4}.cutdesk-inspector-row.note span{color:#a8a29e}.cutdesk-inspector-row.controls label{color:#d6d3d1}.cutdesk-footer{display:flex;justify-content:space-between;align-items:center;min-height:48px;padding:0 16px;border-top:1px solid #35312d;background:#1f1d1a;color:#a8a29e;font-size:10px}.cutdesk-footer .error{color:#ed7772}.cutdesk-footer>div{display:flex;align-items:center;gap:12px}.cutdesk-footer button{border:0;border-radius:6px;background:#f5f5f4;padding:8px 13px;color:#1c1917;font-size:11px;font-weight:800;cursor:pointer}.cutdesk-footer button:disabled{opacity:.45;cursor:not-allowed}.cutdesk-sequence{border-top:1px solid #44403c;background:#181715;padding:10px 16px 14px}.cutdesk-sequence-title{margin-bottom:8px;color:#d6d3d1;font-size:11px}.cutdesk-sequence-title span{color:#78716c;font-size:10px;font-weight:400}.cutdesk-timeline{position:relative;overflow:hidden;border:1px solid #44403c;border-radius:7px;background:#0f0e0d}.cutdesk-ruler{position:relative;height:22px;border-bottom:1px solid #35312d;background:#1f1d1a}.cutdesk-ruler span{position:absolute;top:5px;color:#78716c;font-family:ui-monospace,SFMono-Regular,monospace;font-size:9px;transform:translateX(-50%)}.cutdesk-ruler span:first-child{transform:none}.cutdesk-ruler span:last-child{transform:translateX(-100%)}.cutdesk-track{display:grid;grid-template-columns:34px minmax(0,1fr);min-height:47px;border-bottom:1px solid #35312d}.cutdesk-track.audio{min-height:31px;border-bottom:0}.cutdesk-track-label{display:grid;place-items:center;border-right:1px solid #35312d;background:#292524;color:#a8a29e;font-size:10px;font-weight:700}.cutdesk-track-lane{position:relative;display:flex;align-items:center;gap:4px;min-width:0;padding:5px 8px;overflow:hidden;background:repeating-linear-gradient(90deg,#151412 0,#151412 29px,#1f1d1a 30px)}.cutdesk-track-lane.waveform{background:repeating-linear-gradient(90deg,#181715 0,#181715 29px,#292524 30px)}.cutdesk-track-lane.waveform span{height:18px;width:100%;border-radius:3px;background:repeating-linear-gradient(90deg,#57534e 0,#57534e 2px,transparent 3px,transparent 6px);opacity:.55;color:#a8a29e;font-size:9px;line-height:18px;padding-left:7px}.cutdesk-track-placeholder{color:#78716c;font-size:10px}.cutdesk-track-clip{position:relative;z-index:3;display:flex;align-items:center;min-width:18px;height:30px;border:1px solid #78716c;border-radius:4px;background:linear-gradient(90deg,#3a3631,#57534e);padding:0;color:#f5f5f4;cursor:pointer;overflow:hidden}.cutdesk-track-clip.selected{border-color:#fafaf9;box-shadow:inset 0 0 0 1px #fafaf9}.cutdesk-clip-body{overflow:hidden;padding:0 5px;text-overflow:ellipsis;white-space:nowrap;font-size:9px}.cutdesk-clip-handle{position:absolute;z-index:2;width:4px;height:100%;background:#d6d3d1}.cutdesk-clip-handle.left{left:0}.cutdesk-clip-handle.right{right:0}.cutdesk-selection{position:absolute;z-index:4;top:2px;bottom:2px;border:1px solid #fafaf9;background:#fafaf915;pointer-events:none}.cutdesk-trim-range{position:absolute;z-index:6;left:0;top:0;width:100%;height:100%;margin:0;opacity:0;cursor:ew-resize}.cutdesk-trim-range.end{z-index:5}.cutdesk-cursor-range{position:absolute;z-index:7;left:0;top:0;width:100%;height:100%;margin:0;opacity:0;cursor:ew-resize}.cutdesk-playhead{position:absolute;z-index:8;top:0;bottom:0;width:1px;background:#fafaf9;pointer-events:none}.cutdesk-playhead:before{content:"";position:absolute;top:0;left:-4px;border-left:4px solid transparent;border-right:4px solid transparent;border-top:6px solid #fafaf9}@media(max-width:760px){.cutdesk{width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto}.cutdesk-workspace{grid-template-columns:1fr;height:auto;overflow:visible}.cutdesk-bin{border-right:0;border-bottom:1px solid #35312d}.cutdesk-media-list{display:flex;max-height:88px;overflow-x:auto}.cutdesk-media-item{min-width:155px}.cutdesk-viewer{height:auto;min-height:0;grid-template-rows:auto 220px auto auto}.cutdesk-preview{height:220px;min-height:0;max-height:220px}.cutdesk-preview video{max-height:220px}.cutdesk-header-center{display:none}.cutdesk-header{grid-template-columns:1fr auto}.cutdesk-footer>div>span{display:none}.cutdesk-inspector-row{flex-wrap:wrap}.cutdesk-inspector-row small{margin-left:0;width:100%}}
    `,
    nodes: [{ type: "media-editor:editor", title: "音频视频剪辑台", icon: "✂", description: "黑色时间轴剪辑台，支持按帧截取、拼接与常用音视频处理。", defaultSize: { width: 360, height: 130 }, minimapColor: "#f5f5f4", autoOpenPanel: true, Content: EditorContent, Panel: CutDeskPanel }],
  };
}

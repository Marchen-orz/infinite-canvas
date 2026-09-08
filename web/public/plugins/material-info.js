export default function createMaterialInfoPlugin(runtime) {
  const { jsx } = runtime;

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    const amount = value / 1024 ** index;
    return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
  }

  function materialSummary(node) {
    const metadata = node.metadata || {};
    if (!metadata.content || !["image", "video", "audio"].includes(node.type)) return "";
    const width = Math.round(Number(metadata.naturalWidth) || 0);
    const height = Math.round(Number(metadata.naturalHeight) || 0);
    const dimensions = width > 0 && height > 0 ? `${width} x ${height}` : "";
    const bytes = formatBytes(metadata.bytes);
    return [dimensions, bytes].filter(Boolean).join(" · ");
  }

  function MaterialInfoBadge({ ctx }) {
    const summary = materialSummary(ctx.node);
    if (!summary) return null;
    return jsx(
      "div",
      {
        className: "pointer-events-none absolute bottom-2 left-2 z-[55] max-w-[calc(100%-16px)] truncate rounded-md px-2 py-1 font-mono text-[11px] font-medium shadow-sm",
        style: {
          background: "rgba(23, 23, 23, 0.78)",
          color: "#fff",
          transform: `scale(${1 / Math.max(ctx.scale, 0.35)})`,
          transformOrigin: "bottom left",
        },
        title: `Material: ${summary}`,
      },
      summary,
    );
  }

  function SidePanelMaterialInfo({ node, theme }) {
    const summary = materialSummary(node);
    if (!summary) return null;
    return jsx(
      "span",
      {
        className: "block truncate text-[11px] leading-snug",
        style: { color: theme.node.muted },
        title: `Material: ${summary}`,
      },
      summary,
    );
  }

  return {
    id: "material-info",
    name: "素材信息",
    version: "1.0.0",
    description: "在生成素材节点和画布左侧元素栏显示尺寸与文件大小。",
    autoEnable: true,
    nodes: [],
    nodeOverlays: [MaterialInfoBadge],
    sidePanelNodeMeta: [SidePanelMaterialInfo],
  };
}

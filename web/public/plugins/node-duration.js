export default function createNodeDurationPlugin(runtime) {
  const { React, jsx } = runtime;

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
  }

  function NodeDurationBadge({ ctx }) {
    const metadata = ctx.node.metadata || {};
    const loading = metadata.status === "loading";
    const startedAt = metadata.generationStartedAt;
    const finishedAt = metadata.generationFinishedAt;
    const savedDuration = metadata.generationDurationMs;
    const [now, setNow] = React.useState(Date.now());

    React.useEffect(() => {
      if (loading && (!startedAt || finishedAt)) {
        ctx.updateMetadata({ generationStartedAt: Date.now(), generationFinishedAt: undefined, generationDurationMs: undefined });
        return;
      }
      if (!loading && startedAt && !finishedAt && savedDuration === undefined) {
        const endedAt = Date.now();
        ctx.updateMetadata({ generationFinishedAt: endedAt, generationDurationMs: endedAt - startedAt });
      }
    }, [ctx, finishedAt, loading, savedDuration, startedAt]);

    React.useEffect(() => {
      if (!loading) return undefined;
      setNow(Date.now());
      const timer = window.setInterval(() => setNow(Date.now()), 500);
      return () => window.clearInterval(timer);
    }, [loading]);

    const elapsed = loading && startedAt ? now - startedAt : savedDuration;
    if (elapsed === undefined) return null;

    return jsx(
      "div",
      {
        className: "pointer-events-none absolute right-2 top-2 z-[55] rounded-md px-2 py-1 font-mono text-[11px] font-medium shadow-sm",
        style: {
          background: loading ? "rgba(37, 99, 235, 0.92)" : "rgba(23, 23, 23, 0.78)",
          color: "#fff",
          transform: `scale(${1 / Math.max(ctx.scale, 0.35)})`,
          transformOrigin: "top right",
        },
        title: loading ? "Generation in progress" : "Generation duration",
      },
      formatDuration(elapsed),
    );
  }

  return {
    id: "node-duration",
    name: "节点耗时",
    version: "1.0.0",
    description: "在每个生成节点右上角显示实时和已完成的请求耗时。",
    autoEnable: true,
    nodes: [],
    nodeOverlays: [NodeDurationBadge],
  };
}

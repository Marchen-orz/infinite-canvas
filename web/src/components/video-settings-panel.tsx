import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { resolveVideoModelPlugin } from "@/services/api/model-plugins";
import { resolveModelForCapability, resolveModelScript, type AiConfig } from "@/stores/use-config-store";

const resolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];
const sizeOptions = [
    { value: "1280x720", labelKey: "landscape", width: 1280, height: 720 },
    { value: "720x1280", labelKey: "portrait", width: 720, height: 1280 },
    { value: "1024x1024", labelKey: "square", width: 1024, height: 1024 },
    { value: "1792x1024", labelKey: "widescreen", width: 1792, height: 1024 },
    { value: "1024x1792", labelKey: "tall", width: 1024, height: 1792 },
    { value: "auto", labelKey: "auto", width: 0, height: 0 },
];

const secondOptions = [6, 10, 12, 16, 20];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = sizeOptions.map((item) => ({ value: item.value, get label() { return i18n.t(`settingsPanels.video.sizes.${item.labelKey}`); } }));
export const videoSecondOptions = secondOptions.map((value) => String(value));
export const videoSecondsRange = { min: 4, max: 30 };

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoUseContextIr" | "videoSkillId" | "videoSeed", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const pluginSettings = resolveVideoModelPlugin(resolveModelScript(config, resolveModelForCapability(config, config.model, "video")))?.settings;
    const seconds = pluginSettings?.normalizeSeconds(config.videoSeconds) || config.videoSeconds || "6";
    const size = pluginSettings?.normalizeSize(config.size) || normalizeVideoSizeValue(config.size);
    const dimensions = readSizeDimensions(size);
    const resolution = pluginSettings?.normalizeResolution(config.vquality) || normalizeVideoResolutionValue(config.vquality);
    const availableResolutions = pluginSettings?.resolutions || resolutionOptions;
    const availableSeconds = pluginSettings?.seconds || secondOptions;
    const ratioMode = pluginSettings?.sizeMode === "ratios";
    const outputFields = pluginSettings?.outputFields || [];
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {availableResolutions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        {pluginSettings?.allowCustomResolution === false ? null : <ResolutionInput value={resolution} theme={theme} onChange={(value) => onConfigChange("vquality", pluginSettings?.normalizeResolution(value) || value)} />}
                    </div>
                </SettingGroup>
                <SettingGroup title={t(ratioMode ? "settingsPanels.video.ratio" : "settingsPanels.video.size")} color={theme.node.muted}>
                    {ratioMode ? (
                        <div className="grid grid-cols-3 gap-2.5">
                            {(pluginSettings?.ratios || []).map((value) => (
                                <OptionPill key={value} selected={size === value} theme={theme} onClick={() => onConfigChange("size", value)}>
                                    {value === "adaptive" ? t("settingsPanels.video.adaptive") : value}
                                </OptionPill>
                            ))}
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                                <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                                <span className="text-lg opacity-45">↔</span>
                                <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                            </div>
                            <div className="grid grid-cols-3 gap-2.5">
                                {sizeOptions.map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                        style={{ borderColor: size === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => onConfigChange("size", item.value)}
                                    >
                                        <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                        <span>{t(`settingsPanels.video.sizes.${item.labelKey}`)}</span>
                                        {item.value === "auto" ? null : <span className="text-[11px] leading-none opacity-55">{item.value}</span>}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {availableSeconds.map((value) => (
                            <OptionPill key={value} selected={seconds === String(value)} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                        <NumberInput value={seconds} min={pluginSettings?.minSeconds || 1} max={pluginSettings?.maxSeconds || 20} theme={theme} onChange={(value) => onConfigChange("videoSeconds", pluginSettings?.normalizeSeconds(value) || value)} />
                    </div>
                </SettingGroup>
                {outputFields.length ? (
                    <>
                        <SettingGroup title={t("settingsPanels.video.output")} color={theme.node.muted}>
                            <div className="grid grid-cols-2 gap-2.5">
                                {outputFields.includes("generateAudio") ? <BooleanPill label={t("settingsPanels.video.generateAudio")} value={config.videoGenerateAudio !== "false"} theme={theme} onChange={(value) => onConfigChange("videoGenerateAudio", String(value))} /> : null}
                                {outputFields.includes("watermark") ? <BooleanPill label={t("settingsPanels.video.watermark")} value={config.videoWatermark === "true"} theme={theme} onChange={(value) => onConfigChange("videoWatermark", String(value))} /> : null}
                                {outputFields.includes("contextIr") ? <BooleanPill label={t("settingsPanels.video.contextIr")} value={config.videoUseContextIr === "true"} theme={theme} onChange={(value) => onConfigChange("videoUseContextIr", String(value))} /> : null}
                            </div>
                        </SettingGroup>
                        {pluginSettings?.skillId && config.videoUseContextIr === "true" ? (
                            <SettingGroup title={t("settingsPanels.video.skillId")} color={theme.node.muted}>
                                <input className="h-9 w-full rounded-xl border bg-transparent px-3 text-sm outline-none" style={{ borderColor: theme.node.stroke, color: theme.node.text }} value={config.videoSkillId} placeholder="skill-019xxxxx" onChange={(event) => onConfigChange("videoSkillId", event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
                            </SettingGroup>
                        ) : null}
                        {pluginSettings?.seed ? (
                            <SettingGroup title="随机种子" color={theme.node.muted}>
                                <input inputMode="numeric" className="h-9 w-full rounded-xl border bg-transparent px-3 text-sm outline-none" style={{ borderColor: theme.node.stroke, color: theme.node.text }} value={config.videoSeed} placeholder="选填，整数；留空为随机" onChange={(event) => onConfigChange("videoSeed", event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
                            </SettingGroup>
                        ) : null}
                    </>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return `${normalizeVideoResolutionValue(value)}p`;
}

export function videoSizeLabel(value: string) {
    if (value === "adaptive" || value === "auto") return i18n.t("settingsPanels.video.adaptive");
    const size = normalizeVideoSizeValue(value);
    const option = sizeOptions.find((item) => item.value === size);
    return option ? i18n.t(`settingsPanels.video.sizes.${option.labelKey}`) : size;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    return value.replace(/p$/i, "") || "720";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function BooleanPill({ label, value, theme, onChange }: { label: string; value: boolean; theme: CanvasTheme; onChange: (value: boolean) => void }) {
    return (
        <button type="button" className="flex h-9 cursor-pointer items-center justify-between rounded-full border px-3 text-sm" style={{ borderColor: value ? theme.node.text : theme.node.stroke, color: theme.node.text }} onClick={() => onChange(!value)} onMouseDown={(event) => event.stopPropagation()}>
            <span>{label}</span><span className="text-xs opacity-60">{value ? "ON" : "OFF"}</span>
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function NumberInput({ value, min, max, theme, onChange }: { value: string; min: number; max: number; theme: CanvasTheme; onChange: (value: string) => void }) {
    return <input type="number" min={min} max={max} className="h-9 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }} value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />;
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}

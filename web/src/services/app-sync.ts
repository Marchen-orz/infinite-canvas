import localforage from "localforage";

import i18n, { changeAppLocale, type AppLocale } from "@/i18n";
import { IMAGE_QUICK_TOOLS_STORAGE_KEY } from "@/components/canvas/canvas-image-toolbar-tools";
import { exportPluginStorage, importPluginStorage } from "@/lib/canvas/canvas-event-bus";
import { getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { downloadWebdavFile, uploadWebdavFile, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import type { Asset } from "@/stores/use-asset-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { defaultConfig, useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";
import { useThemeStore, type ThemeName } from "@/stores/use-theme-store";
import { useAgentStore, type AgentPermissionMode, type AgentReasoningEffort } from "@/stores/use-agent-store";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

type StoredLog = Record<string, unknown> & { id?: string };
export type AppSyncDomainKey = "canvas" | "assets" | "image-workbench" | "video-workbench" | "settings" | "prompt-sources" | "plugins" | "plugin-storage" | "prompt-cache";
type DomainKey = AppSyncDomainKey;
type CanvasDomainData = { projects: CanvasProject[] };
type AssetDomainData = { assets: Asset[] };
type LogDomainData = { logs: StoredLog[] };
type TrackedData<T> = T & { updatedAt: string };
type SettingsDomainData = TrackedData<{
    config: AiConfig;
    theme: ThemeName;
    locale: AppLocale;
    preferences: Record<string, string | null>;
    agent: { url: string; token: string; permissionMode: AgentPermissionMode; model: string; reasoningEffort: AgentReasoningEffort | "" };
}>;
type PromptSourcesDomainData = TrackedData<{ sources: PromptSource[]; schedule: PromptSourceSchedule }>;
type PluginsDomainData = TrackedData<{ plugins: InstalledPlugin[] }>;
type EncodedValue = null | boolean | number | string | EncodedValue[] | { [key: string]: EncodedValue };
type PluginStorageDomainData = TrackedData<{ plugins: Array<{ id: string; entries: Array<{ key: string; value: EncodedValue }> }> }>;
type PromptCacheDomainData = TrackedData<{ entries: Array<{ key: string; value: StoredLog }> }>;


type AppSyncFile = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

type DomainManifest<T> = {
    app: "infinite-canvas";
    version: 1;
    domain: DomainKey;
    exportedAt: string;
    data: T;
    files: AppSyncFile[];
};

type SyncDomainOptions<T> = {
    key: DomainKey;
    label: string;
    localData: () => Promise<T>;
    emptyData: T;
    mergeData: (local: T, remote: T) => T;
    applyData?: (data: T) => Promise<void>;
};

type SyncDomainResult<T> = {
    data: T;
    mergedRemote: boolean;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncResult = {
    syncedAt: string;
    mergedRemote: boolean;
    projects: number;
    assets: number;
    imageLogs: number;
    videoLogs: number;
    settings: number;
    promptSources: number;
    plugins: number;
    pluginStorageEntries: number;
    promptCacheEntries: number;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncProgressEvent = {
    domain?: AppSyncDomainKey;
    label?: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

export type AppSyncProgress = (event: AppSyncProgressEvent) => void;

const FILE_CONCURRENCY = 3;
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const promptCacheStore = localforage.createInstance({ name: "infinite-canvas", storeName: "prompt_cache" });
type LogStore = typeof imageLogStore;
const storageKeyPattern = /^(image|video|audio|file|video-reference|audio-reference):/;

export async function syncAppDataToWebdav(config: WebdavSyncConfig, onProgress?: AppSyncProgress): Promise<AppSyncResult> {
    emitProgress(onProgress, { stage: "等待本地数据加载" });
    await Promise.all([
        waitForHydration(useCanvasStore),
        waitForHydration(useAssetStore),
        waitForPersistHydration(useConfigStore),
        waitForPersistHydration(usePromptSourceStore),
        waitForPersistHydration(useThemeStore),
        waitForPersistHydration(usePluginStore),
    ]);

    const [canvas, assets, imageLogs, videoLogs, settings, promptSources, plugins, pluginStorage, promptCache] = await Promise.all([
        syncDomain<CanvasDomainData>(config, onProgress, {
            key: "canvas",
            label: "画布",
            emptyData: { projects: [] },
            localData: async () => ({ projects: useCanvasStore.getState().projects }),
            mergeData: (local, remote) => ({ projects: mergeById(local.projects, remote.projects, "updatedAt") }),
            applyData: async (data) => useCanvasStore.getState().replaceProjects(data.projects),
        }),
        syncDomain<AssetDomainData>(config, onProgress, {
            key: "assets",
            label: "我的资产",
            emptyData: { assets: [] },
            localData: async () => ({ assets: useAssetStore.getState().assets }),
            mergeData: (local, remote) => ({ assets: mergeById(local.assets, remote.assets, "updatedAt") }),
            applyData: async (data) => useAssetStore.getState().replaceAssets(await Promise.all(data.assets.map(hydrateAsset))),
        }),
        syncDomain<LogDomainData>(config, onProgress, {
            key: "image-workbench",
            label: "生图工作台",
            emptyData: { logs: [] },
            localData: async () => ({ logs: await readStoredLogs(imageLogStore) }),
            mergeData: (local, remote) => ({ logs: mergeById(local.logs, remote.logs, "createdAt") }),
            applyData: async (data) => replaceStoredLogs(imageLogStore, data.logs),
        }),
        syncDomain<LogDomainData>(config, onProgress, {
            key: "video-workbench",
            label: "视频创作台",
            emptyData: { logs: [] },
            localData: async () => ({ logs: await readStoredLogs(videoLogStore) }),
            mergeData: (local, remote) => ({ logs: mergeById(local.logs, remote.logs, "createdAt") }),
            applyData: async (data) => replaceStoredLogs(videoLogStore, data.logs),
        }),
        syncDomain<SettingsDomainData>(config, onProgress, {
            key: "settings",
            label: "应用设置",
            emptyData: emptySettingsData(),
            localData: readSettingsData,
            mergeData: mergeTrackedData,
            applyData: applySettingsData,
        }),
        syncDomain<PromptSourcesDomainData>(config, onProgress, {
            key: "prompt-sources",
            label: "提示词源",
            emptyData: { sources: [], schedule: { intervalMinutes: 30, lastFetchedAt: "" }, updatedAt: "" },
            localData: async () => trackLocalData("prompt-sources", pickPromptSources()),
            mergeData: mergeTrackedData,
            applyData: async (data) => {
                usePromptSourceStore.setState({ sources: data.sources, schedule: data.schedule });
                saveTrackedData("prompt-sources", data);
            },
        }),
        syncDomain<PluginsDomainData>(config, onProgress, {
            key: "plugins",
            label: "节点插件",
            emptyData: { plugins: [], updatedAt: "" },
            localData: async () => trackLocalData("plugins", { plugins: usePluginStore.getState().plugins }),
            mergeData: mergeTrackedData,
            applyData: async (data) => {
                usePluginStore.setState({ plugins: data.plugins });
                saveTrackedData("plugins", data);
            },
        }),
        syncDomain<PluginStorageDomainData>(config, onProgress, {
            key: "plugin-storage",
            label: "插件数据",
            emptyData: { plugins: [], updatedAt: "" },
            localData: readPluginStorageData,
            mergeData: mergeTrackedData,
            applyData: applyPluginStorageData,
        }),
        syncDomain<PromptCacheDomainData>(config, onProgress, {
            key: "prompt-cache",
            label: "提示词缓存",
            emptyData: { entries: [], updatedAt: "" },
            localData: async () => trackLocalData("prompt-cache", { entries: await readStoredEntries(promptCacheStore) }),
            mergeData: mergeTrackedData,
            applyData: async (data) => {
                await replaceStoredEntries(promptCacheStore, data.entries);
                saveTrackedData("prompt-cache", data);
            },
        }),
    ]);

    const result = {
        syncedAt: new Date().toISOString(),
        mergedRemote: [canvas, assets, imageLogs, videoLogs, settings, promptSources, plugins, pluginStorage, promptCache].some((item) => item.mergedRemote),
        projects: canvas.data.projects.length,
        assets: assets.data.assets.length,
        imageLogs: imageLogs.data.logs.length,
        videoLogs: videoLogs.data.logs.length,
        settings: 1,
        promptSources: promptSources.data.sources.length,
        plugins: plugins.data.plugins.length,
        pluginStorageEntries: pluginStorage.data.plugins.reduce((count, plugin) => count + plugin.entries.length, 0),
        promptCacheEntries: promptCache.data.entries.length,
        files: canvas.files + assets.files + imageLogs.files + videoLogs.files + settings.files + promptSources.files + plugins.files + pluginStorage.files + promptCache.files,
        manifestBytes: canvas.manifestBytes + assets.manifestBytes + imageLogs.manifestBytes + videoLogs.manifestBytes + settings.manifestBytes + promptSources.manifestBytes + plugins.manifestBytes + pluginStorage.manifestBytes + promptCache.manifestBytes,
        uploadedFiles: canvas.uploadedFiles + assets.uploadedFiles + imageLogs.uploadedFiles + videoLogs.uploadedFiles + settings.uploadedFiles + promptSources.uploadedFiles + plugins.uploadedFiles + pluginStorage.uploadedFiles + promptCache.uploadedFiles,
        uploadedBytes: canvas.uploadedBytes + assets.uploadedBytes + imageLogs.uploadedBytes + videoLogs.uploadedBytes + settings.uploadedBytes + promptSources.uploadedBytes + plugins.uploadedBytes + pluginStorage.uploadedBytes + promptCache.uploadedBytes,
    };
    emitProgress(onProgress, { stage: "同步完成", status: "success" });
    return result;
}

async function syncDomain<T>(config: WebdavSyncConfig, onProgress: AppSyncProgress | undefined, options: SyncDomainOptions<T>): Promise<SyncDomainResult<T>> {
    try {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取远端清单", status: "active" });
        const remoteManifest = await readDomainManifest(config, options.key, options.emptyData);
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取本地数据", status: "active" });
        const localData = await options.localData();
        const mergedData = remoteManifest ? options.mergeData(localData, remoteManifest.data) : localData;

        if (remoteManifest) {
            emitProgress(onProgress, { domain: options.key, label: options.label, stage: "下载缺失媒体", status: "active" });
            await downloadMissingFiles(config, options.key, mergedData, remoteManifest.files, onProgress);
            emitProgress(onProgress, { domain: options.key, label: options.label, stage: "写入本地合并结果", status: "active" });
            await options.applyData?.(mergedData);
        }

        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "上传新增媒体", status: "active" });
        const uploaded = await uploadChangedFiles(config, options.key, mergedData, remoteManifest?.files || [], onProgress);
        const manifest: DomainManifest<T> = { app: "infinite-canvas", version: 1, domain: options.key, exportedAt: new Date().toISOString(), data: mergedData, files: uploaded.files };
        const manifestFile = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: `上传清单 ${formatBytes(manifestFile.size)}`, status: "active" });
        await uploadWebdavFile(config, domainPath(options.key, WEBDAV_MANIFEST_FILE_NAME), manifestFile, "application/json");
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "完成", current: 1, total: 1, status: "success" });

        return {
            data: mergedData,
            mergedRemote: Boolean(remoteManifest),
            files: uploaded.files.length,
            manifestBytes: manifestFile.size,
            uploadedFiles: uploaded.uploadedFiles,
            uploadedBytes: uploaded.uploadedBytes,
        };
    } catch (error) {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: error instanceof Error ? error.message : i18n.t("config.webdav.errors.syncFailed"), status: "exception" });
        throw error;
    }
}

async function readDomainManifest<T>(config: WebdavSyncConfig, domain: DomainKey, emptyData: T): Promise<DomainManifest<T> | null> {
    const file = await downloadWebdavFile(config, domainPath(domain, WEBDAV_MANIFEST_FILE_NAME));
    if (!file) return null;
    const data = JSON.parse(await file.text()) as DomainManifest<T>;
    if (data.app !== "infinite-canvas" || data.domain !== domain) throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
    return {
        app: "infinite-canvas",
        version: 1,
        domain,
        exportedAt: data.exportedAt || new Date().toISOString(),
        data: data.data || emptyData,
        files: Array.isArray(data.files) ? data.files : [],
    };
}

async function downloadMissingFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const tasks: AppSyncFile[] = [];
    const storageKeys = collectStorageKeys(data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const localBlob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        scanned += 1;
        if (localBlob) {
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const remoteFile = remoteFileMap.get(storageKey);
        if (remoteFile) tasks.push(remoteFile);
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
    }
    if (!tasks.length) {
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体已齐全", current: 1, total: 1, status: "active" });
        return;
    }
    let downloaded = 0;
    await runWithConcurrency(tasks, FILE_CONCURRENCY, async (remoteFile) => {
        const blob = await downloadWebdavFile(config, remoteFile.path);
        if (!blob) return;
        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, remoteFile.mimeType);
        await (remoteFile.storageKey.startsWith("image:") ? setImageBlob(remoteFile.storageKey, typedBlob) : setMediaBlob(remoteFile.storageKey, typedBlob));
        downloaded += 1;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "下载媒体", current: downloaded, total: tasks.length, status: "active" });
    });
}

async function uploadChangedFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const files: AppSyncFile[] = [];
    const tasks: Array<{ item: AppSyncFile; blob: Blob }> = [];
    let uploadedFiles = 0;
    let uploadedBytes = 0;

    const storageKeys = collectStorageKeys(data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        const remoteFile = remoteFileMap.get(storageKey);
        if (!blob) {
            if (remoteFile) files.push(remoteFile);
            scanned += 1;
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查本地媒体", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const item: AppSyncFile = {
            storageKey,
            path: remoteFile?.path || domainPath(domain, `files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`),
            mimeType: blob.type || remoteFile?.mimeType || "application/octet-stream",
            bytes: blob.size,
        };
        files.push(item);
        if (!remoteFile || remoteFile.bytes !== blob.size) tasks.push({ item, blob });
        scanned += 1;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查本地媒体", current: scanned, total: storageKeys.length, status: "active" });
    }

    if (!tasks.length) {
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体无需上传", current: 1, total: 1, status: "active" });
        return { files, uploadedFiles, uploadedBytes };
    }

    await runWithConcurrency(tasks, FILE_CONCURRENCY, async ({ item, blob }) => {
        await uploadWebdavFile(config, item.path, blob, item.mimeType);
        uploadedFiles += 1;
        uploadedBytes += blob.size;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: `上传媒体 ${formatBytes(blob.size)}`, current: uploadedFiles, total: tasks.length, status: "active" });
    });

    return { files, uploadedFiles, uploadedBytes };
}

async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "image" && asset.data.storageKey) {
        const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl } };
    }
    if (asset.kind === "video" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl, data: { ...asset.data, url } };
    }
    return asset;
}

async function readStoredLogs(store: LogStore) {
    const logs: StoredLog[] = [];
    await store.iterate<StoredLog, void>((value) => {
        if (value && typeof value === "object") logs.push(value);
    });
    return logs;
}

async function replaceStoredLogs(store: LogStore, logs: StoredLog[]) {
    await store.clear();
    await runWithConcurrency(logs, FILE_CONCURRENCY, async (log) => {
        const id = getStringField(log, "id");
        if (id) await store.setItem(id, log);
    });
}

async function readStoredEntries(store: LogStore) {
    const entries: Array<{ key: string; value: StoredLog }> = [];
    await store.iterate<StoredLog, void>((value, key) => entries.push({ key, value }));
    return entries;
}

async function replaceStoredEntries(store: LogStore, entries: Array<{ key: string; value: StoredLog }>) {
    await store.clear();
    await runWithConcurrency(entries, FILE_CONCURRENCY, async ({ key, value }) => store.setItem(key, value));
}

function mergeById<T extends { id?: string }>(local: T[], remote: T[], timeKey: string) {
    const items = new Map<string, T>();
    remote.forEach((item) => {
        const id = item.id || "";
        if (id) items.set(id, item);
    });
    local.forEach((item) => {
        const id = item.id || "";
        if (!id) return;
        const current = items.get(id);
        if (!current || getTime(item as Record<string, unknown>, timeKey) >= getTime(current as Record<string, unknown>, timeKey)) items.set(id, item);
    });
    return Array.from(items.values()).sort((a, b) => getTime(b as Record<string, unknown>, timeKey) - getTime(a as Record<string, unknown>, timeKey));
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string") {
        if (storageKeyPattern.test(value)) keys.add(value);
        return [...keys];
    }
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && storageKeyPattern.test(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return [...keys];
}

function domainPath(domain: DomainKey, path: string) {
    return `${domain}/${path}`;
}

function domainLabel(domain: DomainKey) {
    const labels: Record<DomainKey, string> = {
        canvas: "画布",
        assets: "我的资产",
        "image-workbench": "生图工作台",
        "video-workbench": "视频创作台",
        settings: "应用设置",
        "prompt-sources": "提示词源",
        plugins: "节点插件",
        "plugin-storage": "插件数据",
        "prompt-cache": "提示词缓存",
    };
    return labels[domain];
}


const SETTINGS_KEYS = ["canvas-side-panel-width", "canvas-side-panel-open", "canvas-agent-panel-width", IMAGE_QUICK_TOOLS_STORAGE_KEY] as const;
const TRACKING_PREFIX = "infinite-canvas:webdav-tracking:";

function emptySettingsData(): SettingsDomainData {
    return { config: defaultConfig, theme: "dark", locale: "zh-CN", preferences: {}, agent: { url: "", token: "", permissionMode: "request", model: "", reasoningEffort: "" }, updatedAt: "" };
}

function pickPromptSources() {
    const { sources, schedule } = usePromptSourceStore.getState();
    return { sources, schedule };
}

async function readSettingsData(): Promise<SettingsDomainData> {
    const agent = useAgentStore.getState();
    return trackLocalData("settings", {
        config: useConfigStore.getState().config,
        theme: useThemeStore.getState().theme,
        locale: ((i18n.resolvedLanguage || i18n.language) as AppLocale) || "zh-CN",
        preferences: Object.fromEntries(SETTINGS_KEYS.map((key) => [key, localStorage.getItem(key)])),
        agent: { url: agent.url, token: agent.token, permissionMode: agent.permissionMode, model: agent.model, reasoningEffort: agent.reasoningEffort },
    });
}

async function applySettingsData(data: SettingsDomainData) {
    useConfigStore.setState({ config: { ...defaultConfig, ...data.config } });
    useThemeStore.getState().setTheme(data.theme);
    await changeAppLocale(data.locale);
    Object.entries(data.preferences).forEach(([key, value]) => (value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)));
    const width = Number(data.preferences["canvas-side-panel-width"]);
    const panelOpen = data.preferences["canvas-side-panel-open"] !== "0";
    useCanvasSidePanelStore.setState({ width: width || useCanvasSidePanelStore.getState().width, panelOpen, panelMounted: panelOpen, panelClosing: false });
    localStorage.setItem("canvas-agent-url", data.agent.url);
    localStorage.setItem("canvas-agent-token", data.agent.token);
    localStorage.setItem("canvas-agent-permission-mode", data.agent.permissionMode);
    localStorage.setItem("canvas-agent-model", data.agent.model);
    localStorage.setItem("canvas-agent-reasoning-effort", data.agent.reasoningEffort);
    useAgentStore.getState().setAgentState({ ...data.agent, width: Number(data.preferences["canvas-agent-panel-width"]) || useAgentStore.getState().width });
    saveTrackedData("settings", data);
}

async function readPluginStorageData(): Promise<PluginStorageDomainData> {
    const raw = await exportPluginStorage(usePluginStore.getState().plugins.map((plugin) => plugin.id));
    const encoded = await Promise.all(raw.map(async (plugin) => ({ id: plugin.id, entries: await Promise.all(plugin.entries.map(async (entry) => ({ key: entry.key, value: await encodeValue(entry.value) }))) })));
    return trackLocalData("plugin-storage", { plugins: encoded });
}

async function applyPluginStorageData(data: PluginStorageDomainData) {
    const decoded = await Promise.all(data.plugins.map(async (plugin) => ({ id: plugin.id, entries: await Promise.all(plugin.entries.map(async (entry) => ({ key: entry.key, value: await decodeValue(entry.value) }))) })));
    await importPluginStorage(decoded);
    saveTrackedData("plugin-storage", data);
}

function mergeTrackedData<T extends { updatedAt: string }>(local: T, remote: T) {
    return getTime(local as Record<string, unknown>, "updatedAt") > getTime(remote as Record<string, unknown>, "updatedAt") ? local : remote;
}

function trackLocalData<T extends object>(scope: string, value: T): T & { updatedAt: string } {
    const fingerprint = JSON.stringify(value);
    const key = `${TRACKING_PREFIX}${scope}`;
    let metadata: { fingerprint: string; updatedAt: string } | null = null;
    try { metadata = JSON.parse(localStorage.getItem(key) || "null"); } catch { metadata = null; }
    if (!metadata) metadata = { fingerprint, updatedAt: "" };
    else if (metadata.fingerprint !== fingerprint) metadata = { fingerprint, updatedAt: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(metadata));
    return { ...value, updatedAt: metadata.updatedAt };
}

function saveTrackedData(scope: string, data: object) {
    const { updatedAt = "", ...value } = data as Record<string, unknown>;
    localStorage.setItem(`${TRACKING_PREFIX}${scope}`, JSON.stringify({ fingerprint: JSON.stringify(value), updatedAt }));
}

async function encodeValue(value: unknown): Promise<EncodedValue> {
    if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
    if (value instanceof Date) return { __webdavType: "date", value: value.toISOString() };
    if (value instanceof Blob) return { __webdavType: "blob", mimeType: value.type, data: await blobToBase64(value) };
    if (value instanceof ArrayBuffer) return { __webdavType: "array-buffer", data: bytesToBase64(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) return { __webdavType: "typed-array", name: value.constructor.name, data: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
    if (Array.isArray(value)) return Promise.all(value.map(encodeValue));
    if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await encodeValue(item)])));
    return String(value);
}

async function decodeValue(value: EncodedValue): Promise<unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return Array.isArray(value) ? Promise.all(value.map(decodeValue)) : value;
    const tagged = value as Record<string, EncodedValue>;
    if (tagged.__webdavType === "date" && typeof tagged.value === "string") return new Date(tagged.value);
    if ((tagged.__webdavType === "blob" || tagged.__webdavType === "array-buffer" || tagged.__webdavType === "typed-array") && typeof tagged.data === "string") {
        const bytes = base64ToBytes(tagged.data);
        if (tagged.__webdavType === "blob") return new Blob([bytes], { type: typeof tagged.mimeType === "string" ? tagged.mimeType : "" });
        return bytes.buffer;
    }
    return Object.fromEntries(await Promise.all(Object.entries(tagged).map(async ([key, item]) => [key, await decodeValue(item)])));
}

function blobToBase64(blob: Blob) { return blob.arrayBuffer().then((buffer) => bytesToBase64(new Uint8Array(buffer))); }
function bytesToBase64(bytes: Uint8Array) { let binary = ""; bytes.forEach((byte) => (binary += String.fromCharCode(byte))); return btoa(binary); }
function base64ToBytes(value: string) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }

function waitForPersistHydration(store: { persist: { hasHydrated: () => boolean; onFinishHydration: (listener: () => void) => () => void } }) {
    if (store.persist.hasHydrated()) return Promise.resolve();
    return new Promise<void>((resolve) => { const unsubscribe = store.persist.onFinishHydration(() => { unsubscribe(); resolve(); }); });
}

function emitProgress(onProgress: AppSyncProgress | undefined, event: AppSyncProgressEvent) {
    onProgress?.(event);
}

function getStringField(item: Record<string, unknown>, key: string) {
    const value = item[key];
    return typeof value === "string" ? value : "";
}

function getTime(item: Record<string, unknown>, key: string) {
    const value = item[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") return Date.parse(value) || 0;
    return 0;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    return storageKey.startsWith("image:") ? "png" : "bin";
}

function waitForHydration<T extends { hydrated: boolean }>(store: { getState: () => T; subscribe: (listener: (state: T) => void) => () => void }) {
    if (store.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe((state) => {
            if (!state.hydrated) return;
            unsubscribe();
            resolve();
        });
    });
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                results[index] = await worker(items[index], index);
            }
        }),
    );
    return results;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

import { create } from "zustand";
import type { VideoModelPlugin } from "./types";

export * from "./types";

const pluginsByOwner = new Map<string, VideoModelPlugin[]>();
export const useModelPluginRegistryVersion = create<{ version: number }>(() => ({ version: 0 }));
const bump = () => useModelPluginRegistryVersion.setState((state) => ({ version: state.version + 1 }));

export function registerVideoModelPlugins(plugins: VideoModelPlugin[] | undefined, owner: string) {
    if (plugins?.length) {
        pluginsByOwner.set(owner, plugins);
        bump();
    }
}

export function unregisterVideoModelPlugins(owner: string) {
    if (pluginsByOwner.delete(owner)) bump();
}

export function listVideoModelPlugins() {
    return Array.from(pluginsByOwner.values()).flat();
}

export function getVideoModelPluginTemplates() {
    return listVideoModelPlugins().flatMap((plugin) => plugin.templates);
}

export function resolveVideoModelPlugin(script: string) {
    return listVideoModelPlugins().find((plugin) => script.includes(plugin.marker));
}

export function migrateVideoModelPluginScript(script: string) {
    return listVideoModelPlugins().reduce((value, plugin) => plugin.migrateScript?.(value) || value, script);
}

export function transformModelPluginMediaUrl(url: string) {
    return listVideoModelPlugins().reduce((value, plugin) => plugin.transformMediaUrl?.(value) || value, url);
}

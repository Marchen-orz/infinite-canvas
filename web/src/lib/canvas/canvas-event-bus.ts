import localforage from "localforage";

import type { PluginStorage } from "@/types/canvas-plugin";

// Lightweight canvas event bus for communication between nodes and plugins.
type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();

export function emitCanvasEvent(event: string, payload?: unknown) {
    handlers.get(event)?.forEach((handler) => {
        try {
            handler(payload);
        } catch (error) {
            console.error(`[canvas-event] handler for "${event}" failed`, error);
        }
    });
}

export function onCanvasEvent(event: string, handler: Handler) {
    let set = handlers.get(event);
    if (!set) {
        set = new Set();
        handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
}

// Private plugin storage isolated by pluginId namespace.
const stores = new Map<string, LocalForage>();

function getPluginStore(pluginId: string) {
    let store = stores.get(pluginId);
    if (!store) {
        store = localforage.createInstance({ name: "infinite-canvas-plugins", storeName: pluginId });
        stores.set(pluginId, store);
    }
    return store;
}

export async function exportPluginStorage(pluginIds: string[]) {
    return Promise.all(
        pluginIds.map(async (pluginId) => {
            const entries: Array<{ key: string; value: unknown }> = [];
            await getPluginStore(pluginId).iterate<unknown, void>((value, key) => {
                entries.push({ key, value });
            });
            return { id: pluginId, entries };
        }),
    );
}

export async function importPluginStorage(data: Array<{ id: string; entries: Array<{ key: string; value: unknown }> }>) {
    await Promise.all(
        data.map(async ({ id, entries }) => {
            const store = getPluginStore(id);
            await store.clear();
            await Promise.all(entries.map(({ key, value }) => store.setItem(key, value)));
        }),
    );
}

export function createPluginStorage(pluginId: string): PluginStorage {
    const store = getPluginStore(pluginId);
    return {
        get: (key) => store!.getItem(key),
        set: async (key, value) => {
            await store!.setItem(key, value);
        },
        remove: async (key) => {
            await store!.removeItem(key);
        },
    };
}

import { create } from "zustand";

import i18n from "@/i18n";

import type { CanvasNodeDefinition, CanvasNodeOverlay, CanvasSidePanelNodeMeta } from "@/types/canvas-plugin";
import { CanvasNodeType } from "@/types/canvas";

const definitions = new Map<string, CanvasNodeDefinition>();
const ownerByType = new Map<string, string>(); // type -> pluginId; built-in nodes use "builtin".
const overlaysByPlugin = new Map<string, CanvasNodeOverlay[]>();
const sidePanelMetaByPlugin = new Map<string, CanvasSidePanelNodeMeta[]>();

// Increment the registry version on registration or removal to update dependent UI such as creation menus.
export const useNodeRegistryVersion = create<{ version: number }>(() => ({ version: 0 }));
function bump() {
    useNodeRegistryVersion.setState((state) => ({ version: state.version + 1 }));
}

export function registerNodeDefinitions(defs: CanvasNodeDefinition[], pluginId = "builtin") {
    defs.forEach((def) => {
        definitions.set(def.type, def);
        ownerByType.set(def.type, pluginId);
    });
    bump();
}

export function registerNodeOverlays(overlays: CanvasNodeOverlay[] | undefined, pluginId: string) {
    if (!overlays?.length) return;
    overlaysByPlugin.set(pluginId, overlays);
    bump();
}

export function registerSidePanelNodeMeta(components: CanvasSidePanelNodeMeta[] | undefined, pluginId: string) {
    if (!components?.length) return;
    sidePanelMetaByPlugin.set(pluginId, components);
    bump();
}

export function unregisterPluginNodes(pluginId: string) {
    let removedNodes = false;
    for (const [type, owner] of ownerByType) {
        if (owner !== pluginId) continue;
        definitions.delete(type);
        ownerByType.delete(type);
        removedNodes = true;
    }
    const removedOverlays = overlaysByPlugin.delete(pluginId);
    const removedSidePanelMeta = sidePanelMetaByPlugin.delete(pluginId);
    if (removedNodes || removedOverlays || removedSidePanelMeta) bump();
}

export function getNodeDefinition(type: string) {
    return definitions.get(type);
}

export function getNodePluginId(type: string) {
    return ownerByType.get(type) || "builtin";
}

export function listNodeDefinitions() {
    return Array.from(definitions.values());
}

export function listNodeOverlays() {
    return Array.from(overlaysByPlugin.entries()).flatMap(([pluginId, overlays]) => overlays.map((Overlay, index) => ({ id: `${pluginId}:${index}`, Overlay })));
}

export function listSidePanelNodeMeta() {
    return Array.from(sidePanelMetaByPlugin.entries()).flatMap(([pluginId, components]) => components.map((Component, index) => ({ id: `${pluginId}:${index}`, Component })));
}

export function isRegisteredNodeType(type: string) {
    return definitions.has(type);
}

const FALLBACK_SPEC = { width: 340, height: 240, title: i18n.t("canvas.node.node"), metadata: {} as CanvasNodeDefinition["defaultMetadata"] };

// Provide default size, title, and metadata shared by createCanvasNode and agent operations.
export function getNodeSpec(type: string) {
    const def = definitions.get(type);
    if (!def) return FALLBACK_SPEC;
    return { width: def.defaultSize.width, height: def.defaultSize.height, title: def.title, metadata: def.defaultMetadata };
}

export function isBuiltinNodeType(type: string) {
    return (Object.values(CanvasNodeType) as string[]).includes(type);
}

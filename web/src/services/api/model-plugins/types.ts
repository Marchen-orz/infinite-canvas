export type ModelPluginTemplate = { label: string; script: string };

export type VideoPluginSettings = {
    resolutions: Array<{ value: string; label: string }>;
    seconds: number[];
    minSeconds: number;
    maxSeconds: number;
    sizeMode: "dimensions" | "ratios";
    ratios?: string[];
    allowCustomResolution: boolean;
    outputFields?: Array<"generateAudio" | "watermark" | "contextIr">;
    skillId?: boolean;
    normalizeResolution: (value: string) => string;
    normalizeSeconds: (value: string) => string;
    normalizeSize: (value: string) => string;
    resolutionLabel: (value: string) => string;
};

export type VideoModelPlugin = {
    id: string;
    marker: string;
    templates: ModelPluginTemplate[];
    settings: VideoPluginSettings;
    migrateScript?: (script: string) => string;
    transformMediaUrl?: (url: string) => string;
};

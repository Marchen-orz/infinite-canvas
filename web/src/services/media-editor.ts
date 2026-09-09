import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

import { resolveMediaUrl } from "@/services/file-storage";

export type MediaEditorSource = {
    content: string;
    storageKey?: string;
    mimeType?: string;
    kind: "video" | "audio";
};

export type MediaEditorRequest = {
    operation: "trim" | "concat" | "extract-audio" | "mute" | "audio-adjust" | "video-speed";
    sources: MediaEditorSource[];
    startSeconds?: number;
    endSeconds?: number;
    speed?: number;
    volume?: number;
    fadeInSeconds?: number;
    fadeOutSeconds?: number;
};

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

async function getFfmpeg() {
    if (ffmpeg?.loaded) return ffmpeg;
    if (!loading) {
        loading = (async () => {
            const instance = new FFmpeg();
            await instance.load({ coreURL, wasmURL });
            ffmpeg = instance;
            return instance;
        })().catch((error) => {
            loading = null;
            throw error;
        });
    }
    return loading;
}

function extension(source: MediaEditorSource, fallback: string) {
    const subtype = (source.mimeType || "").split("/")[1]?.split(";")[0];
    return subtype && /^[a-z0-9]+$/i.test(subtype) ? subtype : fallback;
}

function seconds(value: number | undefined, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function tempoFilters(speed: number) {
    const filters: string[] = [];
    let value = Math.max(0.25, Math.min(4, speed));
    while (value > 2) {
        filters.push("atempo=2");
        value /= 2;
    }
    while (value < 0.5) {
        filters.push("atempo=0.5");
        value /= 0.5;
    }
    filters.push(`atempo=${value.toFixed(5)}`);
    return filters.join(",");
}

function outputSpec(request: MediaEditorRequest) {
    const source = request.sources[0];
    const audio = request.operation === "extract-audio" || source.kind === "audio";
    return audio ? { path: "output.mp3", mimeType: "audio/mpeg" } : { path: "output.mp4", mimeType: "video/mp4" };
}

export async function editMedia(request: MediaEditorRequest) {
    if (!request.sources.length) throw new Error("请先选择至少一个音视频素材");
    const worker = await getFfmpeg();
    const files: string[] = [];
    const output = outputSpec(request);
    try {
        for (let index = 0; index < request.sources.length; index++) {
            const source = request.sources[index];
            const url = await resolveMediaUrl(source.storageKey, source.content);
            if (!url) throw new Error("素材文件不可用，请重新上传后再试");
            const path = `input-${index}.${extension(source, source.kind === "video" ? "mp4" : "mp3")}`;
            await worker.writeFile(path, await fetchFile(url));
            files.push(path);
        }

        const first = request.sources[0];
        const start = seconds(request.startSeconds, 0);
        const end = seconds(request.endSeconds, 0);
        let args: string[];
        if (request.operation === "trim") {
            if (!(end > start)) throw new Error("结束位置需要大于开始位置");
            args = ["-i", files[0], "-ss", start.toFixed(6), "-to", end.toFixed(6)];
            args.push(...(first.kind === "video" ? ["-map", "0:v?", "-map", "0:a?", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart"] : ["-vn", "-c:a", "libmp3lame", "-q:a", "2"]), output.path);
        } else if (request.operation === "concat") {
            if (files.length < 2) throw new Error("拼接至少需要两个素材");
            const list = files.map((file) => `file '${file}'`).join("\n");
            await worker.writeFile("concat.txt", list);
            args = ["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", output.path];
        } else if (request.operation === "extract-audio") {
            args = ["-i", files[0], "-vn", "-c:a", "libmp3lame", "-q:a", "2", output.path];
        } else if (request.operation === "mute") {
            args = ["-i", files[0], "-map", "0:v?", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-movflags", "+faststart", output.path];
        } else if (request.operation === "video-speed") {
            const speed = Math.max(0.25, Math.min(4, Number(request.speed) || 1));
            args = ["-i", files[0], "-filter_complex", `[0:v]setpts=PTS/${speed}[v];[0:a]${tempoFilters(speed)}[a]`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", output.path];
        } else {
            const volume = Math.max(0, Math.min(2, Number(request.volume) || 1));
            const filters = [`volume=${volume.toFixed(3)}`];
            const fadeIn = seconds(request.fadeInSeconds, 0);
            const fadeOut = seconds(request.fadeOutSeconds, 0);
            if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
            // An out fade needs duration. ffmpeg accepts a negative start only poorly, so it is added only when trimming supplied an end.
            if (fadeOut > 0 && end > start) filters.push(`afade=t=out:st=${Math.max(0, end - start - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
            args = ["-i", files[0], "-vn", "-af", filters.join(","), "-c:a", "libmp3lame", "-q:a", "2", output.path];
        }
        const result = await worker.exec(args);
        if (result !== 0) throw new Error("剪辑处理失败：素材编码可能不受浏览器剪辑引擎支持");
        const data = await worker.readFile(output.path);
        if (typeof data === "string") throw new Error("剪辑结果读取失败");
        return new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], { type: output.mimeType });
    } finally {
        await Promise.all([...files, "concat.txt", output.path].map((path) => worker.deleteFile(path).catch(() => undefined)));
    }
}

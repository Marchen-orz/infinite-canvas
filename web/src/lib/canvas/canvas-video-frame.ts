import { transformModelPluginMediaUrl } from "@/services/api/model-plugins";

export type VideoFramePosition = "first" | "last" | "current";

export async function captureVideoFrame(source: string, position: VideoFramePosition, currentTime: number) {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    try {
        const metadataLoaded = waitForVideo(video, "loadedmetadata");
        video.src = transformModelPluginMediaUrl(source);
        video.load();

        await metadataLoaded;
        if (!video.videoWidth || !video.videoHeight) throw new Error("Video has no decoded frame");
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const endTime = Math.max(0, duration - 0.05);
        const time = position === "first" ? 0 : position === "last" ? endTime : Math.max(0, Math.min(Number.isFinite(currentTime) ? currentTime : 0, endTime));
        if (time > 0 || position === "last") {
            const seeked = waitForVideo(video, "seeked");
            video.currentTime = time;
            await seeked;
        }
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            await waitForVideo(video, "loadeddata");
        }

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Failed to create frame canvas");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Failed to capture video frame"))), "image/png"));
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

function waitForVideo(video: HTMLVideoElement, eventName: "loadedmetadata" | "loadeddata" | "seeked") {
    return new Promise<void>((resolve, reject) => {
        const finish = () => {
            video.removeEventListener(eventName, finish);
            video.removeEventListener("error", fail);
            resolve();
        };
        const fail = () => {
            video.removeEventListener(eventName, finish);
            video.removeEventListener("error", fail);
            reject(new Error("Failed to read video frame"));
        };
        video.addEventListener(eventName, finish);
        video.addEventListener("error", fail);
    });
}

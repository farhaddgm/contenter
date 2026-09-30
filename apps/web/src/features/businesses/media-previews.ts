/**
 * Browser-side previews of an uploaded brand asset: a downsized JPEG of an image, or a few
 * frames of a video. These — not the original file — are what the AI analysis looks at, so a
 * 200 MB video costs the same as four small pictures and the server needs no ffmpeg.
 */
const IMAGE_MAX_SIDE = 1568;
const FRAME_MAX_SIDE = 1024;
const FRAME_POSITIONS = [0.08, 0.35, 0.62, 0.9];
const JPEG_QUALITY = 0.85;
const VIDEO_TIMEOUT_MS = 20_000;

function toJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxSide: number,
): Promise<Blob | null> {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  // Transparent PNGs would turn black in JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}

/** One downsized JPEG of an image file (first frame for GIFs). Empty when it cannot be decoded. */
export async function imagePreviews(file: File): Promise<Blob[]> {
  try {
    const bitmap = await createImageBitmap(file);
    const blob = await toJpeg(bitmap, bitmap.width, bitmap.height, IMAGE_MAX_SIDE);
    bitmap.close();
    return blob ? [blob] : [];
  } catch {
    return [];
  }
}

/** Frames spread over the video. Empty when the browser cannot play the file's codec. */
export function videoPreviews(file: File): Promise<Blob[]> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const frames: Blob[] = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(frames);
    };
    const timer = setTimeout(finish, VIDEO_TIMEOUT_MS);

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = finish;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (!duration || !video.videoWidth) return finish();
      const times = FRAME_POSITIONS.map((p) => p * duration);
      let index = 0;
      video.onseeked = () => {
        void toJpeg(video, video.videoWidth, video.videoHeight, FRAME_MAX_SIDE).then((blob) => {
          if (blob) frames.push(blob);
          index++;
          if (index >= times.length) finish();
          else video.currentTime = times[index]!;
        });
      };
      video.currentTime = times[0]!;
    };
    video.src = url;
  });
}

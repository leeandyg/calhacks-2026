// Share decoded images between the managed preload and the room's independent textures.
// Each mesh keeps its own texture/animation offset, but never downloads the image again.
const ready = new Map<string, HTMLImageElement>();
const loads = new Map<string, Promise<HTMLImageElement>>();

export function paintImage(url: string): HTMLImageElement | undefined { return ready.get(url); }

export function loadPaintImage(url: string): Promise<HTMLImageElement> {
  const existing = loads.get(url);
  if (existing) return existing;
  const loading = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const fail = () => { loads.delete(url); reject(new Error('A generated image could not be loaded.')); };
    image.onerror = fail;
    image.onload = async () => {
      try {
        await image.decode();
        ready.set(url, image);
        resolve(image);
      } catch { fail(); }
    };
    image.src = url;
  });
  loads.set(url, loading);
  return loading;
}

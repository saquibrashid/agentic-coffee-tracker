export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const matches = dataUrl.match(/^data:(.+);base64,(.*)$/);
  if (!matches) throw new Error('Invalid data URL');
  const mime = matches[1];
  const bstr = atob(matches[2]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

export function byteSizeOfDataUrl(dataUrl: string): number {
  const base64String = dataUrl.split(',')[1] || '';
  // Each base64 character represents 6 bits
  return Math.floor((base64String.length * 6) / 8);
}

export async function resizeDataUrl(
  dataUrl: string,
  maxWidth = 1600,
  mimeType = 'image/webp',
  quality = 0.85,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not supported'));
      ctx.drawImage(img, 0, 0, width, height);
      const out = canvas.toDataURL(mimeType, quality);
      resolve({ dataUrl: out, width, height });
    };
    img.onerror = (e) => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

export async function createThumbnail(dataUrl: string, maxDim = 160) {
  return resizeDataUrl(dataUrl, maxDim, 'image/webp', 0.75);
}

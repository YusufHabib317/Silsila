import sharp from 'sharp'

export interface CompressResult {
  buffer: Buffer
  mime: string
  width: number | null
  height: number | null
  ext: string
}

// docs/ARCHITECTURE.md §7: images are the real product record. Re-encode to WebP,
// cap the long edge at ~1280px, ~80% quality — a 4MB photo becomes ~80–150KB.
// `.rotate()` (no args) applies EXIF orientation before stripping metadata.
export async function compressImage(input: Buffer): Promise<CompressResult> {
  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true })

  return {
    buffer: data,
    mime: 'image/webp',
    width: info.width ?? null,
    height: info.height ?? null,
    ext: 'webp',
  }
}

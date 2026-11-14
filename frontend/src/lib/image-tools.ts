export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_SOURCE_PIXELS = 40_000_000
export const MAX_OUTPUT_PIXELS = 20_000_000

export type RasterMime = 'image/png' | 'image/jpeg' | 'image/webp'
export interface RasterInfo {
  mime: RasterMime
  width: number
  height: number
}

function dimensions(mime: RasterMime, width: number, height: number): RasterInfo {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new Error('Dimensi gambar tidak valid.')
  if (width > 32768 || height > 32768 || width * height > MAX_SOURCE_PIXELS)
    throw new Error('Gambar terlalu besar. Batas sumber 40 megapiksel dan sisi 32.768 piksel.')
  return { mime, width, height }
}

// Check the actual raster header and dimensions before asking the browser to decode pixels.
// This deliberately excludes SVG and other formats that can contain active content.
export function readRasterInfo(bytes: Uint8Array): RasterInfo {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Ukuran berkas maksimal 20 MB.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length))
  const png = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length >= 24 && png.every((value, index) => bytes[index] === value)) {
    if (view.getUint32(8) !== 13 || text(12, 4) !== 'IHDR')
      throw new Error('Header PNG tidak valid.')
    return dimensions('image/png', view.getUint32(16), view.getUint32(20))
  }
  if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    if (view.getUint32(4, true) + 8 > bytes.length) throw new Error('Berkas WebP terpotong.')
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = text(offset, 4)
      const size = view.getUint32(offset + 4, true)
      const start = offset + 8
      if (start + size > bytes.length) throw new Error('Berkas WebP terpotong.')
      if (kind === 'VP8X' && size >= 10) {
        const little24 = (at: number) => bytes[at]! + bytes[at + 1]! * 256 + bytes[at + 2]! * 65536
        return dimensions('image/webp', 1 + little24(start + 4), 1 + little24(start + 7))
      }
      if (kind === 'VP8L' && size >= 5 && bytes[start] === 0x2f) {
        const packed = view.getUint32(start + 1, true)
        return dimensions('image/webp', 1 + (packed & 0x3fff), 1 + ((packed >>> 14) & 0x3fff))
      }
      if (
        kind === 'VP8 ' &&
        size >= 10 &&
        bytes[start + 3] === 0x9d &&
        bytes[start + 4] === 0x01 &&
        bytes[start + 5] === 0x2a
      )
        return dimensions(
          'image/webp',
          view.getUint16(start + 6, true) & 0x3fff,
          view.getUint16(start + 8, true) & 0x3fff,
        )
      offset = start + size + (size % 2)
    }
    throw new Error('Dimensi WebP tidak ditemukan.')
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 1 < bytes.length) {
      if (bytes[offset] !== 0xff) break
      while (bytes[offset] === 0xff) offset += 1
      const marker = bytes[offset++]
      if (marker === undefined || marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) break
      const size = view.getUint16(offset)
      if (size < 2 || offset + size > bytes.length) break
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && size >= 8)
        return dimensions('image/jpeg', view.getUint16(offset + 5), view.getUint16(offset + 3))
      offset += size
    }
    throw new Error('Header JPEG tidak lengkap atau tidak didukung.')
  }
  throw new Error('Pilih berkas JPG, PNG, atau WebP yang valid. SVG tidak didukung.')
}

export function validateImageOutput(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192
  )
    throw new Error('Lebar dan tinggi harus bilangan bulat antara 1 dan 8.192 piksel.')
  if (width * height > MAX_OUTPUT_PIXELS)
    throw new Error('Hasil maksimal 20 megapiksel. Kurangi ukuran gambar.')
  return { width, height }
}

export function fitImage(width: number, height: number, maxEdge = 4096) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(maxEdge) ||
    maxEdge < 1 ||
    maxEdge > 8192
  )
    throw new Error('Ukuran gambar tidak valid.')
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function formatBytes(size: number) {
  return size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(2)} MB`
}

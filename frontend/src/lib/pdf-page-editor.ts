import { drawImageAnnotations, type ImageAnnotation } from './image-annotations.ts'

export const MAX_PDF_PAGE_PIXELS = 40_000_000
export const MAX_PDF_PAGE_EDGE = 8192
export const MAX_PDF_PAGE_BYTES = 128 * 1024 * 1024
export type PageRotation = 0 | 90 | 180 | 270

export interface PdfPageSource {
  url: string
  name: string
  width: number
  height: number
  dpi: number
}

export interface PdfPageEditResult {
  name: string
  width: number
  height: number
  dpi: number
}

export function validatePdfPageSize(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_PDF_PAGE_EDGE ||
    height > MAX_PDF_PAGE_EDGE
  )
    throw new Error('Lebar dan tinggi harus bilangan bulat antara 1 dan 8.192 piksel.')
  if (width * height > MAX_PDF_PAGE_PIXELS)
    throw new Error('Satu halaman maksimal 40 megapiksel. Kurangi dimensi hasil.')
  return { width, height }
}

export function rotatedPageSize(width: number, height: number, rotation: PageRotation = 0) {
  validatePdfPageSize(width, height)
  if (![0, 90, 180, 270].includes(rotation))
    throw new Error('Rotasi halaman harus 0, 90, 180, atau 270 derajat.')
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height }
}

/** Clockwise canvas transform; every source corner stays inside the rotated page. */
export function pageRotationMatrix(
  width: number,
  height: number,
  rotation: PageRotation,
): [number, number, number, number, number, number] {
  rotatedPageSize(width, height, rotation)
  if (rotation === 90) return [0, 1, -1, 0, height, 0]
  if (rotation === 180) return [-1, 0, 0, -1, width, height]
  if (rotation === 270) return [0, -1, 1, 0, 0, width]
  return [1, 0, 0, 1, 0, 0]
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== 'image/png')
        reject(new Error('Halaman gagal disimpan sebagai PNG. Kurangi dimensinya dan coba lagi.'))
      else resolve(blob)
    }, 'image/png'),
  )
}

/** Shared preview/export path; annotation blur is flattened before page rotation. */
export function drawEditedPage(
  target: HTMLCanvasElement,
  image: ImageBitmap,
  annotations: ImageAnnotation[],
  width: number,
  height: number,
  rotation: PageRotation = 0,
) {
  validatePdfPageSize(image.width, image.height)
  const output = rotatedPageSize(width, height, rotation)
  target.width = output.width
  target.height = output.height
  const canvas = rotation ? document.createElement('canvas') : target
  if (rotation) {
    canvas.width = width
    canvas.height = height
  }
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas belum tersedia pada browser ini.')
    context.clearRect(0, 0, width, height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)
    drawImageAnnotations(context, image, annotations, image.width, image.height, width, height)
    if (rotation) {
      const rotated = target.getContext('2d')
      if (!rotated) throw new Error('Canvas belum tersedia pada browser ini.')
      rotated.save()
      rotated.setTransform(...pageRotationMatrix(width, height, rotation))
      rotated.drawImage(canvas, 0, 0)
      rotated.restore()
    }
  } finally {
    if (canvas !== target) {
      canvas.width = 1
      canvas.height = 1
    }
  }
}

export async function renderEditedPage(
  image: ImageBitmap,
  annotations: ImageAnnotation[],
  width: number,
  height: number,
  rotation: PageRotation = 0,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  try {
    drawEditedPage(canvas, image, annotations, width, height, rotation)
    const blob = await canvasBlob(canvas)
    if (blob.size > MAX_PDF_PAGE_BYTES)
      throw new Error('Hasil halaman melebihi 128 MB. Kurangi dimensinya.')
    return blob
  } finally {
    canvas.width = 1
    canvas.height = 1
  }
}

export async function renderBlankPage(width: number, height: number): Promise<Blob> {
  validatePdfPageSize(width, height)
  const canvas = document.createElement('canvas')
  try {
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas belum tersedia pada browser ini.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    return await canvasBlob(canvas)
  } finally {
    canvas.width = 1
    canvas.height = 1
  }
}

export async function loadPdfPage(
  source: PdfPageSource,
  signal: AbortSignal,
): Promise<ImageBitmap> {
  validatePdfPageSize(source.width, source.height)
  const url = new URL(source.url, window.location.href)
  if (url.origin !== window.location.origin)
    throw new Error('Sumber halaman harus berasal dari server lokal Ruang.')
  const response = await fetch(url, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error('Gambar halaman belum dapat dimuat. Coba buka ulang editor.')
  const length = Number(response.headers.get('content-length'))
  if (length > MAX_PDF_PAGE_BYTES) throw new Error('Berkas halaman melebihi batas 128 MB.')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  if (!response.body) throw new Error('Server belum mengirim gambar halaman.')
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PDF_PAGE_BYTES) {
        await reader.cancel()
        throw new Error('Berkas halaman melebihi batas 128 MB.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const blob = new Blob(chunks, { type: 'image/png' })
  const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer())
  const png = [137, 80, 78, 71, 13, 10, 26, 10]
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  if (
    header.length < 24 ||
    !png.every((value, index) => header[index] === value) ||
    view.getUint32(8) !== 13 ||
    String.fromCharCode(...header.slice(12, 16)) !== 'IHDR'
  )
    throw new Error('Sumber halaman bukan PNG yang valid.')
  if (view.getUint32(16) !== source.width || view.getUint32(20) !== source.height)
    throw new Error('Dimensi gambar halaman tidak cocok dengan metadata. Buka ulang dokumen.')
  signal.throwIfAborted()
  const image = await createImageBitmap(blob)
  if (signal.aborted || image.width !== source.width || image.height !== source.height) {
    image.close()
    signal.throwIfAborted()
    throw new Error('Dimensi gambar yang dibuka tidak cocok dengan halaman.')
  }
  return image
}

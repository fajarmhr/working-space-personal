export interface PdfImageAsset {
  id: string
  job_id: string
  name: string
  width: number
  height: number
  dpi: number
  image_url: string
  thumbnail_url: string
  source_page: number | null
  size: number
}

export interface PdfImageJob {
  id: string
  kind: 'import' | 'export'
  state: 'queued' | 'running' | 'completed' | 'failed'
  filename: string
  progress: number | null
  message: string
  error: string | null
  pages: PdfImageAsset[]
  download_url: string | null
}

export type PdfImageFormat = 'png' | 'jpeg' | 'webp' | 'tiff'

export interface PdfImageExportOptions {
  pages: { job_id: string; id: string }[]
  format: PdfImageFormat
  quality: number
  webp_lossless: boolean
  bundle: boolean
}

export interface PdfImageCollection {
  pages: PdfImageAsset[]
  selected: string | null
  past: PdfImageAsset[][]
  future: PdfImageAsset[][]
}

export const MAX_PDF_IMAGE_PAGES = 100
export const MAX_PDF_IMAGE_PIXELS = 1_000_000_000
export const PDF_IMAGE_HISTORY_LIMIT = 30

export function pdfImageKey(asset: Pick<PdfImageAsset, 'job_id' | 'id'>): string {
  return `${asset.job_id}:${asset.id}`
}

export function validatePdfImagePages(pages: PdfImageAsset[]): void {
  if (pages.length > MAX_PDF_IMAGE_PAGES)
    throw new Error(
      'Susunan maksimal 100 halaman. Hapus sebagian halaman sebelum menambah dokumen lain.',
    )
  const keys = new Set<string>()
  let pixels = 0
  for (const page of pages) {
    const key = pdfImageKey(page)
    if (keys.has(key)) throw new Error('Halaman yang sama sudah ada dalam susunan.')
    keys.add(key)
    if (
      !Number.isInteger(page.width) ||
      !Number.isInteger(page.height) ||
      page.width < 1 ||
      page.height < 1 ||
      page.width > 8192 ||
      page.height > 8192 ||
      page.width * page.height > 40_000_000
    )
      throw new Error('Dimensi halaman melebihi batas 40 MP atau 8.192 piksel per sisi.')
    pixels += page.width * page.height
  }
  if (pixels > MAX_PDF_IMAGE_PIXELS)
    throw new Error(
      'Total susunan melebihi 1 gigapiksel. Kurangi halaman atau impor PDF dengan DPI lebih rendah.',
    )
}

export function createPdfImageCollection(): PdfImageCollection {
  return { pages: [], selected: null, past: [], future: [] }
}

function selectedKey(
  pages: PdfImageAsset[],
  preferred: string | null,
  fallbackIndex = 0,
): string | null {
  if (preferred && pages.some((page) => pdfImageKey(page) === preferred)) return preferred
  return pages.length
    ? pdfImageKey(pages[Math.min(Math.max(0, fallbackIndex), pages.length - 1)])
    : null
}

export function changePdfImagePages(
  collection: PdfImageCollection,
  pages: PdfImageAsset[],
  preferred: string | null = collection.selected,
): PdfImageCollection {
  validatePdfImagePages(pages)
  const index = collection.pages.findIndex((page) => pdfImageKey(page) === collection.selected)
  return {
    pages: [...pages],
    selected: selectedKey(pages, preferred, index),
    past: [...collection.past.slice(-(PDF_IMAGE_HISTORY_LIMIT - 1)), collection.pages],
    future: [],
  }
}

export function undoPdfImagePages(collection: PdfImageCollection): PdfImageCollection {
  if (!collection.past.length) return collection
  const pages = collection.past[collection.past.length - 1]
  const index = collection.pages.findIndex((page) => pdfImageKey(page) === collection.selected)
  return {
    pages,
    selected: selectedKey(pages, collection.selected, index),
    past: collection.past.slice(0, -1),
    future: [collection.pages, ...collection.future],
  }
}

export function redoPdfImagePages(collection: PdfImageCollection): PdfImageCollection {
  if (!collection.future.length) return collection
  const pages = collection.future[0]
  const index = collection.pages.findIndex((page) => pdfImageKey(page) === collection.selected)
  return {
    pages,
    selected: selectedKey(pages, collection.selected, index),
    past: [...collection.past, collection.pages],
    future: collection.future.slice(1),
  }
}

export function removePdfImagePage(
  collection: PdfImageCollection,
  key: string,
): PdfImageCollection {
  if (!collection.pages.some((page) => pdfImageKey(page) === key)) return collection
  return changePdfImagePages(
    collection,
    collection.pages.filter((page) => pdfImageKey(page) !== key),
  )
}

export function movePdfImagePage(
  collection: PdfImageCollection,
  key: string,
  direction: -1 | 1,
): PdfImageCollection {
  const from = collection.pages.findIndex((page) => pdfImageKey(page) === key)
  const to = from + direction
  if (from < 0 || to < 0 || to >= collection.pages.length) return collection
  const pages = [...collection.pages]
  ;[pages[from], pages[to]] = [pages[to], pages[from]]
  return changePdfImagePages(collection, pages)
}

export function replacePdfImagePage(
  collection: PdfImageCollection,
  key: string,
  asset: PdfImageAsset,
): PdfImageCollection {
  const index = collection.pages.findIndex((page) => pdfImageKey(page) === key)
  if (index < 0) throw new Error('Halaman yang diedit sudah tidak ada dalam susunan.')
  const pages = [...collection.pages]
  pages[index] = asset
  return changePdfImagePages(collection, pages, pdfImageKey(asset))
}

export function pdfImageExportOptions(
  collection: PdfImageCollection,
  format: PdfImageFormat,
  quality: number,
  webpLossless: boolean,
  bundle: boolean,
): PdfImageExportOptions {
  const pages = bundle
    ? collection.pages
    : collection.pages.filter((page) => pdfImageKey(page) === collection.selected)
  if (!pages.length) throw new Error('Pilih atau tambahkan halaman untuk diekspor.')
  validatePdfImagePages(pages)
  if (!['png', 'jpeg', 'webp', 'tiff'].includes(format))
    throw new Error('Format gambar belum didukung.')
  if (!Number.isInteger(quality) || quality < 1 || quality > 100)
    throw new Error('Kualitas gambar harus 1–100.')
  return {
    pages: pages.map(({ job_id, id }) => ({ job_id, id })),
    format,
    quality,
    webp_lossless: webpLossless,
    bundle,
  }
}

export function validatePdfImport(file: Pick<File, 'name' | 'size'>): string | null {
  if (!file.name.toLowerCase().endsWith('.pdf')) return 'Pilih dokumen PDF.'
  if (!file.size) return 'Berkas PDF kosong.'
  return file.size > 25 * 1024 * 1024 ? 'Ukuran PDF maksimal 25 MB.' : null
}

export function validatePdfImageImport(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) return 'Tambahkan gambar PNG, JPG, atau WebP.'
  if (!file.size) return 'Berkas gambar kosong.'
  return file.size > 128 * 1024 * 1024 ? 'Ukuran gambar maksimal 128 MB.' : null
}

export function blankPdfImageSize(
  dpi: number,
  selected?: PdfImageAsset,
): { width: number; height: number; dpi: number } {
  if (selected) return { width: selected.width, height: selected.height, dpi: selected.dpi }
  if (!Number.isInteger(dpi) || dpi < 75 || dpi > 600) throw new Error('DPI harus 75–600.')
  return { width: Math.round((210 / 25.4) * dpi), height: Math.round((297 / 25.4) * dpi), dpi }
}

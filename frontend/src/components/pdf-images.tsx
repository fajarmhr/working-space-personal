import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUDownLeft,
  ArrowUUpLeft,
  CheckCircle,
  DownloadSimple,
  FileArrowUp,
  FilePdf,
  ImageSquare,
  LockSimple,
  PencilSimple,
  Plus,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { api } from '../lib/api'
import {
  blankPdfImageSize,
  changePdfImagePages,
  createPdfImageCollection,
  movePdfImagePage,
  pdfImageExportOptions,
  pdfImageKey,
  redoPdfImagePages,
  removePdfImagePage,
  replacePdfImagePage,
  undoPdfImagePages,
  validatePdfImageImport,
  validatePdfImport,
  type PdfImageAsset,
  type PdfImageCollection,
  type PdfImageFormat,
  type PdfImageJob,
} from '../lib/pdf-images'
import { renderBlankPage, type PdfPageEditResult } from '../lib/pdf-page-editor'
import { formatBytes } from '../lib/image-tools'
import { cn } from '../lib/utils'
import PdfPageEditor from './pdf-page-editor'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

type Operation = 'import' | 'asset' | 'blank' | 'edit' | 'export'
interface PendingJob {
  value: PdfImageJob
  kind: 'import' | 'export'
  exportDescription?: string
}
interface DownloadResult {
  job: PdfImageJob
  description: string
}

const formatLabels: Record<PdfImageFormat, string> = {
  png: 'PNG',
  jpeg: 'JPG',
  webp: 'WebP',
  tiff: 'TIFF',
}

export default function PdfImages({ onActivity }: { onActivity: (action: string) => void }) {
  const [collection, setCollection] = useState(createPdfImageCollection)
  const collectionRef = useRef(collection)
  const [dpi, setDpi] = useState(300)
  const [format, setFormat] = useState<PdfImageFormat>('png')
  const [quality, setQuality] = useState(95)
  const [webpLossless, setWebpLossless] = useState(true)
  const [operation, setOperation] = useState<Operation | null>(null)
  const operationRef = useRef<Operation | null>(null)
  const [job, setJob] = useState<PdfImageJob | null>(null)
  const pendingJob = useRef<PendingJob | null>(null)
  const statusRequest = useRef<AbortController | null>(null)
  const [download, setDownload] = useState<DownloadResult | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<PdfImageAsset | null>(null)
  const pdfInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const revision = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      revision.current += 1
      statusRequest.current?.abort()
    }
  }, [])

  const selected = collection.pages.find((page) => pdfImageKey(page) === collection.selected)
  const selectedIndex = collection.pages.findIndex(
    (page) => pdfImageKey(page) === collection.selected,
  )
  const waiting = !operation && !!pendingJob.current
  const busy = operation !== null || waiting
  const locked = busy || editing !== null

  function current(ticket: number) {
    return alive.current && revision.current === ticket
  }
  function begin(kind: Operation, resume = false): number | null {
    if (operationRef.current || (!resume && pendingJob.current)) return null
    if (editing && kind !== 'edit') return null
    operationRef.current = kind
    setOperation(kind)
    setError('')
    setDownload(null)
    return ++revision.current
  }
  function finish(ticket: number) {
    if (!current(ticket)) return
    operationRef.current = null
    setOperation(null)
  }
  function applyCollection(next: PdfImageCollection) {
    collectionRef.current = next
    setCollection(next)
    setDownload(null)
    setError('')
  }
  function appendAssets(assets: PdfImageAsset[]) {
    const state = collectionRef.current
    const last = assets[assets.length - 1]
    applyCollection(
      changePdfImagePages(
        state,
        [...state.pages, ...assets],
        last ? pdfImageKey(last) : state.selected,
      ),
    )
  }

  async function finishJob(descriptor: PendingJob, ticket: number) {
    pendingJob.current = descriptor
    let result = descriptor.value
    const deadline = Date.now() + 360_000
    while (true) {
      if (!current(ticket)) return
      descriptor.value = result
      setJob(result)
      if (result.state === 'failed') {
        pendingJob.current = null
        throw new Error(
          result.error ||
            result.message ||
            'Pemrosesan belum berhasil. Coba berkas yang lebih kecil.',
        )
      }
      if (result.state === 'completed') {
        pendingJob.current = null
        if (descriptor.kind === 'import') {
          if (!result.pages.length) throw new Error('PDF tidak menghasilkan halaman gambar.')
          appendAssets(result.pages)
          onActivity('Mengonversi PDF menjadi halaman gambar')
        } else {
          if (!result.download_url)
            throw new Error('Berkas hasil belum tersedia. Coba ekspor ulang.')
          setDownload({
            job: result,
            description: descriptor.exportDescription || 'Gambar siap diunduh',
          })
          onActivity('Mengekspor halaman PDF menjadi gambar')
        }
        return
      }
      if (Date.now() >= deadline)
        throw new Error(
          'Pemeriksaan status melewati batas waktu. Periksa status lagi untuk melanjutkan pekerjaan yang sama.',
        )
      await new Promise((resolve) => setTimeout(resolve, 850))
      if (!current(ticket)) return
      const controller = new AbortController()
      statusRequest.current = controller
      const timeout = window.setTimeout(() => controller.abort(), 15_000)
      try {
        result = await api.pdfImagesJob(result.id, controller.signal)
      } catch (caught) {
        throw new Error(
          (caught instanceof Error ? caught.message : 'Status pekerjaan belum dapat dibaca.') +
            ' Gunakan Periksa status lagi; tidak perlu mengunggah ulang.',
        )
      } finally {
        window.clearTimeout(timeout)
        if (statusRequest.current === controller) statusRequest.current = null
      }
    }
  }

  async function importPdf(file?: File) {
    if (!file || locked) return
    const problem = validatePdfImport(file)
    if (problem) {
      setError(problem)
      return
    }
    if (collectionRef.current.pages.length >= 100) {
      setError('Susunan sudah berisi 100 halaman. Hapus sebagian halaman terlebih dahulu.')
      return
    }
    const ticket = begin('import')
    if (ticket === null) return
    try {
      const result = await api.pdfImagesImport(file, dpi)
      if (!current(ticket)) return
      await finishJob({ value: result, kind: 'import' }, ticket)
    } catch (caught) {
      if (current(ticket))
        setError(caught instanceof Error ? caught.message : 'PDF belum berhasil dibaca.')
    } finally {
      finish(ticket)
    }
  }

  async function addImages(files: File[]) {
    if (!files.length || locked) return
    if (collectionRef.current.pages.length + files.length > 100) {
      setError('Jumlah gabungan maksimal 100 halaman.')
      return
    }
    const problem = files.map(validatePdfImageImport).find(Boolean)
    if (problem) {
      setError(problem)
      return
    }
    const ticket = begin('asset')
    if (ticket === null) return
    let added = 0
    try {
      for (const file of files) {
        const asset = await api.pdfImagesAsset(file, dpi)
        if (!current(ticket)) return
        appendAssets([asset])
        added += 1
      }
      if (current(ticket)) onActivity('Menambahkan gambar ke susunan halaman PDF')
    } catch (caught) {
      if (current(ticket))
        setError(
          `${caught instanceof Error ? caught.message : 'Gambar belum dapat ditambahkan.'}${added ? ` ${added} gambar sebelumnya sudah ditambahkan.` : ''}`,
        )
    } finally {
      finish(ticket)
    }
  }

  async function addBlank() {
    if (locked) return
    if (collectionRef.current.pages.length >= 100) {
      setError('Susunan maksimal 100 halaman.')
      return
    }
    const ticket = begin('blank')
    if (ticket === null) return
    try {
      const size = blankPdfImageSize(dpi, selected)
      const blob = await renderBlankPage(size.width, size.height)
      if (!current(ticket)) return
      const asset = await api.pdfImagesAsset(
        new File([blob], 'halaman-kosong.png', { type: 'image/png' }),
        size.dpi,
      )
      if (!current(ticket)) return
      appendAssets([asset])
      onActivity('Menambahkan halaman kosong')
    } catch (caught) {
      if (current(ticket))
        setError(caught instanceof Error ? caught.message : 'Halaman kosong belum dapat dibuat.')
    } finally {
      finish(ticket)
    }
  }

  async function applyEdit(blob: Blob, result: PdfPageEditResult) {
    const source = editing
    if (!source) throw new Error('Pilih kembali halaman yang akan diedit.')
    const ticket = begin('edit')
    if (ticket === null) throw new Error('Tunggu proses halaman yang sedang berjalan.')
    try {
      const name = result.name.replace(/\.[^.]+$/, '') + '.png'
      const asset = await api.pdfImagesAsset(
        new File([blob], name, { type: 'image/png' }),
        result.dpi,
      )
      if (!current(ticket)) return
      applyCollection(replacePdfImagePage(collectionRef.current, pdfImageKey(source), asset))
      setEditing(null)
      onActivity('Menyimpan edit halaman PDF sebagai gambar')
    } finally {
      finish(ticket)
    }
  }

  async function exportPages(bundle: boolean) {
    if (locked) return
    const ticket = begin('export')
    if (ticket === null) return
    try {
      const options = pdfImageExportOptions(
        collectionRef.current,
        format,
        quality,
        webpLossless,
        bundle,
      )
      const description = `${options.pages.length} halaman · ${formatLabels[format]}${bundle ? ' dalam ZIP' : ''}`
      const result = await api.pdfImagesExport(options)
      if (!current(ticket)) return
      await finishJob({ value: result, kind: 'export', exportDescription: description }, ticket)
    } catch (caught) {
      if (current(ticket))
        setError(caught instanceof Error ? caught.message : 'Gambar belum dapat diekspor.')
    } finally {
      finish(ticket)
    }
  }

  async function retryJob() {
    const descriptor = pendingJob.current
    if (!descriptor || operationRef.current) return
    const ticket = begin(descriptor.kind, true)
    if (ticket === null) return
    try {
      await finishJob(descriptor, ticket)
    } catch (caught) {
      if (current(ticket))
        setError(caught instanceof Error ? caught.message : 'Status belum dapat diperiksa.')
    } finally {
      finish(ticket)
    }
  }

  function mutate(next: (state: PdfImageCollection) => PdfImageCollection) {
    if (locked) return
    applyCollection(next(collectionRef.current))
  }

  return (
    <div className="space-y-7">
      <input
        ref={pdfInput}
        type="file"
        accept=".pdf,application/pdf"
        className="sr-only"
        aria-label="Tambah PDF ke gambar"
        disabled={locked}
        onChange={(event) => {
          void importPdf(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <input
        ref={imageInput}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Tambah gambar ke halaman PDF"
        disabled={locked}
        onChange={(event) => {
          void addImages(Array.from(event.target.files || []))
          event.target.value = ''
        }}
      />

      <div className="grid min-w-0 items-start gap-7 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[28px] border border-dashed border-border bg-background p-6 sm:p-7">
          <FilePdf size={30} className="mb-5 text-primary" />
          <p className="eyebrow mb-3">PDF menjadi gambar</p>
          <h2 className="text-lg font-medium tracking-tight">Detail halaman, tetap tajam.</h2>
          <p className="mt-3 max-w-xl text-xs leading-7 text-muted-foreground">
            Ubah PDF ke gambar beresolusi tinggi. Susun halaman, tambahkan gambar, dan edit dengan
            anotasi sebelum mengunduh hasil.
          </p>
          <div className="mt-6 grid gap-2 sm:max-w-xs">
            <label htmlFor="pdf-image-dpi" className="field-label">
              Resolusi impor PDF
            </label>
            <select
              id="pdf-image-dpi"
              className="field font-mono"
              value={dpi}
              disabled={locked}
              onChange={(event) => setDpi(Number(event.target.value))}
            >
              <option value={150}>150 DPI — ringkas</option>
              <option value={300}>300 DPI — detail tinggi</option>
              <option value={600}>600 DPI — detail maksimum</option>
            </select>
            <p className="text-[11px] leading-6 text-muted-foreground">
              DPI digunakan saat PDF diimpor. Impor ulang untuk mengganti resolusi halaman. Detail
              scan mengikuti kualitas sumber.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => pdfInput.current?.click()} disabled={locked}>
              <FileArrowUp size={17} />
              {collection.pages.length ? 'Tambah PDF' : 'Pilih PDF'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => imageInput.current?.click()}
              disabled={locked}
            >
              <ImageSquare size={17} />
              Tambah gambar
            </Button>
            <Button variant="ghost" onClick={() => void addBlank()} disabled={locked}>
              <Plus size={17} />
              Halaman kosong
            </Button>
          </div>
          <p className="mt-4 text-[11px] leading-6 text-muted-foreground">
            PDF maksimal 25 MB dan 100 halaman. Per halaman maksimal 40 MP dan sisi 8.192 px.
            Halaman kosong mengikuti ukuran halaman aktif, atau A4 jika susunan masih kosong.
          </p>
        </section>

        <fieldset
          disabled={locked || !collection.pages.length}
          className="min-w-0 space-y-5 py-2 disabled:opacity-55"
        >
          <legend className="field-label mb-5">Format ekspor</legend>
          <div className="grid gap-2">
            <label htmlFor="pdf-image-format" className="field-label">
              Format gambar
            </label>
            <select
              id="pdf-image-format"
              className="field"
              value={format}
              onChange={(event) => {
                setFormat(event.target.value as PdfImageFormat)
                setDownload(null)
              }}
            >
              <option value="png">PNG — lossless, detail dokumen</option>
              <option value="jpeg">JPG — ukuran lebih ringkas</option>
              <option value="webp">WebP — ringkas atau lossless</option>
              <option value="tiff">TIFF — arsip gambar lossless</option>
            </select>
          </div>
          {format === 'webp' && (
            <label className="flex items-start gap-3 text-xs leading-6 text-muted-foreground">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-primary"
                checked={webpLossless}
                onChange={(event) => {
                  setWebpLossless(event.target.checked)
                  setDownload(null)
                }}
              />
              <span>WebP lossless — pertahankan piksel tanpa kompresi lossy.</span>
            </label>
          )}
          {(format === 'jpeg' || (format === 'webp' && !webpLossless)) && (
            <div className="grid gap-3">
              <div className="flex justify-between gap-4">
                <label htmlFor="pdf-image-quality" className="field-label">
                  Kualitas
                </label>
                <output className="font-mono text-xs text-primary">{quality}%</output>
              </div>
              <input
                id="pdf-image-quality"
                type="range"
                min={1}
                max={100}
                value={quality}
                onChange={(event) => {
                  setQuality(Number(event.target.value))
                  setDownload(null)
                }}
                className="w-full accent-primary"
              />
            </div>
          )}
          <p className="text-[11px] leading-6 text-muted-foreground">
            PNG dan TIFF mempertahankan detail piksel. JPG memakai latar putih. Ekspor mengikuti
            ukuran piksel setiap halaman; metadata DPI tersedia pada PNG/JPG/TIFF.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
            <Button
              onClick={() => void exportPages(true)}
              disabled={locked || !collection.pages.length}
            >
              <DownloadSimple size={17} />
              Ekspor semua ke ZIP
            </Button>
            <Button
              variant="secondary"
              onClick={() => void exportPages(false)}
              disabled={locked || !selected}
            >
              Ekspor halaman aktif
              <ArrowRight size={16} />
            </Button>
          </div>
        </fieldset>
      </div>

      {(operation || waiting || (job && job.state === 'failed')) && (
        <section
          role="status"
          aria-label="Status PDF ke gambar"
          className="rounded-2xl border border-border bg-muted/35 p-5"
        >
          <p className="text-xs font-medium">
            {operation === 'asset'
              ? 'Menambahkan gambar…'
              : operation === 'blank'
                ? 'Membuat halaman kosong…'
                : operation === 'edit'
                  ? 'Menyimpan gambar hasil edit…'
                  : waiting
                    ? 'Pemeriksaan status perlu dilanjutkan.'
                    : job?.message ||
                      (operation === 'import'
                        ? 'Menyiapkan impor PDF…'
                        : 'Menyiapkan ekspor gambar…')}
          </p>
          {job && (operation === 'import' || operation === 'export' || waiting) && (
            <p className="mt-2 break-all font-mono text-[10px] leading-6 text-muted-foreground">
              {job.filename}
            </p>
          )}
          {operation && (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={
                  typeof job?.progress === 'number'
                    ? 'h-full rounded-full bg-primary transition-[transform] duration-300'
                    : 'skeleton h-full w-full'
                }
                style={
                  typeof job?.progress === 'number'
                    ? {
                        transform: `scaleX(${Math.max(0, Math.min(100, job.progress)) / 100})`,
                        transformOrigin: 'left',
                      }
                    : undefined
                }
              />
            </div>
          )}
          {waiting && (
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => void retryJob()}>
              Periksa status lagi
            </Button>
          )}
        </section>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-danger/5 p-4 text-xs leading-6 text-danger"
        >
          <WarningCircle size={17} className="mt-1 shrink-0" />
          {error}
        </p>
      )}
      {download?.job.download_url && (
        <section className="flex flex-col items-start gap-4 rounded-2xl border border-primary/15 bg-accent-soft p-5 sm:flex-row sm:items-center">
          <CheckCircle size={27} className="shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium">Hasil siap diunduh.</h2>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">{download.description}</p>
          </div>
          <Button asChild>
            <a href={download.job.download_url} download>
              <DownloadSimple size={17} />
              Unduh hasil
            </a>
          </Button>
        </section>
      )}

      <section aria-label="Susunan halaman gambar" className="min-w-0 border-t border-border pt-7">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-3">Susunan halaman</p>
            <h2 className="text-base font-medium tracking-tight">
              {collection.pages.length
                ? `${collection.pages.length} halaman dalam urutan ekspor.`
                : 'Tambahkan halaman pertama.'}
            </h2>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={locked || !collection.past.length}
              onClick={() => mutate(undoPdfImagePages)}
              aria-label="Urungkan perubahan halaman"
            >
              <ArrowUUpLeft size={16} />
              Undo
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={locked || !collection.future.length}
              onClick={() => mutate(redoPdfImagePages)}
              aria-label="Ulangi perubahan halaman"
            >
              <ArrowUDownLeft size={16} />
              Redo
            </Button>
          </div>
        </div>
        {!collection.pages.length ? (
          <div className="rounded-[28px] border border-dashed border-border px-6 py-10">
            <ImageSquare size={34} className="mb-5 text-primary/60" />
            <p className="text-sm font-medium">Satu halaman menjadi satu gambar.</p>
            <p className="mt-3 max-w-lg text-xs leading-7 text-muted-foreground">
              Mulai dari PDF, gambar, atau halaman kosong. Hapus dan pindahkan halaman sebelum
              ekspor; Undo dapat mengembalikan perubahan.
            </p>
          </div>
        ) : (
          <div className="grid min-w-0 items-start gap-7 xl:grid-cols-[minmax(250px,0.65fr)_minmax(0,1.35fr)]">
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:max-h-[820px] xl:grid-cols-2 xl:overflow-y-auto xl:pr-2">
              {collection.pages.map((page, index) => {
                const key = pdfImageKey(page)
                const active = key === collection.selected
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={locked}
                    aria-label={`Pilih halaman ${index + 1}: ${page.name}`}
                    aria-pressed={active}
                    onClick={() => {
                      applyCollection({ ...collectionRef.current, selected: key })
                    }}
                    className={cn(
                      'min-w-0 rounded-2xl border p-3 text-left transition-colors',
                      active
                        ? 'border-primary/40 bg-accent-soft'
                        : 'border-border bg-surface hover:bg-muted/40',
                    )}
                  >
                    <div className="mb-3 grid aspect-[4/5] place-items-center overflow-hidden rounded-lg border border-border/70 bg-white">
                      <img
                        src={page.thumbnail_url}
                        alt={`Thumbnail halaman ${index + 1}`}
                        loading="lazy"
                        className="max-h-full w-full object-contain"
                      />
                    </div>
                    <p className="font-mono text-[10px] text-primary">
                      {String(index + 1).padStart(2, '0')}
                    </p>
                    <p className="mt-1 truncate text-[11px] font-medium" title={page.name}>
                      {page.name}
                    </p>
                    <p className="mt-1 font-mono text-[9px] leading-5 text-muted-foreground">
                      {page.width} × {page.height} · {page.dpi} DPI
                    </p>
                  </button>
                )
              })}
            </div>
            {selected && (
              <section
                aria-label="Halaman aktif"
                className="min-w-0 rounded-[24px] border border-border bg-surface p-4 sm:p-5"
              >
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow mb-2">Halaman {selectedIndex + 1}</p>
                    <p className="break-all text-xs font-medium">{selected.name}</p>
                    <p className="mt-2 font-mono text-[10px] leading-6 text-muted-foreground">
                      {selected.width} × {selected.height} px · {selected.dpi} DPI ·{' '}
                      {formatBytes(selected.size)}
                      {selected.source_page ? ` · sumber PDF ${selected.source_page}` : ''}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setEditing(selected)} disabled={locked}>
                    <PencilSimple size={15} />
                    Edit halaman
                  </Button>
                </div>
                <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-xl border border-border bg-white">
                  <img
                    key={pdfImageKey(selected)}
                    src={selected.image_url}
                    alt={`Preview halaman ${selectedIndex + 1}`}
                    className="max-h-[620px] max-w-full object-contain"
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={locked || selectedIndex < 1}
                    onClick={() =>
                      mutate((state) => movePdfImagePage(state, pdfImageKey(selected), -1))
                    }
                  >
                    <ArrowUp size={15} />
                    Pindah ke atas
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={locked || selectedIndex === collection.pages.length - 1}
                    onClick={() =>
                      mutate((state) => movePdfImagePage(state, pdfImageKey(selected), 1))
                    }
                  >
                    <ArrowDown size={15} />
                    Pindah ke bawah
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={locked}
                    onClick={() => {
                      mutate((state) => removePdfImagePage(state, pdfImageKey(selected)))
                      onActivity('Menghapus halaman dari susunan ekspor')
                    }}
                  >
                    <Trash size={15} />
                    Hapus halaman
                  </Button>
                </div>
              </section>
            )}
          </div>
        )}
      </section>

      <p className="flex items-start gap-2 border-t border-border pt-5 text-[11px] leading-6 text-muted-foreground">
        <LockSimple size={16} className="mt-1 shrink-0 text-primary" />
        PDF dan gambar diproses di komputer ini. Susunan serta riwayat edit tersedia selama panel
        dibuka; unduh hasil sebelum berpindah alat. PDF sumber tetap tersimpan sebagai sumber
        konversi lokal.
      </p>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && operationRef.current !== 'edit') setEditing(null)
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto p-5 sm:max-w-[min(1280px,calc(100vw-2rem))] sm:p-7">
          <DialogTitle className="pr-8 text-base font-medium">Edit gambar halaman</DialogTitle>
          <DialogDescription className="mt-2 pr-7 text-xs leading-6 text-muted-foreground">
            Anotasi, blur, dan ukuran digabung ke piksel saat diterapkan. Undo pada susunan halaman
            dapat mengembalikan versi sebelumnya.
          </DialogDescription>
          {editing && (
            <div className="mt-6">
              <PdfPageEditor
                key={pdfImageKey(editing)}
                source={{
                  url: editing.image_url,
                  name: editing.name,
                  width: editing.width,
                  height: editing.height,
                  dpi: editing.dpi,
                }}
                onApply={applyEdit}
                onCancel={() => {
                  if (operationRef.current !== 'edit') setEditing(null)
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

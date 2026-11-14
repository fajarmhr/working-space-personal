import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUpRight,
  DownloadSimple,
  ImageSquare,
  LockSimple,
  WarningCircle,
} from '@phosphor-icons/react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import ImageAnnotations from './image-annotations'
import { drawImageAnnotations, type ImageAnnotation } from '../lib/image-annotations'
import {
  fitImage,
  formatBytes,
  MAX_IMAGE_BYTES,
  readRasterInfo,
  validateImageOutput,
  type RasterMime,
} from '../lib/image-tools'

interface SourceImage {
  name: string
  size: number
  width: number
  height: number
  url: string
}
interface ImageResult {
  url: string
  size: number
  width: number
  height: number
  name: string
  mime: RasterMime
}

export default function ImageTools({ onActivity }: { onActivity: (action: string) => void }) {
  const [source, setSource] = useState<SourceImage | null>(null)
  const [result, setResult] = useState<ImageResult | null>(null)
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [keepRatio, setKeepRatio] = useState(true)
  const [mime, setMime] = useState<RasterMime>('image/webp')
  const [quality, setQuality] = useState(85)
  const [busy, setBusy] = useState<'loading' | 'exporting' | null>(null)
  const [error, setError] = useState('')
  const [annotations, setAnnotations] = useState<ImageAnnotation[]>([])
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const bitmap = useRef<ImageBitmap | null>(null)
  const generation = useRef(0)
  const picker = useRef<HTMLInputElement>(null)
  const updateAnnotations = useCallback((values: ImageAnnotation[]) => {
    setAnnotations(values)
    setResult(null)
  }, [])

  useEffect(
    () => () => {
      generation.current += 1
      bitmap.current?.close()
    },
    [],
  )
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.url)
    },
    [source],
  )
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url)
    },
    [result],
  )

  async function load(file: File | undefined) {
    if (!file) return
    const ticket = ++generation.current
    setBusy('loading')
    setError('')
    setResult(null)
    try {
      if (file.size > MAX_IMAGE_BYTES) throw new Error('Ukuran berkas maksimal 20 MB.')
      readRasterInfo(new Uint8Array(await file.arrayBuffer()))
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
      if (ticket !== generation.current) {
        image.close()
        return
      }
      // A rotated JPEG may swap dimensions. Apply the source bound to decoded dimensions too.
      if (image.width * image.height > 40_000_000 || image.width > 32768 || image.height > 32768) {
        image.close()
        throw new Error('Gambar terlalu besar. Batas sumber 40 megapiksel.')
      }
      bitmap.current?.close()
      bitmap.current = image
      const initial = fitImage(image.width, image.height)
      setWidth(String(initial.width))
      setHeight(String(initial.height))
      setKeepRatio(true)
      setAnnotations([])
      setSource({
        name: file.name,
        size: file.size,
        width: image.width,
        height: image.height,
        url: URL.createObjectURL(file),
      })
    } catch (caught) {
      if (ticket === generation.current)
        setError(
          caught instanceof Error ? caught.message : 'Gambar belum bisa dibuka. Coba berkas lain.',
        )
    } finally {
      if (ticket === generation.current) setBusy(null)
    }
  }

  function changeDimension(value: string, axis: 'width' | 'height') {
    setResult(null)
    if (axis === 'width') setWidth(value)
    else setHeight(value)
    const numeric = Number(value)
    if (keepRatio && source && Number.isFinite(numeric) && numeric > 0) {
      if (axis === 'width')
        setHeight(String(Math.max(1, Math.round((numeric * source.height) / source.width))))
      else setWidth(String(Math.max(1, Math.round((numeric * source.width) / source.height))))
    }
  }

  async function process() {
    const image = bitmap.current
    if (!image || !source) return
    const ticket = ++generation.current
    setError('')
    setBusy('exporting')
    try {
      if (annotations.some((value) => value.kind === 'text' || value.kind === 'number'))
        await document.fonts.ready
      if (ticket !== generation.current) return
      const size = validateImageOutput(Number(width), Number(height))
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Browser belum mendukung pemrosesan gambar ini.')
      if (mime === 'image/jpeg') {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, size.width, size.height)
      }
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, size.width, size.height)
      drawImageAnnotations(
        context,
        image,
        annotations,
        source.width,
        source.height,
        size.width,
        size.height,
      )
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error('Gambar gagal diekspor. Kurangi ukurannya.')),
          mime,
          quality / 100,
        ),
      )
      // Release the canvas backing buffer after encoding.
      canvas.width = 1
      canvas.height = 1
      if (ticket !== generation.current) return
      if (blob.type !== mime)
        throw new Error('Format hasil belum didukung browser ini. Pilih PNG atau JPEG.')
      const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp'
      const name =
        (source.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-') || 'gambar') +
        `-${size.width}x${size.height}.${extension}`
      setResult({
        url: URL.createObjectURL(blob),
        size: blob.size,
        width: size.width,
        height: size.height,
        name,
        mime,
      })
      onActivity(
        annotations.length
          ? 'Mengekspor gambar dengan anotasi'
          : 'Mengubah ukuran atau format gambar',
      )
    } catch (caught) {
      if (ticket === generation.current)
        setError(caught instanceof Error ? caught.message : 'Gambar belum bisa diproses.')
    } finally {
      if (ticket === generation.current) setBusy(null)
    }
  }

  return (
    <div className="space-y-7">
      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Pilih gambar JPG PNG atau WebP"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file && annotations.length) setPendingFile(file)
          else void load(file)
          event.target.value = ''
        }}
      />
      <div className="grid grid-cols-1 gap-7 xl:grid-cols-[1.2fr_1fr]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="field-label">Gambar sumber</p>
            <Button size="sm" variant="secondary" onClick={() => picker.current?.click()}>
              <ImageSquare size={16} />
              {source ? 'Ganti gambar' : 'Pilih gambar'}
            </Button>
          </div>
          <div
            className={
              source
                ? 'min-w-0'
                : 'flex min-h-72 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-muted/40 p-5'
            }
          >
            {busy === 'loading' && !source ? (
              <div role="status" aria-label="Membuka gambar" className="skeleton h-60 w-full" />
            ) : source && bitmap.current ? (
              <ImageAnnotations
                key={source.url}
                image={bitmap.current}
                onChange={updateAnnotations}
                disabled={busy !== null}
              />
            ) : (
              <div className="max-w-64 py-6 text-center">
                <ImageSquare size={36} className="mx-auto mb-5 text-primary/60" />
                <p className="text-sm font-medium">Ukuran yang pas untuk pekerjaanmu.</p>
                <p className="mt-3 text-xs leading-6 text-muted-foreground">
                  Pilih JPG, PNG, atau WebP. Maksimal 20 MB dan 40 megapiksel.
                </p>
                <Button className="mt-6" onClick={() => picker.current?.click()}>
                  Buka gambar
                  <ArrowUpRight size={15} />
                </Button>
              </div>
            )}
          </div>
          {source && (
            <p className="mt-3 break-all font-mono text-[10px] leading-6 text-muted-foreground">
              {source.name} · {source.width.toLocaleString('id-ID')} ×{' '}
              {source.height.toLocaleString('id-ID')} px · {formatBytes(source.size)}
            </p>
          )}
          {source && busy === 'loading' && (
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              Membuka gambar baru… Anotasi sebelumnya tetap tersedia jika berkas tidak valid.
            </p>
          )}
        </div>
        <fieldset
          disabled={!source || busy !== null}
          className="min-w-0 space-y-6 disabled:opacity-50"
        >
          <legend className="field-label mb-5">Atur hasilnya</legend>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="image-width" className="field-label">
                Lebar (px)
              </label>
              <input
                id="image-width"
                type="number"
                min="1"
                max="8192"
                value={width}
                onChange={(event) => changeDimension(event.target.value, 'width')}
                className="field min-w-0"
              />
              <span className="text-[10px] text-muted-foreground">Maks. 8.192 px</span>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="image-height" className="field-label">
                Tinggi (px)
              </label>
              <input
                id="image-height"
                type="number"
                min="1"
                max="8192"
                value={height}
                onChange={(event) => changeDimension(event.target.value, 'height')}
                className="field min-w-0"
              />
              <span className="text-[10px] text-muted-foreground">Hasil maks. 20 MP</span>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-3 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={keepRatio}
              onChange={(event) => {
                const checked = event.target.checked
                setKeepRatio(checked)
                setResult(null)
                if (checked && source && Number(width) > 0)
                  setHeight(
                    String(Math.max(1, Math.round((Number(width) * source.height) / source.width))),
                  )
              }}
              className="size-4 accent-primary"
            />
            Pertahankan rasio gambar
          </label>
          <div className="flex flex-col gap-2">
            <label htmlFor="image-format" className="field-label">
              Format hasil
            </label>
            <select
              id="image-format"
              value={mime}
              onChange={(event) => {
                setMime(event.target.value as RasterMime)
                setResult(null)
              }}
              className="field"
            >
              <option value="image/webp">WebP — ukuran ringkas</option>
              <option value="image/jpeg">JPEG — foto & dokumen</option>
              <option value="image/png">PNG — transparansi & detail</option>
            </select>
            <p className="text-[11px] leading-5 text-muted-foreground">
              JPEG mengubah area transparan menjadi putih.
            </p>
          </div>
          {mime !== 'image/png' && (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between gap-4">
                <label htmlFor="image-quality" className="field-label">
                  Kualitas
                </label>
                <output className="font-mono text-xs text-primary">{quality}%</output>
              </div>
              <input
                id="image-quality"
                type="range"
                min="30"
                max="100"
                value={quality}
                onChange={(event) => {
                  setQuality(Number(event.target.value))
                  setResult(null)
                }}
                className="w-full accent-primary"
              />
              <p className="text-[11px] leading-5 text-muted-foreground">
                Ukuran akhir bergantung pada gambar dan format yang dipilih.
              </p>
            </div>
          )}
          <Button
            disabled={!source || busy !== null}
            onClick={() => void process()}
            className="w-full"
          >
            <ArrowDown size={16} />
            {busy === 'exporting' ? 'Memproses gambar…' : 'Proses gambar'}
          </Button>
        </fieldset>
      </div>
      {error && (
        <p
          role="alert"
          className="flex gap-2 rounded-xl bg-danger/5 px-4 py-3 text-xs leading-6 text-danger"
        >
          <WarningCircle size={17} className="mt-1 shrink-0" />
          {error}
        </p>
      )}
      {busy === 'exporting' && (
        <div
          role="status"
          aria-label="Mengekspor gambar"
          className="skeleton h-24 w-full rounded-2xl"
        />
      )}
      {result && (
        <section className="flex flex-col gap-5 rounded-2xl border border-primary/15 bg-accent-soft p-5 sm:flex-row sm:items-center">
          <img
            src={result.url}
            alt="Hasil pengolahan gambar"
            className="h-20 w-24 shrink-0 rounded-xl bg-surface object-contain"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium">Gambar siap dipakai.</h2>
            <p className="mt-2 break-all font-mono text-[11px] leading-6 text-muted-foreground">
              {result.width} × {result.height} px ·{' '}
              {result.mime.replace('image/', '').toUpperCase()} · {formatBytes(result.size)}
            </p>
          </div>
          <Button asChild className="self-start sm:self-auto">
            <a href={result.url} download={result.name}>
              <DownloadSimple size={17} />
              Unduh gambar
            </a>
          </Button>
        </section>
      )}
      <p className="flex items-start gap-2 border-t border-border pt-5 text-[11px] leading-6 text-muted-foreground">
        <LockSimple size={15} className="mt-1 shrink-0 text-primary" />
        Berkas tetap di browser. Anotasi dan blur digabung ke piksel saat ekspor. Metadata sumber
        dihapus; animasi menjadi gambar diam.
      </p>
      <Dialog
        open={pendingFile !== null}
        onOpenChange={(open) => {
          if (!open) setPendingFile(null)
        }}
      >
        <DialogContent>
          <DialogTitle className="pr-10 text-lg font-medium">
            Ganti gambar yang sedang diedit?
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-7 text-muted-foreground">
            Anotasi akan direset ketika gambar baru berhasil dibuka. Unduh hasilnya terlebih dahulu
            bila masih diperlukan.
          </DialogDescription>
          <p className="mt-3 break-all text-xs text-muted-foreground">{pendingFile?.name}</p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setPendingFile(null)}>
              Batal
            </Button>
            <Button
              onClick={() => {
                const file = pendingFile
                setPendingFile(null)
                if (file) void load(file)
              }}
            >
              Buka gambar baru
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

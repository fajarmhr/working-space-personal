'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowClockwise, Check, FloppyDisk, WarningCircle, X } from '@phosphor-icons/react'
import ImageAnnotations from './image-annotations'
import { Button } from './ui/button'
import type { ImageAnnotation } from '../lib/image-annotations'
import {
  drawEditedPage,
  loadPdfPage,
  renderEditedPage,
  rotatedPageSize,
  type PageRotation,
  type PdfPageEditResult,
  type PdfPageSource,
} from '../lib/pdf-page-editor'

export interface PdfPageEditorProps {
  source: PdfPageSource
  onApply: (blob: Blob, metadata: PdfPageEditResult) => Promise<void>
  onCancel: () => void
}

export default function PdfPageEditor({ source, onApply, onCancel }: PdfPageEditorProps) {
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [annotations, setAnnotations] = useState<ImageAnnotation[]>([])
  const [width, setWidth] = useState(String(source.width))
  const [height, setHeight] = useState(String(source.height))
  const [keepRatio, setKeepRatio] = useState(true)
  const [rotation, setRotation] = useState<PageRotation>(0)
  const [busy, setBusy] = useState<'loading' | 'saving' | null>('loading')
  const [error, setError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const preview = useRef<HTMLCanvasElement>(null)
  const generation = useRef(0)
  const bitmap = useRef<ImageBitmap | null>(null)

  useEffect(() => {
    const ticket = ++generation.current
    const controller = new AbortController()
    setImage(null)
    setBusy('loading')
    setError('')
    setAnnotations([])
    setWidth(String(source.width))
    setHeight(String(source.height))
    setKeepRatio(true)
    setRotation(0)
    void loadPdfPage(source, controller.signal)
      .then((opened) => {
        if (controller.signal.aborted || ticket !== generation.current) {
          opened.close()
          return
        }
        bitmap.current = opened
        setImage(opened)
        setBusy(null)
      })
      .catch((caught) => {
        if (controller.signal.aborted || ticket !== generation.current) return
        setBusy(null)
        setError(caught instanceof Error ? caught.message : 'Halaman belum dapat dibuka.')
      })
    return () => {
      controller.abort()
      generation.current += 1
      bitmap.current?.close()
      bitmap.current = null
    }
  }, [source.url, source.width, source.height, attempt])

  const updateAnnotations = useCallback((values: ImageAnnotation[]) => {
    setAnnotations(values)
    setError('')
  }, [])

  useEffect(() => {
    const canvas = preview.current
    if (!canvas || !image) return
    try {
      const out = rotatedPageSize(Number(width), Number(height), rotation)
      const scale = Math.min(1, 800 / Math.max(out.width, out.height))
      drawEditedPage(
        canvas,
        image,
        annotations,
        Math.max(1, Math.round(Number(width) * scale)),
        Math.max(1, Math.round(Number(height) * scale)),
        rotation,
      )
      setPreviewError('')
    } catch (caught) {
      canvas.width = 1
      canvas.height = 1
      setPreviewError(caught instanceof Error ? caught.message : 'Pratinjau hasil belum tersedia.')
    }
    return () => {
      canvas.width = 1
      canvas.height = 1
    }
  }, [image, annotations, width, height, rotation])

  function dimension(value: string, axis: 'width' | 'height') {
    setError('')
    const numeric = Number(value)
    if (axis === 'width') setWidth(value)
    else setHeight(value)
    if (keepRatio && numeric > 0 && Number.isFinite(numeric)) {
      if (axis === 'width')
        setHeight(String(Math.max(1, Math.round((numeric * source.height) / source.width))))
      else setWidth(String(Math.max(1, Math.round((numeric * source.width) / source.height))))
    }
  }

  async function apply() {
    if (!image || busy) return
    const ticket = generation.current
    setBusy('saving')
    setError('')
    try {
      const output = rotatedPageSize(Number(width), Number(height), rotation)
      if (annotations.some((value) => value.kind === 'text' || value.kind === 'number'))
        await document.fonts.ready
      if (ticket !== generation.current) return
      const blob = await renderEditedPage(
        image,
        annotations,
        Number(width),
        Number(height),
        rotation,
      )
      if (ticket !== generation.current) return
      const stem =
        source.name
          .replace(/\.[^.]+$/, '')
          .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
          .slice(0, 150) || 'halaman'
      await onApply(blob, { ...output, dpi: source.dpi, name: `${stem}-edited.png` })
    } catch (caught) {
      if (ticket === generation.current)
        setError(
          caught instanceof Error ? caught.message : 'Perubahan halaman belum dapat disimpan.',
        )
    } finally {
      if (ticket === generation.current) setBusy(null)
    }
  }

  let output: { width: number; height: number } | null = null
  try {
    output = rotatedPageSize(Number(width), Number(height), rotation)
  } catch {
    /* Shown inline by the preview. */
  }

  return (
    <section aria-label="Editor halaman PDF" className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <p className="eyebrow mb-2">Edit halaman</p>
          <h2 className="break-all text-base font-medium tracking-tight">{source.name}</h2>
          <p className="mt-2 font-mono text-[10px] leading-6 text-muted-foreground">
            {source.width.toLocaleString('id-ID')} × {source.height.toLocaleString('id-ID')} px ·{' '}
            {source.dpi} DPI
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={busy === 'saving'} onClick={onCancel}>
          <X size={16} />
          Tutup editor
        </Button>
      </div>
      {busy === 'loading' && (
        <div role="status" aria-label="Memuat halaman resolusi tinggi" className="space-y-4">
          <div className="skeleton h-10 w-3/4" />
          <div className="skeleton min-h-80 w-full" />
        </div>
      )}
      {image && (
        <div className="grid min-w-0 items-start gap-7 xl:grid-cols-[minmax(0,1.55fr)_minmax(240px,0.7fr)]">
          <div className="min-w-0">
            <ImageAnnotations
              key={source.url}
              image={image}
              onChange={updateAnnotations}
              disabled={busy !== null}
            />
          </div>
          <div className="min-w-0 space-y-5">
            <fieldset disabled={busy !== null} className="min-w-0 space-y-4">
              <legend className="mb-4 text-xs font-medium">Dimensi dan orientasi hasil</legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid min-w-0 gap-2">
                  <label htmlFor="pdf-page-width" className="field-label">
                    Lebar (px)
                  </label>
                  <input
                    id="pdf-page-width"
                    type="number"
                    min={1}
                    max={8192}
                    className="field min-w-0 font-mono text-xs"
                    value={width}
                    onChange={(event) => dimension(event.target.value, 'width')}
                  />
                </div>
                <div className="grid min-w-0 gap-2">
                  <label htmlFor="pdf-page-height" className="field-label">
                    Tinggi (px)
                  </label>
                  <input
                    id="pdf-page-height"
                    type="number"
                    min={1}
                    max={8192}
                    className="field min-w-0 font-mono text-xs"
                    value={height}
                    onChange={(event) => dimension(event.target.value, 'height')}
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-start gap-3 text-[11px] leading-6 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={keepRatio}
                  className="mt-1.5 size-4 shrink-0 accent-primary"
                  onChange={(event) => {
                    setKeepRatio(event.target.checked)
                    if (event.target.checked && Number(width) > 0)
                      setHeight(
                        String(
                          Math.max(1, Math.round((Number(width) * source.height) / source.width)),
                        ),
                      )
                  }}
                />
                Pertahankan rasio halaman
              </label>
              <div className="grid gap-2">
                <label htmlFor="pdf-page-rotation" className="field-label">
                  Rotasi hasil
                </label>
                <select
                  id="pdf-page-rotation"
                  className="field font-mono text-xs"
                  value={rotation}
                  onChange={(event) => setRotation(Number(event.target.value) as PageRotation)}
                >
                  <option value={0}>0°</option>
                  <option value={90}>90° searah jarum jam</option>
                  <option value={180}>180°</option>
                  <option value={270}>270° searah jarum jam</option>
                </select>
                <p className="text-[10px] leading-6 text-muted-foreground">
                  Anotasi diedit pada orientasi sumber. Rotasi seluruh halaman terlihat pada
                  pratinjau hasil.
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setWidth(String(source.width))
                  setHeight(String(source.height))
                  setKeepRatio(true)
                  setRotation(0)
                }}
              >
                <ArrowClockwise size={15} />
                Ukuran asli
              </Button>
            </fieldset>
            <div className="rounded-2xl border border-border bg-muted/30 p-4">
              <p className="mb-3 text-[11px] font-medium">Pratinjau hasil</p>
              <canvas
                ref={preview}
                aria-label="Pratinjau hasil halaman"
                className="block h-auto max-h-72 w-full rounded-lg bg-surface object-contain"
              />
              {output && (
                <p className="mt-3 font-mono text-[10px] leading-6 text-muted-foreground">
                  {output.width.toLocaleString('id-ID')} × {output.height.toLocaleString('id-ID')}{' '}
                  px · PNG lossless
                </p>
              )}
              <p className="mt-2 text-[10px] leading-6 text-muted-foreground">
                Pratinjau ringkas. Ukuran ekspor mengikuti nilai piksel di atas, maksimal 40 MP dan
                sisi 8.192 px.
              </p>
            </div>
            {Number(width) > source.width || Number(height) > source.height ? (
              <p className="text-[11px] leading-6 text-muted-foreground">
                Memperbesar piksel tidak menambah detail baru pada hasil render PDF.
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={busy !== null || !output || !!previewError}
              onClick={() => void apply()}
            >
              <FloppyDisk size={16} />
              {busy === 'saving' ? 'Menyimpan halaman…' : 'Terapkan perubahan'}
            </Button>
            <Button
              className="w-full"
              variant="ghost"
              disabled={busy === 'saving'}
              onClick={onCancel}
            >
              Batal
            </Button>
            <p className="flex items-start gap-2 text-[10px] leading-6 text-muted-foreground">
              <Check size={14} className="mt-1 shrink-0 text-primary" />
              Anotasi dan blur digabung ke piksel saat diterapkan. Ukuran asli dipertahankan sampai
              kamu mengubah dimensinya.
            </p>
          </div>
        </div>
      )}
      {(error || previewError) && (
        <div
          role="alert"
          className="space-y-3 rounded-xl bg-danger/5 p-4 text-xs leading-6 text-danger"
        >
          <p className="flex items-start gap-2">
            <WarningCircle size={17} className="mt-1 shrink-0" />
            {error || previewError}
          </p>
          {!image && busy === null && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAttempt((previous) => previous + 1)}
            >
              <ArrowClockwise size={15} />
              Coba muat ulang
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

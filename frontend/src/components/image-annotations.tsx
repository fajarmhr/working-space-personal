'use client'

import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  ArrowUUpLeft,
  ArrowUUpRight,
  ArrowUpRight,
  Circle,
  Cursor,
  DropHalf,
  NumberCircleOne,
  Rectangle,
  TextT,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import { fitImage } from '../lib/image-tools'
import {
  annotationHistory,
  annotationLocalPoint,
  annotationMatrix,
  createAnnotation,
  drawImageAnnotations,
  EMPTY_ANNOTATION_HISTORY,
  MAX_ANNOTATIONS,
  validateAnnotation,
  type AnnotationTool,
  type ImageAnnotation,
  type ImagePoint,
} from '../lib/image-annotations'

const tools = [
  { id: 'select', title: 'Pilih', icon: Cursor },
  { id: 'rectangle', title: 'Kotak', icon: Rectangle },
  { id: 'ellipse', title: 'Bulat', icon: Circle },
  { id: 'arrow', title: 'Panah', icon: ArrowUpRight },
  { id: 'number', title: 'Nomor', icon: NumberCircleOne },
  { id: 'text', title: 'Tulisan', icon: TextT },
  { id: 'blur', title: 'Blur', icon: DropHalf },
] as const

function NumericProperty({
  id,
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  onCommit: (value: number) => void
}) {
  const rounded = Math.round(value * 100) / 100
  const [draft, setDraft] = useState(String(rounded))
  useEffect(() => setDraft(String(rounded)), [rounded])
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="field-label text-xs">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          onCommit(draft.trim() ? Number(draft) : NaN)
          setDraft(String(rounded))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(String(rounded))
            event.stopPropagation()
          }
        }}
        className="field min-w-0 px-3 py-2 text-xs"
      />
    </div>
  )
}

interface DragState {
  mode: 'create' | 'move' | 'resize'
  id: string
  start: ImagePoint
  original: ImageAnnotation
  values: ImageAnnotation[]
}

export default function ImageAnnotations({
  image,
  onChange,
  disabled = false,
}: {
  image: ImageBitmap
  onChange: (annotations: ImageAnnotation[]) => void
  disabled?: boolean
}) {
  const [history, dispatch] = useReducer(annotationHistory, EMPTY_ANNOTATION_HISTORY)
  const [draft, setDraft] = useState<ImageAnnotation[] | null>(null)
  const [tool, setTool] = useState<AnnotationTool>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const overlay = useRef<SVGSVGElement>(null)
  const drag = useRef<DragState | null>(null)
  const draftRef = useRef<ImageAnnotation[] | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const values = draft ?? history.present
  const selected = values.find((value) => value.id === selectedId)
  const preview = fitImage(image.width, image.height, 1600)
  const handleSize = Math.max(image.width, image.height) / 75

  useEffect(() => {
    changeRef.current(history.present)
  }, [history.present])
  useEffect(() => {
    if (selectedId && !history.present.some((value) => value.id === selectedId) && !draft)
      setSelectedId(null)
  }, [history.present, selectedId, draft])
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    element.width = preview.width
    element.height = preview.height
    const context = element.getContext('2d')
    if (!context) {
      setError('Canvas belum tersedia pada browser ini.')
      return
    }
    context.drawImage(image, 0, 0, preview.width, preview.height)
    try {
      drawImageAnnotations(
        context,
        image,
        values,
        image.width,
        image.height,
        preview.width,
        preview.height,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Anotasi belum bisa digambar.')
    }
  }, [image, values, preview.width, preview.height])

  function commit(next: ImageAnnotation[]) {
    try {
      next.forEach(validateAnnotation)
      if (next.length > MAX_ANNOTATIONS) throw new Error('Maksimal 100 anotasi per gambar.')
      dispatch({ type: 'commit', value: next })
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Perubahan belum dapat diterapkan.')
    }
  }
  function point(event: PointerEvent<SVGSVGElement>): ImagePoint {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(
        0,
        Math.min(image.width, ((event.clientX - bounds.left) / bounds.width) * image.width),
      ),
      y: Math.max(
        0,
        Math.min(image.height, ((event.clientY - bounds.top) / bounds.height) * image.height),
      ),
    }
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (disabled || event.button !== 0 || !event.isPrimary) return
    surface.current?.focus({ preventScroll: true })
    const position = point(event)
    const target = event.target as Element
    const id = target.closest('[data-annotation-id]')?.getAttribute('data-annotation-id')
    const found = history.present.find((value) => value.id === id)
    if (tool === 'select') {
      setSelectedId(found?.id ?? null)
      if (!found) return
      drag.current = {
        mode: target.getAttribute('data-handle') === 'resize' ? 'resize' : 'move',
        id: found.id,
        start: position,
        original: found,
        values: history.present,
      }
    } else {
      if (history.present.length >= MAX_ANNOTATIONS) {
        setError('Maksimal 100 anotasi per gambar. Hapus yang tidak diperlukan.')
        return
      }
      if (image.width < 2 || image.height < 2) {
        setError('Gambar minimal 2 × 2 piksel untuk anotasi.')
        return
      }
      const number =
        1 +
        Math.max(
          0,
          ...history.present
            .filter((value) => value.kind === 'number')
            .map((value) => value.number),
        )
      if (number > 999) {
        setError('Nomor anotasi maksimal 999.')
        return
      }
      const value = createAnnotation(tool, position, position, image.width, image.height, number)
      drag.current = {
        mode: 'create',
        id: value.id,
        start: position,
        original: value,
        values: history.present,
      }
      setSelectedId(value.id)
      draftRef.current = [...history.present, value]
      setDraft(draftRef.current)
    }
    setError('')
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current
    if (!current) return
    const position = point(event)
    let updated: ImageAnnotation
    if (current.mode === 'create') {
      updated = createAnnotation(
        current.original.kind,
        current.start,
        position,
        image.width,
        image.height,
        current.original.number,
        current.id,
      )
      draftRef.current = [...current.values, updated]
    } else {
      if (current.mode === 'move')
        updated = {
          ...current.original,
          x: Math.max(0, Math.min(image.width, current.original.x + position.x - current.start.x)),
          y: Math.max(0, Math.min(image.height, current.original.y + position.y - current.start.y)),
        }
      else {
        const local = annotationLocalPoint(current.original, position)
        updated = {
          ...current.original,
          width: Math.max(2, Math.min(32768, Math.abs(local.x) * 2)),
          height: Math.max(2, Math.min(32768, Math.abs(local.y) * 2)),
        }
      }
      draftRef.current = current.values.map((value) => (value.id === current.id ? updated : value))
    }
    setDraft(draftRef.current)
  }
  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return
    if (draftRef.current) commit(draftRef.current)
    const kind = drag.current.original.kind
    drag.current = null
    draftRef.current = null
    setDraft(null)
    if (kind === 'text') setTool('select')
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function cancelDrag() {
    drag.current = null
    draftRef.current = null
    setDraft(null)
  }
  function remove() {
    if (selectedId) commit(history.present.filter((value) => value.id !== selectedId))
  }
  function patch(values: Partial<ImageAnnotation>) {
    if (!selected) return
    commit(
      history.present.map((value) => (value.id === selected.id ? { ...value, ...values } : value)),
    )
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    const target = event.target as HTMLElement
    if (target.closest('input,textarea,select,[contenteditable="true"]')) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      dispatch({ type: 'redo' })
    } else if (event.key === 'Delete' && selected) {
      event.preventDefault()
      remove()
    } else if (event.key === 'Escape') {
      cancelDrag()
      setSelectedId(null)
      setTool('select')
    }
  }

  const numeric = (
    field:
      | 'width'
      | 'height'
      | 'rotation'
      | 'skewX'
      | 'skewY'
      | 'strokeWidth'
      | 'fontSize'
      | 'blur'
      | 'number',
    label: string,
    min: number,
    max: number,
    step = 1,
  ) =>
    selected && (
      <NumericProperty
        key={`${selected.id}-${field}`}
        id={`annotation-${field}`}
        label={label}
        value={selected[field]}
        min={min}
        max={max}
        step={step}
        onCommit={(value) => patch({ [field]: value })}
      />
    )

  return (
    <div
      ref={surface}
      tabIndex={0}
      onKeyDown={keyboard}
      role="region"
      aria-label="Editor anotasi gambar"
      className="min-w-0 space-y-4 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Alat anotasi"
          className="flex max-w-full flex-wrap gap-1 rounded-xl bg-muted p-1"
        >
          {tools.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                cancelDrag()
                setTool(item.id)
              }}
              disabled={disabled}
              aria-pressed={tool === item.id}
              title={item.title}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11px] transition-colors disabled:opacity-40',
                tool === item.id
                  ? 'bg-surface text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <item.icon size={16} />
              <span>{item.title}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled || !history.past.length}
            aria-label="Undo anotasi"
            title="Undo (Ctrl+Z)"
            onClick={() => dispatch({ type: 'undo' })}
          >
            <ArrowUUpLeft size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled || !history.future.length}
            aria-label="Redo anotasi"
            title="Redo (Ctrl+Y)"
            onClick={() => dispatch({ type: 'redo' })}
          >
            <ArrowUUpRight size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled || !selected}
            aria-label="Hapus anotasi terpilih"
            onClick={remove}
          >
            <Trash size={18} />
          </Button>
        </div>
      </div>
      <div
        className="relative mx-auto w-full overflow-hidden rounded-xl border border-border bg-muted/50"
        style={{ aspectRatio: `${image.width} / ${image.height}` }}
      >
        <canvas
          ref={canvas}
          aria-label="Pratinjau gambar dan anotasi"
          className="block h-full w-full"
        />
        <svg
          ref={overlay}
          viewBox={`0 0 ${image.width} ${image.height}`}
          className={cn(
            'absolute inset-0 h-full w-full touch-none',
            tool === 'select' ? 'cursor-default' : 'cursor-crosshair',
          )}
          aria-label="Kanvas anotasi, klik dan seret untuk menggambar"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={cancelDrag}
        >
          {values.map((value) => (
            <g
              key={value.id}
              data-annotation-id={value.id}
              transform={`matrix(${annotationMatrix(value).join(' ')})`}
            >
              <rect
                x={-value.width / 2}
                y={-value.height / 2}
                width={value.width}
                height={value.height}
                fill="transparent"
                stroke="none"
                style={{ cursor: tool === 'select' ? 'move' : undefined }}
              />
              {selectedId === value.id && (
                <>
                  <rect
                    x={-value.width / 2 - handleSize / 4}
                    y={-value.height / 2 - handleSize / 4}
                    width={value.width + handleSize / 2}
                    height={value.height + handleSize / 2}
                    fill="none"
                    stroke="#23745c"
                    strokeWidth={Math.max(1, handleSize / 8)}
                    strokeDasharray={`${handleSize / 2} ${handleSize / 3}`}
                    pointerEvents="none"
                  />
                  <rect
                    data-handle="resize"
                    x={value.width / 2 - handleSize / 2}
                    y={value.height / 2 - handleSize / 2}
                    width={handleSize}
                    height={handleSize}
                    fill="#ffffff"
                    stroke="#23745c"
                    strokeWidth={Math.max(1, handleSize / 8)}
                    style={{ cursor: 'nwse-resize' }}
                  />
                </>
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-[10px] leading-5 text-muted-foreground">
        <span>
          {tool === 'select'
            ? 'Pilih bentuk untuk memindahkan, mengubah ukuran, atau skew.'
            : tool === 'number' || tool === 'text'
              ? 'Klik pada gambar untuk menambahkan label.'
              : 'Klik dan seret pada gambar untuk menambahkan bentuk.'}
        </span>
        <span className="font-mono">{history.present.length} / 100 anotasi</span>
      </div>
      {selected ? (
        <fieldset
          disabled={disabled}
          className="space-y-4 rounded-xl border border-border bg-background p-4"
        >
          <legend className="px-2 text-xs font-medium">Atur anotasi terpilih</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {numeric('width', 'Lebar bentuk', 2, 32768)}
            {numeric('height', 'Tinggi bentuk', 2, 32768)}
            {numeric('rotation', 'Rotasi (°)', -360, 360)}
            <div className="flex flex-col gap-2">
              <label htmlFor="annotation-color" className="field-label text-xs">
                Warna
              </label>
              <input
                id="annotation-color"
                type="color"
                value={selected.color}
                onChange={(event) => patch({ color: event.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-surface p-1"
              />
            </div>
            {numeric('skewX', 'Skew horizontal (°)', -45, 45)}
            {numeric('skewY', 'Skew vertikal (°)', -45, 45)}
            {selected.kind === 'blur'
              ? numeric('blur', 'Kekuatan blur', 1, 150)
              : selected.kind === 'text'
                ? numeric('fontSize', 'Ukuran tulisan', 8, 1000)
                : selected.kind === 'number'
                  ? numeric('number', 'Nomor', 1, 999)
                  : numeric('strokeWidth', 'Tebal garis', 1, 200)}
          </div>
          {selected.kind === 'text' && (
            <div className="flex flex-col gap-2">
              <label htmlFor="annotation-text" className="field-label text-xs">
                Tulisan pada gambar
              </label>
              <textarea
                id="annotation-text"
                value={selected.text}
                maxLength={1000}
                rows={2}
                onChange={(event) => patch({ text: event.target.value })}
                className="field text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                Maksimal 1.000 karakter. Gunakan tinggi bentuk yang cukup untuk beberapa baris.
              </p>
            </div>
          )}
        </fieldset>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-[11px] leading-6 text-muted-foreground">
          Klik bentuk pada mode Pilih untuk mengubah ukuran, rotasi, dan kemiringannya. Anotasi di
          luar gambar akan terpotong saat ekspor.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-danger/5 px-4 py-3 text-xs leading-6 text-danger"
        >
          <WarningCircle size={16} className="mt-1 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

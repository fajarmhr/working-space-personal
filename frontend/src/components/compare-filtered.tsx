import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, PencilSimple } from '@phosphor-icons/react'
import {
  buildComparisonRows,
  type CompareLineChange,
  type ComparisonRow,
  type MovedBlock,
} from '../lib/compare-alignment'
import type { CompareFilter, CompareSide } from '../lib/compare-storage'
import { normalizeForEditor } from '../lib/text-compare'

const ROW_HEIGHT = 24
const OVERSCAN = 8
const MAX_SCROLL_HEIGHT = 8_000_000
const labels = { different: 'Berbeda', same: 'Sama', moved: 'Berpindah' }

export function CompareFiltered({
  leftText,
  rightText,
  changes,
  moves,
  filter,
  pending,
  ignoreSpace = false,
  copy,
  reconcile,
  onEdit,
}: {
  leftText: string
  rightText: string
  changes: CompareLineChange[]
  moves: MovedBlock[]
  filter: Exclude<CompareFilter, 'all'>
  pending: boolean
  ignoreSpace?: boolean
  copy: (from: CompareSide, index: number, offset: number) => void
  reconcile: (from: CompareSide, move: MovedBlock) => void
  /** Receives a one-based line number in the full document. */
  onEdit: (side: CompareSide, line: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const lastScroll = useRef(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(440)
  const lines = useMemo(
    () => ({
      left: normalizeForEditor(leftText).split('\n'),
      right: normalizeForEditor(rightText).split('\n'),
    }),
    [leftText, rightText],
  )
  const rows = useMemo(
    () =>
      pending ? [] : buildComparisonRows(leftText, rightText, changes, filter, moves, ignoreSpace),
    [leftText, rightText, changes, filter, moves, pending, ignoreSpace],
  )
  const movesById = useMemo(() => new Map(moves.map((move) => [move.id, move])), [moves])
  const width = useMemo(() => {
    let longest = 0
    for (const row of rows)
      for (const side of ['left', 'right'] as const) {
        const index = row[side]
        if (index !== null) {
          const line = lines[side][index] ?? ''
          // Geist Mono at 12px; include tab expansion and wider Unicode glyphs.
          const columns = line.replace(/\t/g, '    ').replace(/[^\u0000-\u00ff]/g, 'xx').length
          longest = Math.max(longest, columns)
        }
      }
    return Math.max(720, (longest * 7.5 + 128) * 2)
  }, [rows, lines])

  useEffect(() => {
    const node = container.current
    if (!node) return
    const observer = new ResizeObserver(() => setHeight(node.clientHeight))
    observer.observe(node)
    setHeight(node.clientHeight)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    lastScroll.current = 0
    if (container.current) container.current.scrollTop = 0
    setScrollTop(0)
  }, [filter])

  const logicalHeight = rows.length * ROW_HEIGHT
  const physicalHeight = Math.min(logicalHeight, MAX_SCROLL_HEIGHT)
  // Scale exceptionally large projections to stay below browser canvas limits.
  const scale =
    logicalHeight > physicalHeight && physicalHeight > height
      ? (logicalHeight - height) / (physicalHeight - height)
      : 1
  const logicalTop = scrollTop * scale
  const first = Math.max(0, Math.floor(logicalTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((logicalTop + height) / ROW_HEIGHT) + OVERSCAN)
  useLayoutEffect(() => {
    if (!pending && container.current) {
      const position = Math.min(lastScroll.current, Math.max(0, physicalHeight - height))
      container.current.scrollTop = position
      setScrollTop(position)
    }
  }, [pending, physicalHeight, height])

  function cell(row: ComparisonRow, side: CompareSide) {
    const index = row[side]
    const ownMoveId = side === 'left' ? row.leftMove : row.rightMove
    const otherMoveId = side === 'left' ? row.rightMove : row.leftMove
    const move = movesById.get(ownMoveId ?? otherMoveId ?? '')
    const destination = side === 'left' ? 'kanan' : 'kiri'
    const lineLabel = index === null ? 'kosong' : String(index + 1)
    const copyLabel = move
      ? `Samakan urutan ke ${destination}`
      : index === null
        ? `Hapus baris di ${destination}: samakan sisi ${side === 'left' ? 'kiri' : 'kanan'} yang kosong`
        : `Salin baris ${lineLabel} ke ${destination}`
    const actions = (
      <span className="flex shrink-0 items-center justify-center gap-0.5 px-1">
        {index !== null && (
          <button
            type="button"
            title={`Edit baris ${lineLabel} di ${side === 'left' ? 'kiri' : 'kanan'}`}
            aria-label={`Edit baris ${lineLabel} di ${side === 'left' ? 'kiri' : 'kanan'}`}
            disabled={pending}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onEdit(side, index + 1)}
          >
            <PencilSimple size={12} />
          </button>
        )}
        {row.changed && row.changeIndex !== null && (
          <button
            type="button"
            title={copyLabel}
            aria-label={copyLabel}
            disabled={pending}
            className={`flex size-5 items-center justify-center rounded border hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${move ? 'border-amber-500/40 text-amber-700 dark:text-amber-300' : 'border-border text-primary'}`}
            onClick={() =>
              move ? reconcile(side, move) : copy(side, row.changeIndex!, row.offset)
            }
          >
            {side === 'left' ? <ArrowRight size={13} /> : <ArrowLeft size={13} />}
          </button>
        )}
      </span>
    )
    return (
      <div
        role="cell"
        className={`flex h-6 min-w-0 items-center ${side === 'left' ? 'border-r border-border' : ''} ${move ? 'bg-amber-500/10' : row.changed ? (side === 'left' ? 'bg-danger/5' : 'bg-accent-soft/70') : ''}`}
      >
        {side === 'right' && actions}
        <span
          className="w-11 shrink-0 select-none px-2 text-right text-[10px] text-muted-foreground"
          aria-label={index === null ? undefined : `Baris ${lineLabel}`}
        >
          {index === null ? '' : lineLabel}
        </span>
        <span
          className="min-w-0 flex-1 whitespace-pre pr-2 text-[12px] leading-6"
          style={{ tabSize: 4 }}
        >
          {index === null ? '' : lines[side][index]}
        </span>
        {side === 'left' && actions}
      </div>
    )
  }

  return (
    <div
      ref={container}
      role="region"
      aria-label={`Hasil filter ${labels[filter]}`}
      aria-busy={pending}
      className="relative h-[clamp(440px,62dvh,860px)] overflow-auto bg-surface font-mono"
      onScroll={(event) => {
        const position = event.currentTarget.scrollTop
        setScrollTop(position)
        if (!pending) lastScroll.current = position
      }}
    >
      {!rows.length ? (
        <div className="sticky left-0 grid h-full place-content-center px-5 text-center font-sans text-xs text-muted-foreground">
          {pending
            ? 'Memperbarui perbandingan…'
            : filter === 'moved'
              ? 'Tidak ada blok identik yang berpindah.'
              : filter === 'same'
                ? 'Tidak ada baris yang sama.'
                : 'Tidak ada perbedaan.'}
        </div>
      ) : (
        <div
          role="table"
          aria-label={`Baris ${labels[filter].toLocaleLowerCase('id-ID')}`}
          aria-rowcount={rows.length}
          style={{ height: physicalHeight, width, minWidth: '100%', position: 'relative' }}
        >
          {rows.slice(first, last).map((row, offset) => (
            <div
              key={row.key}
              role="row"
              aria-rowindex={first + offset + 1}
              className="absolute left-0 grid w-full grid-cols-2"
              style={{
                height: ROW_HEIGHT,
                top: scrollTop + (first + offset) * ROW_HEIGHT - logicalTop,
              }}
            >
              {cell(row, 'left')}
              {cell(row, 'right')}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

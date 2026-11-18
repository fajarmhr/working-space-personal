import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import { monaco } from '../lib/compare-editor'
import { changeRange, type CompareLineChange, type MovedBlock } from '../lib/compare-alignment'
import type { Side } from './use-text-compare'

type CodeEditor = monaco.editor.IStandaloneCodeEditor
interface Marker {
  key: string
  top: number
  left: number
  from: Side
  index: number
  offset: number
  label: string
  move?: MovedBlock
}

export function CompareGutter({
  editor,
  changes,
  moves,
  pending,
  copy,
  reconcile,
}: {
  editor: monaco.editor.IStandaloneDiffEditor | null
  changes: CompareLineChange[]
  moves: MovedBlock[]
  pending: boolean
  copy: (from: Side, index: number, offset: number) => void
  reconcile: (from: Side, move: MovedBlock) => void
}) {
  const [painted, setPainted] = useState<{
    changes: CompareLineChange[]
    moves: MovedBlock[]
    markers: Marker[]
  } | null>(null)
  useEffect(() => {
    if (!editor) return
    const left = editor.getOriginalEditor()
    const right = editor.getModifiedEditor()
    const decorations = (side: Side) =>
      moves.map((move) => ({
        range: new monaco.Range(
          (side === 'left' ? move.leftStart : move.rightStart) + 1,
          1,
          side === 'left' ? move.leftEnd : move.rightEnd,
          1,
        ),
        options: {
          isWholeLine: true,
          className: 'compare-moved-line',
          linesDecorationsClassName: 'compare-moved-edge',
          hoverMessage: {
            value: `Teks identik berpindah: kiri ${move.leftStart + 1}–${move.leftEnd}, kanan ${move.rightStart + 1}–${move.rightEnd}. Samakan urutan untuk memindahkan tanpa duplikat.`,
          },
        },
      }))
    const leftDecorations = left.createDecorationsCollection(decorations('left'))
    const rightDecorations = right.createDecorationsCollection(decorations('right'))
    let frame = 0
    function refresh() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (pending) {
          setPainted(null)
          return
        }
        const bounds = editor!.getContainerDomNode().getBoundingClientRect()
        const result: Marker[] = []
        for (const from of ['left', 'right'] as const) {
          const pane = from === 'left' ? left : right
          const box = pane.getDomNode()!.getBoundingClientRect()
          const x = box.left - bounds.left + (from === 'left' ? box.width - 31 : 2)
          changes.forEach((change, index) => {
            const [start, end] = changeRange(change, from)
            const other = changeRange(change, from === 'left' ? 'right' : 'left')
            const count = Math.max(end - start, other[1] - other[0])
            const sources: {
              pane: CodeEditor
              start: number
              minimum: number
              maximum: number
              side: Side
            }[] = [
              { pane, start, minimum: 0, maximum: end - start, side: from },
              {
                pane: from === 'left' ? right : left,
                start: other[0],
                minimum: end - start,
                maximum: count,
                side: from === 'left' ? 'right' : 'left',
              },
            ]
            for (const source of sources)
              for (const window of source.pane.getVisibleRanges()) {
                const first = Math.max(source.minimum, window.startLineNumber - 1 - source.start)
                const last = Math.min(source.maximum, window.endLineNumber - source.start)
                for (let offset = first; offset < last; offset++) {
                  const line = source.start + offset + 1
                  const position = source.pane.getScrolledVisiblePosition({
                    lineNumber: line,
                    column: 1,
                  })
                  const sourceBox = source.pane.getDomNode()!.getBoundingClientRect()
                  if (!position || position.top < 0 || position.top > sourceBox.height - 20)
                    continue
                  const move = moves.find((item) =>
                    source.side === 'left'
                      ? line > item.leftStart && line <= item.leftEnd
                      : line > item.rightStart && line <= item.rightEnd,
                  )
                  const destination = from === 'left' ? 'kanan' : 'kiri'
                  result.push({
                    key: `${from}-${index}-${offset}`,
                    top: sourceBox.top - bounds.top + position.top + 2,
                    left: x,
                    from,
                    index,
                    offset,
                    move,
                    label: move
                      ? `Samakan urutan ke ${destination}: baris ${line}`
                      : source.side === from
                        ? `Salin baris ${line} ke ${destination}`
                        : `Hapus baris ${line} di ${destination}`,
                  })
                }
              }
          })
        }
        setPainted({ changes, moves, markers: result })
      })
    }
    refresh()
    const listeners = [
      left.onDidScrollChange(refresh),
      right.onDidScrollChange(refresh),
      left.onDidLayoutChange(refresh),
      right.onDidLayoutChange(refresh),
      left.onDidChangeHiddenAreas(refresh),
      right.onDidChangeHiddenAreas(refresh),
      editor.onDidUpdateDiff(refresh),
    ]
    return () => {
      cancelAnimationFrame(frame)
      listeners.forEach((listener) => listener.dispose())
      leftDecorations.clear()
      rightDecorations.clear()
    }
  }, [editor, changes, moves, pending])
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-label="Aksi di baris perbedaan"
    >
      {!pending &&
        painted?.changes === changes &&
        painted.moves === moves &&
        painted.markers.map((marker) => (
          <button
            key={marker.key}
            type="button"
            title={marker.label}
            aria-label={marker.label}
            className={`pointer-events-auto absolute flex h-5 w-6 items-center justify-center rounded border bg-surface shadow-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${marker.move ? 'border-amber-500/50 text-amber-700 dark:text-amber-300' : 'border-border text-primary'}`}
            style={{ top: marker.top, left: marker.left }}
            onClick={() =>
              marker.move
                ? reconcile(marker.from, marker.move)
                : copy(marker.from, marker.index, marker.offset)
            }
          >
            {marker.from === 'left' ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}
          </button>
        ))}
    </div>
  )
}

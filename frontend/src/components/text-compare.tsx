'use client'

import { useRef, useState, type DragEvent } from 'react'
import { flushSync } from 'react-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowsDownUp,
  Check,
  DownloadSimple,
  FileArrowUp,
  FloppyDisk,
  FolderOpen,
  GitDiff,
  LockSimple,
  Plus,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { cn } from '../lib/utils'
import type { CompareFileHandle, CompareFilter } from '../lib/compare-storage'
import { CompareGutter } from './compare-gutter'
import { CompareFiltered } from './compare-filtered'
import { useTextCompare, type Side } from './use-text-compare'

const sideLabel = (side: Side) => (side === 'left' ? 'kiri' : 'kanan')
const filters: { value: CompareFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'different', label: 'Berbeda' },
  { value: 'same', label: 'Sama' },
  { value: 'moved', label: 'Berpindah' },
]

export default function TextCompare({ onActivity }: { onActivity: (action: string) => void }) {
  const work = useTextCompare(onActivity)
  const { panes, diff, options, ready } = work
  const inputs = { left: useRef<HTMLInputElement>(null), right: useRef<HTMLInputElement>(null) }
  const [dragging, setDragging] = useState<Side | 'both' | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const loading = panes.left.loading || panes.right.loading
  const canAct = ready && !loading && !diff.pending && diff.changes.length > 0
  function editOriginal(side: Side, line: number) {
    flushSync(() => work.setOptions((previous) => ({ ...previous, filter: 'all' })))
    const editor = work.editorRef.current
    editor?.layout()
    const pane = side === 'left' ? editor?.getOriginalEditor() : editor?.getModifiedEditor()
    pane?.setPosition({ lineNumber: line, column: 1 })
    pane?.revealLineInCenter(line)
    pane?.focus()
  }

  function drag(event: DragEvent, side?: Side) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setDragging(event.dataTransfer.items.length === 2 ? 'both' : (side ?? 'both'))
  }
  async function drop(event: DragEvent, side?: Side) {
    event.preventDefault()
    event.stopPropagation()
    setDragging(null)
    if (!ready || loading) return
    const items = [...event.dataTransfer.items].filter((item) => item.kind === 'file')
    const files = [...event.dataTransfer.files]
    if (!files.length) return
    if (files.length > 2) {
      work.setFailure(
        'Jatuhkan satu berkas ke panel tujuan, atau dua berkas sekaligus (kiri lalu kanan).',
      )
      return
    }
    const handles = items.map((item) => {
      const entry = item as DataTransferItem & {
        getAsFileSystemHandle?: () => Promise<CompareFileHandle | null>
      }
      return entry.getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null)
    })
    for (let index = 0; index < files.length; index++) {
      const target: Side = files.length === 2 ? (index === 0 ? 'left' : 'right') : (side ?? 'left')
      await work.loadFile(target, files[index]!, (await handles[index]) ?? null)
    }
  }

  return (
    <section
      className="min-w-0"
      aria-label="Perbandingan teks langsung"
      onDragOver={(event) => drag(event)}
      onDrop={(event) => void drop(event)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(null)
      }}
    >
      <div className="space-y-4 border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <GitDiff size={18} className="text-primary" />
            Text Compare
          </div>
          <p
            role="status"
            aria-live="polite"
            className="font-mono text-[11px] text-muted-foreground"
          >
            {!ready
              ? 'Menyiapkan editor…'
              : loading
                ? 'Memproses berkas…'
                : diff.pending
                  ? 'Memperbarui perbedaan…'
                  : !panes.left.characters && !panes.right.characters
                    ? 'Ketik, buka, atau jatuhkan berkas ke panel'
                    : !diff.changes.length
                      ? options.ignoreSpace
                        ? 'Sama dengan aturan spasi aktif'
                        : 'Kedua teks sama'
                      : `${diff.changes.length} blok berbeda · ${diff.moves.length} blok berpindah`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
          <label className="grid min-w-40 flex-1 gap-1.5 text-[11px] text-muted-foreground">
            Sesi tersimpan
            <select
              aria-label="Sesi tersimpan"
              className="h-9 min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-foreground"
              value={work.sessionId}
              disabled={!ready || loading || work.sessionBusy}
              onChange={(event) => void work.loadSession(event.target.value)}
            >
              <option value="">Pilih sesi…</option>
              {work.sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-40 flex-1 gap-1.5 text-[11px] text-muted-foreground">
            Nama sesi
            <input
              aria-label="Nama sesi"
              value={work.sessionName}
              maxLength={120}
              placeholder="Contoh: script sebelum dan sesudah"
              className="h-9 min-w-0 rounded-lg border border-border bg-surface px-3 text-xs text-foreground"
              onChange={(event) => work.setSessionName(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            className="h-9"
            disabled={!ready || loading || work.sessionBusy}
            onClick={() => void work.saveSession()}
          >
            <FloppyDisk size={15} />
            {work.sessionBusy ? 'Menyimpan…' : 'Simpan sesi'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-9"
            aria-label="Hapus sesi tersimpan"
            title="Hapus sesi tersimpan"
            disabled={!work.sessionId || work.sessionBusy}
            onClick={() => setRemoveOpen(true)}
          >
            <Trash size={16} />
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter perbandingan">
            {filters.map((filter) => (
              <Button
                key={filter.value}
                size="sm"
                variant={options.filter === filter.value ? 'default' : 'ghost'}
                aria-pressed={options.filter === filter.value}
                disabled={!ready || diff.pending}
                onClick={() =>
                  work.setOptions((previous) => ({ ...previous, filter: filter.value }))
                }
              >
                {filter.value === 'moved' && <ArrowsDownUp size={14} />}
                {filter.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              title="Perbedaan sebelumnya"
              aria-label="Perbedaan sebelumnya"
              disabled={!canAct}
              onClick={() => work.selectChange(diff.active - 1)}
            >
              <ArrowUp size={14} />
            </Button>
            <span className="min-w-14 text-center font-mono text-[11px] text-muted-foreground">
              {diff.changes.length ? `${diff.active + 1} / ${diff.changes.length}` : '0 / 0'}
            </span>
            <Button
              size="sm"
              variant="secondary"
              title="Perbedaan berikutnya"
              aria-label="Perbedaan berikutnya"
              disabled={!canAct}
              onClick={() => work.selectChange(diff.active + 1)}
            >
              <ArrowDown size={14} />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
          {(
            [
              { label: 'Abaikan spasi tepi', key: 'ignoreSpace' },
              { label: 'Bungkus baris', key: 'wrap' },
              { label: 'Tampilkan spasi', key: 'whitespace' },
            ] as const
          ).map((option) => (
            <label key={option.key} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={options[option.key]}
                disabled={!ready}
                className="size-3.5 accent-primary"
                onChange={(event) =>
                  work.setOptions((previous) => ({
                    ...previous,
                    [option.key]: event.target.checked,
                  }))
                }
              />
              {option.label}
            </label>
          ))}
          <span className="ml-auto">
            Panah di baris: salin ·{' '}
            <span className="text-amber-700 dark:text-amber-300">kuning: berpindah</span>
          </span>
        </div>
        {options.filter !== 'all' && (
          <p className="text-[11px] text-muted-foreground">
            Tampilan filter mempertahankan nomor baris asli. Klik pensil di baris untuk mengedit
            pada tampilan Semua.
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-2 divide-x divide-border border-b border-border bg-muted/30">
            {(['left', 'right'] as const).map((side) => (
              <div
                key={side}
                className={cn(
                  'relative min-w-0 px-4 py-3',
                  (dragging === side || dragging === 'both') &&
                    'bg-accent-soft ring-2 ring-inset ring-primary',
                )}
                onDragOver={(event) => drag(event, side)}
                onDrop={(event) => void drop(event, side)}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium">
                    {side === 'left' ? 'Kiri' : 'Kanan'}
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      ref={inputs[side]}
                      type="file"
                      className="sr-only"
                      tabIndex={-1}
                      aria-label={`Pilih berkas ${sideLabel(side)}`}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void work.loadFile(side, file)
                        event.target.value = ''
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!ready || loading}
                      aria-label={`Buka berkas ${sideLabel(side)}`}
                      onClick={() => void work.openFile(side, () => inputs[side].current?.click())}
                    >
                      <FolderOpen size={14} />
                      Buka
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!ready || loading || !panes[side].open}
                      title="Simpan berkas"
                      aria-label={`Simpan berkas ${sideLabel(side)}`}
                      onClick={() => void work.saveFile(side)}
                    >
                      <FloppyDisk size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!ready || loading || !panes[side].open}
                      title="Simpan sebagai…"
                      aria-label={`Simpan sebagai berkas ${sideLabel(side)}`}
                      onClick={() => void work.saveFile(side, true)}
                    >
                      <DownloadSimple size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!ready || loading || !panes[side].open}
                      title="Tutup berkas"
                      aria-label={`Tutup berkas ${sideLabel(side)}`}
                      onClick={() => void work.closeFile(side)}
                    >
                      <X size={15} />
                    </Button>
                  </div>
                </div>
                <p className="truncate text-xs font-medium" title={panes[side].name}>
                  {panes[side].open ? panes[side].name || 'Teks baru' : 'Berkas ditutup'}
                  {panes[side].dirty && (
                    <span className="ml-1.5 text-primary" aria-label="Diubah">
                      *
                    </span>
                  )}
                </p>
                <p className="mt-1 font-mono text-[10px] leading-5 text-muted-foreground">
                  {panes[side].characters.toLocaleString('id-ID')} karakter ·{' '}
                  {panes[side].lines.toLocaleString('id-ID')} baris · {panes[side].encoding} ·{' '}
                  {panes[side].eol}
                </p>
                {panes[side].error && (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    {panes[side].error}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div
            className="relative"
            onDragOver={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect()
              drag(event, event.clientX < bounds.left + bounds.width / 2 ? 'left' : 'right')
            }}
            onDrop={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect()
              void drop(event, event.clientX < bounds.left + bounds.width / 2 ? 'left' : 'right')
            }}
          >
            <div
              ref={work.container}
              className={cn(
                'h-[clamp(440px,62dvh,860px)] w-full',
                options.filter !== 'all' && 'hidden',
              )}
            />
            {options.filter === 'all' ? (
              <CompareGutter
                editor={work.editorRef.current}
                changes={diff.changes}
                moves={diff.moves}
                pending={diff.pending || loading}
                copy={work.copyChange}
                reconcile={work.moveBlock}
              />
            ) : (
              <CompareFiltered
                leftText={panes.left.text}
                rightText={panes.right.text}
                changes={diff.changes}
                moves={diff.moves}
                filter={options.filter}
                ignoreSpace={options.ignoreSpace}
                pending={diff.pending || loading}
                copy={work.copyChange}
                reconcile={work.moveBlock}
                onEdit={editOriginal}
              />
            )}
            {(['left', 'right'] as const)
              .filter((side) => !panes[side].open)
              .map((side) => (
                <div
                  key={side}
                  className={cn(
                    'absolute inset-y-0 grid w-1/2 place-content-center gap-3 bg-surface text-center',
                    side === 'left' ? 'left-0 border-r border-border' : 'right-0',
                  )}
                >
                  <FileArrowUp size={25} className="mx-auto text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    Jatuhkan berkas ke panel {sideLabel(side)}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void work.closeFile(side, true)}
                  >
                    <Plus size={14} />
                    Teks baru
                  </Button>
                </div>
              ))}
            {dragging && (
              <div
                className={cn(
                  'pointer-events-none absolute inset-y-0 grid place-items-center border-2 border-dashed border-primary bg-accent-soft/90 text-sm font-medium text-primary',
                  dragging === 'both'
                    ? 'inset-x-0'
                    : dragging === 'left'
                      ? 'left-0 w-1/2'
                      : 'right-0 w-1/2',
                )}
              >
                {dragging === 'both'
                  ? 'Dua berkas: kiri lalu kanan'
                  : `Buka berkas di ${sideLabel(dragging)}`}
              </div>
            )}
          </div>
        </div>
      </div>
      {diff.moves.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
            <ArrowsDownUp size={15} />
            Isi identik, posisi berbeda
          </div>
          <div className="max-h-40 overflow-y-auto divide-y divide-border">
            {diff.moves.map((move) => (
              <div
                key={move.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-[11px]"
              >
                <span className="font-mono text-muted-foreground">
                  Kiri {move.leftStart + 1}–{move.leftEnd} ↔ Kanan {move.rightStart + 1}–
                  {move.rightEnd}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canAct}
                    onClick={() => work.moveBlock('right', move)}
                  >
                    <ArrowLeft size={13} />
                    Samakan ke kiri
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canAct}
                    onClick={() => work.moveBlock('left', move)}
                  >
                    Samakan ke kanan
                    <ArrowRight size={13} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {work.failure && (
        <div
          role="alert"
          className="m-4 flex items-start gap-2 rounded-xl bg-danger/5 px-4 py-3 text-xs leading-6 text-danger"
        >
          <WarningCircle size={17} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{work.failure}</span>
          <button
            type="button"
            onClick={() => work.setFailure('')}
            className="underline"
            aria-label="Tutup pesan error"
          >
            Tutup
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-[10px] leading-5 text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <LockSimple size={13} />
          Lokal di browser · Draft otomatis · UTF-8 / UTF-16 BOM · Maks. 4 MB per file
        </p>
        <span>Ctrl+S simpan · Ctrl+Shift+S simpan sebagai · Ctrl+Z undo</span>
        <p className="w-full sm:hidden">Geser area editor ke samping untuk melihat kedua panel.</p>
      </div>
      {work.notice && (
        <p
          role="status"
          className="flex items-start gap-2 px-4 pb-3 text-[11px] leading-5 text-primary"
        >
          <Check size={14} className="mt-0.5 shrink-0" />
          {work.notice}
        </p>
      )}
      <Dialog
        open={!!work.confirm}
        onOpenChange={(open) => {
          if (!open) work.confirm?.resolve('cancel')
        }}
      >
        <DialogContent>
          <DialogTitle className="pr-8 text-lg font-semibold">Simpan perubahan berkas?</DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-6 text-muted-foreground">
            Berkas {work.confirm?.sides.map(sideLabel).join(' dan ')} sudah diubah. Simpan sebelum
            melanjutkan.
          </DialogDescription>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => work.confirm?.resolve('cancel')}>
              Batal
            </Button>
            <Button variant="secondary" onClick={() => work.confirm?.resolve('discard')}>
              Jangan simpan
            </Button>
            <Button onClick={() => work.confirm?.resolve('save')}>
              <FloppyDisk size={15} />
              Simpan dan lanjutkan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogTitle className="pr-8 text-lg font-semibold">Hapus sesi tersimpan?</DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-6 text-muted-foreground">
            Snapshot sesi ini akan dihapus dari browser.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoveOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={() => {
                setRemoveOpen(false)
                void work.removeSession()
              }}
            >
              Hapus sesi
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

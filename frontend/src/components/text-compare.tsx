'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  DownloadSimple,
  FileArrowUp,
  GitDiff,
  LockSimple,
  WarningCircle,
} from '@phosphor-icons/react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import { monaco } from '../lib/compare-editor'
import {
  decodeCompareFile,
  languageFromFilename,
  MAX_COMPARE_CHARACTERS,
  MAX_COMPARE_FILE_BYTES,
  normalizeForEditor,
  replaceLineRange,
  type CompareEncoding,
  type CompareEol,
} from '../lib/text-compare'

type Side = 'left' | 'right'
interface PaneState {
  name: string
  encoding: CompareEncoding
  eol: CompareEol
  dirty: boolean
  lines: number
  characters: number
  loading: boolean
  error: string
}
interface DiffState {
  changes: monaco.editor.ILineChange[]
  active: number
  pending: boolean
  leftVersion: number
  rightVersion: number
}
const newPane = (): PaneState => ({
  name: '',
  encoding: 'UTF-8',
  eol: 'Tidak ada',
  dirty: false,
  lines: 1,
  characters: 0,
  loading: false,
  error: '',
})

function range(start: number, end: number) {
  return end === 0 ? ([start, start] as const) : ([start - 1, end] as const)
}

export default function TextCompare({ onActivity }: { onActivity: (action: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const models = useRef<Record<Side, monaco.editor.ITextModel> | null>(null)
  const baselines = useRef({ left: 1, right: 1 })
  const tickets = useRef({ left: 0, right: 0 })
  const activity = useRef(onActivity)
  activity.current = onActivity
  const activityTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sessionRecorded = useRef(false)
  const oversized = useRef(false)
  const inputs = { left: useRef<HTMLInputElement>(null), right: useRef<HTMLInputElement>(null) }
  const [panes, setPanes] = useState<Record<Side, PaneState>>({ left: newPane(), right: newPane() })
  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState('')
  const [notice, setNotice] = useState('')
  const [ignoreSpace, setIgnoreSpace] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [whitespace, setWhitespace] = useState(false)
  const [collapse, setCollapse] = useState(false)
  const [diff, setDiff] = useState<DiffState>({
    changes: [],
    active: 0,
    pending: true,
    leftVersion: 0,
    rightVersion: 0,
  })
  const diffRef = useRef(diff)
  diffRef.current = diff

  useEffect(() => {
    if (!container.current) return
    let mounted = true
    let editor: monaco.editor.IStandaloneDiffEditor | undefined
    const cleanup: monaco.IDisposable[] = []
    let observer: MutationObserver | undefined
    try {
      const left = monaco.editor.createModel('', 'plaintext')
      const right = monaco.editor.createModel('', 'plaintext')
      models.current = { left, right }
      baselines.current = {
        left: left.getAlternativeVersionId(),
        right: right.getAlternativeVersionId(),
      }
      editor = monaco.editor.createDiffEditor(container.current, {
        originalEditable: true,
        originalAriaLabel: 'Editor teks kiri',
        modifiedAriaLabel: 'Editor teks kanan',
        readOnly: false,
        automaticLayout: true,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: false,
        enableSplitViewResizing: true,
        ignoreTrimWhitespace: false,
        diffAlgorithm: 'advanced',
        maxComputationTime: 5000,
        maxFileSize: 8,
        renderMarginRevertIcon: false,
        renderGutterMenu: false,
        renderIndicators: true,
        renderOverviewRuler: true,
        minimap: { enabled: false },
        fontFamily: '"Geist Mono", monospace',
        fontSize: 12,
        lineHeight: 22,
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        padding: { top: 15, bottom: 15 },
        wordWrap: 'off',
        diffWordWrap: 'off',
        renderWhitespace: 'none',
        editContext: false,
        accessibilitySupport: 'auto',
        links: false,
        renderValidationDecorations: 'off',
        stickyScroll: { enabled: false },
        unicodeHighlight: { ambiguousCharacters: false },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        hideUnchangedRegions: { enabled: false, contextLineCount: 3, minimumLineCount: 8 },
      })
      editorRef.current = editor
      editor.setModel({ original: left, modified: right })
      function theme() {
        monaco.editor.setTheme(
          document.documentElement.classList.contains('dark')
            ? 'ruang-compare-dark'
            : 'ruang-compare-light',
        )
      }
      theme()
      observer = new MutationObserver(theme)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      function changed(side: Side) {
        const model = side === 'left' ? left : right
        if (model.getValueLength() > MAX_COMPARE_CHARACTERS && !oversized.current) {
          oversized.current = true
          model.undo()
          oversized.current = false
          setFailure('Setiap editor maksimal 2 juta karakter. Perubahan terakhir dibatalkan.')
          return
        }
        if (!mounted) return
        setPanes((previous) => ({
          ...previous,
          [side]: {
            ...previous[side],
            dirty: model.getAlternativeVersionId() !== baselines.current[side],
            lines: model.getLineCount(),
            characters: model.getValueLength(),
          },
        }))
        setDiff((previous) => ({ ...previous, pending: true }))
        clearTimeout(activityTimer.current)
        activityTimer.current = setTimeout(() => {
          if (!sessionRecorded.current && (left.getValueLength() || right.getValueLength())) {
            sessionRecorded.current = true
            activity.current('Membandingkan berkas atau teks secara langsung')
          }
        }, 1200)
      }
      cleanup.push(
        left.onDidChangeContent(() => changed('left')),
        right.onDidChangeContent(() => changed('right')),
      )
      cleanup.push(
        editor.onDidUpdateDiff(() => {
          if (!mounted) return
          const changes = editor!.getLineChanges()
          setDiff((previous) => ({
            changes: changes ?? [],
            active: Math.min(previous.active, Math.max(0, (changes?.length ?? 0) - 1)),
            pending: changes === null,
            leftVersion: left.getVersionId(),
            rightVersion: right.getVersionId(),
          }))
        }),
      )
      setReady(true)
    } catch (caught) {
      setFailure(
        caught instanceof Error ? caught.message : 'Editor belum dapat dibuka. Muat ulang halaman.',
      )
    }
    return () => {
      mounted = false
      tickets.current.left += 1
      tickets.current.right += 1
      clearTimeout(activityTimer.current)
      observer?.disconnect()
      cleanup.forEach((item) => item.dispose())
      editor?.dispose()
      models.current?.left.dispose()
      models.current?.right.dispose()
      editorRef.current = null
      models.current = null
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    editor?.updateOptions({
      ignoreTrimWhitespace: ignoreSpace,
      wordWrap: wrap ? 'on' : 'off',
      diffWordWrap: wrap ? 'on' : 'off',
      renderWhitespace: whitespace ? 'all' : 'none',
      hideUnchangedRegions: { enabled: collapse, contextLineCount: 3, minimumLineCount: 8 },
    })
    // Monaco resets sub-editor labels when diff options change.
    editor?.getOriginalEditor().updateOptions({ ariaLabel: 'Editor teks kiri' })
    editor?.getModifiedEditor().updateOptions({ ariaLabel: 'Editor teks kanan' })
  }, [ignoreSpace, wrap, whitespace, collapse])

  async function loadFile(side: Side, file: File | undefined) {
    if (!file || !models.current) return
    const ticket = ++tickets.current[side]
    const model = models.current[side]
    const version = model.getVersionId()
    setPanes((previous) => ({
      ...previous,
      [side]: { ...previous[side], loading: true, error: '' },
    }))
    try {
      if (file.size > MAX_COMPARE_FILE_BYTES) throw new Error('Ukuran setiap berkas maksimal 4 MB.')
      const decoded = decodeCompareFile(await file.arrayBuffer(), file.name)
      if (ticket !== tickets.current[side] || model.isDisposed()) return
      if (version !== model.getVersionId())
        throw new Error(
          'Isi editor berubah saat berkas dibaca. Buka berkas lagi setelah selesai mengedit.',
        )
      const value = normalizeForEditor(decoded.text)
      // Loading is undoable, so a replaced draft remains recoverable with Ctrl+Z.
      const pane =
        side === 'left'
          ? editorRef.current!.getOriginalEditor()
          : editorRef.current!.getModifiedEditor()
      pane.pushUndoStop()
      pane.executeEdits('ruang-open-file', [{ range: model.getFullModelRange(), text: value }])
      pane.pushUndoStop()
      monaco.editor.setModelLanguage(model, languageFromFilename(file.name))
      baselines.current[side] = model.getAlternativeVersionId()
      setPanes((previous) => ({
        ...previous,
        [side]: {
          name: file.name,
          encoding: decoded.encoding,
          eol: decoded.eol,
          dirty: false,
          lines: model.getLineCount(),
          characters: model.getValueLength(),
          loading: false,
          error: '',
        },
      }))
      setNotice(
        `${side === 'left' ? 'Berkas kiri' : 'Berkas kanan'} dibuka. Perbandingan diperbarui otomatis.`,
      )
    } catch (caught) {
      if (ticket === tickets.current[side])
        setPanes((previous) => ({
          ...previous,
          [side]: {
            ...previous[side],
            error: caught instanceof Error ? caught.message : 'Berkas belum dapat dibaca.',
          },
        }))
    } finally {
      if (ticket === tickets.current[side])
        setPanes((previous) => ({ ...previous, [side]: { ...previous[side], loading: false } }))
    }
  }

  function selectChange(index: number) {
    const editor = editorRef.current
    const changes = diffRef.current.changes
    if (!editor || !changes.length || diffRef.current.pending) return
    const selected = (index + changes.length) % changes.length
    const change = changes[selected]!
    const original = editor.getOriginalEditor()
    const modified = editor.getModifiedEditor()
    original.setPosition({ lineNumber: Math.max(1, change.originalStartLineNumber), column: 1 })
    modified.setPosition({ lineNumber: Math.max(1, change.modifiedStartLineNumber), column: 1 })
    original.revealLineInCenter(Math.max(1, change.originalStartLineNumber))
    modified.revealLineInCenter(Math.max(1, change.modifiedStartLineNumber))
    setDiff((previous) => ({ ...previous, active: selected }))
  }

  function copyChange(from: Side) {
    const state = diffRef.current
    if (!editorRef.current || !models.current || state.pending) return
    const { left, right } = models.current
    if (left.getVersionId() !== state.leftVersion || right.getVersionId() !== state.rightVersion) {
      setNotice('Perbandingan sedang diperbarui. Coba lagi setelah penanda selesai.')
      return
    }
    const change = state.changes[state.active]
    if (!change) return
    const leftRange = range(change.originalStartLineNumber, change.originalEndLineNumber)
    const rightRange = range(change.modifiedStartLineNumber, change.modifiedEndLineNumber)
    const targetSide = from === 'left' ? 'right' : 'left'
    const source = models.current[from]
    const target = models.current[targetSide]
    try {
      const sourceRange = from === 'left' ? leftRange : rightRange
      const targetRange = from === 'left' ? rightRange : leftRange
      const value = replaceLineRange(
        target.getValue(),
        source.getValue(),
        sourceRange[0],
        sourceRange[1],
        targetRange[0],
        targetRange[1],
      )
      const pane =
        targetSide === 'left'
          ? editorRef.current.getOriginalEditor()
          : editorRef.current.getModifiedEditor()
      pane.pushUndoStop()
      pane.executeEdits('ruang-copy-change', [{ range: target.getFullModelRange(), text: value }])
      pane.pushUndoStop()
      setNotice(
        `Blok disalin ke ${targetSide === 'left' ? 'kiri' : 'kanan'}. Ctrl+Z untuk membatalkan.`,
      )
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : 'Blok belum dapat disalin.')
    }
  }

  function save(side: Side) {
    const model = models.current?.[side]
    if (!model) return
    const url = URL.createObjectURL(
      new Blob([model.getValue(monaco.editor.EndOfLinePreference.LF)], {
        type: 'text/plain;charset=utf-8',
      }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = panes[side].name || `teks-${side === 'left' ? 'kiri' : 'kanan'}.txt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    baselines.current[side] = model.getAlternativeVersionId()
    setPanes((previous) => ({ ...previous, [side]: { ...previous[side], dirty: false } }))
    setNotice('Unduhan disiapkan dalam UTF-8 dengan akhir baris LF.')
  }

  const loading = panes.left.loading || panes.right.loading
  const noChanges = diff.changes.length === 0
  const canAct = ready && !diff.pending && !noChanges && !loading
  const added = diff.changes.reduce(
    (total, change) =>
      total +
      (change.modifiedEndLineNumber
        ? change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1
        : 0),
    0,
  )
  const removed = diff.changes.reduce(
    (total, change) =>
      total +
      (change.originalEndLineNumber
        ? change.originalEndLineNumber - change.originalStartLineNumber + 1
        : 0),
    0,
  )
  return (
    <section className="min-w-0" aria-label="Perbandingan teks langsung">
      <div className="space-y-4 border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <GitDiff size={18} className="text-primary" />
            <span className="font-medium">Editor perbandingan langsung</span>
            <span className="rounded-full bg-accent-soft px-2 py-1 text-[9px] text-primary">
              Otomatis
            </span>
          </div>
          <div
            role="status"
            aria-live="polite"
            className="font-mono text-[11px] text-muted-foreground"
          >
            {!ready
              ? 'Menyiapkan editor…'
              : loading
                ? 'Membaca berkas…'
                : diff.pending
                  ? 'Memperbarui perbedaan…'
                  : !panes.left.characters && !panes.right.characters
                    ? 'Mulai mengetik atau buka dua berkas'
                    : noChanges
                      ? ignoreSpace
                        ? 'Sama dengan aturan spasi aktif'
                        : 'Kedua teks sama'
                      : `${diff.changes.length} blok berbeda · +${added} / −${removed} baris`}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Perbedaan sebelumnya"
              title="Perbedaan sebelumnya"
              disabled={!canAct}
              onClick={() => selectChange(diff.active - 1)}
            >
              <ArrowUp size={15} />
            </Button>
            <span className="min-w-16 text-center font-mono text-[11px] text-muted-foreground">
              {noChanges ? '0 / 0' : `${diff.active + 1} / ${diff.changes.length}`}
            </span>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Perbedaan berikutnya"
              title="Perbedaan berikutnya"
              disabled={!canAct}
              onClick={() => selectChange(diff.active + 1)}
            >
              <ArrowDown size={15} />
            </Button>
            <span className="mx-1 h-5 border-l border-border" />
            <Button
              variant="secondary"
              size="sm"
              disabled={!canAct}
              title="Salin blok perbedaan terpilih dari kanan ke kiri"
              onClick={() => copyChange('right')}
            >
              <ArrowLeft size={15} />
              Ke kiri
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canAct}
              title="Salin blok perbedaan terpilih dari kiri ke kanan"
              onClick={() => copyChange('left')}
            >
              Ke kanan
              <ArrowRight size={15} />
            </Button>
          </div>
          <span className="text-[10px] text-muted-foreground">
            Ctrl+F cari · Ctrl+H ganti · Ctrl+Z undo
          </span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-3 text-[11px] text-muted-foreground">
          {[
            {
              label: 'Abaikan spasi tepi',
              checked: ignoreSpace,
              set: (value: boolean) => {
                setIgnoreSpace(value)
                setDiff((previous) => ({ ...previous, pending: true }))
              },
            },
            { label: 'Bungkus baris', checked: wrap, set: setWrap },
            { label: 'Tampilkan spasi', checked: whitespace, set: setWhitespace },
            { label: 'Lipat baris yang sama', checked: collapse, set: setCollapse },
          ].map((option) => (
            <label key={option.label} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={option.checked}
                onChange={(event) => option.set(event.target.checked)}
                className="size-3.5 accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-2 divide-x divide-border border-b border-border bg-muted/40">
            {(['left', 'right'] as const).map((side) => (
              <div key={side} className="min-w-0 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-[11px] font-medium">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        side === 'left' ? 'bg-danger/65' : 'bg-primary/65',
                      )}
                    />
                    {side === 'left' ? 'Versi kiri' : 'Versi kanan'}
                  </label>
                  <div className="relative flex gap-1.5">
                    <input
                      ref={inputs[side]}
                      type="file"
                      className="sr-only"
                      tabIndex={-1}
                      aria-label={`Pilih berkas ${side === 'left' ? 'kiri' : 'kanan'}`}
                      onChange={(event) => {
                        void loadFile(side, event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!ready || panes[side].loading}
                      onClick={() => inputs[side].current?.click()}
                      aria-label={`Buka berkas ${side === 'left' ? 'kiri' : 'kanan'}`}
                    >
                      <FileArrowUp size={14} />
                      Buka
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!ready}
                      onClick={() => save(side)}
                      aria-label={`Unduh teks ${side === 'left' ? 'kiri' : 'kanan'}`}
                    >
                      <DownloadSimple size={15} />
                    </Button>
                  </div>
                </div>
                <p className="truncate text-[12px] font-medium" title={panes[side].name}>
                  {panes[side].name || 'Teks baru'}
                  {panes[side].dirty && (
                    <span className="ml-1.5 text-primary" aria-label="Diubah">
                      *
                    </span>
                  )}
                </p>
                <p className="mt-1.5 font-mono text-[9px] leading-5 text-muted-foreground">
                  {panes[side].characters.toLocaleString('id-ID')} karakter ·{' '}
                  {panes[side].lines.toLocaleString('id-ID')} baris · {panes[side].encoding}
                  {panes[side].name && ` · ${panes[side].eol}`}
                </p>
                {panes[side].error && (
                  <p role="alert" className="mt-2 text-[11px] leading-5 text-danger">
                    {panes[side].error}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div ref={container} className="h-[clamp(420px,60dvh,760px)] w-full" />
        </div>
      </div>
      {failure && (
        <div
          role="alert"
          className="m-4 flex items-start gap-2 rounded-xl bg-danger/5 px-4 py-3 text-xs leading-6 text-danger"
        >
          <WarningCircle size={17} className="mt-1 shrink-0" />
          <span className="min-w-0 flex-1">{failure}</span>
          <button
            type="button"
            onClick={() => setFailure('')}
            aria-label="Tutup pesan error"
            className="text-xs underline"
          >
            Tutup
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border px-4 py-3 text-[10px] leading-5 text-muted-foreground">
        <p className="flex items-start gap-2">
          <LockSimple size={14} className="mt-0.5 shrink-0 text-primary" />
          Teks/kode UTF-8 atau UTF-16 dengan BOM · 4 MB per berkas · 2 juta karakter per editor.
        </p>
        <p className="sm:hidden">Geser area editor untuk melihat kedua panel.</p>
      </div>
      {notice && (
        <p
          role="status"
          className="flex items-start gap-2 px-4 pb-4 text-[11px] leading-5 text-primary"
        >
          <Check size={14} className="mt-0.5 shrink-0" />
          {notice}
        </p>
      )}
    </section>
  )
}

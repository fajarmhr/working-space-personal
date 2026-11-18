import { useEffect, useRef, useState } from 'react'
import { monaco, waitForCompareDiff } from '../lib/compare-editor'
import {
  decodeCompareFile,
  languageFromFilename,
  MAX_COMPARE_CHARACTERS,
  MAX_COMPARE_FILE_BYTES,
  normalizeForEditor,
  replaceLineRange,
} from '../lib/text-compare'
import {
  chooseCompareSaveHandle,
  deleteCompareSession,
  encodeCompareFile,
  listCompareSessions,
  openCompareFile,
  saveCompareSession,
  supportsCompareFileAccess,
  writeCompareFile,
  type CompareFileHandle,
  type CompareSession,
  type CompareSessionPane,
  type CompareSide,
} from '../lib/compare-storage'
import {
  changeRange,
  detectMovedBlocks,
  reconcileMovedBlock,
  type CompareLineChange,
  type MovedBlock,
} from '../lib/compare-alignment'

export type Side = CompareSide
export interface PaneState extends CompareSessionPane {
  dirty: boolean
  loading: boolean
  error: string
  lines: number
  characters: number
}
interface DiffState {
  changes: CompareLineChange[]
  moves: MovedBlock[]
  active: number
  pending: boolean
  leftVersion: number
  rightVersion: number
  ignoreSpace: boolean
}
const blank = (): PaneState => ({
  text: '',
  savedText: '',
  name: '',
  encoding: 'UTF-8',
  eol: 'Tidak ada',
  open: true,
  dirty: false,
  loading: false,
  error: '',
  lines: 1,
  characters: 0,
})
const defaults: CompareSession['options'] = {
  ignoreSpace: false,
  wrap: false,
  whitespace: false,
  filter: 'all',
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Operasi belum berhasil.'
// Shared across tool unmount/remount so restoration waits for the last flushed draft.
let pendingDraftWrites: Promise<void> = Promise.resolve()

export function useTextCompare(onActivity: (action: string) => void) {
  const container = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const models = useRef<Record<Side, monaco.editor.ITextModel> | null>(null)
  const handles = useRef<Record<Side, CompareFileHandle | null>>({ left: null, right: null })
  const tickets = useRef({ left: 0, right: 0 })
  const saving = useRef({ left: false, right: false })
  const loading = useRef({ left: false, right: false })
  const protecting = useRef(false)
  const readyRef = useRef(false)
  const mounted = useRef(false)
  const baselines = useRef({ left: '', right: '' })
  const optionsRef = useRef(defaults)
  const activity = useRef(onActivity)
  activity.current = onActivity
  const [panes, setPanes] = useState<Record<Side, PaneState>>({ left: blank(), right: blank() })
  const panesRef = useRef(panes)
  panesRef.current = panes
  const [options, setOptions] = useState(defaults)
  optionsRef.current = options
  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState('')
  const [notice, setNotice] = useState('')
  const [sessions, setSessions] = useState<CompareSession[]>([])
  const [sessionName, setSessionName] = useState('')
  const sessionNameRef = useRef(sessionName)
  sessionNameRef.current = sessionName
  const [sessionId, setSessionId] = useState('')
  const [sessionBusy, setSessionBusy] = useState(false)
  const [confirm, setConfirm] = useState<{
    sides: Side[]
    resolve: (choice: 'save' | 'discard' | 'cancel') => void
  } | null>(null)
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  const [diff, setDiff] = useState<DiffState>({
    changes: [],
    moves: [],
    active: 0,
    pending: true,
    leftVersion: 0,
    rightVersion: 0,
    ignoreSpace: false,
  })
  const diffRef = useRef(diff)
  diffRef.current = diff
  const latestDraft = useRef<CompareSession | null>(null)
  const lastQueuedDraft = useRef<CompareSession | null>(null)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function setLoading(side: Side, value: boolean) {
    loading.current[side] = value
    const editor =
      side === 'left'
        ? editorRef.current?.getOriginalEditor()
        : editorRef.current?.getModifiedEditor()
    editor?.updateOptions({
      readOnly: !readyRef.current || !panesRef.current[side].open || value || saving.current[side],
    })
    setPanes((previous) => ({ ...previous, [side]: { ...previous[side], loading: value } }))
  }

  function queueDraft(value: CompareSession) {
    if (lastQueuedDraft.current === value) return
    lastQueuedDraft.current = value
    // Keep complete snapshots in invocation order even when IndexedDB is busy.
    const write = pendingDraftWrites.catch(() => {}).then(() => saveCompareSession(value))
    pendingDraftWrites = write
    void write.catch((error) => {
      if (lastQueuedDraft.current === value) lastQueuedDraft.current = null
      if (mounted.current) setFailure(`Draft belum tersimpan: ${message(error)}`)
    })
  }

  function flushDraft() {
    clearTimeout(draftTimer.current)
    if (readyRef.current && models.current)
      latestDraft.current = snapshot('__draft__', sessionNameRef.current)
    if (latestDraft.current) queueDraft(latestDraft.current)
  }

  function applyPane(
    side: Side,
    pane: CompareSessionPane,
    handle: CompareFileHandle | null = null,
  ) {
    const model = models.current?.[side]
    if (!model) return
    tickets.current[side] += 1
    baselines.current[side] = pane.savedText
    handles.current[side] = handle
    loading.current[side] = false
    panesRef.current = {
      ...panesRef.current,
      [side]: {
        ...pane,
        dirty: pane.text !== pane.savedText,
        loading: false,
        error: '',
        lines: pane.text.split('\n').length,
        characters: pane.text.length,
      },
    }
    model.setValue(pane.text)
    monaco.editor.setModelLanguage(model, languageFromFilename(pane.name))
    const editor =
      side === 'left'
        ? editorRef.current?.getOriginalEditor()
        : editorRef.current?.getModifiedEditor()
    editor?.updateOptions({ readOnly: !readyRef.current || !pane.open || saving.current[side] })
    setPanes((previous) => ({
      ...previous,
      [side]: {
        ...pane,
        dirty: pane.text !== pane.savedText,
        loading: false,
        error: '',
        lines: model.getLineCount(),
        characters: model.getValueLength(),
      },
    }))
  }

  useEffect(() => {
    if (!container.current) return
    mounted.current = true
    readyRef.current = false
    let alive = true
    let recorded = false
    let restoring = false
    let oversized = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup: monaco.IDisposable[] = []
    const left = monaco.editor.createModel('', 'plaintext')
    const right = monaco.editor.createModel('', 'plaintext')
    models.current = { left, right }
    const editor = monaco.editor.createDiffEditor(container.current, {
      originalEditable: true,
      originalAriaLabel: 'Editor teks kiri',
      modifiedAriaLabel: 'Editor teks kanan',
      readOnly: true,
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
      lineHeight: 24,
      lineNumbersMinChars: 3,
      glyphMargin: true,
      scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 12 },
      wordWrap: 'off',
      diffWordWrap: 'off',
      renderWhitespace: 'none',
      editContext: false,
      links: false,
      renderValidationDecorations: 'off',
      stickyScroll: { enabled: false },
      unicodeHighlight: { ambiguousCharacters: false },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    })
    editorRef.current = editor
    editor.setModel({ original: left, modified: right })
    for (const side of ['left', 'right'] as const) {
      const pane = side === 'left' ? editor.getOriginalEditor() : editor.getModifiedEditor()
      cleanup.push(
        pane.addAction({
          id: `ruang-save-${side}`,
          label: `Simpan berkas ${side === 'left' ? 'kiri' : 'kanan'}`,
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
          run: async () => {
            await saveFile(side)
          },
        }),
        pane.addAction({
          id: `ruang-save-as-${side}`,
          label: `Simpan berkas ${side === 'left' ? 'kiri' : 'kanan'} sebagai`,
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS],
          run: async () => {
            await saveFile(side, true)
          },
        }),
      )
    }
    const theme = () =>
      monaco.editor.setTheme(
        document.documentElement.classList.contains('dark')
          ? 'ruang-compare-dark'
          : 'ruang-compare-light',
      )
    theme()
    const observer = new MutationObserver(theme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    function changed(side: Side) {
      const model = models.current![side]
      if (model.getValueLength() > MAX_COMPARE_CHARACTERS && !oversized) {
        oversized = true
        model.undo()
        oversized = false
        setFailure('Setiap editor maksimal 2 juta karakter. Perubahan terakhir dibatalkan.')
        return
      }
      if (!alive) return
      const text = model.getValue(monaco.editor.EndOfLinePreference.LF)
      setPanes((previous) => ({
        ...previous,
        [side]: {
          ...previous[side],
          text,
          dirty: text !== baselines.current[side],
          lines: model.getLineCount(),
          characters: text.length,
        },
      }))
      setDiff((previous) => ({ ...previous, pending: true }))
      clearTimeout(timer)
      if (!restoring)
        timer = setTimeout(() => {
          if (!recorded && (left.getValueLength() || right.getValueLength())) {
            recorded = true
            activity.current('Membandingkan berkas atau teks secara langsung')
          }
        }, 1200)
    }
    cleanup.push(
      left.onDidChangeContent(() => changed('left')),
      right.onDidChangeContent(() => changed('right')),
    )
    let computation = 0
    const updateDiff = () => {
      const request = ++computation
      const leftVersion = left.getVersionId()
      const rightVersion = right.getVersionId()
      const ignoreSpace = optionsRef.current.ignoreSpace
      setDiff((previous) => ({ ...previous, pending: true }))
      void waitForCompareDiff(editor)
        .then(() => {
          if (
            !alive ||
            request !== computation ||
            left.getVersionId() !== leftVersion ||
            right.getVersionId() !== rightVersion ||
            optionsRef.current.ignoreSpace !== ignoreSpace
          )
            return
          const changes = editor.getLineChanges()
          setDiff((previous) => ({
            changes: changes ?? [],
            moves: changes ? detectMovedBlocks(left.getValue(), right.getValue(), changes) : [],
            active: Math.min(previous.active, Math.max(0, (changes?.length ?? 0) - 1)),
            pending: changes === null,
            leftVersion,
            rightVersion,
            ignoreSpace,
          }))
        })
        .catch((error) => {
          if (alive) setFailure(message(error))
        })
    }
    cleanup.push(editor.onDidUpdateDiff(updateDiff))
    updateDiff()
    void pendingDraftWrites
      .catch(() => {})
      .then(() => listCompareSessions())
      .then((saved) => {
        if (!alive) return
        const draft = saved.find((session) => session.id === '__draft__')
        setSessions(saved.filter((session) => session.id !== '__draft__'))
        if (draft) {
          restoring = true
          applyPane('left', draft.left)
          applyPane('right', draft.right)
          setOptions(draft.options)
          setSessionName(draft.name)
          setSessionId(
            saved.find((session) => session.id !== '__draft__' && session.name === draft.name)
              ?.id ?? '',
          )
          restoring = false
          setNotice('Sesi kerja terakhir dipulihkan. Sesi bernama tersedia di daftar sesi.')
        }
      })
      .catch((error) => {
        if (alive) setFailure(`Penyimpanan sesi: ${message(error)}`)
      })
      .finally(() => {
        if (alive) {
          readyRef.current = true
          setReady(true)
        }
      })
    return () => {
      flushDraft()
      alive = false
      mounted.current = false
      readyRef.current = false
      tickets.current.left += 1
      tickets.current.right += 1
      clearTimeout(timer)
      observer.disconnect()
      cleanup.forEach((item) => item.dispose())
      editor.dispose()
      left.dispose()
      right.dispose()
      editorRef.current = null
      models.current = null
      confirmRef.current?.resolve('cancel')
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    editor?.updateOptions({
      ignoreTrimWhitespace: options.ignoreSpace,
      wordWrap: options.wrap ? 'on' : 'off',
      diffWordWrap: options.wrap ? 'on' : 'off',
      renderWhitespace: options.whitespace ? 'all' : 'none',
    })
    editor?.getOriginalEditor().updateOptions({
      ariaLabel: 'Editor teks kiri',
      readOnly: !ready || !panes.left.open || panes.left.loading || saving.current.left,
    })
    editor?.getModifiedEditor().updateOptions({
      ariaLabel: 'Editor teks kanan',
      readOnly: !ready || !panes.right.open || panes.right.loading || saving.current.right,
    })
  }, [
    ready,
    options.ignoreSpace,
    options.wrap,
    options.whitespace,
    panes.left.open,
    panes.right.open,
    panes.left.loading,
    panes.right.loading,
  ])

  function snapshot(id: string, name: string): CompareSession {
    const pane = (side: Side): CompareSessionPane => ({
      text:
        models.current?.[side].getValue(monaco.editor.EndOfLinePreference.LF) ??
        panesRef.current[side].text,
      savedText: baselines.current[side],
      name: panesRef.current[side].name,
      encoding: panesRef.current[side].encoding,
      eol: panesRef.current[side].eol,
      open: panesRef.current[side].open,
    })
    return {
      id,
      name: name.trim() || 'Sesi kerja terakhir',
      updatedAt: new Date().toISOString(),
      left: pane('left'),
      right: pane('right'),
      options: optionsRef.current,
    }
  }

  // Store each draft as a single atomic snapshot. Named sessions remain explicit snapshots.
  useEffect(() => {
    if (!ready) return
    latestDraft.current = snapshot('__draft__', sessionName)
    draftTimer.current = setTimeout(() => {
      if (latestDraft.current) queueDraft(latestDraft.current)
    }, 500)
    return () => clearTimeout(draftTimer.current)
  }, [ready, panes, options, sessionName])

  useEffect(() => {
    const flush = () => flushDraft()
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  useEffect(() => {
    if (!panes.left.dirty && !panes.right.dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [panes.left.dirty, panes.right.dirty])

  async function saveFile(side: Side, saveAs = false, forProtection = false): Promise<boolean> {
    const model = models.current?.[side]
    if (
      !model ||
      !readyRef.current ||
      saving.current[side] ||
      (!forProtection && loading.current[side])
    )
      return false
    const pane = panesRef.current[side]
    if (!pane.open) return false
    const ticket = tickets.current[side]
    const text = model.getValue(monaco.editor.EndOfLinePreference.LF)
    const wasLoading = loading.current[side]
    const isCurrent = () =>
      models.current?.[side] === model && !model.isDisposed() && tickets.current[side] === ticket
    saving.current[side] = true
    setLoading(side, true)
    try {
      const bytes = encodeCompareFile(text, pane.encoding, pane.eol)
      let handle = handles.current[side]
      if (supportsCompareFileAccess()) {
        if (!handle || saveAs)
          handle = await chooseCompareSaveHandle(
            pane.name || `teks-${side === 'left' ? 'kiri' : 'kanan'}.txt`,
          )
        if (!handle || !isCurrent()) return false
        await writeCompareFile(handle, bytes)
        if (!isCurrent()) return false
        handles.current[side] = handle
      } else {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
        )
        const link = document.createElement('a')
        link.href = url
        link.download = pane.name || `teks-${side === 'left' ? 'kiri' : 'kanan'}.txt`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      if (!isCurrent()) return false
      baselines.current[side] = text
      setPanes((previous) => ({
        ...previous,
        [side]: {
          ...previous[side],
          savedText: text,
          dirty: models.current?.[side].getValue() !== text,
          name: handle?.name || previous[side].name,
          eol: pane.eol === 'Campuran' ? 'LF' : pane.eol,
        },
      }))
      setNotice(
        supportsCompareFileAccess()
          ? `Berkas ${side === 'left' ? 'kiri' : 'kanan'} disimpan.`
          : 'Unduhan berkas disiapkan. Periksa hasil unduhan browser.',
      )
      return true
    } catch (error) {
      if (isCurrent()) setFailure(message(error))
      return false
    } finally {
      saving.current[side] = false
      if (isCurrent()) setLoading(side, wasLoading)
    }
  }

  async function protect(sides: Side[], allowLoading = false): Promise<boolean> {
    if (!readyRef.current || !models.current) return false
    if (
      protecting.current ||
      sides.some((side) => saving.current[side] || (!allowLoading && loading.current[side]))
    ) {
      setNotice('Tunggu proses berkas atau konfirmasi yang sedang berjalan.')
      return false
    }
    protecting.current = true
    const approved = new Map(
      sides.map((side) => [
        side,
        {
          model: models.current![side],
          ticket: tickets.current[side],
          version: models.current![side].getVersionId(),
        },
      ]),
    )
    try {
      for (const side of sides) {
        const model = models.current?.[side]
        if (!model || model.isDisposed()) return false
        if (model.getValue(monaco.editor.EndOfLinePreference.LF) === baselines.current[side])
          continue
        // Each dirty file gets a fresh click, preserving native picker user activation.
        const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
          const dialog = {
            sides: [side],
            resolve: (answer: 'save' | 'discard' | 'cancel') => {
              if (confirmRef.current !== dialog) return
              confirmRef.current = null
              setConfirm(null)
              resolve(answer)
            },
          }
          confirmRef.current = dialog
          setConfirm(dialog)
        })
        if (choice === 'cancel' || !models.current || model.isDisposed()) return false
        if (choice === 'save') {
          if (!(await saveFile(side, false, true))) return false
          if (model.getValue(monaco.editor.EndOfLinePreference.LF) !== baselines.current[side]) {
            setNotice(
              'Ada perubahan baru setelah penyimpanan. Berkas tetap dibuka agar perubahan tidak hilang.',
            )
            return false
          }
        }
        approved.set(side, { model, ticket: tickets.current[side], version: model.getVersionId() })
      }
      for (const [side, check] of approved) {
        if (
          models.current?.[side] !== check.model ||
          check.model.isDisposed() ||
          tickets.current[side] !== check.ticket ||
          check.model.getVersionId() !== check.version
        ) {
          setNotice('Isi berkas berubah selama konfirmasi. Ulangi setelah selesai mengedit.')
          return false
        }
      }
      return true
    } finally {
      protecting.current = false
    }
  }

  async function loadFile(side: Side, file: File, handle: CompareFileHandle | null = null) {
    if (!models.current || !readyRef.current) return
    if (saving.current[side] || loading.current[side] || protecting.current) {
      setNotice('Tunggu proses berkas atau konfirmasi yang sedang berjalan.')
      return
    }
    const ticket = ++tickets.current[side]
    const model = models.current[side]
    const version = model.getVersionId()
    setLoading(side, true)
    setPanes((previous) => ({ ...previous, [side]: { ...previous[side], error: '' } }))
    try {
      if (file.size > MAX_COMPARE_FILE_BYTES) throw new Error('Ukuran setiap berkas maksimal 4 MB.')
      const decoded = decodeCompareFile(await file.arrayBuffer(), file.name)
      if (ticket !== tickets.current[side] || model.isDisposed()) return
      if (model.getVersionId() !== version)
        throw new Error(
          'Editor berubah saat berkas dibaca. Buka berkas lagi setelah selesai mengedit.',
        )
      if (!(await protect([side], true))) return
      if (ticket !== tickets.current[side] || model.isDisposed()) return
      const text = normalizeForEditor(decoded.text)
      applyPane(
        side,
        {
          text,
          savedText: text,
          name: file.name,
          encoding: decoded.encoding,
          eol: decoded.eol,
          open: true,
        },
        handle,
      )
      setNotice(`Berkas ${side === 'left' ? 'kiri' : 'kanan'} dibuka.`)
    } catch (error) {
      if (ticket === tickets.current[side])
        setPanes((previous) => ({
          ...previous,
          [side]: { ...previous[side], error: message(error) },
        }))
    } finally {
      // applyPane intentionally increments the ticket and installs a fresh, non-loading pane.
      if (ticket === tickets.current[side] && !model.isDisposed()) setLoading(side, false)
    }
  }

  async function openFile(side: Side, fallback: () => void) {
    if (!readyRef.current || loading.current[side] || saving.current[side] || protecting.current)
      return
    if (!supportsCompareFileAccess()) {
      fallback()
      return
    }
    try {
      const result = await openCompareFile()
      if (result) await loadFile(side, result.file, result.handle)
    } catch (error) {
      setFailure(message(error))
    }
  }

  async function closeFile(side: Side, newText = false) {
    if (!(await protect([side]))) return
    applyPane(side, { ...blank(), open: newText })
    setNotice(
      newText
        ? 'Editor teks baru dibuka.'
        : `Berkas ${side === 'left' ? 'kiri' : 'kanan'} ditutup.`,
    )
  }

  async function saveSession() {
    if (!sessionName.trim()) {
      setFailure('Isi nama sesi terlebih dahulu.')
      return
    }
    setSessionBusy(true)
    try {
      const sameName = sessions.find((session) => session.name === sessionName.trim())
      const id =
        sameName?.id ??
        (sessionId &&
        sessions.find((session) => session.id === sessionId)?.name === sessionName.trim()
          ? sessionId
          : crypto.randomUUID())
      await saveCompareSession(snapshot(id, sessionName))
      setSessions((await listCompareSessions()).filter((session) => session.id !== '__draft__'))
      setSessionId(id)
      setNotice(
        'Sesi disimpan: isi kedua editor dan pengaturan. Simpan berkas secara terpisah untuk memperbarui file.',
      )
    } catch (error) {
      setFailure(message(error))
    } finally {
      setSessionBusy(false)
    }
  }

  async function loadSession(id: string) {
    const session = sessions.find((item) => item.id === id)
    if (!session || !(await protect(['left', 'right']))) return
    applyPane('left', session.left)
    applyPane('right', session.right)
    setOptions(session.options)
    setSessionName(session.name)
    setSessionId(session.id)
    setNotice(`Sesi “${session.name}” dibuka. Pilih lokasi saat pertama kali menyimpan berkas.`)
  }

  async function removeSession() {
    if (!sessionId) return
    setSessionBusy(true)
    try {
      await deleteCompareSession(sessionId)
      setSessions((previous) => previous.filter((session) => session.id !== sessionId))
      setSessionId('')
      setNotice('Sesi tersimpan dihapus. Isi editor tetap tersedia.')
    } catch (error) {
      setFailure(message(error))
    } finally {
      setSessionBusy(false)
    }
  }

  function currentDiff() {
    const state = diffRef.current
    if (
      !readyRef.current ||
      !models.current ||
      state.pending ||
      protecting.current ||
      loading.current.left ||
      loading.current.right ||
      saving.current.left ||
      saving.current.right
    )
      return null
    if (state.ignoreSpace !== optionsRef.current.ignoreSpace) return null
    if (
      models.current.left.getVersionId() !== state.leftVersion ||
      models.current.right.getVersionId() !== state.rightVersion
    )
      return null
    return state
  }

  function edit(side: Side, value: string, action: string) {
    const model = models.current?.[side]
    const editor =
      side === 'left'
        ? editorRef.current?.getOriginalEditor()
        : editorRef.current?.getModifiedEditor()
    if (!model || !editor || loading.current[side] || saving.current[side] || protecting.current)
      return
    const old = model.getValue(monaco.editor.EndOfLinePreference.LF)
    if (old === value) return
    let start = 0
    while (start < old.length && start < value.length && old[start] === value[start]) start += 1
    let oldEnd = old.length
    let newEnd = value.length
    while (oldEnd > start && newEnd > start && old[oldEnd - 1] === value[newEnd - 1]) {
      oldEnd -= 1
      newEnd -= 1
    }
    const first = model.getPositionAt(start)
    const last = model.getPositionAt(oldEnd)
    editor.updateOptions({ readOnly: false })
    editor.pushUndoStop()
    if (
      !editor.executeEdits(action, [
        {
          range: new monaco.Range(first.lineNumber, first.column, last.lineNumber, last.column),
          text: value.slice(start, newEnd),
        },
      ])
    )
      throw new Error('Editor belum siap menerima perubahan. Coba lagi.')
    editor.pushUndoStop()
    panesRef.current = { ...panesRef.current, [side]: { ...panesRef.current[side], open: true } }
    setPanes((previous) => ({ ...previous, [side]: { ...previous[side], open: true } }))
  }

  function copyChange(from: Side, index: number, offset?: number) {
    const state = currentDiff()
    const change = state?.changes[index]
    if (!change || !models.current) return
    const to = from === 'left' ? 'right' : 'left'
    let source = changeRange(change, from)
    let target = changeRange(change, to)
    if (offset !== undefined) {
      source = [
        Math.min(source[0] + offset, source[1]),
        Math.min(source[0] + offset + 1, source[1]),
      ]
      target = [
        Math.min(target[0] + offset, target[1]),
        Math.min(target[0] + offset + 1, target[1]),
      ]
    }
    try {
      edit(
        to,
        replaceLineRange(
          models.current[to].getValue(),
          models.current[from].getValue(),
          ...source,
          ...target,
        ),
        'ruang-copy-change',
      )
      setNotice(
        `${offset === undefined ? 'Blok' : 'Baris'} disalin ke ${to === 'left' ? 'kiri' : 'kanan'}. Ctrl+Z untuk membatalkan.`,
      )
    } catch (error) {
      setFailure(message(error))
    }
  }

  function moveBlock(from: Side, move: MovedBlock) {
    const state = currentDiff()
    if (!state || !models.current) return
    const to = from === 'left' ? 'right' : 'left'
    try {
      const previous = models.current[to].getValue()
      const value = reconcileMovedBlock(
        previous,
        models.current[from].getValue(),
        move,
        from,
        state.changes,
      )
      if (value === previous) {
        setNotice('Blok sudah berada pada posisi yang sesuai. Pilih blok berpindah lain.')
        return
      }
      edit(to, value, 'ruang-reconcile-move')
      setNotice(
        `Urutan blok di ${to === 'left' ? 'kiri' : 'kanan'} disamakan tanpa duplikat. Ctrl+Z untuk membatalkan.`,
      )
    } catch (error) {
      setFailure(message(error))
    }
  }

  function selectChange(index: number) {
    const state = currentDiff()
    if (!state?.changes.length || !editorRef.current) return
    const active = (index + state.changes.length) % state.changes.length
    const change = state.changes[active]!
    for (const side of ['left', 'right'] as const) {
      const editor =
        side === 'left'
          ? editorRef.current.getOriginalEditor()
          : editorRef.current.getModifiedEditor()
      const lineNumber = Math.max(1, changeRange(change, side)[0] + 1)
      editor.setPosition({ lineNumber, column: 1 })
      editor.revealLineInCenter(lineNumber)
    }
    setDiff((previous) => ({ ...previous, active }))
  }

  return {
    container,
    editorRef,
    models,
    panes,
    options,
    setOptions,
    ready,
    failure,
    setFailure,
    notice,
    setNotice,
    diff: diff.ignoreSpace === options.ignoreSpace ? diff : { ...diff, pending: true },
    sessions,
    sessionName,
    setSessionName,
    sessionId,
    sessionBusy,
    confirm,
    saveFile,
    loadFile,
    openFile,
    closeFile,
    saveSession,
    loadSession,
    removeSession,
    copyChange,
    moveBlock,
    selectChange,
  }
}

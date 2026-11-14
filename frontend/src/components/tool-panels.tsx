import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowCounterClockwise,
  ArrowsLeftRight,
  BracketsCurly,
  Check,
  Copy,
  DownloadSimple,
  LockKey,
  Pause,
  Play,
  WarningCircle,
} from '@phosphor-icons/react'
import { Button } from './ui/button'
import { cn, copyText, formatDate } from '../lib/utils'
import {
  decodeBase64,
  encodeBase64,
  formatJson,
  generatePassword,
  passwordGroups,
  textTransformations,
} from '../lib/transformations'
import type { Note, Preferences, ToolId } from '../lib/types'

interface ToolPanelProps {
  id: ToolId
  preferences: Preferences
  note: Note
  onSaveNote: (content: string) => Promise<Note>
  onActivity: (action: string) => void
}

function InlineError({ message }: { message: string }) {
  return message ? (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-danger/5 px-4 py-3 text-[13px] leading-6 text-danger"
    >
      <WarningCircle size={18} className="mt-0.5 shrink-0" />
      {message}
    </p>
  ) : null
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timeout.current), [])
  return (
    <div>
      <Button
        variant="secondary"
        size="sm"
        disabled={!text}
        onClick={() => {
          void copyText(text)
            .then(() => {
              setCopied(true)
              setError('')
              clearTimeout(timeout.current)
              timeout.current = setTimeout(() => setCopied(false), 1800)
            })
            .catch(() => setError('Salin manual dari bidang hasil.'))
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? 'Tersalin' : 'Salin'}
      </Button>
      {error && (
        <p role="status" className="mt-2 max-w-40 text-xs text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  )
}

function Result({
  value,
  label = 'Hasil',
  mono = false,
}: {
  value: string
  label?: string
  mono?: boolean
}) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex h-8 items-center justify-between">
        <label htmlFor="tool-result" className="field-label">
          {label}
        </label>
        <CopyButton text={value} />
      </div>
      {value ? (
        <textarea
          id="tool-result"
          readOnly
          value={value}
          aria-live="polite"
          className={cn('code-editor min-h-72', !mono && 'font-sans text-sm')}
        />
      ) : (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background p-6 text-center">
          <BracketsCurly size={28} className="mb-4 text-muted-foreground/45" />
          <p className="text-sm font-medium">Ada ruang untuk hasilmu.</p>
          <p className="mt-2 max-w-52 text-xs leading-6 text-muted-foreground">
            Masukkan teks dan jalankan alat untuk melihat hasilnya di sini.
          </p>
        </div>
      )}
    </section>
  )
}

function JsonFormatter({ onActivity }: Pick<ToolPanelProps, 'onActivity'>) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [indent, setIndent] = useState('2')
  function format(compact = false) {
    if (!input.trim()) {
      setError('Masukkan JSON yang ingin dirapikan.')
      return
    }
    try {
      setOutput(formatJson(input, compact ? 0 : (Number(indent) as 2 | 4)))
      setError('')
      onActivity(compact ? 'Memadatkan JSON' : 'Memformat JSON')
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'JSON belum valid. Periksa tanda kutip dan koma.',
      )
      setOutput('')
    }
  }
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-3 flex h-8 items-center justify-between">
            <label htmlFor="json-input" className="field-label">
              JSON kamu
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setInput(
                  JSON.stringify({
                    workspace: 'Ruang',
                    local: true,
                    tools: ['format', 'focus', 'write'],
                  }),
                )
                setError('')
              }}
            >
              Isi contoh
            </Button>
          </div>
          <textarea
            id="json-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={500000}
            spellCheck={false}
            className="code-editor min-h-72"
            placeholder={'{\n  "mulai": "dari sini"\n}'}
            aria-describedby="json-help"
          />
          <p id="json-help" className="mt-2 text-xs leading-5 text-muted-foreground">
            Hingga 500.000 karakter. JSON diproses di browser ini.
          </p>
        </div>
        <Result value={output} mono />
      </div>
      <InlineError message={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => format()}>
          <BracketsCurly size={17} />
          Rapikan JSON
        </Button>
        <Button variant="secondary" onClick={() => format(true)}>
          Minify
        </Button>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          Indentasi
          <select
            aria-label="Jumlah spasi indentasi"
            className="rounded-lg border border-border bg-surface px-2 py-2 text-foreground"
            value={indent}
            onChange={(e) => setIndent(e.target.value)}
          >
            <option value="2">2 spasi</option>
            <option value="4">4 spasi</option>
          </select>
        </label>
      </div>
    </div>
  )
}

function TextCase({ onActivity }: Pick<ToolPanelProps, 'onActivity'>) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const transformations = [
    { label: 'HURUF BESAR', run: textTransformations.uppercase },
    { label: 'huruf kecil', run: textTransformations.lowercase },
    { label: 'Title Case', run: textTransformations.title },
    { label: 'Kalimat biasa', run: textTransformations.sentence },
    { label: 'slug-case', run: textTransformations.slug },
    { label: 'Hapus spasi ganda', run: textTransformations.spaces },
  ]
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div>
          <label htmlFor="text-input" className="field-label mb-3 flex h-8 items-center">
            Teks asli
          </label>
          <textarea
            id="text-input"
            className="code-editor min-h-72 font-sans text-sm"
            value={input}
            maxLength={200000}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tulis atau tempel teksmu di sini…"
          />
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            {Array.from(input).length.toLocaleString('id-ID')} karakter ·{' '}
            {input.trim() ? input.trim().split(/\s+/).length.toLocaleString('id-ID') : 0} kata
          </p>
        </div>
        <Result value={output} />
      </div>
      <div className="flex flex-wrap gap-2">
        {transformations.map(({ label, run }) => (
          <Button
            key={label}
            variant="secondary"
            disabled={!input}
            onClick={() => {
              setOutput(run(input))
              onActivity('Mengubah format teks')
            }}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function Base64Tool({ onActivity }: Pick<ToolPanelProps, 'onActivity'>) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [mode, setMode] = useState<'encode' | 'decode'>('encode')
  const [error, setError] = useState('')
  function convert() {
    if (!input) {
      setError('Masukkan teks terlebih dahulu.')
      return
    }
    try {
      setOutput(mode === 'encode' ? encodeBase64(input) : decodeBase64(input))
      setError('')
      onActivity(mode === 'encode' ? 'Encode teks ke Base64' : 'Decode teks Base64')
    } catch {
      setError(
        'Base64 belum valid atau hasilnya bukan teks UTF-8. Pastikan seluruh teks dan padding = ikut tersalin.',
      )
      setOutput('')
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex w-fit gap-1 rounded-xl bg-muted p-1">
        {(['encode', 'decode'] as const).map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => {
              setMode(item)
              setError('')
              setOutput('')
            }}
            className={cn(
              'rounded-lg px-4 py-2 text-xs font-medium capitalize transition-colors',
              mode === item
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div>
          <label htmlFor="base64-input" className="field-label mb-3 flex h-8 items-center">
            {mode === 'encode' ? 'Teks UTF-8' : 'Teks Base64'}
          </label>
          <textarea
            id="base64-input"
            className="code-editor min-h-72"
            maxLength={200000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder={
              mode === 'encode' ? 'Teks apa yang ingin kamu encode?' : 'Tempel teks Base64 di sini…'
            }
          />
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Base64 adalah encoding, bukan enkripsi.
          </p>
        </div>
        <Result value={output} mono />
      </div>
      <InlineError message={error} />
      <Button onClick={convert}>
        <ArrowsLeftRight size={17} />
        {mode === 'encode' ? 'Encode teks' : 'Decode teks'}
      </Button>
    </div>
  )
}

function PasswordGenerator({ onActivity }: Pick<ToolPanelProps, 'onActivity'>) {
  const [length, setLength] = useState(20)
  const [groups, setGroups] = useState({
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
  })
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const definitions = passwordGroups
  function generate() {
    try {
      setPassword(generatePassword(length, groups))
      setError('')
      onActivity('Membuat kata sandi')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Password belum bisa dibuat.')
    }
  }
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.15fr_1fr]">
      <div className="flex min-h-72 flex-col rounded-[28px] bg-accent-soft p-6 sm:p-8">
        <LockKey size={27} className="text-primary" />
        <p className="eyebrow mt-8 text-primary/65">Dibuat di perangkatmu</p>
        <output
          aria-live="polite"
          className={cn(
            'my-5 block break-all font-mono text-2xl leading-relaxed tracking-tight',
            !password && 'text-muted-foreground/50',
          )}
        >
          {password || 'Kata sandimu di sini'}
        </output>
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
          <Button onClick={generate}>
            <ArrowCounterClockwise size={16} />
            Buat password
          </Button>
          <CopyButton text={password} />
        </div>
      </div>
      <div className="space-y-7">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <label htmlFor="password-length" className="field-label">
              Panjang password
            </label>
            <output className="rounded-lg bg-muted px-3 py-1 font-mono text-sm">{length}</output>
          </div>
          <input
            id="password-length"
            type="range"
            min="12"
            max="64"
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>12 karakter</span>
            <span>64 karakter</span>
          </div>
        </div>
        <div className="divide-y divide-border">
          {definitions.map((group) => (
            <label
              key={group.key}
              className="flex cursor-pointer items-center justify-between gap-4 py-4"
            >
              <span className="text-sm">
                {group.label}
                <span className="ml-3 font-mono text-xs text-muted-foreground">
                  {group.preview}
                </span>
              </span>
              <input
                type="checkbox"
                checked={groups[group.key]}
                onChange={(e) =>
                  setGroups((previous) => ({ ...previous, [group.key]: e.target.checked }))
                }
                className="size-4 accent-primary"
              />
            </label>
          ))}
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          Menggunakan generator acak kriptografis browser. Password tidak disimpan dalam riwayat
          aktivitas.
        </p>
        <InlineError message={error} />
      </div>
    </div>
  )
}

interface TimerState {
  remaining: number
  deadline: number | null
  mode: 'focus' | 'break'
  duration: number
}
const TIMER_KEY = 'ruang-focus-v1'

function readTimer(defaultMinutes: number): TimerState {
  try {
    const raw = localStorage.getItem(TIMER_KEY)
    if (raw) {
      const value = JSON.parse(raw) as TimerState
      if (
        typeof value.remaining === 'number' &&
        Number.isFinite(value.remaining) &&
        (value.deadline === null ||
          (typeof value.deadline === 'number' && Number.isFinite(value.deadline))) &&
        (value.mode === 'focus' || value.mode === 'break') &&
        typeof value.duration === 'number' &&
        value.duration > 0 &&
        value.duration <= 10800
      )
        return {
          ...value,
          remaining: value.deadline
            ? Math.max(0, Math.ceil((value.deadline - Date.now()) / 1000))
            : Math.max(0, Math.min(value.remaining, value.duration)),
        }
    }
  } catch {
    /* Storage is optional. */
  }
  return {
    remaining: defaultMinutes * 60,
    deadline: null,
    mode: 'focus',
    duration: defaultMinutes * 60,
  }
}

function FocusTimer({
  preferences,
  onActivity,
}: Pick<ToolPanelProps, 'preferences' | 'onActivity'>) {
  const [timer, setTimer] = useState<TimerState>(() => readTimer(preferences.focus_minutes))
  const [now, setNow] = useState(Date.now())
  const completionSent = useRef(false)
  const remaining = timer.deadline
    ? Math.max(0, Math.ceil((timer.deadline - now) / 1000))
    : timer.remaining
  const complete = remaining === 0
  const progress = Math.max(0, Math.min(1, remaining / timer.duration))
  useEffect(() => {
    if (!timer.deadline) return
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [timer.deadline])
  useEffect(() => {
    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify(timer))
    } catch {
      /* Timer still works without persistence. */
    }
  }, [timer])
  useEffect(() => {
    if (complete && timer.deadline && !completionSent.current) {
      completionSent.current = true
      onActivity(
        timer.mode === 'focus' ? 'Menyelesaikan sesi fokus' : 'Menyelesaikan waktu istirahat',
      )
      setTimer((previous) => ({ ...previous, deadline: null, remaining: 0 }))
    }
  }, [complete, timer.deadline, timer.mode, onActivity])
  function reset(mode = timer.mode) {
    completionSent.current = false
    const duration = (mode === 'focus' ? preferences.focus_minutes : preferences.break_minutes) * 60
    setTimer({ mode, remaining: duration, deadline: null, duration })
    setNow(Date.now())
  }
  function toggle() {
    completionSent.current = false
    if (timer.deadline) {
      setTimer((previous) => ({ ...previous, remaining, deadline: null }))
    } else {
      const seconds = remaining || timer.duration
      setNow(Date.now())
      setTimer((previous) => ({
        ...previous,
        remaining: seconds,
        deadline: Date.now() + seconds * 1000,
      }))
      onActivity(timer.mode === 'focus' ? 'Memulai sesi fokus' : 'Memulai waktu istirahat')
    }
  }
  return (
    <div className="flex flex-col items-center py-2 sm:py-6">
      <div className="mb-10 flex gap-1 rounded-xl bg-muted p-1">
        {(
          [
            { value: 'focus', label: 'Fokus' },
            { value: 'break', label: 'Istirahat' },
          ] as const
        ).map((mode) => (
          <button
            key={mode.value}
            type="button"
            onClick={() => reset(mode.value)}
            className={cn(
              'rounded-lg px-6 py-2 text-[13px] font-medium transition-colors',
              timer.mode === mode.value
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <div className="relative flex size-64 max-w-full items-center justify-center sm:size-72">
        <svg
          className="absolute inset-0 size-full -rotate-90"
          viewBox="0 0 288 288"
          aria-hidden="true"
        >
          <circle cx="144" cy="144" r="136" fill="none" stroke="var(--muted)" strokeWidth="3" />
          <circle
            cx="144"
            cy="144"
            r="136"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 136}
            strokeDashoffset={2 * Math.PI * 136 * (1 - progress)}
          />
        </svg>
        <div className="text-center">
          <p className="eyebrow mb-3">
            {complete ? 'Selesai' : timer.deadline ? 'Sedang berjalan' : 'Ambil satu langkah'}
          </p>
          <output
            role="timer"
            aria-label={`${Math.floor(remaining / 60)} menit ${remaining % 60} detik`}
            className="font-mono text-[52px] tracking-[-0.07em] sm:text-[60px]"
          >
            {String(Math.floor(remaining / 60)).padStart(2, '0')}
            <span className="text-muted-foreground/50">:</span>
            {String(remaining % 60).padStart(2, '0')}
          </output>
          <p className="mt-3 text-xs text-muted-foreground">
            {timer.mode === 'focus'
              ? 'Satu hal dalam satu waktu.'
              : 'Beri pikiranmu sedikit ruang.'}
          </p>
        </div>
      </div>
      <div className="mt-10 flex gap-3">
        <Button onClick={toggle} className="min-w-36" size="lg">
          {timer.deadline ? <Pause size={17} /> : <Play size={17} />}
          {timer.deadline ? 'Jeda' : complete ? 'Mulai lagi' : 'Mulai fokus'}
        </Button>
        <Button variant="secondary" size="lg" aria-label="Reset timer" onClick={() => reset()}>
          <ArrowCounterClockwise size={19} />
        </Button>
      </div>
      <p className="mt-5 max-w-sm text-center text-xs leading-6 text-muted-foreground">
        Durasi mengikuti pengaturan workspace. Timer tetap menghitung saat kamu berpindah alat.
        Status dan aktivitas penyelesaian diperbarui saat alat ini dibuka kembali.
      </p>
    </div>
  )
}

const NOTE_DRAFT_KEY = 'ruang-note-draft-v1'
function QuickNote({ note, onSaveNote }: Pick<ToolPanelProps, 'note' | 'onSaveNote'>) {
  const [content, setContent] = useState(() => {
    try {
      return localStorage.getItem(NOTE_DRAFT_KEY) ?? note.content
    } catch {
      return note.content
    }
  })
  const [savedContent, setSavedContent] = useState(note.content)
  const [updatedAt, setUpdatedAt] = useState(note.updated_at)
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>(
    content === note.content ? 'saved' : 'pending',
  )
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const contentRef = useRef(content)
  contentRef.current = content
  const saveRef = useRef(onSaveNote)
  saveRef.current = onSaveNote
  const save = useCallback(async (value: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setStatus('saving')
    try {
      const result = await saveRef.current(value)
      setSavedContent(result.content)
      setUpdatedAt(result.updated_at)
      setError('')
      if (contentRef.current === value) {
        setStatus('saved')
        try {
          localStorage.removeItem(NOTE_DRAFT_KEY)
        } catch {
          /* Storage optional. */
        }
      } else setStatus('pending')
    } catch (caught) {
      setStatus('error')
      setError(
        caught instanceof Error
          ? caught.message
          : 'Catatan belum tersimpan. Draf tetap ada di browser ini.',
      )
    } finally {
      inFlight.current = false
    }
  }, [])
  useEffect(() => {
    if (status === 'saving') return
    if (content === savedContent) {
      setStatus('saved')
      setError('')
      try {
        localStorage.removeItem(NOTE_DRAFT_KEY)
      } catch {
        /* Storage optional. */
      }
      return
    }
    if (status === 'error') return
    setStatus('pending')
    const timeout = setTimeout(() => void save(content), 800)
    return () => clearTimeout(timeout)
  }, [content, savedContent, status, save])
  function change(value: string) {
    setContent(value)
    if (status !== 'saving') setStatus('pending')
    try {
      localStorage.setItem(NOTE_DRAFT_KEY, value)
    } catch {
      /* Save through backend remains available. */
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'catatan-ruang.txt'
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <label className="field-label" htmlFor="quick-note">
          Halaman kecil untuk pikiranmu
        </label>
        <div
          role="status"
          className={cn(
            'flex items-center gap-1.5 text-xs',
            status === 'error' ? 'text-danger' : 'text-muted-foreground',
          )}
        >
          {status === 'saved' && <Check size={14} />}
          {status === 'saved'
            ? 'Tersimpan di perangkat'
            : status === 'saving'
              ? 'Menyimpan…'
              : status === 'error'
                ? 'Belum tersimpan'
                : 'Draf belum tersimpan'}
        </div>
      </div>
      <textarea
        id="quick-note"
        value={content}
        onChange={(e) => change(e.target.value)}
        maxLength={100000}
        className="w-full rounded-2xl border border-border bg-background px-5 py-5 text-[15px] leading-8 outline-none placeholder:text-muted-foreground/55 focus:border-primary focus:ring-2 focus:ring-primary/10 sm:px-7"
        rows={13}
        placeholder="Ide, daftar kecil, atau hal yang tak ingin kamu lupa…"
        aria-describedby="note-help"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p id="note-help" className="font-mono text-[10px] leading-5 text-muted-foreground">
          {Array.from(content).length.toLocaleString('id-ID')} / 100.000 karakter
          {updatedAt && <> · {formatDate(updatedAt)}</>}
        </p>
        <Button variant="ghost" size="sm" onClick={download} disabled={!content}>
          <DownloadSimple size={16} />
          Unduh .txt
        </Button>
      </div>
      <InlineError message={error} />
      {status === 'error' && (
        <Button variant="secondary" className="mt-3" onClick={() => void save(content)}>
          Coba simpan lagi
        </Button>
      )}
      <p className="mt-5 text-xs leading-6 text-muted-foreground">
        Catatan disimpan otomatis setelah kamu berhenti mengetik. Draf yang belum terkirim
        dipertahankan di browser ini. Data tersimpan sebagai teks biasa di perangkat.
      </p>
    </div>
  )
}

export function ToolPanel(props: ToolPanelProps) {
  switch (props.id) {
    case 'json-formatter':
      return <JsonFormatter onActivity={props.onActivity} />
    case 'text-case':
      return <TextCase onActivity={props.onActivity} />
    case 'base64':
      return <Base64Tool onActivity={props.onActivity} />
    case 'password-generator':
      return <PasswordGenerator onActivity={props.onActivity} />
    case 'focus-timer':
      return <FocusTimer preferences={props.preferences} onActivity={props.onActivity} />
    case 'quick-note':
      return <QuickNote note={props.note} onSaveNote={props.onSaveNote} />
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowClockwise,
  Camera,
  CheckCircle,
  ClockCounterClockwise,
  DownloadSimple,
  Play,
  ShieldCheck,
  Stop,
  WarningCircle,
} from '@phosphor-icons/react'
import { api } from '../lib/api'
import type { CaptureSession, CaptureStatus } from '../lib/types'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

type Hotkey = 'ctrl+shift+s' | 'ctrl+alt+s'
type NativeState = CaptureStatus['state']
const activeStates: NativeState[] = ['starting', 'active', 'stopping']
const labels: Record<NativeState, string> = {
  idle: 'Belum dimulai',
  starting: 'Menyiapkan sesi…',
  active: 'Aktif',
  stopping: 'Mengakhiri sesi…',
  stopped: 'Sesi selesai',
  error: 'Sesi perlu diperiksa',
}
function message(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Permintaan belum berhasil. Coba lagi.'
}
function timestamp(value: string | null) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Belum tersedia'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Makassar',
  }).format(new Date(value))
}
function downloadUrl(value: string | null) {
  const prefix = '/api/capture/download/'
  return value?.startsWith(prefix) && /^[0-9a-f-]{36}$/i.test(value.slice(prefix.length))
    ? value
    : null
}
function InlineError({ value }: { value: string }) {
  return value ? (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-danger/5 px-4 py-3 text-xs leading-6 text-danger"
    >
      <WarningCircle size={17} className="mt-1 shrink-0" />
      {value}
    </p>
  ) : null
}

export default function CaptureStudio({ onActivity }: { onActivity?: (action: string) => void }) {
  const [capture, setCapture] = useState<CaptureStatus | null>(null)
  const [captures, setCaptures] = useState<CaptureSession[]>([])
  const [hotkey, setHotkey] = useState<Hotkey>('ctrl+shift+s')
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [connectionError, setConnectionError] = useState('')
  const [actionError, setActionError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const mutation = useRef(0)
  const inFlight = useRef(false)
  const historyRequest = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      const ticket = mutation.current
      let fast = false
      try {
        const next = await api.captureStatus()
        fast = activeStates.includes(next.state)
        if (active && !inFlight.current && ticket === mutation.current) {
          setCapture(next)
          setConnectionError('')
          setLoading(false)
        }
      } catch (caught) {
        if (active) {
          setConnectionError(message(caught))
          setLoading(false)
        }
      } finally {
        if (active) timer = setTimeout(() => void poll(), fast ? 1000 : 3000)
      }
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [revision])
  const loadHistory = useCallback(async () => {
    const ticket = ++historyRequest.current
    try {
      const result = await api.captureSessions()
      if (mounted.current && ticket === historyRequest.current) {
        setCaptures(result.items)
        setHistoryError('')
      }
    } catch (caught) {
      if (mounted.current && ticket === historyRequest.current) setHistoryError(message(caught))
    } finally {
      if (mounted.current && ticket === historyRequest.current) setHistoryLoading(false)
    }
  }, [])
  useEffect(() => {
    void loadHistory()
  }, [loadHistory, capture?.session_id, capture?.capture_count, capture?.state])
  async function action(name: string, run: () => Promise<CaptureStatus>, activity?: string) {
    if (inFlight.current) return
    inFlight.current = true
    mutation.current += 1
    setPending(name)
    setActionError('')
    try {
      const result = await run()
      if (!mounted.current) return
      setCapture(result)
      if (activity) onActivity?.(activity)
      void loadHistory()
    } catch (caught) {
      if (mounted.current) setActionError(message(caught))
    } finally {
      mutation.current += 1
      inFlight.current = false
      if (mounted.current) {
        setPending(null)
        setRevision((value) => value + 1)
      }
    }
  }
  const running = !!capture && activeStates.includes(capture.state)
  const currentDownload = downloadUrl(capture?.download_url ?? null)
  return (
    <div className="space-y-7">
      <InlineError value={connectionError} />
      {connectionError && (
        <Button variant="secondary" size="sm" onClick={() => setRevision((value) => value + 1)}>
          <ArrowClockwise size={16} />
          Coba hubungkan lagi
        </Button>
      )}
      {loading ? (
        <div
          role="status"
          aria-label="Memuat status capture"
          className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]"
        >
          <div className="skeleton min-h-64 rounded-2xl" />
          <div className="skeleton min-h-64 rounded-2xl" />
        </div>
      ) : (
        capture && (
          <>
            {!capture.supported && (
              <p
                role="status"
                className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-xs leading-6 text-muted-foreground"
              >
                Screenshot global memerlukan Windows. Tools lain tetap dapat digunakan.
              </p>
            )}
            <div className="grid grid-cols-1 gap-7 lg:grid-cols-[1.15fr_1fr]">
              <section
                className={cn(
                  'min-w-0 rounded-[28px] border p-6 sm:p-7',
                  running ? 'border-primary/20 bg-accent-soft' : 'border-border bg-background',
                )}
                aria-label="Status sesi"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-surface text-primary">
                    <Camera size={25} />
                  </span>
                  <span
                    className={cn(
                      'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px]',
                      running
                        ? 'border-primary/20 text-primary'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {running && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
                    {labels[capture.state]}
                  </span>
                </div>
                <h2 className="mt-7 text-xl font-medium tracking-tight">
                  Tangkap langkah. Susun laporan.
                </h2>
                <p className="mt-3 max-w-sm text-xs leading-7 text-muted-foreground">
                  Mulai sesi, lalu gunakan hotkey saat berpindah aplikasi. Setiap screenshot
                  ditambahkan dan disimpan otomatis ke satu dokumen Word.
                </p>
                <div className="mt-7 flex flex-wrap gap-x-8 gap-y-4 border-t border-border pt-5">
                  <div>
                    <p className="eyebrow">Screenshot tersimpan</p>
                    <p className="mt-2 font-mono text-2xl tracking-tight">
                      {capture.capture_count}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="eyebrow">Terakhir</p>
                    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                      {timestamp(capture.last_capture_at)}
                    </p>
                  </div>
                </div>
                {currentDownload && (
                  <Button asChild variant="secondary" className="mt-6">
                    <a href={currentDownload} download>
                      <DownloadSimple size={17} />
                      Unduh DOCX sesi ini
                    </a>
                  </Button>
                )}
              </section>
              <section className="min-w-0 space-y-5" aria-label="Pengaturan screenshot">
                <div className="flex flex-col gap-2">
                  <label htmlFor="capture-hotkey" className="field-label">
                    Kombinasi tombol screenshot
                  </label>
                  <select
                    id="capture-hotkey"
                    value={running ? capture.hotkey : hotkey}
                    onChange={(event) => setHotkey(event.target.value as Hotkey)}
                    disabled={running || pending !== null || !capture.supported}
                    className="field"
                  >
                    <option value="ctrl+shift+s">Ctrl + Shift + S</option>
                    <option value="ctrl+alt+s">Ctrl + Alt + S</option>
                  </select>
                  <p className="text-[11px] leading-6 text-muted-foreground">
                    Jika kombinasi dipakai aplikasi lain, pilih alternatif sebelum memulai sesi.
                  </p>
                </div>
                {running ? (
                  <div className="space-y-3">
                    <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs leading-6 text-foreground">
                      Hotkey aktif:{' '}
                      <span className="font-mono">
                        {capture.hotkey.toUpperCase().replaceAll('+', ' + ')}
                      </span>
                    </p>
                    <Button
                      className="w-full"
                      disabled={pending !== null || capture.state !== 'active' || capture.busy}
                      onClick={() => void action('capture-take', api.captureTake)}
                    >
                      <Camera size={17} />
                      {pending === 'capture-take' || capture.busy
                        ? 'Menyimpan screenshot…'
                        : 'Ambil sekarang'}
                    </Button>
                    <Button
                      className="w-full"
                      variant="danger"
                      disabled={pending !== null || capture.state === 'stopping'}
                      onClick={() =>
                        void action('capture-stop', api.captureStop, 'Menghentikan sesi screenshot')
                      }
                    >
                      <Stop size={17} />
                      {pending === 'capture-stop' ? 'Menghentikan…' : 'Hentikan dan simpan'}
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    disabled={pending !== null || !capture.supported || !!connectionError}
                    onClick={() =>
                      void action(
                        'capture-start',
                        () => api.captureStart(hotkey),
                        'Memulai sesi screenshot ke DOCX',
                      )
                    }
                  >
                    <Play size={17} />
                    {pending === 'capture-start' ? 'Menyiapkan…' : 'Mulai sesi screenshot'}
                  </Button>
                )}
                <p className="flex items-start gap-2 text-[11px] leading-6 text-muted-foreground">
                  <CheckCircle size={16} className="mt-1 shrink-0 text-primary" />
                  DOCX disimpan setelah setiap tangkapan. Hentikan sesi setelah pekerjaan selesai
                  untuk melepaskan hotkey.
                </p>
                <InlineError value={actionError || capture.error || ''} />
              </section>
            </div>
          </>
        )
      )}
      <section className="border-t border-border pt-7" aria-label="Riwayat sesi">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow mb-2">Tersimpan di perangkat ini</p>
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <ClockCounterClockwise size={18} />
              Riwayat sesi screenshot
            </h2>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadHistory()}>
            <ArrowClockwise size={15} />
            Muat ulang riwayat
          </Button>
        </div>
        <InlineError value={historyError} />
        {historyLoading ? (
          <div role="status" aria-label="Memuat riwayat sesi" className="space-y-3">
            {[0, 1, 2].map((value) => (
              <div key={value} className="skeleton h-16 w-full" />
            ))}
          </div>
        ) : captures.length ? (
          <div className="divide-y divide-border">
            {captures.map((session) => (
              <article key={session.id} className="flex flex-wrap items-center gap-4 py-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
                  <Camera size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{timestamp(session.created_at)}</p>
                  <p className="mt-1 text-[11px] leading-6 text-muted-foreground">
                    {session.capture_count} screenshot · {labels[session.state]}
                  </p>
                </div>
                {downloadUrl(session.download_url) ? (
                  <Button asChild variant="secondary" size="sm">
                    <a href={downloadUrl(session.download_url)!} download>
                      <DownloadSimple size={15} />
                      Unduh DOCX
                    </a>
                  </Button>
                ) : (
                  <span className="text-[10px] text-muted-foreground">Belum ada berkas</span>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
            <p className="text-sm font-medium">Belum ada sesi screenshot.</p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              Mulai sesi secara manual. Hasilnya akan muncul di sini setelah ada yang tersimpan.
            </p>
          </div>
        )}
      </section>
      <p className="flex items-start gap-2 text-[11px] leading-6 text-muted-foreground">
        <ShieldCheck size={16} className="mt-1 shrink-0 text-primary" />
        Sesi berlangsung lokal. Screenshot hanya diambil melalui hotkey atau tombol Ambil sekarang
        selama sesi aktif.
      </p>
    </div>
  )
}

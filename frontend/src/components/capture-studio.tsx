import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowClockwise,
  Camera,
  CheckCircle,
  ClockCounterClockwise,
  DownloadSimple,
  Keyboard,
  Play,
  ShieldCheck,
  Stop,
  WarningCircle,
} from '@phosphor-icons/react'
import { api } from '../lib/api'
import type { CaptureSession, CaptureStatus, KeyboardSession, KeyboardStatus } from '../lib/types'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

type Tab = 'screenshot' | 'keyboard'
type Hotkey = 'ctrl+shift+s' | 'ctrl+alt+s'
type Application = { name: string; label: string; running: boolean }
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
function downloadUrl(value: string | null, keyboard: boolean) {
  if (!value) return null
  const prefix = keyboard ? '/api/capture/keyboard/download/' : '/api/capture/download/'
  return value.startsWith(prefix) && /^[0-9a-f-]{36}$/i.test(value.slice(prefix.length))
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
  const [tab, setTab] = useState<Tab>('screenshot')
  const [capture, setCapture] = useState<CaptureStatus | null>(null)
  const [keyboard, setKeyboard] = useState<KeyboardStatus | null>(null)
  const [captures, setCaptures] = useState<CaptureSession[]>([])
  const [keyboardSessions, setKeyboardSessions] = useState<KeyboardSession[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
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
        const [nextCapture, nextKeyboard] = await Promise.all([
          api.captureStatus(),
          api.keyboardStatus(),
        ])
        fast = activeStates.includes(nextCapture.state) || activeStates.includes(nextKeyboard.state)
        if (active && !inFlight.current && ticket === mutation.current) {
          setCapture(nextCapture)
          setKeyboard(nextKeyboard)
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
  useEffect(() => {
    let active = true
    void api
      .keyboardApps()
      .then((result) => {
        if (active) setApplications(result.items)
      })
      .catch((caught) => {
        if (active) setActionError(message(caught))
      })
    return () => {
      active = false
    }
  }, [revision])

  const loadHistory = useCallback(async () => {
    const ticket = ++historyRequest.current
    try {
      const [nextCapture, nextKeyboard] = await Promise.all([
        api.captureSessions(),
        api.keyboardSessions(),
      ])
      if (mounted.current && ticket === historyRequest.current) {
        setCaptures(nextCapture.items)
        setKeyboardSessions(nextKeyboard.items)
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
  }, [
    loadHistory,
    capture?.session_id,
    capture?.capture_count,
    capture?.state,
    keyboard?.session_id,
    keyboard?.line_count,
    keyboard?.state,
  ])

  async function action(
    name: string,
    run: () => Promise<CaptureStatus | KeyboardStatus>,
    kind: Tab,
    activity?: string,
  ) {
    if (inFlight.current) return
    inFlight.current = true
    mutation.current += 1
    setPending(name)
    setActionError('')
    try {
      const status = await run()
      if (!mounted.current) return
      if (kind === 'screenshot') setCapture(status as CaptureStatus)
      else {
        setKeyboard(status as KeyboardStatus)
        setAcknowledged(false)
      }
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

  const captureRunning = !!capture && activeStates.includes(capture.state)
  const keyboardRunning = !!keyboard && activeStates.includes(keyboard.state)
  const current = tab === 'screenshot' ? capture : keyboard
  const running = tab === 'screenshot' ? captureRunning : keyboardRunning
  const currentDownload = downloadUrl(current?.download_url ?? null, tab === 'keyboard')

  return (
    <div className="space-y-7">
      {keyboardRunning && (
        <div
          role="status"
          className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-accent-soft p-5 sm:flex-row sm:items-center"
        >
          <Keyboard size={24} className="shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-primary">Perekaman input AKTIF</p>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              Hentikan sebelum memasukkan data sensitif. Tombol darurat:{' '}
              <span className="font-mono text-foreground">Ctrl + Alt + Shift + K</span>.
            </p>
          </div>
          <Button
            variant="danger"
            disabled={pending !== null || keyboard?.state === 'stopping'}
            onClick={() =>
              void action('keyboard-stop', api.keyboardStop, 'keyboard', 'Menghentikan sesi input')
            }
          >
            <Stop size={17} />
            Hentikan input
          </Button>
        </div>
      )}
      <div
        role="group"
        aria-label="Jenis sesi capture"
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-muted p-1"
      >
        {(
          [
            { id: 'screenshot', label: 'Screenshot ke DOCX', icon: Camera },
            { id: 'keyboard', label: 'Perekam input', icon: Keyboard },
          ] as const
        ).map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => {
              setTab(item.id)
              setActionError('')
            }}
            aria-pressed={tab === item.id}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-medium transition-colors',
              tab === item.id
                ? 'bg-surface text-primary shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <item.icon size={17} />
            {item.label}
          </button>
        ))}
      </div>
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
        current && (
          <>
            {!current.supported && (
              <p
                role="status"
                className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-xs leading-6 text-muted-foreground"
              >
                Sesi native ini memerlukan Windows. Tools lain tetap dapat digunakan.
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
                    {tab === 'screenshot' ? <Camera size={25} /> : <Keyboard size={25} />}
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
                    {labels[current.state]}
                  </span>
                </div>
                <h2 className="mt-7 text-xl font-medium tracking-tight">
                  {tab === 'screenshot'
                    ? 'Tangkap langkah. Susun laporan.'
                    : 'Tinjau input selama bekerja.'}
                </h2>
                <p className="mt-3 max-w-sm text-xs leading-7 text-muted-foreground">
                  {tab === 'screenshot'
                    ? 'Mulai sesi, lalu gunakan hotkey saat berpindah aplikasi. Setiap screenshot ditambahkan dan disimpan otomatis ke satu dokumen Word.'
                    : 'Perekaman hanya berjalan setelah kamu memulainya dan hanya untuk aplikasi yang dipilih. Tidak ada sesi otomatis saat membuka Ruang.'}
                </p>
                <div className="mt-7 flex flex-wrap gap-x-8 gap-y-4 border-t border-border pt-5">
                  <div>
                    <p className="eyebrow">
                      {tab === 'screenshot' ? 'Screenshot tersimpan' : 'Baris tercatat'}
                    </p>
                    <p className="mt-2 font-mono text-2xl tracking-tight">
                      {tab === 'screenshot'
                        ? (capture?.capture_count ?? 0)
                        : (keyboard?.line_count ?? 0)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="eyebrow">Terakhir</p>
                    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                      {timestamp(
                        tab === 'screenshot'
                          ? (capture?.last_capture_at ?? null)
                          : (keyboard?.last_recorded_at ?? null),
                      )}
                    </p>
                  </div>
                </div>
                {currentDownload && (
                  <Button asChild variant="secondary" className="mt-6">
                    <a href={currentDownload} download>
                      <DownloadSimple size={17} />
                      {tab === 'screenshot' ? 'Unduh DOCX sesi ini' : 'Unduh log sesi ini'}
                    </a>
                  </Button>
                )}
              </section>
              <section
                className="min-w-0 space-y-5"
                aria-label={
                  tab === 'screenshot' ? 'Pengaturan screenshot' : 'Pengaturan perekaman input'
                }
              >
                {tab === 'screenshot' ? (
                  <>
                    <div className="flex flex-col gap-2">
                      <label htmlFor="capture-hotkey" className="field-label">
                        Kombinasi tombol screenshot
                      </label>
                      <select
                        id="capture-hotkey"
                        value={captureRunning ? (capture?.hotkey ?? hotkey) : hotkey}
                        onChange={(event) => setHotkey(event.target.value as Hotkey)}
                        disabled={captureRunning || pending !== null || !capture?.supported}
                        className="field"
                      >
                        <option value="ctrl+shift+s">Ctrl + Shift + S</option>
                        <option value="ctrl+alt+s">Ctrl + Alt + S</option>
                      </select>
                      <p className="text-[11px] leading-6 text-muted-foreground">
                        Jika kombinasi dipakai aplikasi lain, pilih alternatif sebelum memulai sesi.
                      </p>
                    </div>
                    {captureRunning ? (
                      <div className="space-y-3">
                        <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs leading-6 text-foreground">
                          Hotkey aktif:{' '}
                          <span className="font-mono">
                            {capture?.hotkey.toUpperCase().replaceAll('+', ' + ')}
                          </span>
                        </p>
                        <Button
                          className="w-full"
                          disabled={
                            pending !== null || capture?.state !== 'active' || capture?.busy
                          }
                          onClick={() => void action('capture-take', api.captureTake, 'screenshot')}
                        >
                          <Camera size={17} />
                          {pending === 'capture-take' || capture?.busy
                            ? 'Menyimpan screenshot…'
                            : 'Ambil sekarang'}
                        </Button>
                        <Button
                          className="w-full"
                          variant="danger"
                          disabled={pending !== null || capture?.state === 'stopping'}
                          onClick={() =>
                            void action(
                              'capture-stop',
                              api.captureStop,
                              'screenshot',
                              'Menghentikan sesi screenshot',
                            )
                          }
                        >
                          <Stop size={17} />
                          {pending === 'capture-stop' ? 'Menghentikan…' : 'Hentikan dan simpan'}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        className="w-full"
                        disabled={pending !== null || !capture?.supported || !!connectionError}
                        onClick={() =>
                          void action(
                            'capture-start',
                            () => api.captureStart(hotkey),
                            'screenshot',
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
                      DOCX disimpan setelah setiap tangkapan. Hentikan sesi setelah pekerjaan
                      selesai untuk melepaskan hotkey.
                    </p>
                  </>
                ) : (
                  <>
                    <fieldset
                      disabled={keyboardRunning || pending !== null || !keyboard?.supported}
                      className="space-y-3"
                    >
                      <legend className="field-label mb-3">Aplikasi yang boleh direkam</legend>
                      <p className="text-[11px] leading-6 text-muted-foreground">
                        Pilih satu atau beberapa aplikasi. Tidak ada aplikasi yang dipilih secara
                        otomatis.
                      </p>
                      <div className="divide-y divide-border rounded-2xl border border-border px-4">
                        {applications.map((app) => (
                          <label
                            key={app.name}
                            className="flex cursor-pointer items-center gap-3 py-3 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={
                                keyboardRunning
                                  ? keyboard?.applications.includes(app.name)
                                  : selected.includes(app.name)
                              }
                              onChange={(event) =>
                                setSelected((previous) =>
                                  event.target.checked
                                    ? [...previous, app.name]
                                    : previous.filter((name) => name !== app.name),
                                )
                              }
                              className="size-4 accent-primary"
                            />
                            <span className="min-w-0 flex-1">{app.label}</span>
                            <span className="text-[9px] text-muted-foreground">
                              {app.running ? 'Terbuka' : 'Belum terbuka'}
                            </span>
                          </label>
                        ))}
                        {!applications.length && (
                          <div className="py-4 text-xs leading-6 text-muted-foreground">
                            <p>Daftar aplikasi belum tersedia.</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-2"
                              onClick={() => setRevision((value) => value + 1)}
                            >
                              <ArrowClockwise size={15} />
                              Muat ulang aplikasi
                            </Button>
                          </div>
                        )}
                      </div>
                    </fieldset>
                    <div className="rounded-xl border border-border bg-background px-4 py-3 text-[11px] leading-6 text-muted-foreground">
                      <p>
                        Isi clipboard tidak dibaca. Pendeteksian kolom password dilakukan sebisanya
                        dan tidak dapat menjamin rahasia pada terminal tersaring.
                      </p>
                      <p className="mt-2 font-medium text-foreground">
                        Hentikan perekaman sebelum mengetik password, token, atau informasi
                        sensitif.
                      </p>
                    </div>
                    {!keyboardRunning && (
                      <label className="flex cursor-pointer items-start gap-3 text-xs leading-6">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(event) => setAcknowledged(event.target.checked)}
                          disabled={pending !== null || !keyboard?.supported}
                          className="mt-1 size-4 shrink-0 accent-primary"
                        />
                        <span>
                          Saya memahami cakupannya dan akan menghentikan sesi sebelum memasukkan
                          informasi sensitif.
                        </span>
                      </label>
                    )}
                    <Button
                      className="w-full"
                      variant={keyboardRunning ? 'danger' : 'default'}
                      disabled={
                        pending !== null ||
                        !keyboard?.supported ||
                        !!connectionError ||
                        (keyboardRunning
                          ? keyboard?.state === 'stopping'
                          : !selected.length || !acknowledged || !applications.length)
                      }
                      onClick={() =>
                        void (keyboardRunning
                          ? action(
                              'keyboard-stop',
                              api.keyboardStop,
                              'keyboard',
                              'Menghentikan sesi input',
                            )
                          : action(
                              'keyboard-start',
                              () => api.keyboardStart(selected),
                              'keyboard',
                              'Memulai sesi input aplikasi pilihan',
                            ))
                      }
                    >
                      {keyboardRunning ? <Stop size={17} /> : <Play size={17} />}
                      {pending === 'keyboard-start'
                        ? 'Menyiapkan…'
                        : pending === 'keyboard-stop'
                          ? 'Menghentikan…'
                          : keyboardRunning
                            ? 'Hentikan perekaman input'
                            : 'Mulai perekaman input'}
                    </Button>
                  </>
                )}
                <InlineError value={actionError || current.error || ''} />
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
              Riwayat sesi {tab === 'screenshot' ? 'screenshot' : 'input'}
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
        ) : (tab === 'screenshot' ? captures.length : keyboardSessions.length) ? (
          <div className="divide-y divide-border">
            {tab === 'screenshot'
              ? captures.map((session) => (
                  <SessionRow
                    key={session.id}
                    createdAt={session.created_at}
                    count={session.capture_count}
                    state={session.state}
                    url={downloadUrl(session.download_url, false)}
                    keyboard={false}
                  />
                ))
              : keyboardSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    createdAt={session.created_at}
                    count={session.line_count}
                    state={session.state}
                    url={downloadUrl(session.download_url, true)}
                    keyboard
                    applications={session.applications
                      .map((name) => applications.find((app) => app.name === name)?.label ?? name)
                      .join(', ')}
                  />
                ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
            <p className="text-sm font-medium">
              Belum ada sesi {tab === 'screenshot' ? 'screenshot' : 'input'}.
            </p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              Mulai sesi secara manual. Hasilnya akan muncul di sini setelah ada yang tersimpan.
            </p>
          </div>
        )}
      </section>
      <p className="flex items-start gap-2 text-[11px] leading-6 text-muted-foreground">
        <ShieldCheck size={16} className="mt-1 shrink-0 text-primary" />
        Sesi berlangsung lokal. Status aktif tetap terlihat di Ruang; perekam input juga menampilkan
        indikator native dan tombol berhenti darurat.
      </p>
    </div>
  )
}

function SessionRow({
  createdAt,
  count,
  state,
  url,
  keyboard,
  applications,
}: {
  createdAt: string | null
  count: number
  state: NativeState
  url: string | null
  keyboard: boolean
  applications?: string
}) {
  return (
    <article className="flex flex-wrap items-center gap-4 py-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
        {keyboard ? <Keyboard size={20} /> : <Camera size={20} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{timestamp(createdAt)}</p>
        <p className="mt-1 text-[11px] leading-6 text-muted-foreground">
          {count} {keyboard ? 'baris' : 'screenshot'} · {labels[state]}
          {applications && <span className="block break-words">{applications}</span>}
        </p>
      </div>
      {url ? (
        <Button asChild variant="secondary" size="sm">
          <a href={url} download>
            <DownloadSimple size={15} />
            Unduh {keyboard ? 'TXT' : 'DOCX'}
          </a>
        </Button>
      ) : (
        <span className="text-[10px] text-muted-foreground">Belum ada berkas</span>
      )}
    </article>
  )
}

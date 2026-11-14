'use client'

import { useEffect, useId, useRef, useState } from 'react'
import {
  ArrowsLeftRight,
  CalendarBlank,
  Check,
  Copy,
  DownloadSimple,
  FileArrowUp,
  Fingerprint,
  Hash,
  LinkSimple,
  TextAlignLeft,
  WarningCircle,
} from '@phosphor-icons/react'
import { Button } from './ui/button'
import { cn, copyText } from '../lib/utils'
import {
  csvToJson,
  decodeTextFile,
  dateInterval,
  decodeUrlComponent,
  describeTimestamp,
  encodeUrlComponent,
  generateUuids,
  inspectUrl,
  jsonToCsv,
  MAX_FILE_BYTES,
  parseEpoch,
  parseIsoTimestamp,
  sha256,
  type CsvDelimiter,
} from '../lib/daily-tools'

export type DailyUtilityId = 'csv-json' | 'date-time' | 'url-tools' | 'uuid-generator' | 'file-hash'
type ActivityCallback = (action: string) => void

function message(caught: unknown) {
  return caught instanceof Error
    ? caught.message
    : 'Proses belum berhasil. Periksa input dan coba lagi.'
}

function ErrorNotice({ value }: { value: string }) {
  return value ? (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-danger/5 px-4 py-3 text-[13px] leading-6 text-danger"
    >
      <WarningCircle size={18} className="mt-0.5 shrink-0" />
      {value}
    </p>
  ) : null
}

function downloadText(value: string, filename: string, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([value], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function CopyValue({ value, label = 'Salin' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timeout.current), [])
  useEffect(() => {
    setCopied(false)
    setError('')
  }, [value])
  return (
    <div className="min-w-0">
      <Button
        size="sm"
        variant="secondary"
        disabled={!value}
        onClick={() => {
          void copyText(value)
            .then(() => {
              setCopied(true)
              setError('')
              clearTimeout(timeout.current)
              timeout.current = setTimeout(() => setCopied(false), 1800)
            })
            .catch(() => setError('Pilih dan salin hasil secara manual.'))
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? 'Tersalin' : label}
      </Button>
      {error && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  )
}

function OutputBox({
  value,
  filename = 'hasil-ruang.txt',
  label = 'Hasil',
  csv = false,
}: {
  value: string
  filename?: string
  label?: string
  csv?: boolean
}) {
  const id = useId()
  return (
    <section className="min-w-0">
      <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <CopyValue value={value} />
          <Button
            variant="ghost"
            size="sm"
            disabled={!value}
            aria-label={`Unduh ${label.toLocaleLowerCase('id')}`}
            onClick={() =>
              downloadText(
                csv ? '\uFEFF' + value : value,
                filename,
                csv ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
              )
            }
          >
            <DownloadSimple size={16} />
            <span className="hidden sm:inline">Unduh</span>
          </Button>
        </div>
      </div>
      {value ? (
        <textarea
          id={id}
          className="code-editor min-h-80"
          readOnly
          value={value}
          spellCheck={false}
        />
      ) : (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background px-6 py-9 text-center">
          <TextAlignLeft size={28} className="mb-4 text-muted-foreground/50" />
          <p className="text-sm font-medium">Hasil yang siap dipakai.</p>
          <p className="mt-2 max-w-60 text-xs leading-6 text-muted-foreground">
            Masukkan datamu, lalu jalankan alat. Seluruh proses berlangsung di browser.
          </p>
        </div>
      )}
    </section>
  )
}

function Segmented({
  value,
  onChange,
  options,
  label,
}: {
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; label: string }[]
  label: string
}) {
  return (
    <div
      className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-muted p-1"
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:px-4',
            value === option.value
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function CsvPanel({ onActivity }: { onActivity: ActivityCallback }) {
  const [mode, setMode] = useState<'to-json' | 'to-csv'>('to-json')
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [protect, setProtect] = useState(true)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current += 1
    },
    [],
  )
  function convert() {
    try {
      setOutput(
        mode === 'to-json' ? csvToJson(input, delimiter) : jsonToCsv(input, delimiter, protect),
      )
      setError('')
      onActivity(mode === 'to-json' ? 'Mengubah CSV ke JSON' : 'Mengubah JSON ke CSV')
    } catch (caught) {
      setError(message(caught))
      setOutput('')
    }
  }
  async function read(file?: File) {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      setError('File input maksimal 4 MB.')
      return
    }
    const current = ++request.current
    setReading(true)
    try {
      const content = decodeTextFile(await file.arrayBuffer())
      if (current !== request.current) return
      if (content.length > 1_000_000) throw new Error('Input maksimal 1 juta karakter.')
      setInput(content)
      setOutput('')
      setError('')
    } catch (caught) {
      if (current === request.current) setError(message(caught))
    } finally {
      if (current === request.current) setReading(false)
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Segmented
          label="Arah konversi CSV"
          value={mode}
          onChange={(value) => {
            setMode(value as typeof mode)
            setOutput('')
            setError('')
          }}
          options={[
            { value: 'to-json', label: 'CSV ke JSON' },
            { value: 'to-csv', label: 'JSON ke CSV' },
          ]}
        />
        <div className="flex flex-col gap-2">
          <label htmlFor="csv-delimiter" className="field-label">
            Pemisah kolom CSV
          </label>
          <select
            id="csv-delimiter"
            className="field min-w-40 py-2"
            value={delimiter}
            onChange={(event) => {
              setDelimiter(event.target.value as CsvDelimiter)
              setOutput('')
            }}
          >
            <option value=",">Koma (,)</option>
            <option value=";">Titik koma (;)</option>
            <option value={'\t'}>Tab</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-2">
            <label htmlFor="csv-input" className="field-label">
              {mode === 'to-json' ? 'CSV dengan header' : 'Array objek JSON'}
            </label>
            <label
              className={cn(
                'inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted',
                reading && 'pointer-events-none opacity-50',
              )}
            >
              <FileArrowUp size={16} />
              Buka file
              <input
                className="sr-only"
                type="file"
                accept=".csv,.json,.tsv,text/csv,text/tab-separated-values,application/json"
                aria-label="Buka file CSV atau JSON"
                disabled={reading}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  void read(file)
                }}
              />
            </label>
          </div>
          {reading ? (
            <div
              role="status"
              aria-label="Memuat isi file"
              className="skeleton min-h-80 rounded-2xl"
            />
          ) : (
            <textarea
              id="csv-input"
              className="code-editor min-h-80"
              value={input}
              onChange={(event) => {
                setInput(event.target.value)
                setOutput('')
              }}
              maxLength={1_000_000}
              spellCheck={false}
              placeholder={
                mode === 'to-json'
                  ? 'id,nama\n0017,Rahayu'
                  : '[\n  { "id": "0017", "nama": "Rahayu" }\n]'
              }
            />
          )}
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            Maksimal 10.000 baris, 100 kolom, dan 1 juta karakter. Nilai CSV tetap berupa teks,
            termasuk nol di depan.
          </p>
        </div>
        <OutputBox
          value={output}
          filename={mode === 'to-json' ? 'data-ruang.json' : 'data-ruang.csv'}
          csv={mode === 'to-csv'}
        />
      </div>
      {mode === 'to-csv' && (
        <div className="rounded-xl border border-border bg-background px-4 py-3">
          <label className="flex cursor-pointer items-start gap-3 text-xs leading-6">
            <input
              type="checkbox"
              checked={protect}
              onChange={(event) => {
                setProtect(event.target.checked)
                setOutput('')
              }}
              className="mt-1 size-4 shrink-0 accent-primary"
            />
            <span>
              <span className="block font-medium">Lindungi sel dari formula spreadsheet</span>
              <span className="text-muted-foreground">
                Tambahkan apostrof pada sel yang dimulai dengan =, +, -, @, tab, atau carriage
                return. Matikan hanya bila kamu memang memerlukan nilai aslinya.
              </span>
            </span>
          </label>
        </div>
      )}
      <ErrorNotice value={error} />
      <Button disabled={reading || !input.trim()} onClick={convert}>
        <ArrowsLeftRight size={17} />
        {mode === 'to-json' ? 'Ubah ke JSON' : 'Ubah ke CSV'}
      </Button>
    </div>
  )
}

function TimestampValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="eyebrow mb-2">{label}</p>
        <p className="break-all font-mono text-[13px] leading-6">{value}</p>
      </div>
      <CopyValue value={value} />
    </div>
  )
}

function DateTimePanel({ onActivity }: { onActivity: ActivityCallback }) {
  const [mode, setMode] = useState<'epoch' | 'iso'>('epoch')
  const [unit, setUnit] = useState<'seconds' | 'milliseconds'>('milliseconds')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<ReturnType<typeof describeTimestamp> | null>(null)
  const [error, setError] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [interval, setIntervalResult] = useState<ReturnType<typeof dateInterval> | null>(null)
  const [intervalError, setIntervalError] = useState('')
  function convert() {
    try {
      setResult(
        describeTimestamp(mode === 'epoch' ? parseEpoch(input, unit) : parseIsoTimestamp(input)),
      )
      setError('')
      onActivity('Mengonversi tanggal dan timestamp')
    } catch (caught) {
      setError(message(caught))
      setResult(null)
    }
  }
  return (
    <div className="space-y-8">
      <section className="grid grid-cols-1 gap-7 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="min-w-0 space-y-5">
          <Segmented
            label="Jenis timestamp"
            value={mode}
            onChange={(value) => {
              setMode(value as typeof mode)
              setInput('')
              setResult(null)
              setError('')
            }}
            options={[
              { value: 'epoch', label: 'Unix epoch' },
              { value: 'iso', label: 'Tanggal ISO' },
            ]}
          />
          {mode === 'epoch' && (
            <div className="flex flex-col gap-2">
              <label htmlFor="epoch-unit" className="field-label">
                Satuan epoch
              </label>
              <select
                id="epoch-unit"
                value={unit}
                className="field"
                onChange={(event) => {
                  setUnit(event.target.value as typeof unit)
                  setResult(null)
                }}
              >
                <option value="milliseconds">Milidetik</option>
                <option value="seconds">Detik</option>
              </select>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label className="field-label" htmlFor="timestamp-input">
              {mode === 'epoch' ? 'Nilai timestamp' : 'Tanggal dan zona waktu'}
            </label>
            <input
              id="timestamp-input"
              className="field font-mono text-[13px]"
              value={input}
              maxLength={100}
              onChange={(event) => {
                setInput(event.target.value)
                setResult(null)
              }}
              placeholder={
                mode === 'epoch' ? 'Tempel nilai Unix epoch…' : '2026-11-14T09:30:00+08:00'
              }
            />
            <p className="text-xs leading-6 text-muted-foreground">
              {mode === 'epoch'
                ? 'Satuan dipilih secara eksplisit agar detik dan milidetik tidak tertukar.'
                : 'Zona waktu wajib ditulis: Z untuk UTC atau offset seperti +08:00.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={convert} disabled={!input.trim()}>
              <CalendarBlank size={17} />
              Konversi
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const now = Date.now()
                setInput(
                  mode === 'iso'
                    ? new Date(now).toISOString()
                    : String(unit === 'milliseconds' ? now : Math.floor(now / 1000)),
                )
                setResult(null)
                setError('')
              }}
            >
              Gunakan waktu sekarang
            </Button>
          </div>
          <ErrorNotice value={error} />
        </div>
        <div className="min-w-0 rounded-2xl border border-border bg-background px-5 py-2">
          {result ? (
            <>
              <TimestampValue label="ISO 8601 · UTC" value={result.iso} />
              <TimestampValue label="Epoch detik" value={String(result.seconds)} />
              <TimestampValue label="Epoch milidetik" value={String(result.milliseconds)} />
              {result.zones.map((zone) => (
                <div key={zone.zone} className="border-b border-border py-4 last:border-0">
                  <p className="eyebrow mb-2">{zone.label}</p>
                  <p className="text-[13px] leading-6">{zone.value}</p>
                </div>
              ))}
            </>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center py-8 text-center">
              <CalendarBlank size={30} className="mb-4 text-muted-foreground/50" />
              <p className="text-sm font-medium">Satu waktu, beberapa zona.</p>
              <p className="mt-2 max-w-60 text-xs leading-6 text-muted-foreground">
                Hasil tersedia dalam UTC, WITA, dan WIB setelah kamu menjalankan konversi.
              </p>
            </div>
          )}
        </div>
      </section>
      <section className="border-t border-border pt-7">
        <h2 className="text-base font-medium tracking-tight">Hitung jarak antartanggal</h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          Hari kerja menghitung Senin–Jumat dari tanggal yang lebih awal hingga sebelum tanggal yang
          lebih akhir. Tanda hasil mengikuti urutan input. Hari libur nasional belum diperhitungkan.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <label className="field-label" htmlFor="date-start">
              Tanggal awal
            </label>
            <input
              id="date-start"
              type="date"
              className="field min-w-0"
              value={start}
              onChange={(event) => {
                setStart(event.target.value)
                setIntervalResult(null)
              }}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <label className="field-label" htmlFor="date-end">
              Tanggal akhir
            </label>
            <input
              id="date-end"
              type="date"
              className="field min-w-0"
              value={end}
              onChange={(event) => {
                setEnd(event.target.value)
                setIntervalResult(null)
              }}
            />
          </div>
        </div>
        <Button
          variant="secondary"
          className="mt-4"
          disabled={!start || !end}
          onClick={() => {
            try {
              setIntervalResult(dateInterval(start, end))
              setIntervalError('')
              onActivity('Menghitung jarak tanggal')
            } catch (caught) {
              setIntervalError(message(caught))
              setIntervalResult(null)
            }
          }}
        >
          Hitung selisih
        </Button>
        {interval && (
          <div className="mt-6 flex flex-wrap gap-x-10 gap-y-5 border-t border-border pt-5">
            <div>
              <p className="eyebrow">Selisih hari</p>
              <p className="mt-2 font-mono text-2xl">{interval.days}</p>
            </div>
            <div>
              <p className="eyebrow">Hari kerja</p>
              <p className="mt-2 font-mono text-2xl">{interval.weekdays}</p>
            </div>
            <div>
              <p className="eyebrow">Termasuk kedua tanggal</p>
              <p className="mt-2 font-mono text-2xl">{interval.inclusiveDays}</p>
            </div>
          </div>
        )}
        <div className="mt-4">
          <ErrorNotice value={intervalError} />
        </div>
      </section>
    </div>
  )
}

function UrlPanel({ onActivity }: { onActivity: ActivityCallback }) {
  const [mode, setMode] = useState<'encode' | 'decode' | 'inspect'>('encode')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [inspected, setInspected] = useState<ReturnType<typeof inspectUrl> | null>(null)
  const [error, setError] = useState('')
  function run() {
    try {
      if (mode === 'inspect') {
        setInspected(inspectUrl(input))
        setOutput('')
      } else {
        setOutput(mode === 'encode' ? encodeUrlComponent(input) : decodeUrlComponent(input))
        setInspected(null)
      }
      setError('')
      onActivity(
        mode === 'inspect'
          ? 'Memeriksa struktur URL'
          : mode === 'encode'
            ? 'Encode komponen URL'
            : 'Decode komponen URL',
      )
    } catch (caught) {
      setError(message(caught))
      setOutput('')
      setInspected(null)
    }
  }
  return (
    <div className="space-y-6">
      <Segmented
        label="Mode alat URL"
        value={mode}
        onChange={(value) => {
          setMode(value as typeof mode)
          setOutput('')
          setInspected(null)
          setError('')
        }}
        options={[
          { value: 'encode', label: 'Encode' },
          { value: 'decode', label: 'Decode' },
          { value: 'inspect', label: 'Periksa URL' },
        ]}
      />
      <div className={cn('grid grid-cols-1 gap-6', mode !== 'inspect' && 'xl:grid-cols-2')}>
        <div className="min-w-0">
          <label className="field-label mb-3 block" htmlFor="url-input">
            {mode === 'inspect'
              ? 'URL lengkap'
              : mode === 'encode'
                ? 'Teks komponen URL'
                : 'Komponen URL ter-encode'}
          </label>
          <textarea
            id="url-input"
            className={cn('code-editor', mode === 'inspect' ? 'min-h-36' : 'min-h-80')}
            value={input}
            maxLength={mode === 'inspect' ? 100_000 : 1_000_000}
            spellCheck={false}
            onChange={(event) => {
              setInput(event.target.value)
              setOutput('')
              setInspected(null)
            }}
            placeholder={
              mode === 'inspect'
                ? 'https://example.com/cari?q=ruang+kerja&halaman=2'
                : mode === 'encode'
                  ? 'Teks dengan spasi, simbol, atau karakter lain…'
                  : 'Tempel komponen URL yang ingin di-decode…'
            }
          />
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            {mode === 'inspect'
              ? 'Parameter berulang tetap ditampilkan. URL hanya diperiksa sebagai teks dan tidak dibuka.'
              : 'Mode komponen menggunakan percent encoding. Tanda + tetap + saat decode; gunakan Periksa URL untuk membaca query string.'}
          </p>
        </div>
        {mode !== 'inspect' && <OutputBox value={output} filename="komponen-url.txt" />}
      </div>
      <ErrorNotice value={error} />
      <Button onClick={run} disabled={!input}>
        <LinkSimple size={17} />
        {mode === 'inspect'
          ? 'Periksa URL'
          : mode === 'encode'
            ? 'Encode komponen'
            : 'Decode komponen'}
      </Button>
      {inspected && (
        <section className="min-w-0 border-t border-border pt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Struktur URL</h2>
            <CopyValue value={JSON.stringify(inspected, null, 2)} label="Salin detail" />
          </div>
          <dl className="divide-y divide-border">
            {[
              { label: 'Protokol', value: inspected.protocol },
              { label: 'Host', value: inspected.host },
              { label: 'Origin', value: inspected.origin },
              { label: 'Path', value: inspected.path },
              { label: 'Fragment', value: inspected.fragment || '(tidak ada)' },
            ].map((item) => (
              <div
                key={item.label}
                className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[6rem_minmax(0,1fr)]"
              >
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="min-w-0 break-all font-mono text-xs leading-6">{item.value}</dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-6 text-sm font-medium">
            Parameter query{' '}
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {inspected.query.length}
            </span>
          </h3>
          {inspected.query.length ? (
            <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-border bg-background px-4">
              {inspected.query.map(([key, value], index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 gap-2 border-b border-border py-3 last:border-0 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)]"
                >
                  <span className="min-w-0 break-all font-mono text-xs text-primary">
                    {key || '(nama kosong)'}
                  </span>
                  <span className="min-w-0 break-all font-mono text-xs leading-6">
                    {value || '(nilai kosong)'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              URL ini tidak memiliki parameter query.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function UuidPanel({ onActivity }: { onActivity: ActivityCallback }) {
  const [count, setCount] = useState('5')
  const [format, setFormat] = useState<'lines' | 'json'>('lines')
  const [values, setValues] = useState<string[]>([])
  const [error, setError] = useState('')
  const output =
    format === 'json' ? (values.length ? JSON.stringify(values, null, 2) : '') : values.join('\n')
  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[0.65fr_1.35fr]">
      <div className="min-w-0 space-y-6">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-primary/15 bg-accent-soft text-primary">
          <Fingerprint size={29} />
        </div>
        <div>
          <h2 className="text-lg font-medium tracking-tight">Identifier untuk ide berikutnya.</h2>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            UUID versi 4 dibuat dengan generator acak kriptografis browser. Hasil tidak dikirim ke
            server.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label className="field-label" htmlFor="uuid-count">
            Jumlah UUID
          </label>
          <input
            id="uuid-count"
            type="number"
            min="1"
            max="100"
            className="field"
            value={count}
            onChange={(event) => setCount(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Buat 1–100 identifier sekaligus.</p>
        </div>
        <div className="flex flex-col gap-2">
          <label className="field-label" htmlFor="uuid-format">
            Format hasil
          </label>
          <select
            id="uuid-format"
            className="field"
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
          >
            <option value="lines">Satu UUID per baris</option>
            <option value="json">Array JSON</option>
          </select>
        </div>
        <ErrorNotice value={error} />
        <Button
          onClick={() => {
            try {
              setValues(generateUuids(Number(count)))
              setError('')
              onActivity('Membuat UUID v4')
            } catch (caught) {
              setError(message(caught))
            }
          }}
        >
          <Fingerprint size={17} />
          Buat UUID
        </Button>
        {values.length > 0 && (
          <p role="status" className="font-mono text-xs text-muted-foreground">
            {values.length} UUID siap dipakai.
          </p>
        )}
      </div>
      <OutputBox
        value={output}
        filename={format === 'json' ? 'uuid-ruang.json' : 'uuid-ruang.txt'}
      />
    </div>
  )
}

function FileHashPanel({ onActivity }: { onActivity: ActivityCallback }) {
  const [file, setFile] = useState<File | null>(null)
  const [hash, setHash] = useState('')
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current += 1
    },
    [],
  )
  async function calculate() {
    if (!file) return
    const current = ++request.current
    setBusy(true)
    setError('')
    setHash('')
    try {
      const result = await sha256(await file.arrayBuffer())
      if (current !== request.current) return
      setHash(result)
      onActivity('Menghitung checksum SHA-256 file')
    } catch (caught) {
      if (current === request.current) setError(message(caught))
    } finally {
      if (current === request.current) setBusy(false)
    }
  }
  const comparison = expected.trim().toLowerCase()
  const validComparison = /^[a-f0-9]{64}$/.test(comparison)
  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="min-w-0 space-y-6">
        <div>
          <label htmlFor="hash-file" className="field-label mb-3 block">
            File yang ingin diperiksa
          </label>
          <label
            className={cn(
              'flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background px-6 py-7 text-center transition-colors hover:border-primary/40 focus-within:ring-2 focus-within:ring-primary/30',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            <FileArrowUp size={30} className="mb-4 text-primary" />
            <span className="text-sm font-medium">
              {file ? 'Ganti file' : 'Pilih file dari perangkat'}
            </span>
            <span className="mt-2 max-w-full break-all text-xs leading-6 text-muted-foreground">
              {file
                ? `${file.name} · ${new Intl.NumberFormat('id-ID').format(file.size)} byte`
                : 'Semua jenis file, maksimal 50 MB.'}
            </span>
            <input
              id="hash-file"
              type="file"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const selected = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (!selected) return
                setHash('')
                if (selected.size > MAX_FILE_BYTES) {
                  setError('File maksimal 50 MB untuk menjaga browser tetap responsif.')
                  setFile(null)
                } else {
                  setFile(selected)
                  setError('')
                }
              }}
            />
          </label>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            File dibaca di browser dan tidak diunggah ke backend.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="hash-expected" className="field-label">
            Hash pembanding (opsional)
          </label>
          <textarea
            id="hash-expected"
            value={expected}
            maxLength={200}
            rows={3}
            onChange={(event) => setExpected(event.target.value)}
            className="field min-h-24 font-mono text-xs"
            placeholder="Tempel 64 karakter SHA-256 untuk dibandingkan…"
            spellCheck={false}
          />
          <p className="text-xs leading-6 text-muted-foreground">
            Gunakan checksum dari sumber file yang kamu percayai.
          </p>
        </div>
        <ErrorNotice value={error} />
        <Button onClick={() => void calculate()} disabled={!file || busy}>
          <Hash size={17} />
          {busy ? 'Menghitung…' : 'Hitung SHA-256'}
        </Button>
      </div>
      <div className="min-w-0">
        {busy ? (
          <div
            role="status"
            aria-label="Menghitung hash file"
            className="space-y-4 rounded-2xl border border-border bg-background p-6"
          >
            <div className="skeleton h-4 w-32" />
            <div className="skeleton h-16 w-full" />
            <div className="skeleton h-4 w-44 max-w-full" />
          </div>
        ) : hash ? (
          <div className="rounded-2xl border border-border bg-background p-5 sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <p className="eyebrow">SHA-256</p>
              <CopyValue value={hash} />
            </div>
            <output className="block break-all font-mono text-[15px] leading-8">{hash}</output>
            <Button
              variant="ghost"
              size="sm"
              className="mt-5"
              onClick={() => downloadText(hash + '\n', 'checksum-ruang.sha256')}
            >
              <DownloadSimple size={16} />
              Unduh checksum
            </Button>
            {comparison && (
              <p
                role={validComparison ? 'status' : 'alert'}
                className={cn(
                  'mt-5 border-t border-border pt-5 text-xs leading-6',
                  !validComparison || comparison !== hash ? 'text-danger' : 'text-primary',
                )}
              >
                {!validComparison
                  ? 'Hash pembanding harus terdiri dari 64 digit heksadesimal.'
                  : comparison === hash
                    ? 'Cocok. Kedua checksum sama.'
                    : 'Tidak cocok. Checksum file berbeda dari pembanding.'}
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background px-6 py-9 text-center">
            <Hash size={32} className="mb-4 text-muted-foreground/50" />
            <p className="text-sm font-medium">Sidik jari untuk sebuah file.</p>
            <p className="mt-2 max-w-60 text-xs leading-6 text-muted-foreground">
              Pilih file lalu hitung checksum. Kamu juga bisa membandingkannya dengan SHA-256 lain.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export function DailyUtilityPanel({
  id,
  onActivity,
}: {
  id: DailyUtilityId
  onActivity: ActivityCallback
}) {
  switch (id) {
    case 'csv-json':
      return <CsvPanel onActivity={onActivity} />
    case 'date-time':
      return <DateTimePanel onActivity={onActivity} />
    case 'url-tools':
      return <UrlPanel onActivity={onActivity} />
    case 'uuid-generator':
      return <UuidPanel onActivity={onActivity} />
    case 'file-hash':
      return <FileHashPanel onActivity={onActivity} />
  }
}

import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  CheckCircle,
  DownloadSimple,
  FileArrowUp,
  FilePdf,
  LockSimple,
  WarningCircle,
} from '@phosphor-icons/react'
import { api } from '../lib/api'
import type { PdfJob } from '../lib/types'
import { Button } from './ui/button'

const JOB_KEY = 'ruang-pdf-job-v1'
const stages: Record<PdfJob['stage'], string> = {
  queued: 'Menyiapkan pekerjaan',
  validating: 'Memeriksa dokumen',
  converting: 'Memulihkan teks, tabel, dan layout',
  verifying: 'Memeriksa hasil Word',
  completed: 'DOCX siap diunduh',
  failed: 'Konversi belum berhasil',
}
function storedJob() {
  try {
    const value = localStorage.getItem(JOB_KEY)
    return value && /^[0-9a-f-]{36}$/.test(value) ? value : ''
  } catch {
    return ''
  }
}

export default function PdfConverter({ onActivity }: { onActivity: (action: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [id, setId] = useState(storedJob)
  const [job, setJob] = useState<PdfJob | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const [retry, setRetry] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const recorded = useRef('')
  const action = useRef(onActivity)
  action.current = onActivity
  useEffect(() => {
    if (!id) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const result = await api.pdfJob(id)
        if (!active) return
        setJob(result)
        setPollError('')
        if (result.state === 'queued' || result.state === 'running')
          timer = setTimeout(() => void poll(), 1000)
        if (result.state === 'completed' && recorded.current !== result.id) {
          recorded.current = result.id
          action.current('Mengonversi PDF menjadi DOCX editable')
        }
      } catch (caught) {
        if (active)
          setPollError(
            caught instanceof Error ? caught.message : 'Status konversi belum dapat dibaca.',
          )
      }
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [id, retry])

  const working = uploading || job?.state === 'queued' || job?.state === 'running'
  function choose(candidate?: File) {
    if (!candidate || working) return
    setError('')
    if (candidate.size > 25 * 1024 * 1024) {
      setError('Ukuran PDF maksimal 25 MB.')
      return
    }
    if (!candidate.name.toLowerCase().endsWith('.pdf')) {
      setError('Pilih berkas dengan format PDF.')
      return
    }
    setFile(candidate)
  }
  async function convert() {
    if (!file || working) return
    setUploading(true)
    setError('')
    setPollError('')
    try {
      const result = await api.pdfConvert(file)
      try {
        localStorage.setItem(JOB_KEY, result.id)
      } catch {
        /* Polling still works without storage. */
      }
      setJob(result)
      setId(result.id)
      setRetry((value) => value + 1)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'PDF belum berhasil dikirim ke server lokal.',
      )
    } finally {
      setUploading(false)
    }
  }
  return (
    <div className="space-y-7">
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[1.15fr_1fr]">
        <div className="flex min-w-0 flex-col rounded-[28px] border border-dashed border-border bg-background p-6 sm:p-8">
          <FilePdf size={34} className="mb-6 text-primary" />
          <h2 className="text-lg font-medium tracking-tight">
            Dari PDF ke dokumen yang bisa diedit.
          </h2>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            Teks, tabel, gambar, dan struktur halaman dipulihkan ke Word di komputer ini.
          </p>
          <input
            ref={input}
            type="file"
            accept=".pdf,application/pdf"
            aria-label="Pilih PDF untuk dikonversi"
            className="sr-only"
            onChange={(event) => {
              choose(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          {file ? (
            <div className="mt-7 min-w-0 rounded-2xl border border-border bg-surface p-4">
              <p className="break-all text-sm font-medium">{file.name}</p>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)} MB · Mode editable
              </p>
            </div>
          ) : (
            <p className="mt-7 text-xs text-muted-foreground">
              Pilih PDF untuk mulai. Maksimal 25 MB dan 100 halaman.
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => input.current?.click()} disabled={!!working}>
              <FileArrowUp size={17} />
              {file ? 'Ganti PDF' : 'Pilih PDF'}
            </Button>
            <Button onClick={() => void convert()} disabled={!file || !!working}>
              {uploading
                ? 'Mengirim ke server lokal…'
                : working
                  ? 'Konversi berjalan…'
                  : 'Konversi ke Word'}
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
        <div className="min-w-0 py-2">
          <p className="eyebrow mb-4">Teks tetap dapat diedit</p>
          <h3 className="text-sm font-medium">Layout dipertahankan semampu struktur PDF.</h3>
          <p className="mt-3 text-xs leading-7 text-muted-foreground">
            PDF menyimpan posisi visual, sehingga susunan Word dapat berbeda pada font khusus, kolom
            rumit, atau tabel kompleks. Periksa hasil sebelum dipakai.
          </p>
          <div className="mt-6 divide-y divide-border text-xs">
            <p className="py-3 leading-6">
              Cocok untuk PDF digital yang memiliki teks yang dapat dipilih.
            </p>
            <p className="py-3 leading-6">
              PDF scan murni memerlukan OCR terlebih dahulu. PDF yang terkunci perlu dibuka
              proteksinya sebelum diproses.
            </p>
            <p className="py-3 leading-6">
              Halaman tidak diganti dengan gambar. Hasil berupa elemen Word editable dengan
              pendekatan layout.
            </p>
          </div>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="flex gap-2 rounded-xl bg-danger/5 p-4 text-xs leading-6 text-danger"
        >
          <WarningCircle size={17} className="mt-1 shrink-0" />
          {error}
        </p>
      )}
      {pollError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-danger/5 p-4 text-xs text-danger"
        >
          <p className="min-w-0 flex-1 leading-6">{pollError}</p>
          <Button size="sm" variant="secondary" onClick={() => setRetry((value) => value + 1)}>
            Coba baca status
          </Button>
        </div>
      )}
      {(uploading || (id && !job && !pollError)) && (
        <div
          role="status"
          aria-label="Memuat status PDF"
          className="skeleton h-28 w-full rounded-2xl"
        />
      )}
      {job && (
        <section
          aria-label="Status konversi PDF"
          className="rounded-[28px] border border-border p-5 sm:p-7"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow mb-3">
                {job.state === 'completed'
                  ? 'Selesai'
                  : job.state === 'failed'
                    ? 'Perlu diperiksa'
                    : 'Sedang diproses'}
              </p>
              <h2 className="text-sm font-medium">{stages[job.stage]}</h2>
              <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">
                {job.filename}
                {job.page_count !== null ? ` · ${job.page_count} halaman` : ''}
              </p>
            </div>
            {job.download_url && job.state === 'completed' && (
              <Button asChild>
                <a href={job.download_url} download>
                  <DownloadSimple size={17} />
                  Unduh DOCX
                </a>
              </Button>
            )}
          </div>
          {job.state === 'running' || job.state === 'queued' ? (
            <div role="status" className="mt-5">
              <div className="skeleton h-2 w-full" />
              <p className="mt-4 text-xs leading-6 text-muted-foreground">
                {job.message} Proses tetap berjalan saat kamu berpindah alat.
              </p>
            </div>
          ) : job.state === 'completed' ? (
            <p className="mt-5 flex items-center gap-2 text-xs text-primary">
              <CheckCircle size={17} />
              {job.message}
            </p>
          ) : (
            <p role="alert" className="mt-5 text-xs leading-6 text-danger">
              {job.error || job.message}
            </p>
          )}
          {job.warnings.length > 0 && (
            <ul className="mt-5 list-disc space-y-2 border-t border-border pt-5 pl-4 text-[11px] leading-6 text-muted-foreground">
              {job.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <p className="flex items-start gap-2 border-t border-border pt-5 text-[11px] leading-6 text-muted-foreground">
        <LockSimple size={15} className="mt-1 shrink-0 text-primary" />
        PDF dan DOCX disimpan lokal pada folder data workspace. Tidak diunggah ke layanan konversi
        eksternal.
      </p>
    </div>
  )
}

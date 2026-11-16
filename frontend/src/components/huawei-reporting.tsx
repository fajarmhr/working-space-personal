import { useEffect, useRef, useState } from 'react'
import {
  ArrowClockwise,
  ArrowRight,
  Browser,
  CalendarBlank,
  ChartLine,
  Check,
  EnvelopeSimple,
  FloppyDisk,
  LockSimple,
  Plus,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { api } from '../lib/api'
import {
  addReportingMetric,
  addReportingProfile,
  recipientAddresses,
  updateReportingProfile,
  validateReportingWindow,
  type ReportingConfig,
  type ReportingDeliveryProfile,
  type ReportingDraftResponse,
} from '../lib/huawei-reporting'
import { Button } from './ui/button'

const phaseLabels = [
  'Ambil ekspor U2020',
  'Validasi & olah KPI',
  'Buat gambar grafik',
  'Email & Telegram',
]

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  help,
  mono = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  help?: string
  mono?: boolean
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        className={`field min-w-0 ${mono ? 'font-mono text-xs' : ''}`}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {help && <p className="text-[11px] leading-6 text-muted-foreground">{help}</p>}
    </div>
  )
}

function TemplateField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <textarea
        id={id}
        className="field min-h-28 font-mono text-xs leading-6"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export default function HuaweiReporting({ onActivity }: { onActivity: (action: string) => void }) {
  const [saved, setSaved] = useState<ReportingDraftResponse | null>(null)
  const [config, setConfig] = useState<ReportingConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [recipientInputs, setRecipientInputs] = useState<Record<string, string>>({})
  const alive = useRef(true)
  const requestVersion = useRef(0)
  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
      requestVersion.current += 1
    }
  }, [])

  async function load() {
    const request = ++requestVersion.current
    setLoading(true)
    setError('')
    try {
      const data = await api.reportDraft()
      if (!alive.current || request !== requestVersion.current) return
      setSaved(data)
      setConfig(data.config)
      setRecipientInputs({})
      setNotice('')
    } catch (caught) {
      if (alive.current && request === requestVersion.current)
        setError(caught instanceof Error ? caught.message : 'Draft reporting belum dapat dimuat.')
    } finally {
      if (alive.current && request === requestVersion.current) setLoading(false)
    }
  }

  function change(update: (current: ReportingConfig) => ReportingConfig) {
    setConfig((current) => (current ? update(current) : current))
    setNotice('')
    setError('')
  }

  function profileChange(update: (profile: ReportingDeliveryProfile) => ReportingDeliveryProfile) {
    change((current) => updateReportingProfile(current, current.profile_id, update))
  }

  async function save() {
    if (!config || !saved || saving) return
    const invalidWindow = validateReportingWindow(config.schedule.start_at, config.schedule.end_at)
    if (invalidWindow) {
      setError(invalidWindow)
      return
    }
    const request = ++requestVersion.current
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const data = await api.saveReportDraft(config, saved.revision)
      if (!alive.current || request !== requestVersion.current) return
      setSaved(data)
      setConfig(data.config)
      setRecipientInputs({})
      setNotice('Draft tersimpan. Monitoring dan pengiriman tetap belum aktif.')
      onActivity('Menyimpan draft monitoring KPI')
    } catch (caught) {
      if (alive.current && request === requestVersion.current)
        setError(caught instanceof Error ? caught.message : 'Draft belum dapat disimpan.')
    } finally {
      if (alive.current && request === requestVersion.current) setSaving(false)
    }
  }

  const dirty = config && saved ? JSON.stringify(config) !== JSON.stringify(saved.config) : false
  const profile = config?.delivery_profiles.find((item) => item.id === config.profile_id)
  const readiness = saved?.readiness

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div className="max-w-2xl">
          <p className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            Draft / belum aktif
          </p>
          <h2 className="text-lg font-medium tracking-tight">
            Satu alur untuk monitoring selama libur.
          </h2>
          <p className="mt-3 text-xs leading-7 text-muted-foreground">
            Siapkan sumber KPI, periode laporan, dan profil penerima. Koneksi U2020, pembuatan
            grafik, serta pengiriman akan dilengkapi setelah kebutuhan tersedia.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading || saving || !!dirty}
          >
            <ArrowClockwise size={16} />
            Muat ulang draft
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={loading || saving || !dirty}>
            <FloppyDisk size={16} />
            {saving ? 'Menyimpan…' : 'Simpan draft'}
          </Button>
        </div>
      </div>

      <ol
        className="grid grid-cols-1 gap-3 border-b border-border pb-6 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Alur reporting yang direncanakan"
      >
        {phaseLabels.map((label, index) => (
          <li key={label} className="flex items-center gap-3 text-xs">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">
              0{index + 1}
            </span>
            <span>{label}</span>
            {index < 3 && (
              <ArrowRight size={13} className="ml-auto hidden text-muted-foreground/50 xl:block" />
            )}
          </li>
        ))}
      </ol>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-2 rounded-xl border border-danger/20 bg-danger/5 p-4 text-xs leading-6 text-danger"
        >
          <WarningCircle size={17} className="mt-1 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          {!loading && (
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={saving}>
              Muat versi tersimpan
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="flex items-center gap-2 text-xs leading-6 text-primary">
          <Check size={16} />
          {notice}
        </p>
      )}
      {loading && (
        <div
          role="status"
          aria-label="Memuat draft reporting"
          className="grid gap-7 lg:grid-cols-[1.35fr_0.65fr]"
        >
          <div className="space-y-4">
            <div className="skeleton h-16" />
            <div className="skeleton h-56" />
            <div className="skeleton h-40" />
          </div>
          <div className="skeleton h-80" />
        </div>
      )}

      {!loading && config && (
        <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[1.35fr_0.65fr]">
          <fieldset disabled={saving} className="min-w-0 space-y-7 disabled:opacity-60">
            <section className="space-y-5" aria-labelledby="report-identity-title">
              <h3
                id="report-identity-title"
                className="flex items-center gap-2 text-sm font-medium"
              >
                <Browser size={19} />
                Sumber U2020
              </h3>
              <TextField
                id="report-name"
                label="Nama laporan"
                value={config.name}
                onChange={(value) => change((current) => ({ ...current, name: value }))}
                placeholder="Nama monitoring"
              />
              <TextField
                id="report-base-url"
                label="Alamat U2020"
                value={config.source.base_url}
                onChange={(value) =>
                  change((current) => ({
                    ...current,
                    source: { ...current.source, base_url: value },
                  }))
                }
                placeholder="https://alamat-u2020"
                help="Alamat disimpan sebagai draft. Aplikasi belum membuka atau mengakses U2020."
                mono
              />
              <TextField
                id="report-page-path"
                label="Halaman atau path KPI"
                value={config.source.page_path}
                onChange={(value) =>
                  change((current) => ({
                    ...current,
                    source: { ...current.source, page_path: value },
                  }))
                }
                placeholder="Diisi setelah halaman KPI ditentukan"
                mono
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id="report-browser-profile"
                  label="ID profil browser khusus"
                  value={config.source.browser_profile_id}
                  onChange={(value) =>
                    change((current) => ({
                      ...current,
                      source: { ...current.source, browser_profile_id: value },
                    }))
                  }
                  mono
                />
                <div className="grid content-start gap-2">
                  <label htmlFor="report-export-format" className="field-label">
                    Format ekspor utama
                  </label>
                  <select
                    id="report-export-format"
                    className="field"
                    value={config.source.export_format}
                    onChange={(event) =>
                      change((current) => ({
                        ...current,
                        source: {
                          ...current.source,
                          export_format: event.target.value as 'csv' | 'xlsx',
                        },
                      }))
                    }
                  >
                    <option value="csv">CSV</option>
                    <option value="xlsx">Excel (.xlsx)</option>
                  </select>
                </div>
              </div>
              <p className="rounded-2xl bg-muted/60 px-4 py-3 text-[11px] leading-6 text-muted-foreground">
                Rencana awal memakai profil browser khusus agar sesi login U2020 bisa dipakai ulang.
                Detail login, timeout sesi, dan langkah ekspor menunggu konfirmasi di lingkungan
                target.
              </p>
            </section>

            <details className="border-t border-border pt-6">
              <summary className="cursor-pointer text-sm font-medium">Pemetaan data KPI</summary>
              <div className="mt-5 space-y-5">
                <p className="text-[11px] leading-6 text-muted-foreground">
                  Isi berdasarkan header pada contoh ekspor. Data yang hilang tidak akan dianggap
                  nol. Pemetaan tersimpan sebagai rancangan, belum menjalankan impor.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    id="report-time-column"
                    label="Kolom waktu"
                    value={config.dataset.timestamp_column}
                    onChange={(value) =>
                      change((current) => ({
                        ...current,
                        dataset: { ...current.dataset, timestamp_column: value },
                      }))
                    }
                  />
                  <TextField
                    id="report-entity-column"
                    label="Kolom NE / objek"
                    value={config.dataset.entity_column}
                    onChange={(value) =>
                      change((current) => ({
                        ...current,
                        dataset: { ...current.dataset, entity_column: value },
                      }))
                    }
                  />
                </div>
                <TextField
                  id="report-data-timezone"
                  label="Zona waktu data sumber"
                  value={config.dataset.timezone}
                  onChange={(value) =>
                    change((current) => ({
                      ...current,
                      dataset: { ...current.dataset, timezone: value },
                    }))
                  }
                  placeholder="Asia/Makassar"
                  mono
                />
                {config.dataset.metrics.map((metric, index) => (
                  <div key={index} className="space-y-4 rounded-2xl border border-border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-[10px] text-muted-foreground">KPI {index + 1}</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Hapus mapping KPI ${index + 1}`}
                        onClick={() =>
                          change((current) => ({
                            ...current,
                            dataset: {
                              ...current.dataset,
                              metrics: current.dataset.metrics.filter(
                                (_, position) => position !== index,
                              ),
                            },
                          }))
                        }
                      >
                        <Trash size={14} />
                      </Button>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(['key', 'label', 'column', 'unit'] as const).map((field) => (
                        <TextField
                          key={field}
                          id={`report-metric-${index}-${field}`}
                          label={
                            {
                              key: 'ID KPI',
                              label: 'Nama grafik',
                              column: 'Kolom nilai',
                              unit: 'Satuan',
                            }[field]
                          }
                          value={metric[field]}
                          onChange={(value) =>
                            change((current) => ({
                              ...current,
                              dataset: {
                                ...current.dataset,
                                metrics: current.dataset.metrics.map((item, position) =>
                                  position === index ? { ...item, [field]: value } : item,
                                ),
                              },
                            }))
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={config.dataset.metrics.length >= 100}
                  onClick={() => change(addReportingMetric)}
                >
                  <Plus size={15} />
                  Tambah mapping KPI
                </Button>
              </div>
            </details>

            <section
              className="space-y-5 border-t border-border pt-6"
              aria-labelledby="report-schedule-title"
            >
              <h3
                id="report-schedule-title"
                className="flex items-center gap-2 text-sm font-medium"
              >
                <CalendarBlank size={19} />
                Rencana jadwal
              </h3>
              <p className="text-[11px] leading-6 text-muted-foreground">
                Nilai ini belum mengaktifkan scheduler. Mesin monitoring perlu tetap menyala dan
                memiliki akses U2020, email, serta Telegram selama jadwal berjalan.
              </p>
              <TextField
                id="report-schedule-timezone"
                label="Zona waktu jadwal"
                value={config.schedule.timezone}
                onChange={(value) =>
                  change((current) => ({
                    ...current,
                    schedule: { ...current.schedule, timezone: value },
                  }))
                }
                placeholder="Asia/Makassar"
                mono
              />
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    { key: 'interval_minutes', label: 'Interval laporan (menit)', min: 1 },
                    { key: 'lookback_minutes', label: 'Rentang data per laporan (menit)', min: 1 },
                    { key: 'delay_minutes', label: 'Jeda tunggu kelengkapan data (menit)', min: 0 },
                  ] as const
                ).map((field) => (
                  <div key={field.key} className="grid gap-2">
                    <label htmlFor={`report-${field.key}`} className="field-label">
                      {field.label}
                    </label>
                    <input
                      id={`report-${field.key}`}
                      className="field font-mono"
                      type="number"
                      min={field.min}
                      step={1}
                      value={config.schedule[field.key]}
                      onChange={(event) =>
                        change((current) => ({
                          ...current,
                          schedule: {
                            ...current.schedule,
                            [field.key]: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <TextField
                id="report-start"
                label="Mulai monitoring"
                value={config.schedule.start_at || ''}
                onChange={(value) =>
                  change((current) => ({
                    ...current,
                    schedule: { ...current.schedule, start_at: value || null },
                  }))
                }
                placeholder="YYYY-MM-DDTHH:mm:ss+08:00"
                help="Opsional saat menyusun draft. Sertakan offset waktu, misalnya +08:00."
                mono
              />
              <TextField
                id="report-end"
                label="Akhir monitoring"
                value={config.schedule.end_at || ''}
                onChange={(value) =>
                  change((current) => ({
                    ...current,
                    schedule: { ...current.schedule, end_at: value || null },
                  }))
                }
                placeholder="YYYY-MM-DDTHH:mm:ss+08:00"
                mono
              />
            </section>

            <section
              className="space-y-5 border-t border-border pt-6"
              aria-labelledby="report-delivery-title"
            >
              <h3
                id="report-delivery-title"
                className="flex items-center gap-2 text-sm font-medium"
              >
                <EnvelopeSimple size={19} />
                Profil penerima
              </h3>
              <p className="text-[11px] leading-6 text-muted-foreground">
                Setiap profil menyimpan penerima dan referensi bot sendiri. Rencana memakai profil
                yang dipilih; profil lokal ini belum menjadi akun multiuser.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid min-w-0 flex-1 gap-2">
                  <label htmlFor="report-profile" className="field-label">
                    Profil untuk laporan ini
                  </label>
                  <select
                    id="report-profile"
                    className="field"
                    value={config.profile_id}
                    onChange={(event) =>
                      change((current) => ({ ...current, profile_id: event.target.value }))
                    }
                  >
                    {config.delivery_profiles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label || item.id}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="secondary"
                  disabled={config.delivery_profiles.length >= 20}
                  onClick={() => change(addReportingProfile)}
                >
                  <Plus size={15} />
                  Tambah profil
                </Button>
              </div>
              {profile && (
                <div className="space-y-5">
                  <TextField
                    id="report-profile-label"
                    label="Nama profil"
                    value={profile.label}
                    onChange={(value) => profileChange((current) => ({ ...current, label: value }))}
                  />
                  <div className="space-y-4 rounded-2xl border border-border p-4">
                    <label className="flex cursor-pointer items-start gap-3 text-xs leading-6">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={profile.email.enabled}
                        onChange={(event) =>
                          profileChange((current) => ({
                            ...current,
                            email: { ...current.email, enabled: event.target.checked },
                          }))
                        }
                      />
                      <span>Sertakan email dalam rencana</span>
                    </label>
                    <TextField
                      id="report-email-to"
                      label="Penerima email"
                      value={recipientInputs[profile.id] ?? profile.email.to.join(', ')}
                      onChange={(value) => {
                        setRecipientInputs((current) => ({ ...current, [profile.id]: value }))
                        profileChange((current) => ({
                          ...current,
                          email: { ...current.email, to: recipientAddresses(value) },
                        }))
                      }}
                      placeholder="Pisahkan alamat dengan koma"
                    />
                    <TextField
                      id="report-smtp-ref"
                      label="Referensi secret SMTP"
                      value={profile.email.smtp_secret_ref}
                      onChange={(value) =>
                        profileChange((current) => ({
                          ...current,
                          email: { ...current.email, smtp_secret_ref: value },
                        }))
                      }
                      placeholder="RUANG_SMTP_PERSONAL"
                      help="Isi nama variabel environment, bukan password atau kredensial SMTP. Contoh: RUANG_SMTP_PERSONAL."
                      mono
                    />
                  </div>
                  <div className="space-y-4 rounded-2xl border border-border p-4">
                    <label className="flex cursor-pointer items-start gap-3 text-xs leading-6">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={profile.telegram.enabled}
                        onChange={(event) =>
                          profileChange((current) => ({
                            ...current,
                            telegram: { ...current.telegram, enabled: event.target.checked },
                          }))
                        }
                      />
                      <span>Sertakan Telegram dalam rencana</span>
                    </label>
                    <TextField
                      id="report-telegram-chat"
                      label="Telegram chat ID pribadi"
                      value={profile.telegram.chat_id}
                      onChange={(value) =>
                        profileChange((current) => ({
                          ...current,
                          telegram: { ...current.telegram, chat_id: value },
                        }))
                      }
                      placeholder="Diisi setelah pengguna memulai chat dengan bot"
                      mono
                    />
                    <TextField
                      id="report-telegram-ref"
                      label="Referensi secret bot Telegram"
                      value={profile.telegram.bot_token_secret_ref}
                      onChange={(value) =>
                        profileChange((current) => ({
                          ...current,
                          telegram: { ...current.telegram, bot_token_secret_ref: value },
                        }))
                      }
                      placeholder="RUANG_TELEGRAM_PERSONAL"
                      help="Isi nama variabel environment. Token bot dipasang di mesin monitoring, tidak pada draft ini."
                      mono
                    />
                  </div>
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">
                      Template email &amp; keterangan Telegram
                    </summary>
                    <div className="mt-4 space-y-4">
                      <p className="text-[11px] leading-6 text-muted-foreground">
                        Placeholder rencana: {'{report_name}'}, {'{window_start}'}, {'{window_end}'}
                        , {'{summary}'}. Grafik akan menjadi gambar PNG; preview menunggu contoh KPI
                        dan template yang disepakati.
                      </p>
                      <TextField
                        id="report-subject"
                        label="Subjek email"
                        value={profile.email.subject_template}
                        onChange={(value) =>
                          profileChange((current) => ({
                            ...current,
                            email: { ...current.email, subject_template: value },
                          }))
                        }
                      />
                      <TemplateField
                        id="report-email-body"
                        label="Isi email"
                        value={profile.email.body_template}
                        onChange={(value) =>
                          profileChange((current) => ({
                            ...current,
                            email: { ...current.email, body_template: value },
                          }))
                        }
                      />
                      <TemplateField
                        id="report-telegram-caption"
                        label="Keterangan gambar Telegram"
                        value={profile.telegram.caption_template}
                        onChange={(value) =>
                          profileChange((current) => ({
                            ...current,
                            telegram: { ...current.telegram, caption_template: value },
                          }))
                        }
                      />
                    </div>
                  </details>
                </div>
              )}
            </section>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
              <p className="text-[11px] leading-6 text-muted-foreground">
                {dirty
                  ? 'Ada perubahan draft yang belum disimpan.'
                  : saved?.updated_at
                    ? 'Draft tersimpan di perangkat ini.'
                    : 'Draft awal belum disimpan.'}
              </p>
              <Button onClick={() => void save()} disabled={saving || !dirty}>
                <FloppyDisk size={16} />
                {saving ? 'Menyimpan…' : 'Simpan draft'}
              </Button>
            </div>
          </fieldset>

          <aside
            className="min-w-0 space-y-6 lg:sticky lg:top-6"
            aria-label="Kebutuhan reporting yang belum lengkap"
          >
            <section className="rounded-[24px] border border-border bg-muted/35 p-5">
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-accent-soft text-primary">
                <ChartLine size={20} />
              </div>
              <h3 className="text-sm font-medium">Grafik menunggu data sumber.</h3>
              <p className="mt-3 text-[11px] leading-6 text-muted-foreground">
                Belum ada KPI yang diambil atau gambar yang dibuat. Sampel CSV/Excel diperlukan
                untuk menyepakati waktu, objek, unit, agregasi, dan tampilan grafik.
              </p>
            </section>
            <section>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">Kelengkapan sebelum implementasi</h3>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {readiness?.missing_requirements.length || 0} item
                </span>
              </div>
              {dirty && (
                <p className="mb-4 text-[11px] leading-6 text-muted-foreground">
                  Daftar ini mengikuti versi tersimpan. Simpan draft untuk memperbarui rencana.
                </p>
              )}
              <ul className="space-y-4">
                {readiness?.missing_requirements.map((item) => (
                  <li
                    key={item.code}
                    className="flex items-start gap-3 text-[11px] leading-6 text-muted-foreground"
                  >
                    <WarningCircle size={16} className="mt-1 shrink-0" />
                    <span>{item.message}</span>
                  </li>
                ))}
              </ul>
            </section>
            {readiness?.next_window && (
              <section className="border-t border-border pt-5">
                <h3 className="text-xs font-medium">Contoh rentang data yang tersedia</h3>
                <p className="mt-3 break-words font-mono text-[10px] leading-6 text-muted-foreground">
                  {readiness.next_window.start}
                  <br />
                  sampai {readiness.next_window.end}
                </p>
                <p className="mt-2 text-[11px] leading-6 text-muted-foreground">
                  Hanya perhitungan jadwal. Belum menjadi pekerjaan yang dijalankan.
                </p>
              </section>
            )}
            <p className="flex items-start gap-2 border-t border-border pt-5 text-[11px] leading-6 text-muted-foreground">
              <LockSimple size={16} className="mt-1 shrink-0 text-primary" />
              Draft tidak memulai browser, menjadwalkan pekerjaan, atau mengirim pesan. Pengujian
              U2020 dan pengiriman dilakukan nanti di lingkungan target.
            </p>
          </aside>
        </div>
      )}
    </div>
  )
}

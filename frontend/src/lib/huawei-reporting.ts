export interface ReportingMetric {
  key: string
  label: string
  column: string
  unit: string
}

export interface ReportingDeliveryProfile {
  id: string
  label: string
  email: {
    enabled: boolean
    to: string[]
    subject_template: string
    body_template: string
    smtp_secret_ref: string
  }
  telegram: {
    enabled: boolean
    chat_id: string
    bot_token_secret_ref: string
    caption_template: string
  }
}

export interface ReportingConfig {
  enabled: false
  name: string
  profile_id: string
  source: {
    base_url: string
    page_path: string
    browser_profile_id: string
    export_format: 'csv' | 'xlsx'
    selectors_confirmed: boolean
  }
  dataset: {
    timestamp_column: string
    entity_column: string
    timezone: string
    metrics: ReportingMetric[]
  }
  schedule: {
    timezone: string
    interval_minutes: number
    lookback_minutes: number
    delay_minutes: number
    start_at: string | null
    end_at: string | null
  }
  delivery_profiles: ReportingDeliveryProfile[]
}

export interface ReportingReadiness {
  active: false
  can_activate: false
  missing_requirements: { code: string; message: string }[]
  components: { id: string; status: 'not_configured' | 'scaffold'; message: string }[]
  flow: { id: string; label: string; status: string }[]
  next_window: { start: string; end: string; slot: string } | null
}

export interface ReportingDraftResponse {
  config: ReportingConfig
  readiness: ReportingReadiness
  revision: number
  updated_at: string | null
}

export function recipientAddresses(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,;\n]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
}

export function addReportingProfile(config: ReportingConfig): ReportingConfig {
  const ids = new Set(config.delivery_profiles.map((profile) => profile.id))
  let index = 1
  while (ids.has(`profile-${index}`)) index += 1
  const id = `profile-${index}`
  const profile: ReportingDeliveryProfile = {
    id,
    label: `Profil ${index}`,
    email: {
      enabled: false,
      to: [],
      subject_template: '{report_name} — {window_end}',
      body_template: 'Periode {window_start} sampai {window_end}.\n{summary}',
      smtp_secret_ref: '',
    },
    telegram: {
      enabled: false,
      chat_id: '',
      bot_token_secret_ref: '',
      caption_template: '{report_name}\n{window_start} – {window_end}\n{summary}',
    },
  }
  return { ...config, profile_id: id, delivery_profiles: [...config.delivery_profiles, profile] }
}

export function updateReportingProfile(
  config: ReportingConfig,
  id: string,
  update: (profile: ReportingDeliveryProfile) => ReportingDeliveryProfile,
): ReportingConfig {
  return {
    ...config,
    delivery_profiles: config.delivery_profiles.map((profile) =>
      profile.id === id ? update(profile) : profile,
    ),
  }
}

export function addReportingMetric(config: ReportingConfig): ReportingConfig {
  const keys = new Set(config.dataset.metrics.map((metric) => metric.key))
  let index = 1
  while (keys.has(`kpi_${index}`)) index += 1
  return {
    ...config,
    dataset: {
      ...config.dataset,
      metrics: [
        ...config.dataset.metrics,
        { key: `kpi_${index}`, label: '', column: '', unit: '' },
      ],
    },
  }
}

export function validateReportingWindow(start: string | null, end: string | null): string | null {
  for (const value of [start, end]) {
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) ||
        !Number.isFinite(Date.parse(value)))
    )
      return 'Waktu monitoring harus ISO 8601 dengan offset, misalnya 2026-12-20T08:00:00+08:00.'
  }
  if (start && end && Date.parse(end) <= Date.parse(start))
    return 'Akhir monitoring harus sesudah waktu mulai.'
  return null
}

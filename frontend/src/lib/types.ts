export type Theme = 'light' | 'dark' | 'system'
export type WorkspaceId = 'personal' | 'huawei'
export type Category = 'developer' | 'writing' | 'productivity' | 'security' | 'files'
export type ToolId =
  | 'json-formatter'
  | 'text-case'
  | 'base64'
  | 'password-generator'
  | 'focus-timer'
  | 'quick-note'
  | 'daily-tasks'
  | 'snippets'
  | 'csv-json'
  | 'text-diff'
  | 'date-time'
  | 'url-tools'
  | 'uuid-generator'
  | 'file-hash'
  | 'image-tools'
  | 'pdf-to-docx'
  | 'capture-studio'
  | 'huawei-lld'
  | 'huawei-reporting'

export interface Tool {
  id: ToolId
  title: string
  description: string
  category: Category
  execution: string
  favorite: boolean
}

export interface Preferences {
  theme: Theme
  display_name: string
  focus_minutes: number
  break_minutes: number
  huawei_enabled: boolean
  active_workspace: WorkspaceId
}

export interface Note {
  content: string
  updated_at: string | null
}

export type TaskPriority = 'low' | 'normal' | 'high'

export interface DailyTask {
  id: number
  title: string
  details: string
  priority: TaskPriority
  due_date: string | null
  completed: boolean
  created_at: string
  updated_at: string
}

export type CreateTask = Pick<DailyTask, 'title' | 'details' | 'priority' | 'due_date'>
export type UpdateTask = Partial<CreateTask & Pick<DailyTask, 'completed'>>

export interface SearchItem {
  kind: 'note' | 'task' | 'snippet'
  id: number
  title: string
  excerpt: string
  updated_at: string | null
  completed?: boolean | null
}

export interface SearchResults {
  query: string
  items: SearchItem[]
  has_more: boolean
}

export type SearchTarget = Pick<SearchItem, 'kind' | 'id'>

export interface Snippet {
  id: number
  title: string
  content: string
  category: string
  created_at: string
  updated_at: string
}

export type CreateSnippet = Pick<Snippet, 'title' | 'content' | 'category'>

export type NativeSessionState = 'idle' | 'starting' | 'active' | 'stopping' | 'stopped' | 'error'
export interface CaptureStatus {
  supported: boolean
  state: NativeSessionState
  session_id: string | null
  hotkey: string
  capture_count: number
  last_capture_at: string | null
  error: string | null
  download_url: string | null
  busy: boolean
}
export interface CaptureSession {
  id: string
  created_at: string
  capture_count: number
  state: NativeSessionState
  download_url: string | null
}
export type PdfOcrMode = 'auto' | 'off' | 'force'
export type PdfOcrLanguage = 'eng+ind' | 'eng' | 'ind'
export interface PdfJob {
  id: string
  state: 'queued' | 'running' | 'completed' | 'failed'
  stage: 'queued' | 'validating' | 'ocr' | 'converting' | 'verifying' | 'completed' | 'failed'
  mode: 'editable'
  ocr_mode: PdfOcrMode
  ocr_language: PdfOcrLanguage
  ocr_pages: number[]
  timeout_seconds: number
  filename: string
  created_at: string
  updated_at: string
  page_count: number | null
  progress: number | null
  message: string
  warnings: string[]
  error: string | null
  download_url: string | null
}

export interface Activity {
  id: number
  tool_id: ToolId
  action: string
  created_at: string
}

export interface Bootstrap {
  tools: Tool[]
  preferences: Preferences
  note: Note
  recent: Activity[]
  csrf_token: string
}

export type Page = 'home' | 'tools' | 'favorites' | 'activity' | 'settings' | ToolId

export const categoryLabels: Record<Category, string> = {
  developer: 'Developer',
  writing: 'Menulis',
  productivity: 'Produktivitas',
  security: 'Keamanan',
  files: 'Berkas',
}

export const toolLabels: Record<ToolId, { title: string; description: string; hint: string }> = {
  'json-formatter': {
    title: 'JSON formatter',
    description: 'Rapikan data, temukan strukturnya.',
    hint: 'Format & validasi',
  },
  'text-case': {
    title: 'Ubah teks',
    description: 'Satu tulisan, berbagai bentuk.',
    hint: 'Transformasi teks',
  },
  base64: {
    title: 'Base64',
    description: 'Encode dan decode teks UTF-8.',
    hint: 'Encode & decode',
  },
  'password-generator': {
    title: 'Password generator',
    description: 'Buat kata sandi yang sulit ditebak.',
    hint: 'Generator aman',
  },
  'focus-timer': {
    title: 'Timer fokus',
    description: 'Satu hal dalam satu waktu.',
    hint: 'Ritme kerja',
  },
  'quick-note': {
    title: 'Catatan cepat',
    description: 'Simpan ide sebelum terlewat.',
    hint: 'Ruang menulis',
  },
  'daily-tasks': {
    title: 'Tugas harian',
    description: 'Atur prioritas, tenggat, dan pekerjaan yang ingin diselesaikan.',
    hint: 'Rencana & prioritas',
  },
  snippets: {
    title: 'Pustaka snippet',
    description: 'Simpan template, perintah, dan teks yang sering dipakai.',
    hint: 'Teks siap pakai',
  },
  'csv-json': {
    title: 'CSV & JSON',
    description: 'Ubah tabel dan data terstruktur tanpa kehilangan angka nol.',
    hint: 'Konversi data',
  },
  'text-diff': {
    title: 'Bandingkan teks',
    description: 'Buka dua berkas, edit langsung, dan lihat perbedaannya otomatis.',
    hint: 'Editor perbandingan',
  },
  'date-time': {
    title: 'Tanggal & waktu',
    description: 'Konversi timestamp, zona waktu, dan selisih tanggal.',
    hint: 'Waktu yang jelas',
  },
  'url-tools': {
    title: 'URL toolkit',
    description: 'Encode, decode, dan baca parameter sebuah URL.',
    hint: 'URL & query',
  },
  'uuid-generator': {
    title: 'UUID generator',
    description: 'Buat identitas UUID v4 untuk data dan pengujian.',
    hint: 'Identitas acak',
  },
  'file-hash': {
    title: 'Checksum berkas',
    description: 'Hitung SHA-256 dan cocokkan integritas berkas.',
    hint: 'Verifikasi berkas',
  },
  'image-tools': {
    title: 'Olah gambar',
    description: 'Resize, konversi, beri anotasi, dan blur bagian gambar.',
    hint: 'Editor & anotasi',
  },
  'pdf-to-docx': {
    title: 'PDF ke Word',
    description: 'Ubah PDF digital atau scan menjadi DOCX editable dengan OCR lokal.',
    hint: 'Konversi dokumen',
  },
  'capture-studio': {
    title: 'Capture studio',
    description: 'Tangkap langkah kerja dengan hotkey dan simpan ke satu DOCX.',
    hint: 'Sesi kerja lokal',
  },
  'huawei-lld': {
    title: 'LLD Script Builder',
    description: 'Ubah LLD XLSX menjadi paket script sesuai template kerja Huawei.',
    hint: 'Preparation hingga rollback',
  },
  'huawei-reporting': {
    title: 'KPI Reporting',
    description: 'Siapkan alur monitoring U2020, grafik KPI, email, dan Telegram.',
    hint: 'Rencana monitoring',
  },
}

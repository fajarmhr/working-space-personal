import type {
  Activity,
  CaptureSession,
  CaptureStatus,
  Bootstrap,
  CreateSnippet,
  CreateTask,
  DailyTask,
  Note,
  PdfJob,
  PdfOcrMode,
  PdfOcrLanguage,
  Preferences,
  SearchResults,
  Snippet,
  ToolId,
  UpdateTask,
} from './types'
import type { HuaweiInspection, HuaweiOptions, HuaweiPackage } from './huawei-lld'
import type { ReportingConfig, ReportingDraftResponse } from './huawei-reporting'

let csrfToken = ''

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(options.body && !(options.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(options.method && options.method !== 'GET' ? { 'X-CSRFToken': csrfToken } : {}),
        ...options.headers,
      },
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new Error(
      'Server lokal belum tersambung. Pastikan Ruang sedang berjalan, lalu coba lagi.',
    )
  }
  if (!response.ok) {
    let message = `Permintaan gagal (${response.status}). Coba lagi.`
    try {
      const error = (await response.json()) as { detail?: unknown; message?: string }
      if (typeof error.detail === 'string') message = error.detail
      else if (typeof error.message === 'string') message = error.message
      else if (response.status === 422)
        message = 'Ada isian yang belum sesuai. Periksa kembali nilainya.'
    } catch {
      if (response.status === 403) message = 'Sesi lokal perlu diperbarui. Muat ulang halaman ini.'
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export const api = {
  search: (query: string, signal?: AbortSignal) =>
    request<SearchResults>(`/search?q=${encodeURIComponent(query)}`, { signal }),
  reportDraft: () => request<ReportingDraftResponse>('/huawei/reporting/draft'),
  saveReportDraft: (config: ReportingConfig, revision: number) =>
    request<ReportingDraftResponse>('/huawei/reporting/draft', {
      method: 'PUT',
      body: JSON.stringify({ config, revision }),
    }),
  huaweiInspect: (file: File) => {
    const data = new FormData()
    data.append('file', file)
    return request<HuaweiInspection>('/huawei/inspect', { method: 'POST', body: data })
  },
  huaweiGenerate: (file: File, options: HuaweiOptions) => {
    const data = new FormData()
    data.append('file', file)
    data.append('options', JSON.stringify(options))
    return request<HuaweiPackage>('/huawei/generate', { method: 'POST', body: data })
  },
  huaweiDownload: async (file: File, options: HuaweiOptions): Promise<Blob> => {
    const data = new FormData()
    data.append('file', file)
    data.append('options', JSON.stringify(options))
    let response: Response
    try {
      response = await fetch('/api/huawei/download', {
        method: 'POST',
        body: data,
        credentials: 'same-origin',
        headers: { 'X-CSRFToken': csrfToken },
      })
    } catch {
      throw new Error('Server lokal belum tersambung. Pastikan Ruang sedang berjalan.')
    }
    if (!response.ok) {
      let message = `Unduhan gagal (${response.status}). Coba lagi.`
      try {
        const error = (await response.json()) as { detail?: string }
        if (typeof error.detail === 'string') message = error.detail
      } catch {
        /* Keep the HTTP error when a response has no JSON body. */
      }
      throw new Error(message)
    }
    const blob = await response.blob()
    if (blob.size === 0 || !response.headers.get('content-type')?.includes('application/zip'))
      throw new Error('Server belum mengirim paket ZIP yang valid. Coba unduh lagi.')
    return blob
  },
  async bootstrap() {
    const data = await request<Bootstrap>('/bootstrap')
    csrfToken = data.csrf_token
    return data
  },
  favorite: (id: ToolId, favorite: boolean) =>
    request<{ tool_id: ToolId; favorite: boolean }>(`/tools/${id}/favorite`, {
      method: 'PUT',
      body: JSON.stringify({ favorite }),
    }),
  note: (content: string) =>
    request<Note>('/note', { method: 'PUT', body: JSON.stringify({ content }) }),
  preferences: (values: Partial<Preferences>) =>
    request<Preferences>('/preferences', { method: 'PATCH', body: JSON.stringify(values) }),
  activity: (tool_id: ToolId, action: string) =>
    request<Activity>('/activity', { method: 'POST', body: JSON.stringify({ tool_id, action }) }),
  clearActivity: () => request<{ deleted: number }>('/activity', { method: 'DELETE' }),
  pdfConvert: (
    file: File,
    ocrMode: PdfOcrMode = 'auto',
    ocrLanguage: PdfOcrLanguage = 'eng+ind',
  ) => {
    const data = new FormData()
    data.append('file', file)
    data.append('mode', 'editable')
    data.append('ocr_mode', ocrMode)
    data.append('ocr_language', ocrLanguage)
    return request<PdfJob>('/pdf/convert', { method: 'POST', body: data })
  },
  pdfJob: (id: string) => request<PdfJob>(`/pdf/jobs/${encodeURIComponent(id)}`),
  captureStatus: () => request<CaptureStatus>('/capture/status'),
  captureStart: (hotkey: 'ctrl+shift+s' | 'ctrl+alt+s') =>
    request<CaptureStatus>('/capture/start', { method: 'POST', body: JSON.stringify({ hotkey }) }),
  captureTake: () => request<CaptureStatus>('/capture/take', { method: 'POST' }),
  captureStop: () => request<CaptureStatus>('/capture/stop', { method: 'POST' }),
  captureSessions: () => request<{ items: CaptureSession[] }>('/capture/sessions'),
  tasks: (signal?: AbortSignal) => request<{ items: DailyTask[] }>('/tasks', { signal }),
  createTask: (values: CreateTask) =>
    request<DailyTask>('/tasks', { method: 'POST', body: JSON.stringify(values) }),
  updateTask: (id: number, values: UpdateTask) =>
    request<DailyTask>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteTask: (id: number) => request<{ deleted: number }>(`/tasks/${id}`, { method: 'DELETE' }),
  snippets: (signal?: AbortSignal) => request<{ items: Snippet[] }>('/snippets', { signal }),
  createSnippet: (values: CreateSnippet) =>
    request<Snippet>('/snippets', { method: 'POST', body: JSON.stringify(values) }),
  updateSnippet: (id: number, values: Partial<CreateSnippet>) =>
    request<Snippet>(`/snippets/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteSnippet: (id: number) =>
    request<{ deleted: number }>(`/snippets/${id}`, { method: 'DELETE' }),
}

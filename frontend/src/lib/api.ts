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
  Snippet,
  ToolId,
  UpdateTask,
} from './types'

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
  } catch {
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
  tasks: () => request<{ items: DailyTask[] }>('/tasks'),
  createTask: (values: CreateTask) =>
    request<DailyTask>('/tasks', { method: 'POST', body: JSON.stringify(values) }),
  updateTask: (id: number, values: UpdateTask) =>
    request<DailyTask>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteTask: (id: number) => request<{ deleted: number }>(`/tasks/${id}`, { method: 'DELETE' }),
  snippets: () => request<{ items: Snippet[] }>('/snippets'),
  createSnippet: (values: CreateSnippet) =>
    request<Snippet>('/snippets', { method: 'POST', body: JSON.stringify(values) }),
  updateSnippet: (id: number, values: Partial<CreateSnippet>) =>
    request<Snippet>(`/snippets/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteSnippet: (id: number) =>
    request<{ deleted: number }>(`/snippets/${id}`, { method: 'DELETE' }),
}

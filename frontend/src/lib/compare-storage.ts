import {
  MAX_COMPARE_CHARACTERS,
  normalizeForEditor,
  type CompareEncoding,
  type CompareEol,
} from './text-compare.ts'

export type CompareSide = 'left' | 'right'
export type CompareFilter = 'all' | 'different' | 'same' | 'moved'

export interface CompareSessionPane {
  text: string
  savedText: string
  name: string
  encoding: CompareEncoding
  eol: CompareEol
  open: boolean
}

export interface CompareSession {
  id: string
  name: string
  updatedAt: string
  left: CompareSessionPane
  right: CompareSessionPane
  options: {
    ignoreSpace: boolean
    wrap: boolean
    whitespace: boolean
    filter: CompareFilter
  }
}

export interface CompareFileHandle {
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<{
    write(data: Blob): Promise<void>
    close(): Promise<void>
    abort?(): Promise<void>
  }>
}

interface CompareFilePickers {
  showOpenFilePicker?: (options: { multiple: boolean }) => Promise<CompareFileHandle[]>
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<CompareFileHandle>
}

const ENCODINGS: readonly CompareEncoding[] = ['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE']
const EOLS: readonly CompareEol[] = ['LF', 'CRLF', 'CR', 'Campuran', 'Tidak ada']
const FILTERS: readonly CompareFilter[] = ['all', 'different', 'same', 'moved']
const DATABASE = 'ruang-text-compare'
const STORE = 'sessions'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Format sesi perbandingan tidak valid.')
  return value as Record<string, unknown>
}

function string(value: unknown, maximum: number, label: string, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim()))
    throw new Error(`${label} sesi tidak valid atau terlalu panjang.`)
  return value
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Pengaturan sesi perbandingan tidak valid.')
  return value
}

function member<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T))
    throw new Error('Pengaturan sesi perbandingan tidak valid.')
  return value as T
}

function pane(value: unknown): CompareSessionPane {
  const data = record(value)
  return {
    text: string(data.text, MAX_COMPARE_CHARACTERS, 'Isi teks'),
    savedText: string(data.savedText, MAX_COMPARE_CHARACTERS, 'Isi teks tersimpan'),
    name: string(data.name, 260, 'Nama berkas'),
    encoding: member(data.encoding, ENCODINGS),
    eol: member(data.eol, EOLS),
    open: boolean(data.open),
  }
}

/** Rebuild the snapshot so imported/untrusted values cannot inject extra properties. */
export function validateCompareSession(value: unknown): CompareSession {
  const data = record(value)
  const options = record(data.options)
  const updatedAt = string(data.updatedAt, 40, 'Waktu', true)
  const date = new Date(updatedAt)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== updatedAt)
    throw new Error('Waktu sesi perbandingan tidak valid.')
  return {
    id: string(data.id, 100, 'ID', true),
    name: string(data.name, 120, 'Nama', true),
    updatedAt,
    left: pane(data.left),
    right: pane(data.right),
    options: {
      ignoreSpace: boolean(options.ignoreSpace),
      wrap: boolean(options.wrap),
      whitespace: boolean(options.whitespace),
      filter: member(options.filter, FILTERS),
    },
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Penyimpanan sesi tidak tersedia di browser ini.'))
      return
    }
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onerror = () => reject(request.error ?? new Error('Penyimpanan sesi gagal dibuka.'))
    request.onblocked = () => reject(new Error('Tutup tab Ruang lain lalu coba simpan sesi lagi.'))
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

export async function listCompareSessions(): Promise<CompareSession[]> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly')
    const request = transaction.objectStore(STORE).getAll()
    transaction.oncomplete = () => {
      database.close()
      try {
        resolve(
          (request.result as unknown[])
            .map(validateCompareSession)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        )
      } catch (error) {
        reject(error)
      }
    }
    transaction.onabort = transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Daftar sesi belum dapat dibaca.'))
    }
  })
}

async function mutateSession(operation: (store: IDBObjectStore) => void): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    operation(transaction.objectStore(STORE))
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onabort = transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Sesi belum dapat disimpan. Periksa ruang browser.'))
    }
  })
}

export async function saveCompareSession(session: CompareSession): Promise<void> {
  const validated = validateCompareSession(session)
  await mutateSession((store) => {
    store.put(validated)
  })
}

export async function deleteCompareSession(id: string): Promise<void> {
  string(id, 100, 'ID', true)
  await mutateSession((store) => {
    store.delete(id)
  })
}

/** Mixed/unspecified EOL becomes LF; uniform CRLF/CR and the original BOM are retained. */
export function encodeCompareFile(
  text: string,
  encoding: CompareEncoding,
  eol: CompareEol,
): Uint8Array {
  member(encoding, ENCODINGS)
  member(eol, EOLS)
  const normalized = normalizeForEditor(text)
  const value = normalized.replace(/\n/g, eol === 'CRLF' ? '\r\n' : eol === 'CR' ? '\r' : '\n')
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
    throw new Error('Teks berisi karakter Unicode tidak lengkap. Perbaiki sebelum menyimpan.')
  if (encoding === 'UTF-16 LE' || encoding === 'UTF-16 BE') {
    const bytes = new Uint8Array(2 + value.length * 2)
    const littleEndian = encoding === 'UTF-16 LE'
    bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff])
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < value.length; index += 1)
      view.setUint16(2 + index * 2, value.charCodeAt(index), littleEndian)
    return bytes
  }
  const content = new TextEncoder().encode(value)
  if (encoding === 'UTF-8') return content
  const bytes = new Uint8Array(content.length + 3)
  bytes.set([0xef, 0xbb, 0xbf])
  bytes.set(content, 3)
  return bytes
}

export function supportsCompareFileAccess(): boolean {
  const pickers = globalThis as unknown as CompareFilePickers
  return (
    typeof pickers.showOpenFilePicker === 'function' &&
    typeof pickers.showSaveFilePicker === 'function'
  )
}

function wasCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export async function openCompareFile(): Promise<{ file: File; handle: CompareFileHandle } | null> {
  const pickers = globalThis as unknown as CompareFilePickers
  if (!pickers.showOpenFilePicker)
    throw new Error('Browser ini belum mendukung akses berkas langsung. Gunakan unggah berkas.')
  try {
    const [handle] = await pickers.showOpenFilePicker({ multiple: false })
    if (!handle) return null
    return { file: await handle.getFile(), handle }
  } catch (error) {
    if (wasCancelled(error)) return null
    throw error
  }
}

export async function chooseCompareSaveHandle(name: string): Promise<CompareFileHandle | null> {
  const pickers = globalThis as unknown as CompareFilePickers
  if (!pickers.showSaveFilePicker)
    throw new Error('Browser ini belum mendukung simpan langsung. Gunakan unduh berkas.')
  try {
    return await pickers.showSaveFilePicker({ suggestedName: name })
  } catch (error) {
    if (wasCancelled(error)) return null
    throw error
  }
}

/** The browser commits the replacement only when close succeeds. */
export async function writeCompareFile(
  handle: CompareFileHandle,
  bytes: Uint8Array,
): Promise<void> {
  const writable = await handle.createWritable()
  try {
    await writable.write(new Blob([new Uint8Array(bytes)]))
    await writable.close()
  } catch (error) {
    try {
      await writable.abort?.()
    } catch {
      /* Preserve the original write failure. */
    }
    throw error
  }
}

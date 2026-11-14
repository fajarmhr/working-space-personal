export type CsvDelimiter = ',' | ';' | '\t'
const MAX_TEXT = 1_000_000
const MAX_ROWS = 10_000
const MAX_COLUMNS = 100

function checkText(input: string, limit = MAX_TEXT) {
  if (input.length > limit)
    throw new Error(`Input terlalu besar. Batas ${limit.toLocaleString('id-ID')} karakter.`)
}

function checkDelimiter(delimiter: string): asserts delimiter is CsvDelimiter {
  if (![',', ';', '\t'].includes(delimiter)) throw new Error('Delimiter CSV tidak didukung.')
}

export function decodeTextFile(buffer: ArrayBuffer): string {
  if (buffer.byteLength > 4 * 1024 * 1024) throw new Error('File input maksimal 4 MB.')
  let value: string
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error(
      'Encoding file bukan UTF-8 yang valid. Simpan ulang sebagai CSV UTF-8 atau JSON UTF-8, lalu coba lagi.',
    )
  }
  checkText(value)
  return value
}

export function parseCsv(input: string, delimiter: CsvDelimiter = ','): string[][] {
  checkText(input)
  checkDelimiter(delimiter)
  const source = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let closed = false
  let touched = false
  const pushField = () => {
    row.push(field)
    if (row.length > MAX_COLUMNS) throw new Error('CSV maksimal 100 kolom.')
    field = ''
    closed = false
  }
  const pushRow = () => {
    pushField()
    if (touched || row.length > 1 || row[0] !== '') rows.push(row)
    if (rows.length > MAX_ROWS + 1) throw new Error('CSV maksimal 10.000 baris data.')
    row = []
    touched = false
  }
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
          closed = true
        }
      } else field += character
      continue
    }
    if (character === delimiter) {
      touched = true
      pushField()
    } else if (character === '\r' || character === '\n') {
      pushRow()
      if (character === '\r' && source[index + 1] === '\n') index += 1
    } else if (character === '"' && field === '' && !closed) {
      touched = true
      quoted = true
    } else {
      if (closed) throw new Error('Ada karakter setelah tanda kutip penutup CSV.')
      if (character === '"')
        throw new Error('Tanda kutip di dalam sel harus ditulis sebagai dua tanda kutip.')
      touched = true
      field += character
    }
  }
  if (quoted) throw new Error('Tanda kutip CSV belum ditutup.')
  if (touched || row.length || field) pushRow()
  if (!rows.length) throw new Error('Masukkan CSV beserta baris header.')
  return rows
}

export function csvToJson(input: string, delimiter: CsvDelimiter = ','): string {
  const [rawHeaders, ...rows] = parseCsv(input, delimiter)
  const headers = rawHeaders!.map((header) => header.trim())
  if (headers.some((header) => !header))
    throw new Error('Setiap kolom CSV harus memiliki nama header.')
  if (new Set(headers).size !== headers.length) throw new Error('Nama header CSV tidak boleh sama.')
  const records = rows.map((row, index) => {
    if (row.length !== headers.length)
      throw new Error(
        `Baris data ${index + 1} memiliki ${row.length} sel; seharusnya ${headers.length}.`,
      )
    return Object.fromEntries(headers.map((header, column) => [header, row[column]!]))
  })
  const result = JSON.stringify(records, null, 2)
  if (result.length > 4_000_000) throw new Error('Hasil terlalu besar. Kurangi jumlah baris CSV.')
  return result
}

const RAW_NUMBER = Symbol('csv-number')
type RawNumber = { [RAW_NUMBER]: string }

export function protectSpreadsheetCell(value: string): string {
  return /^[\t\r\n]/.test(value) || /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value
}

export function jsonToCsv(
  input: string,
  delimiter: CsvDelimiter = ',',
  protectFormulas = true,
): string {
  checkText(input)
  checkDelimiter(delimiter)
  const parsed: unknown = JSON.parse(
    input,
    (_key: string, value: unknown, context?: { source?: string }) => {
      if (typeof value !== 'number') return value
      if (!context?.source)
        throw new Error(
          'Browser ini belum mendukung angka JSON tanpa pembulatan. Ubah nilai angka menjadi string terlebih dahulu.',
        )
      return { [RAW_NUMBER]: context.source } satisfies RawNumber
    },
  )
  if (!Array.isArray(parsed) || !parsed.length)
    throw new Error('JSON harus berupa array berisi objek, minimal satu baris.')
  if (parsed.length > MAX_ROWS) throw new Error('JSON maksimal 10.000 baris data.')
  const headers: string[] = []
  for (const record of parsed) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || RAW_NUMBER in record)
      throw new Error('Setiap baris JSON harus berupa objek datar.')
    for (const key of Object.keys(record)) if (!headers.includes(key)) headers.push(key)
    if (headers.length > MAX_COLUMNS) throw new Error('JSON maksimal 100 kolom.')
  }
  if (!headers.length || headers.some((header) => !header.trim()))
    throw new Error('Nama kolom JSON tidak boleh kosong.')
  const cell = (value: unknown): string => {
    let text: string
    if (value === null || value === undefined) text = ''
    else if (typeof value === 'object' && RAW_NUMBER in value)
      text = (value as RawNumber)[RAW_NUMBER]
    else if (typeof value === 'string' || typeof value === 'boolean') text = String(value)
    else throw new Error('JSON berisi objek atau array bersarang. Gunakan objek datar untuk CSV.')
    if (protectFormulas) text = protectSpreadsheetCell(text)
    return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [headers.map(cell).join(delimiter)]
  for (const record of parsed as Record<string, unknown>[]) {
    lines.push(
      headers
        .map((header) => cell(Object.hasOwn(record, header) ? record[header] : undefined))
        .join(delimiter),
    )
  }
  const result = lines.join('\r\n')
  if (result.length > 4_000_000) throw new Error('Hasil CSV terlalu besar. Kurangi jumlah baris.')
  return result
}

export interface DiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
  leftLine: number | null
  rightLine: number | null
}

export function diffLines(before: string, after: string): DiffLine[] {
  if (before.length + after.length > 200_000)
    throw new Error('Perbandingan maksimal 200.000 karakter gabungan.')
  const left = before ? before.replace(/\r\n?/g, '\n').split('\n') : []
  const right = after ? after.replace(/\r\n?/g, '\n').split('\n') : []
  if (left.length > 500 || right.length > 500) throw new Error('Setiap teks maksimal 500 baris.')
  const width = right.length + 1
  const table = new Uint16Array((left.length + 1) * width)
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        left[i] === right[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }
  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ kind: 'same', text: left[i]!, leftLine: ++i, rightLine: ++j })
    } else if (
      i < left.length &&
      (j === right.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)
    ) {
      result.push({ kind: 'removed', text: left[i]!, leftLine: ++i, rightLine: null })
    } else {
      result.push({ kind: 'added', text: right[j]!, leftLine: null, rightLine: ++j })
    }
  }
  return result
}

function utcDate(year: number, month: number, day: number): Date {
  const result = new Date(0)
  result.setUTCFullYear(year, month - 1, day)
  result.setUTCHours(0, 0, 0, 0)
  if (
    year < 1 ||
    year > 9999 ||
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  )
    throw new Error('Tanggal kalender tidak valid.')
  return result
}

export function parseCalendarDate(input: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input)
  if (!match) throw new Error('Gunakan tanggal dengan format YYYY-MM-DD.')
  return utcDate(Number(match[1]), Number(match[2]), Number(match[3])).getTime()
}

export function parseIsoTimestamp(input: string): number {
  const source = input.trim()
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      source,
    )
  if (!match)
    throw new Error('Gunakan ISO 8601 dengan zona waktu, misalnya 2026-11-14T09:30:00+08:00.')
  utcDate(Number(match[1]), Number(match[2]), Number(match[3]))
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? 0) > 59)
    throw new Error('Jam, menit, atau detik tidak valid.')
  const offset = match[8]!
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))
    throw new Error('Offset zona waktu tidak valid.')
  const value = Date.parse(source)
  if (!Number.isFinite(value)) throw new Error('Timestamp tidak valid.')
  return value
}

export function parseEpoch(input: string, unit: 'seconds' | 'milliseconds'): number {
  const source = input.trim()
  const pattern = unit === 'seconds' ? /^-?\d+(?:\.\d{1,3})?$/ : /^-?\d+$/
  if (!pattern.test(source))
    throw new Error(
      unit === 'seconds'
        ? 'Masukkan epoch detik; pecahan maksimal tiga digit.'
        : 'Masukkan epoch milidetik berupa bilangan bulat.',
    )
  const value = Math.round(Number(source) * (unit === 'seconds' ? 1000 : 1))
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime()))
    throw new Error('Epoch berada di luar rentang tanggal yang didukung.')
  return value
}

export function describeTimestamp(milliseconds: number) {
  const date = new Date(milliseconds)
  if (!Number.isFinite(date.getTime())) throw new Error('Tanggal tidak valid.')
  const zones = [
    { label: 'UTC', zone: 'UTC' },
    { label: 'Makassar · WITA', zone: 'Asia/Makassar' },
    { label: 'Jakarta · WIB', zone: 'Asia/Jakarta' },
  ].map((zone) => ({
    ...zone,
    value: new Intl.DateTimeFormat('id-ID', {
      timeZone: zone.zone,
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(date),
  }))
  return { iso: date.toISOString(), seconds: milliseconds / 1000, milliseconds, zones }
}

export function dateInterval(start: string, end: string) {
  const first = parseCalendarDate(start)
  const last = parseCalendarDate(end)
  const days = (last - first) / 86_400_000
  const absolute = Math.abs(days)
  let weekdays = Math.floor(absolute / 7) * 5
  const beginning = new Date(Math.min(first, last)).getUTCDay()
  for (let index = 0; index < absolute % 7; index += 1) {
    const weekday = (beginning + index) % 7
    if (weekday !== 0 && weekday !== 6) weekdays += 1
  }
  return {
    days,
    weekdays: days < 0 && weekdays ? -weekdays : weekdays,
    inclusiveDays: absolute + 1,
  }
}

export function encodeUrlComponent(input: string): string {
  checkText(input)
  try {
    return encodeURIComponent(input)
  } catch {
    throw new Error('Teks memiliki karakter Unicode yang tidak lengkap.')
  }
}

export function decodeUrlComponent(input: string): string {
  checkText(input)
  try {
    return decodeURIComponent(input)
  } catch {
    throw new Error('Encoding URL tidak valid. Periksa pasangan persen dan digit heksadesimal.')
  }
}

export function inspectUrl(input: string) {
  checkText(input, 100_000)
  if (!/^https?:\/\//i.test(input.trim()))
    throw new Error('Masukkan URL lengkap yang diawali http:// atau https://.')
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Masukkan URL lengkap yang diawali http:// atau https://.')
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Pemeriksa ini hanya mendukung URL HTTP dan HTTPS.')
  const query = Array.from(url.searchParams.entries())
  if (query.length > 1000) throw new Error('URL maksimal 1.000 parameter query.')
  return {
    protocol: url.protocol,
    host: url.host,
    origin: url.origin,
    path: url.pathname,
    fragment: url.hash.slice(1),
    query,
  }
}

export function generateUuids(count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new Error('Jumlah UUID harus 1–100.')
  return Array.from({ length: count }, () => crypto.randomUUID())
}

export const MAX_FILE_BYTES = 50 * 1024 * 1024

export async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (buffer.byteLength > MAX_FILE_BYTES)
    throw new Error('File maksimal 50 MB untuk menjaga browser tetap responsif.')
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

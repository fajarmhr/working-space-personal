export const MAX_COMPARE_FILE_BYTES = 4 * 1024 * 1024
export const MAX_COMPARE_CHARACTERS = 2_000_000

export type CompareEncoding = 'UTF-8' | 'UTF-8 BOM' | 'UTF-16 LE' | 'UTF-16 BE'
export type CompareEol = 'LF' | 'CRLF' | 'CR' | 'Campuran' | 'Tidak ada'

export interface DecodedCompareFile {
  text: string
  encoding: CompareEncoding
  eol: CompareEol
}

function checkLength(text: string) {
  if (text.length > MAX_COMPARE_CHARACTERS)
    throw new Error('Setiap editor maksimal 2 juta karakter. Buka berkas yang lebih kecil.')
}

export function detectCompareEol(text: string): CompareEol {
  const kinds = new Set<string>()
  for (const match of text.matchAll(/\r\n|\r|\n/g)) kinds.add(match[0])
  if (kinds.size > 1) return 'Campuran'
  if (kinds.has('\r\n')) return 'CRLF'
  if (kinds.has('\r')) return 'CR'
  if (kinds.has('\n')) return 'LF'
  return 'Tidak ada'
}

function hasBinarySignature(bytes: Uint8Array) {
  const starts = (signature: readonly number[]) =>
    signature.every((value, index) => bytes[index] === value)
  const riffKind = String.fromCharCode(...bytes.subarray(8, 12))
  return (
    starts([0x25, 0x50, 0x44, 0x46, 0x2d]) || // PDF
    starts([0x50, 0x4b, 0x03, 0x04]) || // ZIP / Office documents
    starts([0x50, 0x4b, 0x05, 0x06]) ||
    starts([0x50, 0x4b, 0x07, 0x08]) ||
    starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    starts([0xff, 0xd8, 0xff]) ||
    starts([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    starts([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) ||
    (starts([0x52, 0x49, 0x46, 0x46]) && ['WEBP', 'WAVE', 'AVI '].includes(riffKind)) ||
    starts([0x1f, 0x8b]) || // gzip
    starts([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) || // 7-Zip
    starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) || // legacy Office
    starts([0x7f, 0x45, 0x4c, 0x46]) // executable
  )
}

function checkPlainText(text: string) {
  // Tabs, newlines, carriage returns, and page breaks are legitimate text.
  // A lone unusual control character can appear in a log. A dense set is binary.
  if (text.includes('\0'))
    throw new Error(
      'Berkas berisi data biner atau UTF-16 tanpa BOM. Gunakan berkas teks UTF-8 atau UTF-16 dengan BOM.',
    )
  let controls = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if ((code < 32 && ![9, 10, 12, 13].includes(code)) || code === 127) controls += 1
  }
  if (controls > Math.max(1, text.length * 0.01))
    throw new Error('Berkas tampaknya berisi data biner. Pilih berkas teks atau kode sumber.')
}

export function decodeCompareFile(buffer: ArrayBuffer, _filename?: string): DecodedCompareFile {
  if (buffer.byteLength > MAX_COMPARE_FILE_BYTES)
    throw new Error('Ukuran setiap berkas maksimal 4 MB.')
  const bytes = new Uint8Array(buffer)
  if (hasBinarySignature(bytes))
    throw new Error(
      'Format biner seperti PDF, gambar, dan dokumen Office belum didukung. Pilih berkas teks atau kode sumber.',
    )

  let encoding: CompareEncoding = 'UTF-8'
  let decoder = 'utf-8'
  let start = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'UTF-8 BOM'
    start = 3
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'UTF-16 LE'
    decoder = 'utf-16le'
    start = 2
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'UTF-16 BE'
    decoder = 'utf-16be'
    start = 2
  }
  if (start === 2 && (bytes.length - start) % 2 !== 0)
    throw new Error('Berkas UTF-16 terpotong: pasangan byte tidak lengkap.')

  let text: string
  try {
    // BOM is handled above, so any further U+FEFF is content and must survive.
    text = new TextDecoder(decoder, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(start))
  } catch {
    throw new Error(
      'Encoding teks tidak valid. Simpan sebagai UTF-8 atau UTF-16 dengan BOM lalu buka lagi.',
    )
  }
  checkLength(text)
  checkPlainText(text)
  return { text, encoding, eol: detectCompareEol(text) }
}

export function normalizeForEditor(text: string): string {
  checkLength(text)
  return text.replace(/\r\n?/g, '\n')
}

function checkLineRange(start: number, end: number, length: number) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > length
  )
    throw new Error(
      'Rentang perubahan sudah tidak valid. Tunggu perbandingan terbaru lalu coba lagi.',
    )
}

/**
 * Replace zero-based half-open line ranges. Lines follow the editor model:
 * ''.split('\n') has one empty line, and a terminal LF contributes a final empty line.
 * Empty source ranges delete; empty target ranges insert. The caller maps its diff
 * engine's insertion/deletion sentinel values into these explicit ranges.
 */
export function replaceLineRange(
  targetText: string,
  sourceText: string,
  sourceStart: number,
  sourceEndExclusive: number,
  targetStart: number,
  targetEndExclusive: number,
): string {
  const target = normalizeForEditor(targetText).split('\n')
  const source = normalizeForEditor(sourceText).split('\n')
  checkLineRange(sourceStart, sourceEndExclusive, source.length)
  checkLineRange(targetStart, targetEndExclusive, target.length)
  const result = [
    ...target.slice(0, targetStart),
    ...source.slice(sourceStart, sourceEndExclusive),
    ...target.slice(targetEndExclusive),
  ].join('\n')
  checkLength(result)
  return result
}

export function languageFromFilename(filename: string): string {
  const name = filename.split(/[\\/]/).pop()?.toLocaleLowerCase('en-US') ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  if (name === '.env' || name.startsWith('.env.')) return 'ini'
  const extension = name.split('.').pop() ?? ''
  const languages: Record<string, string> = {
    json: 'json',
    jsonc: 'json',
    jsonl: 'json',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    py: 'python',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    markdown: 'markdown',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml',
    ini: 'ini',
    toml: 'ini',
    conf: 'ini',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    java: 'java',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
  }
  return languages[extension] ?? 'plaintext'
}

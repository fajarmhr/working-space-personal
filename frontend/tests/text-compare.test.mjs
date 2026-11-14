import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeCompareFile,
  detectCompareEol,
  languageFromFilename,
  MAX_COMPARE_CHARACTERS,
  MAX_COMPARE_FILE_BYTES,
  normalizeForEditor,
  replaceLineRange,
} from '../src/lib/text-compare.ts'

const utf8 = (value) => new TextEncoder().encode(value).buffer
function utf16(value, littleEndian) {
  const bytes = new Uint8Array(2 + value.length * 2)
  bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff])
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < value.length; index += 1)
    view.setUint16(2 + index * 2, value.charCodeAt(index), littleEndian)
  return bytes.buffer
}

test('text files retain Unicode, blank lines, trailing newline, and original EOL metadata', () => {
  const text = 'Laporan — 日本語\r\n\r\nbaris akhir\r\n'
  assert.deepEqual(decodeCompareFile(utf8(text), 'laporan.txt'), {
    text,
    encoding: 'UTF-8',
    eol: 'CRLF',
  })
  assert.deepEqual(decodeCompareFile(utf8('')), { text: '', encoding: 'UTF-8', eol: 'Tidak ada' })
  assert.equal(normalizeForEditor(text), 'Laporan — 日本語\n\nbaris akhir\n')
})

test('BOM is metadata and UTF-16 endian forms decode strictly without losing a second BOM', () => {
  assert.deepEqual(decodeCompareFile(utf8('\ufeff日本語\n')), {
    text: '日本語\n',
    encoding: 'UTF-8 BOM',
    eol: 'LF',
  })
  assert.equal(decodeCompareFile(utf8('\ufeff\ufeffisi')).text, '\ufeffisi')
  for (const littleEndian of [true, false]) {
    assert.deepEqual(decodeCompareFile(utf16('Surat 日本語\r\n', littleEndian)), {
      text: 'Surat 日本語\r\n',
      encoding: littleEndian ? 'UTF-16 LE' : 'UTF-16 BE',
      eol: 'CRLF',
    })
  }
})

test('invalid UTF-8 and incomplete or unpaired UTF-16 fail instead of replacing source bytes', () => {
  assert.throws(() => decodeCompareFile(Uint8Array.from([0xc3, 0x28]).buffer), /Encoding/)
  assert.throws(() => decodeCompareFile(Uint8Array.from([0xff, 0xfe, 0x61]).buffer), /terpotong/)
  assert.throws(
    () => decodeCompareFile(Uint8Array.from([0xff, 0xfe, 0x00, 0xd8]).buffer),
    /Encoding/,
  )
  assert.throws(
    () => decodeCompareFile(Uint8Array.from([0xfe, 0xff, 0xd8, 0x00]).buffer),
    /Encoding/,
  )
})

test('binary formats, NULs, dense controls, and oversized documents are rejected', () => {
  for (const value of [
    '%PDF-1.7\nexample',
    'PK\x03\x04office',
    'GIF89aimage',
    'RIFF\x04\0\0\0WEBP',
  ])
    assert.throws(() => decodeCompareFile(utf8(value)), /Format biner/)
  assert.throws(() => decodeCompareFile(utf8('teks\0data')), /data biner/)
  assert.throws(() => decodeCompareFile(utf8('\x01\x02\x03\x04')), /data biner/)
  assert.equal(
    decodeCompareFile(utf8('tab\tbaris\n\fhalaman\r\n')).text,
    'tab\tbaris\n\fhalaman\r\n',
  )
  assert.equal(
    decodeCompareFile(utf8('RIFF adalah format kontainer.')).text,
    'RIFF adalah format kontainer.',
  )
  assert.throws(() => decodeCompareFile(new ArrayBuffer(MAX_COMPARE_FILE_BYTES + 1)), /4 MB/)
  assert.throws(() => decodeCompareFile(utf8('a'.repeat(MAX_COMPARE_CHARACTERS + 1))), /2 juta/)
})

test('line-ending detection distinguishes CRLF from LF and mixed documents', () => {
  assert.equal(detectCompareEol('a\r\nb\r\n'), 'CRLF')
  assert.equal(detectCompareEol('a\nb\n'), 'LF')
  assert.equal(detectCompareEol('a\rb\r'), 'CR')
  assert.equal(detectCompareEol('a\r\nb\nc\r'), 'Campuran')
  assert.equal(detectCompareEol('tanpa baris baru'), 'Tidak ada')
})

test('block replacement handles changed lines and normalizes both documents to LF', () => {
  assert.equal(
    replaceLineRange('awal\r\nlama\r\nakhir\r\n', 'awal\nbaru\nakhir\n', 1, 2, 1, 2),
    'awal\nbaru\nakhir\n',
  )
  assert.equal(replaceLineRange('a\nx\ny\nz', 'a\nb\nz', 1, 2, 1, 3), 'a\nb\nz')
  assert.equal(replaceLineRange('a\nb\nz', 'a\nx\ny\nz', 1, 3, 1, 2), 'a\nx\ny\nz')
})

test('insertions work at the first line, EOF, and before the final empty line', () => {
  assert.equal(replaceLineRange('akhir', 'awal\nakhir', 0, 1, 0, 0), 'awal\nakhir')
  assert.equal(replaceLineRange('awal', 'awal\nakhir', 1, 2, 1, 1), 'awal\nakhir')
  assert.equal(replaceLineRange('awal\n', 'awal\ntengah\n', 1, 2, 1, 1), 'awal\ntengah\n')
  assert.equal(replaceLineRange('awal', 'awal\n', 1, 2, 1, 1), 'awal\n')
})

test('deletions and empty files preserve deliberate terminal newlines', () => {
  assert.equal(replaceLineRange('a\nb', 'a', 1, 1, 1, 2), 'a')
  assert.equal(replaceLineRange('a\nb\n', 'a\n', 1, 1, 1, 2), 'a\n')
  assert.equal(replaceLineRange('a\n', 'a', 1, 1, 1, 2), 'a')
  assert.equal(replaceLineRange('', 'baru', 0, 1, 0, 1), 'baru')
  assert.equal(replaceLineRange('lama', '', 0, 1, 0, 1), '')
  assert.equal(replaceLineRange('seluruh\nisi\n', '', 0, 0, 0, 3), '')
  assert.equal(replaceLineRange('', '', 0, 1, 0, 1), '')
})

test('copying repeated lines does not match by content or alter untouched text', () => {
  const original = 'sama\npertama\nsama\nkedua\nsama'
  const changed = 'sama\npertama\nsama\n9223372036854775807\nsama'
  assert.equal(replaceLineRange(original, changed, 3, 4, 3, 4), changed)
})

test('invalid or stale ranges and an oversized merged result fail safely', () => {
  for (const range of [
    [-1, 0, 0, 0],
    [0, 2, 0, 1],
    [0.5, 1, 0, 1],
    [1, 0, 0, 1],
    [0, 1, 0, 2],
  ])
    assert.throws(() => replaceLineRange('a', 'b', ...range), /Rentang/)
  assert.throws(() => normalizeForEditor('a'.repeat(MAX_COMPARE_CHARACTERS + 1)), /2 juta/)
  const half = 'a'.repeat(MAX_COMPARE_CHARACTERS / 2 + 1)
  assert.throws(() => replaceLineRange(half, half, 0, 1, 1, 1), /2 juta/)
})

test('language detection recognizes source filenames without interpreting file content', () => {
  assert.equal(languageFromFilename('C:\\files\\settings.JSON'), 'json')
  assert.equal(languageFromFilename('/code/component.tsx'), 'typescript')
  assert.equal(languageFromFilename('script.py'), 'python')
  assert.equal(languageFromFilename('.env.local'), 'ini')
  assert.equal(languageFromFilename('Dockerfile'), 'dockerfile')
  assert.equal(languageFromFilename('dataset.csv'), 'plaintext')
  assert.equal(languageFromFilename('unknown.backup'), 'plaintext')
})

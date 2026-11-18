import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chooseCompareSaveHandle,
  encodeCompareFile,
  openCompareFile,
  supportsCompareFileAccess,
  validateCompareSession,
  writeCompareFile,
} from '../src/lib/compare-storage.ts'
import { decodeCompareFile, MAX_COMPARE_CHARACTERS } from '../src/lib/text-compare.ts'

function snapshot() {
  const pane = {
    text: 'script yang diubah\n',
    savedText: 'script asli\n',
    name: 'konfigurasi.ini',
    encoding: 'UTF-8 BOM',
    eol: 'CRLF',
    open: true,
  }
  return {
    id: '6fb2a172-201b-4d23-a117-6e3d75e89623',
    name: 'Periksa konfigurasi UPF',
    updatedAt: '2026-11-18T12:00:00.000Z',
    left: { ...pane },
    right: { ...pane, open: false, name: '', text: '', savedText: '' },
    options: { ignoreSpace: false, wrap: true, whitespace: true, filter: 'moved' },
  }
}

test('session snapshot retains both draft and saved baseline, file state and compare options', () => {
  const input = snapshot()
  const validated = validateCompareSession(input)
  assert.deepEqual(validated, input)
  assert.notEqual(validated, input)
  assert.notEqual(validated.left, input.left)
  assert.notEqual(validated.left.text, validated.left.savedText)
  assert.equal(validated.right.open, false)
})

test('untrusted sessions reject corrupt metadata, excessive contents and unsupported options', () => {
  for (const invalid of [
    null,
    [],
    'session',
    { ...snapshot(), name: '' },
    { ...snapshot(), id: 'x'.repeat(101) },
    { ...snapshot(), name: 'x'.repeat(121) },
    { ...snapshot(), updatedAt: 'besok' },
    { ...snapshot(), updatedAt: '2026-11-18' },
    { ...snapshot(), left: { ...snapshot().left, text: 'a'.repeat(MAX_COMPARE_CHARACTERS + 1) } },
    {
      ...snapshot(),
      left: { ...snapshot().left, savedText: 'a'.repeat(MAX_COMPARE_CHARACTERS + 1) },
    },
    { ...snapshot(), left: { ...snapshot().left, encoding: 'latin1' } },
    { ...snapshot(), left: { ...snapshot().left, eol: '\r\n' } },
    { ...snapshot(), left: { ...snapshot().left, open: 'yes' } },
    { ...snapshot(), options: { ...snapshot().options, filter: 'unknown' } },
    { ...snapshot(), options: { ...snapshot().options, wrap: 1 } },
  ])
    assert.throws(() => validateCompareSession(invalid), /sesi|Pengaturan/)
  const polluted = { ...snapshot(), secret: 'discard', left: { ...snapshot().left, handle: {} } }
  assert.equal(Object.hasOwn(validateCompareSession(polluted), 'secret'), false)
  assert.equal(Object.hasOwn(validateCompareSession(polluted).left, 'handle'), false)
})

test('save preserves encoding, byte order, BOM, line endings and Unicode through decoding', () => {
  const source = 'Laporan — 日本語 🛰\n\nakhir\n'
  for (const encoding of ['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE']) {
    for (const eol of ['LF', 'CRLF', 'CR']) {
      const bytes = encodeCompareFile(source, encoding, eol)
      const expected = source.replace(/\n/g, eol === 'CRLF' ? '\r\n' : eol === 'CR' ? '\r' : '\n')
      assert.deepEqual(decodeCompareFile(bytes.buffer), { text: expected, encoding, eol })
    }
  }
  assert.deepEqual([...encodeCompareFile('', 'UTF-8 BOM', 'LF')], [0xef, 0xbb, 0xbf])
  assert.deepEqual([...encodeCompareFile('', 'UTF-16 LE', 'LF')], [0xff, 0xfe])
  assert.deepEqual([...encodeCompareFile('', 'UTF-16 BE', 'LF')], [0xfe, 0xff])
  assert.equal(encodeCompareFile('', 'UTF-8', 'LF').length, 0)
})

test('mixed line endings normalize predictably without stripping a content BOM', () => {
  const source = '\ufeffawal\r\ntengah\rakhir\n'
  for (const eol of ['Campuran', 'Tidak ada']) {
    const decoded = decodeCompareFile(encodeCompareFile(source, 'UTF-8 BOM', eol).buffer)
    assert.equal(decoded.text, '\ufeffawal\ntengah\nakhir\n')
    assert.equal(decoded.eol, 'LF')
  }
  assert.throws(() => encodeCompareFile('\ud800', 'UTF-8', 'LF'), /Unicode/)
  assert.throws(() => encodeCompareFile('\udc00', 'UTF-16 LE', 'LF'), /Unicode/)
  assert.throws(
    () => encodeCompareFile('a'.repeat(MAX_COMPARE_CHARACTERS + 1), 'UTF-8', 'LF'),
    /2 juta/,
  )
})

test('file writing commits only successful writes and aborts partial replacement on failure', async () => {
  const steps = []
  const bytes = encodeCompareFile('baris\n', 'UTF-16 BE', 'CRLF')
  await writeCompareFile(
    {
      async createWritable() {
        return {
          async write(blob) {
            steps.push('write')
            assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes)
          },
          async close() {
            steps.push('close')
          },
          async abort() {
            steps.push('abort')
          },
        }
      },
    },
    bytes,
  )
  assert.deepEqual(steps, ['write', 'close'])
  const failure = new Error('disk full')
  steps.length = 0
  await assert.rejects(
    () =>
      writeCompareFile(
        {
          async createWritable() {
            return {
              async write() {
                steps.push('write')
                throw failure
              },
              async close() {
                steps.push('close')
              },
              async abort() {
                steps.push('abort')
                throw new Error('abort error')
              },
            }
          },
        },
        bytes,
      ),
    failure,
  )
  assert.deepEqual(steps, ['write', 'abort'])
})

test('native file pickers retain selected handle and distinguish cancellation from permission errors', async () => {
  const openDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'showOpenFilePicker')
  const saveDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'showSaveFilePicker')
  const file = new File(['script'], 'upf.ini')
  const handle = { name: file.name, getFile: async () => file }
  try {
    globalThis.showOpenFilePicker = async (options) => {
      assert.equal(options.multiple, false)
      return [handle]
    }
    globalThis.showSaveFilePicker = async (options) => {
      assert.equal(options.suggestedName, 'upf.ini')
      return handle
    }
    assert.equal(supportsCompareFileAccess(), true)
    assert.deepEqual(await openCompareFile(), { file, handle })
    assert.equal(await chooseCompareSaveHandle('upf.ini'), handle)
    const cancelled = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    globalThis.showOpenFilePicker = async () => {
      throw cancelled
    }
    globalThis.showSaveFilePicker = async () => {
      throw cancelled
    }
    assert.equal(await openCompareFile(), null)
    assert.equal(await chooseCompareSaveHandle('upf.ini'), null)
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    globalThis.showSaveFilePicker = async () => {
      throw denied
    }
    await assert.rejects(() => chooseCompareSaveHandle('upf.ini'), denied)
    delete globalThis.showOpenFilePicker
    delete globalThis.showSaveFilePicker
    assert.equal(supportsCompareFileAccess(), false)
    await assert.rejects(() => openCompareFile(), /unggah/)
    await assert.rejects(() => chooseCompareSaveHandle('upf.ini'), /unduh/)
  } finally {
    if (openDescriptor) Object.defineProperty(globalThis, 'showOpenFilePicker', openDescriptor)
    else delete globalThis.showOpenFilePicker
    if (saveDescriptor) Object.defineProperty(globalThis, 'showSaveFilePicker', saveDescriptor)
    else delete globalThis.showSaveFilePicker
  }
})

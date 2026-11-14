import assert from 'node:assert/strict'
import test from 'node:test'
import {
  csvToJson,
  decodeTextFile,
  dateInterval,
  decodeUrlComponent,
  describeTimestamp,
  diffLines,
  encodeUrlComponent,
  generateUuids,
  inspectUrl,
  jsonToCsv,
  parseCalendarDate,
  parseCsv,
  parseEpoch,
  parseIsoTimestamp,
  protectSpreadsheetCell,
  sha256,
} from '../src/lib/daily-tools.ts'

test('text file decoding preserves Unicode and rejects invalid UTF-8 instead of replacing bytes', () => {
  const original = '\ufeffid,nama\n0017,Rahayu 日本語'
  assert.equal(decodeTextFile(new TextEncoder().encode(original).buffer), original.slice(1))
  assert.throws(
    () => decodeTextFile(Uint8Array.from([0x6e, 0x61, 0x6d, 0x61, 0x0a, 0xe9]).buffer),
    /UTF-8/,
  )
})

test('CSV preserves identifiers, BOM, escaped quotes, delimiters, and multiline cells', () => {
  const source =
    '\ufeffid;nama;catatan\r\n0017;"Rahayu; Putri";"Baris pertama\r\nBaris ""kedua"""\r\n'
  assert.deepEqual(JSON.parse(csvToJson(source, ';')), [
    { id: '0017', nama: 'Rahayu; Putri', catatan: 'Baris pertama\r\nBaris "kedua"' },
  ])
  assert.deepEqual(parseCsv('isi\n""\n'), [['isi'], ['']])
  assert.deepEqual(parseCsv('a\tb\n1\t2', '\t'), [
    ['a', 'b'],
    ['1', '2'],
  ])
})

test('CSV validation catches malformed quoting, duplicate/empty headers, and uneven rows', () => {
  assert.throws(() => csvToJson('nama,nama\na,b'), /tidak boleh sama/)
  assert.throws(() => csvToJson('nama,\na,b'), /nama header/)
  assert.throws(() => csvToJson('nama,usia\nRahayu'), /Baris data 1/)
  for (const source of ['nama\n"belum tutup', 'nama\n"sel"x', 'nama\nse"l'])
    assert.throws(() => parseCsv(source))
  assert.throws(() => parseCsv('a|b', '|'), /Delimiter/)
  assert.throws(() => parseCsv('a'.repeat(1_000_001)), /terlalu besar/)
})

test('CSV special property names are data rather than prototype mutation', () => {
  const rows = JSON.parse(csvToJson('__proto__,constructor\naman,isi'))
  assert.equal(Object.hasOwn(rows[0], '__proto__'), true)
  assert.equal(rows[0].__proto__, 'aman')
  assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype)
})

test('JSON to CSV preserves exact numeric literals and unions keys consistently', () => {
  const source =
    '[{"id":9223372036854775807,"nilai":0.1234567890123456789},{"id":"0019","status":true}]'
  assert.equal(
    jsonToCsv(source),
    'id,nilai,status\r\n9223372036854775807,0.1234567890123456789,\r\n0019,,true',
  )
  assert.equal(
    jsonToCsv(JSON.stringify([{ catatan: 'Satu, dua\nTiga "empat"' }])),
    'catatan\r\n"Satu, dua\nTiga ""empat"""',
  )
})

test('CSV export protects formula cells by default with an explicit opt-out', () => {
  assert.equal(jsonToCsv('[{"isi":"=SUM(A1:A2)"}]'), "isi\r\n'=SUM(A1:A2)")
  assert.equal(jsonToCsv('[{"isi":"=SUM(A1:A2)"}]', ',', false), 'isi\r\n=SUM(A1:A2)')
  for (const value of ['=1+1', '+cmd', '-5', '@rumus', '\tisi', '\risi', '\nisi', '  =1', '\f=1'])
    assert.equal(protectSpreadsheetCell(value), `'${value}`)
  assert.equal(protectSpreadsheetCell('catatan biasa'), 'catatan biasa')
  for (const source of ['[]', '{}', '[1]', '[{"a":{"b":1}}]', '[{"a":[1]}]'])
    assert.throws(() => jsonToCsv(source))
})

test('line diff reconstructs each version and distinguishes adds, removals, and unchanged lines', () => {
  const before = 'rapat\r\nriset\r\ntulis'
  const after = 'rapat\nrevisi\ntulis\nkirim'
  const diff = diffLines(before, after)
  assert.equal(
    diff
      .filter((row) => row.kind !== 'added')
      .map((row) => row.text)
      .join('\n'),
    before.replaceAll('\r\n', '\n'),
  )
  assert.equal(
    diff
      .filter((row) => row.kind !== 'removed')
      .map((row) => row.text)
      .join('\n'),
    after,
  )
  assert.equal(diff.filter((row) => row.kind === 'added').length, 2)
  assert.equal(diff.filter((row) => row.kind === 'removed').length, 1)
  assert.deepEqual(diffLines('', ''), [])
  assert.equal(diffLines('', 'baru')[0].kind, 'added')
  assert.equal(diffLines('lama', '')[0].kind, 'removed')
  assert.throws(() => diffLines('a\n'.repeat(501), ''), /500 baris/)
  assert.throws(() => diffLines('a'.repeat(200_001), ''), /200.000/)
})

test('timestamp conversions require explicit offsets and preserve millisecond precision', () => {
  const milliseconds = parseIsoTimestamp('2026-11-14T09:30:12.345+08:00')
  assert.equal(new Date(milliseconds).toISOString(), '2026-11-14T01:30:12.345Z')
  assert.equal(parseEpoch(String(milliseconds), 'milliseconds'), milliseconds)
  assert.equal(parseEpoch(String(milliseconds / 1000), 'seconds'), milliseconds)
  assert.equal(parseEpoch('-0.125', 'seconds'), -125)
  const described = describeTimestamp(milliseconds)
  assert.equal(described.iso, '2026-11-14T01:30:12.345Z')
  assert.match(described.zones.find((zone) => zone.zone === 'Asia/Makassar').value, /09\.30\.12/)
  for (const input of [
    '2026-02-30T00:00:00Z',
    '2026-11-14T24:00:00Z',
    '2026-11-14T09:30:00',
    '2026-11-14T09:30:00+24:00',
  ])
    assert.throws(() => parseIsoTimestamp(input))
  assert.throws(() => parseEpoch('1.1', 'milliseconds'))
  assert.throws(() => parseEpoch('1.0001', 'seconds'))
  assert.throws(() => parseEpoch('999999999999999999999', 'milliseconds'))
})

test('calendar intervals validate leap dates and count weekdays without local timezone drift', () => {
  assert.equal(new Date(parseCalendarDate('0004-02-29')).getUTCFullYear(), 4)
  assert.throws(() => parseCalendarDate('2025-02-29'))
  assert.throws(() => parseCalendarDate('2026-13-01'))
  assert.deepEqual(dateInterval('2026-11-13', '2026-11-16'), {
    days: 3,
    weekdays: 1,
    inclusiveDays: 4,
  })
  assert.deepEqual(dateInterval('2026-11-16', '2026-11-13'), {
    days: -3,
    weekdays: -1,
    inclusiveDays: 4,
  })
  assert.deepEqual(dateInterval('2026-11-14', '2026-11-14'), {
    days: 0,
    weekdays: 0,
    inclusiveDays: 1,
  })
  assert.deepEqual(dateInterval('2026-11-15', '2026-11-14'), {
    days: -1,
    weekdays: 0,
    inclusiveDays: 2,
  })
})

test('URL components preserve Unicode and plus characters while inspection retains duplicate query keys', () => {
  const source = 'ruang kerja + 日本語 / & ?'
  assert.equal(decodeUrlComponent(encodeUrlComponent(source)), source)
  assert.equal(decodeUrlComponent('a+b'), 'a+b')
  assert.throws(() => decodeUrlComponent('%ZZ'))
  assert.throws(() => decodeUrlComponent('%C3%28'))
  const inspected = inspectUrl('https://example.com:8443/path?q=satu+dua&q=%2B#bagian')
  assert.equal(inspected.host, 'example.com:8443')
  assert.deepEqual(inspected.query, [
    ['q', 'satu dua'],
    ['q', '+'],
  ])
  assert.equal(inspected.fragment, 'bagian')
  assert.throws(() => inspectUrl('javascript:alert(1)'))
  assert.throws(() => inspectUrl('example.com'))
  assert.throws(() => inspectUrl('https:example.com'))
})

test('UUID generator produces bounded, independent version-4 identifiers', () => {
  const values = generateUuids(100)
  assert.equal(values.length, 100)
  assert.equal(new Set(values).size, 100)
  for (const value of values)
    assert.match(value, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
  for (const count of [0, 101, 1.5, NaN]) assert.throws(() => generateUuids(count))
})

test('SHA-256 matches the published abc test vector and handles empty files', async () => {
  assert.equal(
    await sha256(new TextEncoder().encode('abc').buffer),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  assert.equal(
    await sha256(new ArrayBuffer(0)),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
})

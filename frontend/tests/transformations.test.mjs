import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeBase64,
  encodeBase64,
  formatJson,
  generatePassword,
  passwordGroups,
  secureRandomIndex,
  textTransformations,
} from '../src/lib/transformations.ts'

test('JSON formatting and minifying preserve valid structures and scalar values', () => {
  const input = ' { "message" : "ruang, {kerja}", "items" : [ 1, true, null, {}, [] ] } '
  const compact = '{"message":"ruang, {kerja}","items":[1,true,null,{},[]]}'
  assert.equal(formatJson(input, 0), compact)
  assert.equal(
    formatJson('{"items":[1,{"ready":true}]}'),
    ['{', '  "items": [', '    1,', '    {', '      "ready": true', '    }', '  ]', '}'].join('\n'),
  )
  assert.equal(formatJson('{"ready":true}', 4), '{\n    "ready": true\n}')
  for (const scalar of ['true', 'null', '42', '"halo"']) assert.equal(formatJson(scalar), scalar)
})

test('JSON keeps integer precision, decimal precision, scientific notation, and negative zero', () => {
  const input =
    '{ "id": 9007199254740993123456789, "price": 0.123456789012345678901, "large": 1.234567890123456789e+400, "small": 1e-999, "zero": -0 }'
  const expected =
    '{"id":9007199254740993123456789,"price":0.123456789012345678901,"large":1.234567890123456789e+400,"small":1e-999,"zero":-0}'
  assert.equal(formatJson(input, 0), expected)
  assert.equal(formatJson(formatJson(input, 4), 0), expected)
})

test('JSON preserves key order, duplicate keys, and the original escape sequences', () => {
  const input = String.raw`{ "2": "\u0061", "1": "path\\file and \"quote\"", "2": "last", "line": "one\ntwo" }`
  const expected = String.raw`{"2":"\u0061","1":"path\\file and \"quote\"","2":"last","line":"one\ntwo"}`
  assert.equal(formatJson(input, 0), expected)
  assert.equal(formatJson(formatJson(input), 0), expected)
})

test('JSON rejects malformed content and bounds input, depth, and expanded output', () => {
  for (const malformed of [
    '',
    '  ',
    '{',
    '{"a":1,}',
    '[01]',
    '{"x":undefined}',
    'true false',
    '"unterminated',
  ]) {
    assert.throws(() => formatJson(malformed), undefined, malformed)
  }
  assert.throws(() => formatJson('"' + 'x'.repeat(1_000_000) + '"'), /terlalu besar/)
  assert.throws(() => formatJson('[]', 3), /Indentasi/)
  assert.doesNotThrow(() => formatJson('['.repeat(100) + '0' + ']'.repeat(100)))
  assert.throws(() => formatJson('['.repeat(101) + '0' + ']'.repeat(101)), /100 tingkat/)
  const expandable = '['.repeat(100) + Array(12_000).fill('0').join(',') + ']'.repeat(100)
  assert.throws(() => formatJson(expandable, 4), /Hasil JSON terlalu besar/)
  assert.equal(formatJson(expandable, 0), expandable)
})

test('Base64 round-trips Indonesian, accented characters, CJK, and line breaks as UTF-8', () => {
  const text =
    'Catatan: pekerjaan hari ini.\nCaf\u00e9, r\u00e9sum\u00e9, \u65e5\u672c\u8a9e, \u4e2d\u6587.'
  const encoded = encodeBase64(text)
  assert.equal(decodeBase64(encoded), text)
  assert.equal(decodeBase64(encoded.slice(0, 8) + '\n ' + encoded.slice(8)), text)
  assert.equal(encodeBase64('Halo'), 'SGFsbw==')
})

test('Base64 rejects malformed padding, unsupported alphabets, and invalid UTF-8', () => {
  for (const malformed of [
    '',
    'a',
    'abcde',
    'A===',
    '=AAA',
    'AAAA=',
    'not_base64',
    '\u4e2d\u6587',
  ]) {
    assert.throws(() => decodeBase64(malformed), /Base64 tidak valid/)
  }
  assert.throws(() => decodeBase64('/w=='), TypeError)
  assert.throws(() => decodeBase64('wK8='), TypeError)
})

test('text transformations retain Unicode letters and useful paragraph breaks', () => {
  assert.equal(
    textTransformations.uppercase('Caf\u00e9 dan \u65e5\u672c\u8a9e'),
    'CAF\u00c9 DAN \u65e5\u672c\u8a9e',
  )
  assert.equal(textTransformations.lowercase('RUANG KERJA'), 'ruang kerja')
  assert.equal(
    textTransformations.title('CATATAN caf\u00c9 \u65e5\u672c\u8a9e'),
    'Catatan Caf\u00e9 \u65e5\u672c\u8a9e',
  )
  assert.equal(textTransformations.sentence('HALO. APA KABAR? BAIK!'), 'Halo. Apa kabar? Baik!')
  assert.equal(
    textTransformations.slug(' Caf\u00e9 & \u65e5\u672c\u8a9e 2026 '),
    'cafe-\u65e5\u672c\u8a9e-2026',
  )
  assert.equal(textTransformations.spaces('  ruang\t  kerja\n  catatan  '), 'ruang kerja\n catatan')
})

test('password generation respects every selected character group and requested length', () => {
  for (const selected of [
    ['uppercase'],
    ['lowercase'],
    ['numbers'],
    ['symbols'],
    ['uppercase', 'lowercase', 'numbers', 'symbols'],
  ]) {
    const groups = Object.fromEntries(
      passwordGroups.map((group) => [group.key, selected.includes(group.key)]),
    )
    const allowed = passwordGroups
      .filter((group) => groups[group.key])
      .map((group) => group.chars)
      .join('')
    for (const length of [12, 37, 64]) {
      const password = generatePassword(length, groups)
      assert.equal(password.length, length)
      assert.ok([...password].every((character) => allowed.includes(character)))
      for (const key of selected) {
        const chars = passwordGroups.find((group) => group.key === key).chars
        assert.ok(
          [...password].some((character) => chars.includes(character)),
          `missing ${key}`,
        )
      }
    }
  }
})

test('password generation rejects unsafe lengths and an empty alphabet', () => {
  const none = { uppercase: false, lowercase: false, numbers: false, symbols: false }
  const all = { uppercase: true, lowercase: true, numbers: true, symbols: true }
  for (const length of [0, 11, 65, -12, 12.5, NaN, Infinity, '16']) {
    assert.throws(() => generatePassword(length, all), /12\u201364 karakter/)
  }
  assert.throws(() => generatePassword(16, none), /Pilih minimal satu/)
})

test('secure random sampling rejects the biased tail before accepting a value', (context) => {
  const values = [0xffffffff, 8]
  const random = context.mock.method(globalThis.crypto, 'getRandomValues', (buffer) => {
    buffer[0] = values.shift()
    return buffer
  })
  assert.equal(secureRandomIndex(3), 2)
  assert.equal(random.mock.callCount(), 2)
})

test('secure random sampling validates alphabet bounds and supports a full uint32 range', (context) => {
  const random = context.mock.method(globalThis.crypto, 'getRandomValues', (buffer) => {
    buffer[0] = 0xffffffff
    return buffer
  })
  for (const size of [0, -1, 1.5, Infinity, NaN, 0x100000001])
    assert.throws(() => secureRandomIndex(size), /alfabet/)
  assert.equal(random.mock.callCount(), 0)
  assert.equal(secureRandomIndex(0x100000000), 0xffffffff)
  assert.equal(secureRandomIndex(1), 0)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { fitImage, readRasterInfo, validateImageOutput } from '../src/lib/image-tools.ts'

function png(width, height) {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

test('raster headers validate dimensions before decoding and reject oversized sources', () => {
  assert.deepEqual(readRasterInfo(png(1920, 1080)), {
    mime: 'image/png',
    width: 1920,
    height: 1080,
  })
  assert.throws(() => readRasterInfo(png(20000, 20000)), /terlalu besar/)
  assert.throws(() => readRasterInfo(png(0, 4)), /tidak valid/)
  assert.throws(
    () => readRasterInfo(new TextEncoder().encode('<svg onload="alert(1)"></svg>')),
    /JPG, PNG, atau WebP/,
  )
})

test('baseline and progressive JPEG SOF dimensions are read without decoding', () => {
  for (const marker of [0xc0, 0xc2]) {
    const bytes = Uint8Array.from([
      255,
      216,
      255,
      marker,
      0,
      11,
      8,
      1,
      44,
      2,
      88,
      1,
      1,
      17,
      0,
      255,
      217,
    ])
    assert.deepEqual(readRasterInfo(bytes), { mime: 'image/jpeg', width: 600, height: 300 })
  }
  assert.throws(() => readRasterInfo(Uint8Array.from([255, 216, 255, 225, 0, 200])), /Header JPEG/)
})

test('WebP extended canvas dimensions and truncated data are validated', () => {
  const bytes = new Uint8Array(30)
  bytes.set(new TextEncoder().encode('RIFF'), 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 22, true)
  bytes.set(new TextEncoder().encode('WEBPVP8X'), 8)
  view.setUint32(16, 10, true)
  bytes[24] = 127
  bytes[27] = 63
  assert.deepEqual(readRasterInfo(bytes), { mime: 'image/webp', width: 128, height: 64 })
  view.setUint32(16, 20, true)
  assert.throws(() => readRasterInfo(bytes), /terpotong/)
})

test('resizing preserves aspect ratio without enlarging small sources', () => {
  assert.deepEqual(fitImage(8000, 4000), { width: 4096, height: 2048 })
  assert.deepEqual(fitImage(400, 800), { width: 400, height: 800 })
  assert.deepEqual(fitImage(1, 10000, 1200), { width: 1, height: 1200 })
  assert.throws(() => fitImage(0, 100), /tidak valid/)
})

test('output rejects fractional, non-finite, and excessive canvas allocation', () => {
  assert.deepEqual(validateImageOutput(1600, 900), { width: 1600, height: 900 })
  for (const pair of [
    [1.5, 2],
    [0, 100],
    [8193, 3],
    [Infinity, 4],
    [8000, 8000],
  ])
    assert.throws(() => validateImageOutput(...pair))
})

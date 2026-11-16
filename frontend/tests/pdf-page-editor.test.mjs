import assert from 'node:assert/strict'
import test from 'node:test'
import {
  pageRotationMatrix,
  rotatedPageSize,
  validatePdfPageSize,
} from '../src/lib/pdf-page-editor.ts'

test('high resolution page dimensions retain a full 600 DPI A4 render without downsampling', () => {
  assert.deepEqual(validatePdfPageSize(4961, 7016), { width: 4961, height: 7016 })
  assert.deepEqual(rotatedPageSize(4961, 7016), { width: 4961, height: 7016 })
  for (const size of [
    [0, 100],
    [100, 1.5],
    [8193, 1],
    [8192, 8192],
    [Infinity, 100],
    [NaN, 100],
  ])
    assert.throws(() => validatePdfPageSize(...size))
  assert.throws(() => rotatedPageSize(100, 200, 45))
})

test('quarter-turn transforms preserve all corners and swap dimensions only when necessary', () => {
  const width = 240,
    height = 400
  for (const angle of [0, 90, 180, 270]) {
    const size = rotatedPageSize(width, height, angle)
    const [a, b, c, d, e, f] = pageRotationMatrix(width, height, angle)
    const corners = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])
    assert.equal(Math.min(...corners.map(([x]) => x)), 0)
    assert.equal(Math.min(...corners.map(([, y]) => y)), 0)
    assert.equal(Math.max(...corners.map(([x]) => x)), size.width)
    assert.equal(Math.max(...corners.map(([, y]) => y)), size.height)
    assert.equal(a * d - b * c, 1)
  }
  assert.deepEqual(rotatedPageSize(width, height, 90), { width: height, height: width })
  assert.deepEqual(rotatedPageSize(width, height, 180), { width, height })
})

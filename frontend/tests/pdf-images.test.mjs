import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blankPdfImageSize,
  changePdfImagePages,
  createPdfImageCollection,
  movePdfImagePage,
  pdfImageExportOptions,
  pdfImageKey,
  redoPdfImagePages,
  removePdfImagePage,
  replacePdfImagePage,
  undoPdfImagePages,
  validatePdfImageImport,
  validatePdfImagePages,
  validatePdfImport,
} from '../src/lib/pdf-images.ts'

function page(id, overrides = {}) {
  return {
    id,
    job_id: 'source-job',
    name: `Page ${id}`,
    width: 2480,
    height: 3508,
    dpi: 300,
    image_url: `/images/${id}.png`,
    thumbnail_url: `/thumbnails/${id}.png`,
    source_page: 1,
    size: 1024,
    ...overrides,
  }
}

test('page ordering and deletion determine exactly what is exported without mutating the original collection', () => {
  const pages = [page('a'), page('b'), page('c')]
  const initial = changePdfImagePages(createPdfImageCollection(), pages, pdfImageKey(pages[1]))
  const moved = movePdfImagePage(initial, pdfImageKey(pages[1]), -1)
  assert.deepEqual(
    moved.pages.map(({ id }) => id),
    ['b', 'a', 'c'],
  )
  assert.deepEqual(
    initial.pages.map(({ id }) => id),
    ['a', 'b', 'c'],
  )
  const removed = removePdfImagePage(moved, pdfImageKey(pages[0]))
  const all = pdfImageExportOptions(removed, 'tiff', 95, true, true)
  assert.deepEqual(
    all.pages.map(({ id }) => id),
    ['b', 'c'],
  )
  const selected = pdfImageExportOptions(removed, 'png', 95, true, false)
  assert.deepEqual(
    selected.pages.map(({ id }) => id),
    ['b'],
  )
  assert.equal(movePdfImagePage(moved, pdfImageKey(pages[1]), -1), moved)
})

test('undo and redo restore immutable originals after edited replacements and page deletion', () => {
  const source = page('original')
  const edited = page('edited', { width: 3508, height: 2480, job_id: 'edit-job' })
  const first = page('first')
  const initial = changePdfImagePages(createPdfImageCollection(), [first, source], pdfImageKey(source))
  const applied = replacePdfImagePage(initial, pdfImageKey(source), edited)
  assert.equal(applied.pages[1].id, 'edited')
  const undone = undoPdfImagePages(applied)
  assert.equal(undone.pages[1], source)
  assert.equal(undone.pages[1].width, 2480)
  assert.equal(undone.pages[1].dpi, 300)
  assert.equal(undone.selected, pdfImageKey(source))
  const redone = redoPdfImagePages(undone)
  assert.equal(redone.pages[1], edited)
  assert.equal(redone.selected, pdfImageKey(edited))
  assert.deepEqual(pdfImageExportOptions(redone, 'png', 95, true, false).pages, [
    { job_id: edited.job_id, id: edited.id },
  ])
  const deleted = removePdfImagePage(applied, pdfImageKey(edited))
  assert.deepEqual(deleted.pages, [first])
  assert.equal(undoPdfImagePages(deleted).pages[1], edited)
  const newBranch = changePdfImagePages(undone, [source, page('new')])
  assert.equal(newBranch.future.length, 0)
  assert.throws(() => replacePdfImagePage(newBranch, 'missing', edited), /sudah tidak ada/)
})

test('pixel/page budgets reject oversized or ambiguous exports while preserving 600 DPI A4 dimensions', () => {
  const highResolution = blankPdfImageSize(600)
  assert.deepEqual(highResolution, { width: 4961, height: 7016, dpi: 600 })
  assert.doesNotThrow(() => validatePdfImagePages([page('hi', highResolution)]))
  assert.throws(() => validatePdfImagePages([page('a'), page('a')]), /sama/)
  assert.throws(() => validatePdfImagePages([page('wide', { width: 8193 })]), /8.192/)
  assert.throws(
    () => validatePdfImagePages(Array.from({ length: 101 }, (_, index) => page(String(index)))),
    /100 halaman/,
  )
  assert.throws(
    () =>
      validatePdfImagePages(
        Array.from({ length: 26 }, (_, index) =>
          page(String(index), { width: 8000, height: 5000 }),
        ),
      ),
    /gigapiksel/,
  )
  assert.throws(
    () => pdfImageExportOptions(createPdfImageCollection(), 'png', 95, true, true),
    /Tambahkan|tambahkan/,
  )
})

test('import limits and blank page sizing are explicit rather than silently downsampling', () => {
  assert.equal(validatePdfImport({ name: 'document.PDF', size: 25 * 1024 * 1024 }), null)
  assert.match(validatePdfImport({ name: 'document.pdf', size: 25 * 1024 * 1024 + 1 }), /25 MB/)
  assert.match(validatePdfImport({ name: 'document.txt', size: 100 }), /PDF/)
  assert.equal(validatePdfImageImport({ name: 'photo.JPEG', size: 100 }), null)
  assert.match(validatePdfImageImport({ name: 'image.svg', size: 100 }), /PNG/)
  assert.match(validatePdfImageImport({ name: 'image.png', size: 129 * 1024 * 1024 }), /128 MB/)
  const selected = page('exact', { width: 6000, height: 4000, dpi: 450 })
  assert.deepEqual(blankPdfImageSize(150, selected), { width: 6000, height: 4000, dpi: 450 })
  assert.throws(() => blankPdfImageSize(601), /75–600/)
})

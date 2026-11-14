import assert from 'node:assert/strict'
import test from 'node:test'
import {
  annotationBounds,
  annotationHistory,
  annotationLocalPoint,
  annotationMatrix,
  createAnnotation,
  EMPTY_ANNOTATION_HISTORY,
  MAX_ANNOTATIONS,
  validateAnnotation,
} from '../src/lib/image-annotations.ts'

const shape = (kind = 'rectangle', id = kind) =>
  createAnnotation(kind, { x: 40, y: 70 }, { x: 240, y: 170 }, 1200, 800, 1, id)

test('reverse-direction drawing produces positive bounds and arrows retain drag direction', () => {
  const rectangle = createAnnotation('rectangle', { x: 240, y: 170 }, { x: 40, y: 70 }, 1200, 800)
  assert.deepEqual(
    [rectangle.x, rectangle.y, rectangle.width, rectangle.height],
    [140, 120, 200, 100],
  )
  const arrow = createAnnotation('arrow', { x: 100, y: 100 }, { x: 40, y: 20 }, 1200, 800)
  assert.equal(arrow.width, 100)
  assert.ok(arrow.rotation < -90 && arrow.rotation > -180)
  assert.equal(validateAnnotation(arrow).kind, 'arrow')
})

test('labels use bounded defaults and preserve caller-assigned numbering', () => {
  const number = createAnnotation('number', { x: 0, y: 0 }, { x: 0, y: 0 }, 20, 20, 7)
  assert.equal(number.number, 7)
  assert.equal(number.width, 20)
  assert.equal(number.height, 20)
  assert.equal(number.x, 10)
  assert.equal(number.y, 10)
  const text = createAnnotation('text', { x: 30, y: 20 }, { x: 30, y: 20 }, 40, 30)
  assert.ok(text.width <= 40 && text.height <= 30)
})

test('rotated and skewed coordinates invert correctly for resizing and hit testing', () => {
  const annotation = { ...shape(), rotation: 33, skewX: 21, skewY: -12 }
  validateAnnotation(annotation)
  const [a, b, c, d, e, f] = annotationMatrix(annotation)
  for (const point of [
    { x: 0, y: 0 },
    { x: -70, y: 25 },
    { x: 100, y: -50 },
  ]) {
    const world = { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }
    const local = annotationLocalPoint(annotation, world)
    assert.ok(Math.abs(local.x - point.x) < 1e-8)
    assert.ok(Math.abs(local.y - point.y) < 1e-8)
  }
})

test('blur crop bounds include every corner after rotation and skew', () => {
  const annotation = { ...shape('blur'), rotation: 90 }
  const bounds = annotationBounds(annotation)
  assert.ok(Math.abs(bounds.left - 90) < 1e-8)
  assert.ok(Math.abs(bounds.right - 190) < 1e-8)
  assert.ok(Math.abs(bounds.top - 20) < 1e-8)
  assert.ok(Math.abs(bounds.bottom - 220) < 1e-8)
})

test('transform and style validation rejects singular skew and unsafe canvas values', () => {
  for (const patch of [
    { skewX: 45, skewY: 45 },
    { width: 0 },
    { height: 33000 },
    { x: Infinity },
    { rotation: 361 },
    { skewX: 46 },
    { strokeWidth: 0 },
    { blur: 151 },
    { fontSize: 0 },
    { text: 'a'.repeat(1001) },
    { color: 'url(javascript:1)' },
    { number: 1.5 },
  ])
    assert.throws(() => validateAnnotation({ ...shape(), ...patch }))
})

test('undo and redo preserve previous snapshots and a new edit discards the redo branch', () => {
  const original = shape()
  let state = annotationHistory(EMPTY_ANNOTATION_HISTORY, { type: 'commit', value: [original] })
  original.x = 999
  assert.equal(state.present[0].x, 140)
  state = annotationHistory(state, { type: 'commit', value: [{ ...state.present[0], x: 250 }] })
  state = annotationHistory(state, { type: 'undo' })
  assert.equal(state.present[0].x, 140)
  state = annotationHistory(state, { type: 'redo' })
  assert.equal(state.present[0].x, 250)
  state = annotationHistory(state, { type: 'undo' })
  state = annotationHistory(state, { type: 'commit', value: [{ ...state.present[0], x: 300 }] })
  assert.equal(state.future.length, 0)
  assert.equal(state.present[0].x, 300)
  assert.deepEqual(annotationHistory(state, { type: 'reset' }), EMPTY_ANNOTATION_HISTORY)
})

test('history is bounded and identical commits do not create useless undo steps', () => {
  let state = annotationHistory(EMPTY_ANNOTATION_HISTORY, { type: 'commit', value: [shape()] })
  const same = annotationHistory(state, { type: 'commit', value: state.present })
  assert.equal(same, state)
  for (let index = 0; index < 120; index += 1)
    state = annotationHistory(state, { type: 'commit', value: [{ ...shape(), x: index }] })
  assert.equal(state.past.length, 80)
  assert.throws(
    () =>
      annotationHistory(state, {
        type: 'commit',
        value: Array.from({ length: MAX_ANNOTATIONS + 1 }, (_, index) =>
          shape('rectangle', String(index)),
        ),
      }),
    /100 anotasi/,
  )
})

export type AnnotationKind = 'rectangle' | 'ellipse' | 'arrow' | 'number' | 'text' | 'blur'
export type AnnotationTool = AnnotationKind | 'select'
export interface ImagePoint {
  x: number
  y: number
}
export type AnnotationCorner = 'nw' | 'ne' | 'se' | 'sw'
export interface ImageAnnotation {
  id: string
  kind: AnnotationKind
  x: number
  y: number
  width: number
  height: number
  rotation: number
  skewX: number
  skewY: number
  color: string
  strokeWidth: number
  fontSize: number
  text: string
  number: number
  blur: number
}
export interface AnnotationHistory {
  past: ImageAnnotation[][]
  present: ImageAnnotation[]
  future: ImageAnnotation[][]
}
export type AnnotationAction =
  | { type: 'commit'; value: ImageAnnotation[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' }

export const MAX_ANNOTATIONS = 100
export const EMPTY_ANNOTATION_HISTORY: AnnotationHistory = { past: [], present: [], future: [] }

export function annotationHistory(
  state: AnnotationHistory,
  action: AnnotationAction,
): AnnotationHistory {
  if (action.type === 'reset') return { past: [], present: [], future: [] }
  if (action.type === 'undo') {
    if (!state.past.length) return state
    return {
      past: state.past.slice(0, -1),
      present: state.past[state.past.length - 1]!,
      future: [state.present, ...state.future].slice(0, 80),
    }
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state
    return {
      past: [...state.past, state.present].slice(-80),
      present: state.future[0]!,
      future: state.future.slice(1),
    }
  }
  if (action.value.length > MAX_ANNOTATIONS) throw new Error('Maksimal 100 anotasi per gambar.')
  if (JSON.stringify(action.value) === JSON.stringify(state.present)) return state
  return {
    past: [...state.past, state.present].slice(-80),
    present: action.value.map((value) => ({ ...value })),
    future: [],
  }
}

export function annotationFontSize(width: number, height: number) {
  return Math.round(Math.max(18, Math.min(120, Math.max(width, height) / 35)))
}

export function createAnnotation(
  kind: AnnotationKind,
  start: ImagePoint,
  end: ImagePoint,
  imageWidth: number,
  imageHeight: number,
  number = 1,
  id: string = crypto.randomUUID(),
): ImageAnnotation {
  const fontSize = annotationFontSize(imageWidth, imageHeight)
  const clampX = (value: number) => Math.max(0, Math.min(imageWidth, value))
  const clampY = (value: number) => Math.max(0, Math.min(imageHeight, value))
  const first = { x: clampX(start.x), y: clampY(start.y) }
  const last = { x: clampX(end.x), y: clampY(end.y) }
  let width = Math.max(4, Math.abs(last.x - first.x))
  let height = Math.max(4, Math.abs(last.y - first.y))
  let x = (first.x + last.x) / 2
  let y = (first.y + last.y) / 2
  let rotation = 0
  if (kind === 'arrow') {
    width = Math.max(fontSize, Math.hypot(last.x - first.x, last.y - first.y))
    height = fontSize
    rotation = (Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI
  } else if (kind === 'number' || kind === 'text') {
    width = Math.min(imageWidth, kind === 'number' ? fontSize * 1.8 : fontSize * 5)
    height = Math.min(imageHeight, kind === 'number' ? fontSize * 1.8 : fontSize * 1.5)
    x = Math.min(imageWidth - width / 2, Math.max(width / 2, first.x))
    y = Math.min(imageHeight - height / 2, Math.max(height / 2, first.y))
  }
  return {
    id,
    kind,
    x,
    y,
    width,
    height,
    rotation,
    skewX: 0,
    skewY: 0,
    color: '#23745c',
    strokeWidth: Math.max(2, Math.round(fontSize / 10)),
    fontSize,
    text: 'Teks',
    number,
    blur: Math.max(6, Math.round(fontSize / 2)),
  }
}

export function validateAnnotation(value: ImageAnnotation): ImageAnnotation {
  const finite = [
    value.x,
    value.y,
    value.width,
    value.height,
    value.rotation,
    value.skewX,
    value.skewY,
    value.strokeWidth,
    value.fontSize,
    value.blur,
    value.number,
  ]
  if (!finite.every(Number.isFinite))
    throw new Error('Nilai anotasi harus berupa angka yang valid.')
  if (value.width < 2 || value.height < 2 || value.width > 32768 || value.height > 32768)
    throw new Error('Ukuran bentuk harus antara 2 dan 32.768 piksel.')
  if (Math.abs(value.rotation) > 360 || Math.abs(value.skewX) > 45 || Math.abs(value.skewY) > 45)
    throw new Error('Rotasi maksimal 360° dan skew maksimal ±45°.')
  const determinant =
    1 - Math.tan((value.skewX * Math.PI) / 180) * Math.tan((value.skewY * Math.PI) / 180)
  if (Math.abs(determinant) < 0.15)
    throw new Error('Kombinasi skew terlalu pipih. Kurangi salah satu sudutnya.')
  if (
    value.fontSize < 8 ||
    value.fontSize > 1000 ||
    value.strokeWidth < 1 ||
    value.strokeWidth > 200 ||
    value.blur < 1 ||
    value.blur > 150
  )
    throw new Error('Ukuran teks, garis, atau blur di luar batas.')
  if (!/^#[0-9a-f]{6}$/i.test(value.color)) throw new Error('Warna anotasi tidak valid.')
  if (
    value.text.length > 1000 ||
    !Number.isInteger(value.number) ||
    value.number < 1 ||
    value.number > 999
  )
    throw new Error('Teks maksimal 1.000 karakter dan nomor antara 1–999.')
  return { ...value }
}

export function annotationMatrix(
  value: ImageAnnotation,
): [number, number, number, number, number, number] {
  const angle = (value.rotation * Math.PI) / 180
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  const tx = Math.tan((value.skewX * Math.PI) / 180),
    ty = Math.tan((value.skewY * Math.PI) / 180)
  return [cos - sin * ty, sin + cos * ty, cos * tx - sin, sin * tx + cos, value.x, value.y]
}

export function annotationLocalPoint(value: ImageAnnotation, point: ImagePoint): ImagePoint {
  const [a, b, c, d, e, f] = annotationMatrix(value)
  const determinant = a * d - b * c
  if (Math.abs(determinant) < 0.15) throw new Error('Bentuk terlalu pipih untuk dipilih.')
  return {
    x: (d * (point.x - e) - c * (point.y - f)) / determinant,
    y: (-b * (point.x - e) + a * (point.y - f)) / determinant,
  }
}

/** Resize in the shape's own axes while its opposite corner stays fixed. */
export function resizeAnnotation(
  value: ImageAnnotation,
  point: ImagePoint,
  corner: AnnotationCorner,
): ImageAnnotation {
  const horizontal = corner.endsWith('w') ? -1 : 1
  const vertical = corner.startsWith('n') ? -1 : 1
  const anchor = { x: (-horizontal * value.width) / 2, y: (-vertical * value.height) / 2 }
  const local = annotationLocalPoint(value, point)
  const width = Math.max(2, Math.min(32768, horizontal * (local.x - anchor.x)))
  const height = Math.max(2, Math.min(32768, vertical * (local.y - anchor.y)))
  const center = { x: anchor.x + (horizontal * width) / 2, y: anchor.y + (vertical * height) / 2 }
  const [a, b, c, d, e, f] = annotationMatrix(value)
  return {
    ...value,
    width,
    height,
    x: a * center.x + c * center.y + e,
    y: b * center.x + d * center.y + f,
  }
}

/** Rotate around the existing center; Shift snaps the final angle to 15 degrees. */
export function rotateAnnotation(
  value: ImageAnnotation,
  start: ImagePoint,
  end: ImagePoint,
  snap = false,
): ImageAnnotation {
  if (Math.hypot(end.x - value.x, end.y - value.y) < 0.001) return value
  const angle = (point: ImagePoint) => Math.atan2(point.y - value.y, point.x - value.x)
  const delta = ((angle(end) - angle(start)) * 180) / Math.PI
  const rotation = value.rotation + delta
  const normalized = ((((rotation + 180) % 360) + 360) % 360) - 180
  return { ...value, rotation: snap ? Math.round(normalized / 15) * 15 : normalized }
}

export function annotationBounds(value: ImageAnnotation) {
  const [a, b, c, d, e, f] = annotationMatrix(value)
  const points = [
    [-value.width / 2, -value.height / 2],
    [value.width / 2, -value.height / 2],
    [value.width / 2, value.height / 2],
    [-value.width / 2, value.height / 2],
  ].map(([x, y]) => ({ x: a * x! + c * y! + e, y: b * x! + d * y! + f }))
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  }
}

/** Draw in source-image coordinates, matching the SVG selection overlay transform. */
export function drawImageAnnotations(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  values: ImageAnnotation[],
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
) {
  const sx = outputWidth / sourceWidth,
    sy = outputHeight / sourceHeight
  for (const value of values) {
    validateAnnotation(value)
    context.save()
    context.scale(sx, sy)
    context.transform(...annotationMatrix(value))
    context.lineWidth = value.strokeWidth
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = value.color
    context.fillStyle = value.color
    const w = value.width,
      h = value.height
    if (value.kind === 'blur') {
      context.beginPath()
      context.rect(-w / 2, -h / 2, w, h)
      context.clip()
      context.setTransform(sx, 0, 0, sy, 0, 0)
      const bounds = annotationBounds(value),
        padding = value.blur * 3
      const left = Math.max(0, Math.floor(bounds.left - padding)),
        top = Math.max(0, Math.floor(bounds.top - padding))
      const right = Math.min(sourceWidth, Math.ceil(bounds.right + padding)),
        bottom = Math.min(sourceHeight, Math.ceil(bounds.bottom + padding))
      if (right > left && bottom > top) {
        context.filter = `blur(${value.blur * Math.max(sx, sy)}px)`
        context.drawImage(
          image,
          left,
          top,
          right - left,
          bottom - top,
          left,
          top,
          right - left,
          bottom - top,
        )
      }
    } else if (value.kind === 'rectangle') {
      context.strokeRect(-w / 2, -h / 2, w, h)
    } else if (value.kind === 'ellipse') {
      context.beginPath()
      context.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
      context.stroke()
    } else if (value.kind === 'arrow') {
      const head = Math.min(w * 0.3, Math.max(value.strokeWidth * 4, value.fontSize * 0.55))
      context.beginPath()
      context.moveTo(-w / 2, 0)
      context.lineTo(w / 2, 0)
      context.stroke()
      context.beginPath()
      context.moveTo(w / 2, 0)
      context.lineTo(w / 2 - head, -head * 0.5)
      context.lineTo(w / 2 - head, head * 0.5)
      context.closePath()
      context.fill()
    } else if (value.kind === 'number') {
      const radius = Math.min(w, h) / 2
      context.beginPath()
      context.arc(0, 0, radius, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#ffffff'
      context.font = `600 ${radius * 1.1}px Geist, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(String(value.number), 0, radius * 0.04, w * 0.8)
    } else {
      context.beginPath()
      context.rect(-w / 2, -h / 2, w, h)
      context.clip()
      context.font = `600 ${value.fontSize}px Geist, sans-serif`
      context.textBaseline = 'top'
      for (const [index, line] of value.text.split('\n').entries())
        context.fillText(line, -w / 2, -h / 2 + index * value.fontSize * 1.2, w)
    }
    context.restore()
  }
}

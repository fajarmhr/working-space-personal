import { normalizeForEditor } from './text-compare.ts'

export interface CompareLineChange {
  originalStartLineNumber: number
  originalEndLineNumber: number
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
}

type Side = 'left' | 'right'
export interface MovedBlock {
  id: string
  leftStart: number
  leftEnd: number
  rightStart: number
  rightEnd: number
}
/** Monaco represents an empty range by an end of zero and a preceding-line start. */
export function changeRange(change: CompareLineChange, side: Side): [number, number] {
  const start = side === 'left' ? change.originalStartLineNumber : change.modifiedStartLineNumber
  const end = side === 'left' ? change.originalEndLineNumber : change.modifiedEndLineNumber
  return end === 0 ? [start, start] : [start - 1, end]
}

function changedLines(changes: readonly CompareLineChange[], side: Side, count: number) {
  const mask = new Uint8Array(count)
  for (const change of changes) {
    const [start, end] = changeRange(change, side)
    mask.fill(1, Math.max(0, start), Math.min(count, end))
  }
  return mask
}

interface Positions {
  values: number[]
  cursor: number
}

/**
 * Match exact, non-overlapping runs in the unmatched lines, independently of the
 * whitespace comparison setting. Small bounded candidate sets keep repeated
 * scripts from degenerating into an all-pairs comparison.
 */
export function detectMovedBlocks(
  leftText: string,
  rightText: string,
  changes: readonly CompareLineChange[],
): MovedBlock[] {
  const left = normalizeForEditor(leftText).split('\n')
  const right = normalizeForEditor(rightText).split('\n')
  const leftMask = changedLines(changes, 'left', left.length)
  const rightMask = changedLines(changes, 'right', right.length)
  // A final empty editor line records the trailing newline, not movable text.
  if (left.at(-1) === '') leftMask[left.length - 1] = 0
  if (right.at(-1) === '') rightMask[right.length - 1] = 0
  // Diff engines can coalesce nearby changes. Equal lines at the corresponding
  // position in such a section are already aligned and must not acquire a move.
  for (const change of changes) {
    const [ls, le] = changeRange(change, 'left')
    const [rs, re] = changeRange(change, 'right')
    for (let offset = 0; offset < Math.min(le - ls, re - rs); offset += 1) {
      if (left[ls + offset] === right[rs + offset]) {
        leftMask[ls + offset] = 0
        rightMask[rs + offset] = 0
      }
    }
  }

  const ids = new Map<string, number>()
  function lineId(line: string) {
    let id = ids.get(line)
    if (id === undefined) {
      id = ids.size
      ids.set(line, id)
    }
    return id
  }
  const leftIds = left.map(lineId)
  const rightIds = right.map(lineId)
  const singles = new Map<number, Positions>()
  const triples = new Map<string, Positions>()
  function add<K>(map: Map<K, Positions>, key: K, position: number) {
    const item = map.get(key)
    if (item) item.values.push(position)
    else map.set(key, { values: [position], cursor: 0 })
  }
  for (let index = 0; index < right.length; index += 1) {
    if (!rightMask[index]) continue
    add(singles, rightIds[index]!, index)
    if (rightMask[index + 1] && rightMask[index + 2])
      add(triples, `${rightIds[index]},${rightIds[index + 1]},${rightIds[index + 2]}`, index)
  }
  function candidates(positions: Positions | undefined): number[] {
    if (!positions) return []
    while (
      positions.cursor < positions.values.length &&
      !rightMask[positions.values[positions.cursor]!]
    )
      positions.cursor += 1
    const result: number[] = []
    // At most four runs are examined for a line. Each successful examination
    // advances the left cursor by the longest run, bounding total matching work.
    const scanEnd = Math.min(positions.values.length, positions.cursor + 32)
    for (let index = positions.cursor; index < scanEnd && result.length < 4; index += 1) {
      const position = positions.values[index]!
      if (rightMask[position]) result.push(position)
    }
    return result
  }

  const moves: MovedBlock[] = []
  for (let ls = 0; ls < left.length; ls += 1) {
    if (!leftMask[ls] || !left[ls]!.trim()) continue
    const triple =
      leftMask[ls + 1] && leftMask[ls + 2]
        ? triples.get(`${leftIds[ls]},${leftIds[ls + 1]},${leftIds[ls + 2]}`)
        : undefined
    const options = candidates(triple)
    if (!options.length) options.push(...candidates(singles.get(leftIds[ls]!)))
    let bestStart = -1
    let bestLength = 0
    for (const rs of options) {
      let length = 0
      while (
        leftMask[ls + length] &&
        rightMask[rs + length] &&
        leftIds[ls + length] === rightIds[rs + length]
      )
        length += 1
      // Keep blank separator lines outside the move; moving a script should not
      // move an unrelated blank line or change whether the file ends in LF.
      while (length && !left[ls + length - 1]!.trim()) length -= 1
      if (length > bestLength) {
        bestStart = rs
        bestLength = length
      }
    }
    if (!bestLength) continue
    const le = ls + bestLength
    const re = bestStart + bestLength
    moves.push({
      id: `move-${ls}-${bestStart}-${bestLength}`,
      leftStart: ls,
      leftEnd: le,
      rightStart: bestStart,
      rightEnd: re,
    })
    leftMask.fill(0, ls, le)
    rightMask.fill(0, bestStart, re)
    ls = le - 1
  }
  return moves
}

function mappedBoundary(line: number, from: Side, changes: readonly CompareLineChange[]) {
  const to = from === 'left' ? 'right' : 'left'
  let delta = 0
  for (const change of changes) {
    const [sourceStart, sourceEnd] = changeRange(change, from)
    const [targetStart, targetEnd] = changeRange(change, to)
    if (line < sourceStart) return line + delta
    if (line < sourceEnd) return targetStart + Math.min(line - sourceStart, targetEnd - targetStart)
    delta = targetEnd - sourceEnd
  }
  return line + delta
}

function moveBoundary(
  ss: number,
  se: number,
  from: Side,
  source: string[],
  target: string[],
  sourceText: string,
  targetText: string,
  changes: readonly CompareLineChange[],
) {
  const to = from === 'left' ? 'right' : 'left'
  const section = changes.find((change) => {
    const [start, end] = changeRange(change, from)
    return ss >= start && ss < end
  })
  if (!section) return mappedBoundary(ss, from, changes)
  const [sourceStart, sourceEnd] = changeRange(section, from)
  const [targetStart, targetEnd] = changeRange(section, to)
  if (targetStart === targetEnd) return targetStart

  // A coalesced replacement can contain several reordered runs. Prefer a
  // concrete neighboring match to an arbitrary equal-offset position.
  let precedingSource = -1
  let precedingTarget = -1
  let followingSource = Number.POSITIVE_INFINITY
  let followingTarget = -1
  function anchor(start: number, end: number, targetRunStart: number, targetRunEnd: number) {
    if (end <= ss && end > precedingSource) {
      precedingSource = end
      precedingTarget = targetRunEnd
    }
    if (start >= se && start < followingSource) {
      followingSource = start
      followingTarget = targetRunStart
    }
  }
  for (
    let offset = 0;
    offset < Math.min(sourceEnd - sourceStart, targetEnd - targetStart);
    offset += 1
  ) {
    if (source[sourceStart + offset] === target[targetStart + offset])
      anchor(
        sourceStart + offset,
        sourceStart + offset + 1,
        targetStart + offset,
        targetStart + offset + 1,
      )
  }
  const matches =
    from === 'left'
      ? detectMovedBlocks(sourceText, targetText, changes)
      : detectMovedBlocks(targetText, sourceText, changes)
  for (const match of matches) {
    const [start, end, targetRunStart, targetRunEnd] =
      from === 'left'
        ? [match.leftStart, match.leftEnd, match.rightStart, match.rightEnd]
        : [match.rightStart, match.rightEnd, match.leftStart, match.leftEnd]
    if (
      start >= sourceStart &&
      end <= sourceEnd &&
      targetRunStart >= targetStart &&
      targetRunEnd <= targetEnd
    )
      anchor(start, end, targetRunStart, targetRunEnd)
  }
  if (precedingTarget >= 0) return precedingTarget
  if (followingTarget >= 0) return followingTarget
  return mappedBoundary(ss, from, changes)
}

/** Move only the matched target run; no other target lines are replaced. */
export function reconcileMovedBlock(
  targetText: string,
  sourceText: string,
  move: MovedBlock,
  from: Side,
  changes: readonly CompareLineChange[],
): string {
  const source = normalizeForEditor(sourceText).split('\n')
  const target = normalizeForEditor(targetText).split('\n')
  const [ss, se, ts, te] =
    from === 'left'
      ? [move.leftStart, move.leftEnd, move.rightStart, move.rightEnd]
      : [move.rightStart, move.rightEnd, move.leftStart, move.leftEnd]
  if (
    ![ss, se, ts, te].every(Number.isInteger) ||
    ss < 0 ||
    ts < 0 ||
    se <= ss ||
    te <= ts ||
    se > source.length ||
    te > target.length ||
    se - ss !== te - ts
  )
    throw new Error('Rentang perpindahan sudah tidak valid. Tunggu perbandingan terbaru.')
  const block = source.slice(ss, se)
  if (block.some((line, index) => target[ts + index] !== line))
    throw new Error('Isi pasangan perpindahan berubah. Tunggu perbandingan terbaru.')
  const mapped = moveBoundary(ss, se, from, source, target, sourceText, targetText, changes)
  if (mapped < 0 || mapped > target.length)
    throw new Error('Posisi perpindahan sudah tidak valid. Tunggu perbandingan terbaru.')
  // Monaco may map an EOF replacement past the final empty editor line when
  // the two files disagree about their trailing LF. That line is structural:
  // insert before it so moving text retains the target's newline convention.
  const boundary = target.at(-1) === '' ? Math.min(mapped, target.length - 1) : mapped
  if (boundary >= ts && boundary <= te) return target.join('\n')
  const remaining = [...target.slice(0, ts), ...target.slice(te)]
  const destination = boundary > te ? boundary - (te - ts) : boundary
  const result = [
    ...remaining.slice(0, destination),
    ...block,
    ...remaining.slice(destination),
  ].join('\n')
  return normalizeForEditor(result)
}

export interface ComparisonRow {
  key: string
  /** Zero-based positions in the original, unfiltered documents. */
  left: number | null
  right: number | null
  changed: boolean
  changeIndex: number | null
  offset: number
  leftMove?: string
  rightMove?: string
}

/**
 * A display projection only: indices and copy offsets always refer to the full
 * documents. Monaco's alignment view zones remain outside this filtered view.
 */
export function buildComparisonRows(
  leftText: string,
  rightText: string,
  changes: readonly CompareLineChange[],
  filter: 'all' | 'different' | 'same' | 'moved',
  moves: readonly MovedBlock[],
  ignoreSpace = false,
): ComparisonRow[] {
  const left = normalizeForEditor(leftText).split('\n')
  const right = normalizeForEditor(rightText).split('\n')
  const leftMoves = new Map<number, string>()
  const rightMoves = new Map<number, string>()
  for (const move of moves) {
    for (let line = move.leftStart; line < move.leftEnd; line += 1) leftMoves.set(line, move.id)
    for (let line = move.rightStart; line < move.rightEnd; line += 1) rightMoves.set(line, move.id)
  }
  const rows: ComparisonRow[] = []
  function append(
    l: number | null,
    r: number | null,
    changed: boolean,
    changeIndex: number | null,
    offset: number,
  ) {
    const leftMove = l === null ? undefined : leftMoves.get(l)
    const rightMove = r === null ? undefined : rightMoves.get(r)
    const key = `row-${l ?? 'gap'}-${r ?? 'gap'}`
    if ((filter === 'same' && changed) || (filter === 'different' && !changed)) return
    if (filter === 'moved') {
      // Preserve each origin's position rather than visually pairing unrelated
      // reordered lines that happen to share an alignment row.
      if (leftMove)
        rows.push({
          key: `${key}-left`,
          left: l,
          right: null,
          changed,
          changeIndex,
          offset,
          leftMove,
        })
      if (rightMove)
        rows.push({
          key: `${key}-right`,
          left: null,
          right: r,
          changed,
          changeIndex,
          offset,
          rightMove,
        })
      return
    }
    rows.push({ key, left: l, right: r, changed, changeIndex, offset, leftMove, rightMove })
  }
  let leftCursor = 0
  let rightCursor = 0
  function unchangedUntil(leftEnd: number, rightEnd: number) {
    const count = Math.max(leftEnd - leftCursor, rightEnd - rightCursor)
    for (let offset = 0; offset < count; offset += 1) {
      const l = leftCursor + offset < leftEnd ? leftCursor + offset : null
      const r = rightCursor + offset < rightEnd ? rightCursor + offset : null
      append(l, r, l === null || r === null, null, offset)
    }
    leftCursor = leftEnd
    rightCursor = rightEnd
  }
  changes.forEach((change, changeIndex) => {
    const [ls, le] = changeRange(change, 'left')
    const [rs, re] = changeRange(change, 'right')
    const leftStart = Math.max(leftCursor, Math.min(left.length, ls))
    const rightStart = Math.max(rightCursor, Math.min(right.length, rs))
    const leftEnd = Math.max(leftStart, Math.min(left.length, le))
    const rightEnd = Math.max(rightStart, Math.min(right.length, re))
    unchangedUntil(leftStart, rightStart)
    const count = Math.max(leftEnd - leftStart, rightEnd - rightStart)
    for (let offset = 0; offset < count; offset += 1) {
      const l = leftStart + offset < leftEnd ? leftStart + offset : null
      const r = rightStart + offset < rightEnd ? rightStart + offset : null
      const changed =
        l === null ||
        r === null ||
        (ignoreSpace ? left[l]!.trim() !== right[r]!.trim() : left[l] !== right[r])
      append(l, r, changed, changeIndex, offset)
    }
    leftCursor = leftEnd
    rightCursor = rightEnd
  })
  unchangedUntil(left.length, right.length)
  return rows
}

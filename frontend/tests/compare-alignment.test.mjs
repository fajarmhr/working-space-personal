import assert from 'node:assert/strict'
import test from 'node:test'
import { DefaultLinesDiffComputer } from '../node_modules/monaco-editor/esm/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js'
import {
  buildComparisonRows,
  changeRange,
  detectMovedBlocks,
  reconcileMovedBlock,
} from '../src/lib/compare-alignment.ts'

const change = (ls, le, rs, re) => ({
  originalStartLineNumber: ls,
  originalEndLineNumber: le,
  modifiedStartLineNumber: rs,
  modifiedEndLineNumber: re,
})

test('Monaco insertion and deletion sentinels become half-open ranges', () => {
  assert.deepEqual(changeRange(change(0, 0, 1, 2), 'left'), [0, 0])
  assert.deepEqual(changeRange(change(2, 3, 1, 0), 'left'), [1, 3])
  assert.deepEqual(changeRange(change(2, 3, 1, 0), 'right'), [1, 1])
})

test('single-line swaps are marked and reconcile in both directions without duplicates', () => {
  const left = 'ADD A;\nADD B;\nEND;'
  const right = 'ADD B;\nADD A;\nEND;'
  const changes = [change(1, 1, 0, 0), change(2, 0, 2, 2)]
  const moves = detectMovedBlocks(left, right, changes)
  assert.deepEqual(
    moves.map(({ id, ...range }) => range),
    [{ leftStart: 0, leftEnd: 1, rightStart: 1, rightEnd: 2 }],
  )
  assert.equal(reconcileMovedBlock(right, left, moves[0], 'left', changes), left)
  assert.equal(reconcileMovedBlock(left, right, moves[0], 'right', changes), right)
  assert.deepEqual(detectMovedBlocks(left, right, changes), moves)
})

test('multiline moved scripts preserve unrelated target modifications and LF', () => {
  const left = 'begin\nconfigure A\n  activate A\nanchor\nold\nend\n'
  const right = 'begin\nanchor\nnew\nconfigure A\n  activate A\nend\n'
  const changes = [change(2, 3, 1, 0), change(5, 5, 3, 5)]
  const [move] = detectMovedBlocks(left, right, changes)
  assert.deepEqual(
    { ...move, id: '' },
    { id: '', leftStart: 1, leftEnd: 3, rightStart: 3, rightEnd: 5 },
  )
  assert.equal(
    reconcileMovedBlock(right, left, move, 'left', changes),
    'begin\nconfigure A\n  activate A\nanchor\nnew\nend\n',
  )
})

test('coalesced replacement sections use neighboring exact runs as placement anchors', () => {
  const changes = [change(1, 2, 1, 2)]
  const left = 'A\nB'
  const right = 'B\nA'
  const moves = detectMovedBlocks(left, right, changes)
  assert.equal(moves.length, 2)
  for (const move of moves) {
    assert.equal(reconcileMovedBlock(right, left, move, 'left', changes), left)
    assert.equal(reconcileMovedBlock(left, right, move, 'right', changes), right)
  }
  const section = [change(1, 4, 1, 4)]
  const [moveC] = detectMovedBlocks('C\nA\nB\nD', 'A\nB\nD\nC', section)
  assert.equal(
    reconcileMovedBlock('A\nB\nD\nC', 'C\nA\nB\nD', moveC, 'left', section),
    'C\nA\nB\nD',
  )
})

test('repeated lines are paired one to one without consuming a counterpart twice', () => {
  const left = 'A\nR\nA\nS\nanchor\n'
  const right = 'anchor\nA\nS\nA\nR\n'
  const changes = [change(1, 4, 0, 0), change(5, 0, 2, 5)]
  const moves = detectMovedBlocks(left, right, changes)
  const leftUsed = moves.flatMap((m) =>
    Array.from({ length: m.leftEnd - m.leftStart }, (_, i) => m.leftStart + i),
  )
  const rightUsed = moves.flatMap((m) =>
    Array.from({ length: m.rightEnd - m.rightStart }, (_, i) => m.rightStart + i),
  )
  assert.equal(new Set(leftUsed).size, leftUsed.length)
  assert.equal(new Set(rightUsed).size, rightUsed.length)
  for (const m of moves)
    assert.deepEqual(
      left.split('\n').slice(m.leftStart, m.leftEnd),
      right.split('\n').slice(m.rightStart, m.rightEnd),
    )
  assert.equal(leftUsed.length, 4)
})

test('blank-only, whitespace changes and corresponding lines are not moves', () => {
  assert.deepEqual(detectMovedBlocks(' \n\n', '\n \n', [change(1, 3, 1, 3)]), [])
  assert.deepEqual(
    detectMovedBlocks('ADD A;\nleftOnly', 'rightOnly\nADD A; ', [change(1, 2, 1, 2)]),
    [],
  )
  assert.deepEqual(
    detectMovedBlocks('old\nsame\nold2', 'new\nsame\nnew2', [change(1, 3, 1, 3)]),
    [],
  )
})

test('start and EOF moves preserve the target terminal-newline convention', () => {
  for (const suffix of ['', '\n']) {
    const left = `A\nB${suffix}`
    const right = `B\nA${suffix}`
    const changes = [change(1, 1, 0, 0), change(2, 0, 2, 2)]
    const [move] = detectMovedBlocks(left, right, changes)
    assert.equal(reconcileMovedBlock(left, right, move, 'right', changes), right)
    assert.equal(reconcileMovedBlock(right, left, move, 'left', changes), left)
  }
})

test('stale or invalid move matches fail without changing content', () => {
  const changes = [change(1, 1, 0, 0), change(2, 0, 2, 2)]
  const [move] = detectMovedBlocks('A\nB', 'B\nA', changes)
  assert.throws(() => reconcileMovedBlock('B\nchanged', 'A\nB', move, 'left', changes), /berubah/)
  assert.throws(
    () => reconcileMovedBlock('B\nA', 'A\nB', { ...move, rightEnd: 10 }, 'left', changes),
    /tidak valid/,
  )
})

test('large repeated scripts finish with one-to-one exact ranges', () => {
  const commands = Array.from({ length: 12000 }, (_, i) => `ADD ITEM ${i % 47};`)
  const left = `${commands.join('\n')}\nanchor`
  const right = `anchor\n${commands.join('\n')}`
  const changes = [change(1, 12000, 0, 0), change(12001, 0, 2, 12001)]
  const moves = detectMovedBlocks(left, right, changes)
  assert.equal(moves.length, 1)
  assert.equal(moves[0].leftEnd - moves[0].leftStart, 12000)
  assert.equal(reconcileMovedBlock(right, left, moves[0], 'left', changes), left)
})

test('filtered projections retain original line numbers and exact insertion copy offsets', () => {
  const left = 'A\nC\nD'
  const right = 'A\nB\nC\nD'
  const changes = [change(1, 0, 2, 2)]
  const same = buildComparisonRows(left, right, changes, 'same', [])
  assert.deepEqual(
    same.map((row) => [row.left, row.right]),
    [
      [0, 0],
      [1, 2],
      [2, 3],
    ],
  )
  assert.ok(same.every((row) => row.changed === false))
  const different = buildComparisonRows(left, right, changes, 'different', [])
  assert.deepEqual(
    different.map((row) => [row.left, row.right, row.changeIndex, row.offset]),
    [[null, 1, 0, 0]],
  )
  assert.equal(different[0].changed, true)
  assert.equal(buildComparisonRows(left, right, changes, 'all', []).length, 4)
})

test('multi-line replacement projections keep deletion rows and both-direction action metadata', () => {
  const changes = [change(2, 4, 2, 2)]
  const rows = buildComparisonRows(
    'first\nx\ny\nz\nlast',
    'first\nnew\nlast',
    changes,
    'different',
    [],
  )
  assert.deepEqual(
    rows.map((row) => [row.left, row.right, row.changeIndex, row.offset]),
    [
      [1, 1, 0, 0],
      [2, null, 0, 1],
      [3, null, 0, 2],
    ],
  )
})

test('moved projection separates source origins instead of pairing unrelated reordered commands', () => {
  const left = 'ADD A;\nADD B;\nEND;'
  const right = 'ADD B;\nADD A;\nEND;'
  const changes = [change(1, 1, 0, 0), change(2, 0, 2, 2)]
  const moves = detectMovedBlocks(left, right, changes)
  const rows = buildComparisonRows(left, right, changes, 'moved', moves)
  assert.deepEqual(
    rows.map((row) => [row.left, row.right]),
    [
      [0, null],
      [null, 1],
    ],
  )
  assert.equal(rows[0].leftMove, moves[0].id)
  assert.equal(rows[1].rightMove, moves[0].id)
  assert.deepEqual(
    rows.map((row) => [row.changeIndex, row.offset]),
    [
      [0, 0],
      [1, 0],
    ],
  )
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length)
})

test('projections treat coalesced equal lines and ignored-whitespace gaps as same', () => {
  const rows = buildComparisonRows(
    'old\nsame\nold2',
    'new\nsame\nnew2',
    [change(1, 3, 1, 3)],
    'same',
    [],
  )
  assert.deepEqual(
    rows.map((row) => [row.left, row.right]),
    [[1, 1]],
  )
  assert.deepEqual(buildComparisonRows(' a ', 'a', [], 'different', []), [])
  assert.equal(buildComparisonRows(' a ', 'a', [], 'same', []).length, 1)
  assert.deepEqual(buildComparisonRows('', '', [], 'different', []), [])
  assert.equal(buildComparisonRows('', '', [], 'same', []).length, 1)
})

test('projections do not reveal unchanged contents when only one side has different rows', () => {
  const left = 'same'
  const right = 'same\nadded'
  const rows = buildComparisonRows(left, right, [change(1, 0, 2, 2)], 'different', [])
  assert.deepEqual(
    rows.map((row) => [row.left, row.right]),
    [[null, 1]],
  )
  const whole = buildComparisonRows('old', 'new', [change(1, 1, 1, 1)], 'same', [])
  assert.deepEqual(whole, [])
})

test('trim-only matches inside coalesced sections follow the selected whitespace rule', () => {
  const left = 'old\n  same value  \nold2'
  const right = 'new\nsame value\nnew2'
  const changes = [change(1, 3, 1, 3)]
  assert.equal(buildComparisonRows(left, right, changes, 'different', [], false).length, 3)
  assert.deepEqual(buildComparisonRows(left, right, changes, 'same', [], false), [])
  assert.deepEqual(
    buildComparisonRows(left, right, changes, 'same', [], true).map((row) => [row.left, row.right]),
    [[1, 1]],
  )
  assert.deepEqual(
    buildComparisonRows(left, right, changes, 'different', [], true).map((row) => [
      row.left,
      row.right,
    ]),
    [
      [0, 0],
      [2, 2],
    ],
  )
  // The move matcher remains exact even when trim-only rows appear as same.
  assert.deepEqual(detectMovedBlocks('A  \nuniqueLeft', 'uniqueRight\nA', changes), [])
})

const diffComputer = new DefaultLinesDiffComputer()
function actualChanges(left, right) {
  return diffComputer
    .computeDiff(left.split('\n'), right.split('\n'), {
      ignoreTrimWhitespace: false,
      maxComputationTimeMs: 0,
      computeMoves: false,
    })
    .changes.map((mapping) => ({
      // This is Monaco's getLineChanges() conversion, including empty sentinels.
      originalStartLineNumber: mapping.original.isEmpty
        ? mapping.original.startLineNumber - 1
        : mapping.original.startLineNumber,
      originalEndLineNumber: mapping.original.isEmpty
        ? 0
        : mapping.original.endLineNumberExclusive - 1,
      modifiedStartLineNumber: mapping.modified.isEmpty
        ? mapping.modified.startLineNumber - 1
        : mapping.modified.startLineNumber,
      modifiedEndLineNumber: mapping.modified.isEmpty
        ? 0
        : mapping.modified.endLineNumberExclusive - 1,
    }))
}

test('EOF moves preserve the target terminal newline when the two files disagree', () => {
  for (const targetHasLf of [false, true])
    for (const from of ['left', 'right']) {
      const source = `C\nB\nA${targetHasLf ? '' : '\n'}`
      const target = `A\nB\nC${targetHasLf ? '\n' : ''}`
      const left = from === 'left' ? source : target
      const right = from === 'left' ? target : source
      const changes = actualChanges(left, right)
      const moves = detectMovedBlocks(left, right, changes)
      assert.ok(moves.length)
      for (const move of moves) {
        const result = reconcileMovedBlock(target, source, move, from, changes)
        assert.notEqual(result, target)
        assert.equal(
          result.endsWith('\n'),
          targetHasLf,
          'EOF placement must retain the target LF convention',
        )
        assert.deepEqual(
          result.split('\n').sort(),
          target.split('\n').sort(),
          'The structural final empty line must stay at EOF',
        )
      }
    }
  const target = 'ADD ITEM 0;\nADD ITEM 1;\nADD ITEM 2;\nADD ITEM 0;\nADD ITEM 1;\n'
  const source = 'ADD ITEM 2;\nADD ITEM 0;\nADD ITEM 1;\nADD ITEM 1;\nADD ITEM 0;'
  const changes = actualChanges(target, source)
  const lastBlock = detectMovedBlocks(target, source, changes).find((move) => move.rightStart === 4)
  assert.ok(lastBlock)
  assert.equal(
    reconcileMovedBlock(target, source, lastBlock, 'right', changes),
    'ADD ITEM 1;\nADD ITEM 2;\nADD ITEM 0;\nADD ITEM 1;\nADD ITEM 0;\n',
  )
})

test('duplicate commands never use a moved anchor outside their own replacement section', () => {
  const left =
    'START\nADD ITEM 0;\nADD ITEM 1;\nADD ITEM 2;\nADD ITEM 0;\nADD ITEM 1;\nADD ITEM 2;\nADD ITEM 0;\nADD ITEM 1;\nADD ITEM 2;\nADD ITEM 0;\nADD ITEM 1;\nEND\n'
  const right =
    'START\nADD ITEM 2;\nADD ITEM 2;\nADD ITEM 0;\nADD ITEM 2;\nADD ITEM 1;\nADD ITEM 0;\nADD ITEM 1;\nADD ITEM 0;\nADD ITEM 0;\nADD ITEM 1;\nADD ITEM 1;\nEND\n'
  const changes = actualChanges(left, right)
  const moves = detectMovedBlocks(left, right, changes)
  assert.ok(moves.length)
  const result = reconcileMovedBlock(right, left, moves[0], 'left', changes)
  assert.notEqual(result, right)
  assert.deepEqual(result.split('\n').slice(0, 2), ['START', 'ADD ITEM 0;'])
  assert.deepEqual(result.split('\n').sort(), right.split('\n').sort())
})

test('seeded reorderings converge with actual Monaco diffs in both directions, including duplicates', () => {
  let seed = 2357
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  let checkedMoves = 0
  for (const repeated of [false, true])
    for (let sample = 0; sample < 120; sample += 1) {
      const count = 2 + Math.floor(random() * 11)
      const commands = Array.from(
        { length: count },
        (_, index) => `ADD ITEM ${repeated ? index % 3 : index};`,
      )
      const suffix = sample % 2 ? '\n' : ''
      const left = ['START', ...commands, 'END'].join('\n') + suffix
      for (let index = commands.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1))
        ;[commands[index], commands[other]] = [commands[other], commands[index]]
      }
      const right = ['START', ...commands, 'END'].join('\n') + suffix
      for (const from of ['left', 'right']) {
        const desired = from === 'left' ? left : right
        let target = from === 'left' ? right : left
        const originalLines = target.split('\n').sort()
        const seen = new Set([target])
        for (let step = 0; target !== desired && step < count * 4; step += 1) {
          const a = from === 'left' ? desired : target
          const b = from === 'left' ? target : desired
          const changes = actualChanges(a, b)
          const moves = detectMovedBlocks(a, b, changes)
          assert.ok(
            moves.length,
            `No move found for sample ${sample}, repeated=${repeated}, from=${from}`,
          )
          for (const move of moves) {
            const result = reconcileMovedBlock(target, desired, move, from, changes)
            assert.notEqual(result, target, 'Every offered move must change its target')
            assert.deepEqual(
              result.split('\n').sort(),
              originalLines,
              'A move must preserve every original target line exactly once',
            )
            assert.equal(
              result.endsWith('\n'),
              target.endsWith('\n'),
              'A move must retain the terminal newline',
            )
            checkedMoves += 1
          }
          const next = reconcileMovedBlock(target, desired, moves[0], from, changes)
          assert.equal(seen.has(next), false, 'Applying offered moves must not cycle')
          seen.add(next)
          target = next
        }
        assert.equal(
          target,
          desired,
          `Move sequence failed to converge for sample ${sample}, repeated=${repeated}, from=${from}`,
        )
      }
    }
  assert.ok(checkedMoves > 1000, `Expected broad move coverage, checked ${checkedMoves}`)
})

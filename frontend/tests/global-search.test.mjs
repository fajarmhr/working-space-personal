import assert from 'node:assert/strict'
import test from 'node:test'
import { contentHash, readContentTarget } from '../src/lib/global-search.ts'

test('search result links preserve the exact content ID and collection', () => {
  for (const target of [
    { kind: 'task', id: 412 },
    { kind: 'snippet', id: 98 },
    { kind: 'note', id: 1 },
  ])
    assert.deepEqual(readContentTarget(contentHash(target)), target)
  assert.deepEqual(readContentTarget('#/daily-tasks?item=700&filter=completed'), {
    kind: 'task',
    id: 700,
  })
  assert.equal(contentHash({ kind: 'note', id: 1 }), '#/quick-note')
})

test('malformed or ambiguous deep links never select a different saved record', () => {
  for (const hash of [
    '#/daily-tasks?item=0',
    '#/daily-tasks?item=-1',
    '#/snippets?item=1.5',
    '#/snippets?item=9007199254740993',
    '#/daily-tasks?item=2&item=3',
    '#/other?item=5',
    '#/snippets?item=2e3',
    '#/daily-tasks?item=01',
    '#/snippets',
  ])
    assert.equal(readContentTarget(hash), null, hash)
  for (const id of [NaN, 0, -2, 2.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => contentHash({ kind: 'task', id }))
})

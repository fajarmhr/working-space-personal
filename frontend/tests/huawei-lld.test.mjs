import assert from 'node:assert/strict'
import test from 'node:test'
import {
  huaweiFilename,
  parsePhysicalBaseline,
  renameHuaweiInterface,
  validateHuaweiFile,
  validateHuaweiInterfaces,
} from '../src/lib/huawei-lld.ts'

test('LLD uploads accept XLSX within the limit and reject empty or unsupported files', () => {
  assert.equal(validateHuaweiFile({ name: 'LLD.XLSX', size: 10 * 1024 * 1024 }), null)
  assert.match(validateHuaweiFile({ name: 'LLD.xlsm', size: 50 }), /\.xlsx/)
  assert.match(validateHuaweiFile({ name: 'LLD.xlsx', size: 0 }), /kosong/)
  assert.match(validateHuaweiFile({ name: 'LLD.xlsx', size: 10 * 1024 * 1024 + 1 }), /10 MB/)
  assert.equal(huaweiFilename('01-static.ini', 'txt'), '01-static.txt')
  assert.equal(huaweiFilename('02-bgp', 'ini'), '02-bgp.ini')
})

test('renaming a trunk updates dependent interface names while preserving other edits', () => {
  const names = {
    'Eth-Trunk1': 'Eth-Trunk10',
    'Eth-Trunk1.150': 'Eth-Trunk10.150',
    'Eth-Trunk2': 'Eth-Trunk2',
    Loopback1: 'Loopback7',
  }
  assert.deepEqual(renameHuaweiInterface(names, 'Eth-Trunk1', 'Eth-Trunk20'), {
    'Eth-Trunk1': 'Eth-Trunk20',
    'Eth-Trunk1.150': 'Eth-Trunk20.150',
    'Eth-Trunk2': 'Eth-Trunk2',
    Loopback1: 'Loopback7',
  })
  assert.equal(validateHuaweiInterfaces(names), null)
  assert.match(validateHuaweiInterfaces({ Loopback1: '' }), /wajib/)
  assert.match(
    validateHuaweiInterfaces({ Loopback1: 'Loopback7', Loopback2: 'loopback7' }),
    /lebih dari sekali/,
  )
  assert.match(validateHuaweiInterfaces({ Loopback1: 'Loopback1;RMV' }), /karakter perintah/)
})

test('physical baseline parsing keeps prior state explicit and rejects conflicting entries', () => {
  assert.deepEqual(parsePhysicalBaseline(' 200GE1/0/1 = up\r\n\n200GE1/0/2=DOWN '), {
    '200GE1/0/1': 'up',
    '200GE1/0/2': 'down',
  })
  assert.deepEqual(parsePhysicalBaseline(''), {})
  assert.throws(() => parsePhysicalBaseline('200GE1/0/1=auto'), /baris 1/)
  assert.throws(() => parsePhysicalBaseline('200GE1/0/1=up\n200GE1/0/1=down'), /berulang/)
  assert.throws(() => parsePhysicalBaseline('__proto__=up'), /tidak valid/)
})

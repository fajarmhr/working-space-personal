import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addReportingMetric,
  addReportingProfile,
  recipientAddresses,
  updateReportingProfile,
  validateReportingWindow,
} from '../src/lib/huawei-reporting.ts'

function draft() {
  return {
    enabled: false,
    name: 'Lab monitoring',
    profile_id: 'personal',
    source: {
      base_url: '',
      page_path: '',
      browser_profile_id: 'lab-browser',
      export_format: 'csv',
      selectors_confirmed: false,
    },
    dataset: {
      timestamp_column: '',
      entity_column: '',
      timezone: 'Asia/Makassar',
      metrics: [{ key: 'kpi_2', label: 'Load', column: 'load', unit: '%' }],
    },
    schedule: {
      timezone: 'Asia/Makassar',
      interval_minutes: 60,
      lookback_minutes: 60,
      delay_minutes: 10,
      start_at: null,
      end_at: null,
    },
    delivery_profiles: [
      {
        id: 'personal',
        label: 'Pribadi',
        email: {
          enabled: true,
          to: ['owner@example.test'],
          subject_template: '{report_name}',
          body_template: '{summary}',
          smtp_secret_ref: 'OWNER_SMTP',
        },
        telegram: {
          enabled: true,
          chat_id: '100001',
          bot_token_secret_ref: 'OWNER_BOT',
          caption_template: '{summary}',
        },
      },
    ],
  }
}

test('delivery profiles keep independent channel settings and do not clone another recipient or secret reference', () => {
  const original = draft()
  const added = addReportingProfile(original)
  assert.equal(added.enabled, false)
  assert.equal(original.delivery_profiles.length, 1)
  assert.equal(added.delivery_profiles.length, 2)
  const selected = added.delivery_profiles.find((profile) => profile.id === added.profile_id)
  assert.deepEqual(selected.email.to, [])
  assert.equal(selected.email.smtp_secret_ref, '')
  assert.equal(selected.telegram.bot_token_secret_ref, '')
  assert.equal(selected.telegram.chat_id, '')
  const changed = updateReportingProfile(added, added.profile_id, (profile) => ({
    ...profile,
    telegram: { ...profile.telegram, chat_id: '200002', bot_token_secret_ref: 'SECOND_BOT' },
  }))
  assert.deepEqual(changed.delivery_profiles[0], original.delivery_profiles[0])
  assert.equal(changed.delivery_profiles[1].telegram.bot_token_secret_ref, 'SECOND_BOT')
})

test('adding KPI mappings and profiles avoids existing identifiers after deletion or manual edits', () => {
  let current = draft()
  current.delivery_profiles.push({ ...current.delivery_profiles[0], id: 'profile-1' })
  const added = addReportingProfile(current)
  assert.equal(added.profile_id, 'profile-2')
  const withMetric = addReportingMetric(current)
  assert.equal(withMetric.dataset.metrics[1].key, 'kpi_1')
  assert.equal(new Set(withMetric.dataset.metrics.map((metric) => metric.key)).size, 2)
  assert.equal(current.dataset.metrics.length, 1)
})

test('recipient entry handles common delimiters and monitoring windows require explicit offsets and chronological order', () => {
  assert.deepEqual(
    recipientAddresses(
      'first@example.test, second@example.test;first@example.test\nthird@example.test',
    ),
    ['first@example.test', 'second@example.test', 'third@example.test'],
  )
  assert.equal(validateReportingWindow(null, null), null)
  assert.equal(validateReportingWindow('2026-12-20T08:00:00+08:00', '2026-12-20T01:00:00Z'), null)
  assert.match(validateReportingWindow('2026-12-20T08:00:00', null), /offset/)
  assert.match(validateReportingWindow('December 20, 2026 08:00:00+08:00', null), /ISO/)
  assert.match(
    validateReportingWindow('2026-12-20T08:00:00+08:00', '2026-12-20T00:00:00Z'),
    /sesudah/,
  )
})

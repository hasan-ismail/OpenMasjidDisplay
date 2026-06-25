// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTv, ruleActive } from './scheduler';
import type { Tv, ScheduleRule, ContentRef } from './types';

const TT: ContentRef = { kind: 'timetable', id: 'tt_main' };
const CAM: ContentRef = { kind: 'source', id: 'src_cam' };

function tv(over?: Tv['override']): Tv {
  return {
    id: 'tv_1',
    name: 'Main hall',
    defaultContent: TT,
    override: over ?? null,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

function rule(p: Partial<ScheduleRule>): ScheduleRule {
  return {
    id: 'rule_1',
    name: 'r',
    enabled: true,
    targets: ['*'],
    content: CAM,
    days: [5],
    start: '13:00',
    end: '13:45',
    priority: 0,
    createdAt: '2024-01-01T00:00:00Z',
    ...p,
  };
}

test('falls back to default content with no rules or override', () => {
  const r = resolveTv(tv(), [], new Date('2024-03-22T09:00:00Z'), 'UTC');
  assert.equal(r.source, 'default');
  assert.deepEqual(r.content, TT);
});

test('an open schedule window wins over the default', () => {
  const friday = new Date('2024-03-22T13:30:00Z'); // Friday
  const r = resolveTv(tv(), [rule({})], friday, 'UTC');
  assert.equal(r.source, 'schedule');
  assert.deepEqual(r.content, CAM);
  assert.equal(r.ruleId, 'rule_1');
});

test('outside the window, the rule does not apply', () => {
  const friday = new Date('2024-03-22T14:30:00Z');
  const r = resolveTv(tv(), [rule({})], friday, 'UTC');
  assert.equal(r.source, 'default');
});

test('a sticky manual override beats an open schedule', () => {
  const friday = new Date('2024-03-22T13:30:00Z');
  const r = resolveTv(tv({ content: CAM, until: null }), [rule({})], friday, 'UTC');
  assert.equal(r.source, 'override');
});

test('an expired override is ignored', () => {
  const now = new Date('2024-03-22T09:00:00Z');
  const r = resolveTv(tv({ content: CAM, until: now.getTime() - 1000 }), [], now, 'UTC');
  assert.equal(r.source, 'default');
});

test('overnight window wraps past midnight', () => {
  const r = rule({ days: [1], start: '22:00', end: '02:00', content: CAM });
  // Monday 23:00 (start day) → active
  assert.equal(ruleActive(r, 1, 23 * 60), true);
  // Tuesday 01:00 (next day, early) → active via previous day membership
  assert.equal(ruleActive(r, 2, 60), true);
  // Monday noon → inactive
  assert.equal(ruleActive(r, 1, 12 * 60), false);
});

test('higher priority rule wins when two windows overlap', () => {
  const friday = new Date('2024-03-22T13:30:00Z');
  const low = rule({ id: 'low', priority: 1, content: CAM });
  const high = rule({ id: 'high', priority: 5, content: TT });
  const r = resolveTv(tv(), [low, high], friday, 'UTC');
  assert.equal(r.ruleId, 'high');
  assert.deepEqual(r.content, TT);
});

test('a rule targeting another screen does not apply', () => {
  const friday = new Date('2024-03-22T13:30:00Z');
  const r = resolveTv(tv(), [rule({ targets: ['tv_other'] })], friday, 'UTC');
  assert.equal(r.source, 'default');
});

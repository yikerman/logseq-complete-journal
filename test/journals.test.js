import test from 'node:test';
import assert from 'node:assert/strict';
import { Cancelled, dateFromDay, dayKey, fillJournals, planJournals } from '../src/journals.js';
import { host, journal, localDate, title } from './helpers.js';

test('fills internal gaps and the tail through today, ignoring normal pages and future journals', () => {
  const pages = [journal(20260310), journal(20260307), journal(20260320), { ...journal(19990101), 'journal?': false }];
  assert.deepEqual(planJournals(pages, localDate(2026, 3, 12)).map(x => x.day), [20260308, 20260309, 20260311, 20260312]);
});

test('handles leap days and year boundaries', () => {
  assert.deepEqual(planJournals([journal(20240228)], localDate(2024, 3, 1)).map(x => x.day), [20240229, 20240301]);
  assert.deepEqual(planJournals([journal(20251231)], localDate(2026, 1, 2)).map(x => x.day), [20260101, 20260102]);
});

test('uses local dates across DST transitions and late evening', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(dayKey(new Date(2026, 0, 2, 23, 59)), 20260102);
    for (const [start, end, expected] of [
      [20260307, localDate(2026, 3, 10), [20260308, 20260309, 20260310]],
      [20261031, localDate(2026, 11, 3), [20261101, 20261102, 20261103]],
    ]) assert.deepEqual(planJournals([journal(start)], end).map(x => x.day), expected);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('ignores invalid dates and does nothing without an existing journal file', () => {
  for (const day of [20260230, 20261301, 20260001, NaN, '20260101', 0]) assert.equal(dateFromDay(day), null);
  assert.deepEqual(planJournals([], localDate(2026, 1, 3)), []);
  assert.deepEqual(planJournals([journal(20270101), journal(20000101, false), journal(20260230)], localDate(2026, 1, 3)), []);
});

test('references do not extend history but fileless dates within the range get filled', () => {
  const result = planJournals([journal(20000101, false), journal(20260101), journal(20260102, false)], localDate(2026, 1, 3));
  assert.deepEqual(result.map(x => x.day), [20260102, 20260103]);
  assert.equal(result[0].page.journalDay, 20260102);
});

test('creates two empty blocks per missing journal and remains idempotent before disk writes finish', async () => {
  const h = host([journal(20260101), journal(20260103)]);
  const options = { today: localDate(2026, 1, 4) };
  assert.equal((await fillJournals(h.api, title, options)).created, 2);
  assert.equal((await fillJournals(h.api, title, options)).created, 0);
  assert.equal(h.writes.length, 6);
  assert.equal(h.blocks.get('page-20260102').length, 2);
  assert.deepEqual(h.writes[0].options, { journal: true, format: 'markdown', createFirstBlock: false, redirect: false });
  assert.deepEqual(h.writes[1], { method: 'insertBlock', uuid: 'page-20260102', content: '', options: { sibling: false, focus: false } });
});

test('materializes reference-only pages using their existing titles', async () => {
  const h = host([journal(20260101), journal(20260102, false, 'Jan 2nd, 2026')]);
  const result = await fillJournals(h.api, () => { throw new Error('should reuse the title'); }, { today: localDate(2026, 1, 2) });
  assert.equal(result.created, 1);
  assert.deepEqual(h.writes.map(w => w.method), ['insertBlock', 'insertBlock']);
});

test('adds the second block to a fileless journal that already has one empty block', async () => {
  const h = host([journal(20260101), journal(20260102, false)]);
  h.blocks.set('page-20260102', [{ content: '' }]);
  const result = await fillJournals(h.api, title, { today: localDate(2026, 1, 2) });
  assert.equal(result.created, 1);
  assert.equal(h.writes.length, 1);
  assert.equal(h.blocks.get('page-20260102').length, 2);
});

test('preserves existing blocks even when the file metadata has not caught up', async () => {
  const h = host([journal(20260101), journal(20260102, false)]);
  h.blocks.set('page-20260102', [{ content: 'My journal' }]);
  await fillJournals(h.api, title, { today: localDate(2026, 1, 2) });
  assert.equal(h.writes.length, 0);
});

test('rechecks candidates in case a page was created after the scan', async () => {
  const h = host();
  h.api.Editor.getPage = async () => journal(20260102);
  await fillJournals(h.api, title, { today: localDate(2026, 1, 2) });
  assert.equal(h.writes.length, 0);
});

test('rejects title collisions without inserting into an ordinary page', async () => {
  const h = host();
  h.api.Editor.getPage = async () => ({ ...journal(20260102, false), 'journal?': false });
  await assert.rejects(fillJournals(h.api, title, { today: localDate(2026, 1, 2) }), /did not recognize/);
  assert.equal(h.writes.length, 0);
});

test('cancels between reading and inserting', async () => {
  const h = host();
  let active = true;
  h.api.Editor.getPageBlocksTree = async () => { active = false; return []; };
  await assert.rejects(fillJournals(h.api, title, {
    today: localDate(2026, 1, 3),
    checkActive: async () => { if (!active) throw new Cancelled(); },
  }), Cancelled);
  assert.deepEqual(h.writes.map(w => w.method), ['createPage']);
});

test('a failed insertion can be retried without duplicate pages', async () => {
  const h = host();
  const insert = h.api.Editor.insertBlock;
  h.api.Editor.insertBlock = async () => { throw new Error('disk error'); };
  const options = { today: localDate(2026, 1, 2) };
  await assert.rejects(fillJournals(h.api, title, options), /disk error/);
  h.api.Editor.insertBlock = insert;
  assert.equal((await fillJournals(h.api, title, options)).created, 1);
  assert.equal(h.writes.filter(w => w.method === 'createPage').length, 1);
});

test('disabled journals and unavailable graphs cause no writes', async () => {
  const h = host();
  h.api.App.getUserConfigs = async () => ({ enabledJournals: false });
  assert.equal((await fillJournals(h.api, title)).reason, 'disabled');
  assert.equal(h.writes.length, 0);
  const h2 = host();
  h2.api.Editor.getAllPages = async () => null;
  await assert.rejects(fillJournals(h2.api, title), /not ready/);
});

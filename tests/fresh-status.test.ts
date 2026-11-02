import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LmsStore } from '../src/database/store.js';
import { runMonitor, type LmsSource } from '../src/monitor.js';
import { AppError, type RunStatus } from '../src/utils/result.js';
import { parseCourse } from '../src/crawler/courses.js';
import { parseBoardRow } from '../src/crawler/boards.js';
const course = parseCourse({ id: 'selfarea_TEST1_A', href: "javascript:fncGoClassroom('TEST1','A','3');", title: '합성' }, { year: '2026년', term: '2학기' });
const source: LmsSource = { courses: async () => [course], enter: async () => {}, collect: async () => ({ status: 'OK', items: [] }) };
for (const status of ['CREDENTIALS_NOT_CONFIGURED','AUTO_LOGIN_REQUIRES_USER','NETWORK_ERROR','LMS_STRUCTURE_CHANGED'] as RunStatus[]) {
  test(`monitor preserves ${status} and cleanup without crawling`, async () => {
    const store = new LmsStore(':memory:'); let closes = 0; let collections = 0;
    try {
      const result = await runMonitor(store, { ...source, courses: async () => { collections++; return [course]; } }, async () => ({ status: 'SENT' }), () => {}, {
        authenticate: async () => { throw new AppError(status); }, dispose: async () => { closes++; },
      });
      assert.equal(result.status, status); assert.equal(closes, 1); assert.equal(collections, 0);
    } finally { store.close(); }
  });
}
test('database failure and Discord failure have separate results without deleting history', async () => {
  for (const mode of ['database','discord']) {
    const store = new LmsStore(':memory:');
    try {
      store.sync([course], [{ course, type: 'NOTICE', items: [] }]);
      const broken: LmsSource = { ...source, collect: async (_c, type) => {
        const item = parseBoardRow({ id: '1', title: '합성', date: null }, course, 'NOTICE');
        return { status: 'OK', items: type === 'NOTICE' ? mode === 'database' ? [item,item] : [item] : [] };
      } };
      const result = await runMonitor(store, broken, async () => ({ status: 'UNKNOWN' }), () => {}, { deliveryDelayMs: 0 });
      assert.equal(result.status, mode === 'database' ? 'DATABASE_ERROR' : 'PARTIAL');
      assert.equal(result.code, mode === 'database' ? 'DATABASE_ERROR' : 'DISCORD_NOTIFICATION_FAILED');
      assert.equal(result.collectionStatus, 'SUCCESS');
      assert.ok(Number(store.db.prepare('SELECT count(*) n FROM sync_history').get()?.n) >= 1);
    } finally { store.close(); }
  }
});

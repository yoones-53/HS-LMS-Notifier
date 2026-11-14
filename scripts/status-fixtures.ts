// Offline presentation demo: in-memory DB + synthetic source/transport, no .env or LMS.
import { LmsStore } from '../src/database/store.js';
import { runMonitor } from '../src/monitor.js';
import { AppError } from '../src/utils/result.js';
import { formatMonitor } from '../src/status/presentation.js';
import { fixtureSource, fixtureCourses, fixtureOptions } from '../tests/fixtures/status-source.js';

for (const scenario of ['SUCCESS','PARTIAL','AUTO_LOGIN_FAILED','NETWORK_ERROR','DISCORD_NOTIFICATION_FAILED'] as const) {
  const store = new LmsStore(':memory:');
  try {
    const result = await runMonitor(store, { ...fixtureSource, collect: async (c, type) => {
      if (scenario === 'PARTIAL' && c.courseId === fixtureCourses[0]!.courseId && type === 'NOTICE') throw new AppError('LMS_TIMEOUT');
      return { status: 'OK', items: [] };
    } }, async () => ({ status: 'SENT' }), () => {}, { ...fixtureOptions,
      notificationAvailable: scenario !== 'DISCORD_NOTIFICATION_FAILED',
      ...(scenario === 'AUTO_LOGIN_FAILED' || scenario === 'NETWORK_ERROR' ? { authenticate: async () => { throw new AppError(scenario); } } : {}),
    });
    console.log(`\n[OFFLINE FIXTURE: ${scenario}]`); console.log(formatMonitor(result));
  } finally { store.close(); }
}

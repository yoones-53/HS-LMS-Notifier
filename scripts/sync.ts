import { collectCourses } from '../src/crawler/courses.js';
import { collectBoard } from '../src/crawler/boards.js';
import { collectAssignments } from '../src/crawler/assignments.js';
import { collectVideos } from '../src/crawler/videos.js';
import { enterCourse, withLmsPage } from '../src/crawler/navigation.js';
import { LmsStore } from '../src/database/store.js';
import type { ScopeSnapshot } from '../src/model.js';
import { runCli, UserFacingError } from '../src/utils/cli.js';
import { loadEnvironment } from '../src/utils/environment.js';
import { resolveRuntimePaths } from '../src/runtime/paths.js';

await runCli(async () => {
  loadEnvironment();
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0]) throw new UserFacingError('사용법: npm run sync -- <courseId 또는 --all>');
  const store = new LmsStore(resolveRuntimePaths().database);
  try {
    await withLmsPage(async page => {
      const courses = (await collectCourses(page)).filter(c => args[0] === '--all' || c.courseId === args[0]);
      if (!courses.length) throw new UserFacingError('현재 학기에서 해당 과목을 찾을 수 없습니다.');
      const scopes: ScopeSnapshot[] = [];
      for (const course of courses) {
        await enterCourse(page, course);
        for (const type of ['NOTICE', 'MATERIAL', 'ASSIGNMENT', 'VIDEO'] as const) {
          const result = type === 'ASSIGNMENT' ? await collectAssignments(page, course)
            : type === 'VIDEO' ? await collectVideos(page, course) : await collectBoard(page, course, type);
          console.log(`[${course.name}] ${type}: ${result.status} / ${result.items.length}건`);
          if ('unidentifiedOnlineRows' in result && result.unidentifiedOnlineRows) console.log(`고유 ID 없는 온라인 행 ${result.unidentifiedOnlineRows}개 제외`);
          if (result.status === 'OK') scopes.push({ course, type, items: result.items });
        }
      }
      const result = store.sync(courses, scopes);
      console.log(`동기화: BASELINE=${result.baseline}, NEW=${result.newItems}, UPDATED=${result.updated}, SAME=${result.unchanged}`);
      console.log(`이번 변경 이벤트=${result.events.length}건`);
      for (const event of result.events) console.log(`${event.type}: ${event.item.title}`);
      console.log(`Discord 전송 없음. 알림 기록=${store.notificationCount()}건`);
    });
  } finally { store.close(); }
});

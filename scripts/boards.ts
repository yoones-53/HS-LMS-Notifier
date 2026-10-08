import { collectCourses } from '../src/crawler/courses.js';
import { collectBoard } from '../src/crawler/boards.js';
import { enterCourse, withLmsPage } from '../src/crawler/navigation.js';
import { runCli, UserFacingError } from '../src/utils/cli.js';
import { loadEnvironment } from '../src/utils/environment.js';

await runCli(async () => {
  loadEnvironment();
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0]) throw new UserFacingError('사용법: npm run boards -- <courseId 또는 --all>');
  await withLmsPage(async page => {
    const courses = (await collectCourses(page)).filter(c => args[0] === '--all' || c.courseId === args[0]);
    if (!courses.length) throw new UserFacingError('현재 학기 목록에서 지정한 과목을 찾지 못했습니다.');
    for (const course of courses) {
      await enterCourse(page, course);
      for (const type of ['NOTICE', 'MATERIAL'] as const) {
        const { status, items } = await collectBoard(page, course, type);
        if (status === 'UNAVAILABLE') {
          console.log(`[${course.name}] ${type}: 메뉴 제공 안 됨 (UNAVAILABLE)`);
          continue;
        }
        console.log(`[${course.name}] ${type}: ${items.length}건`);
        if (items.length) console.table(items.map(i => ({ ID: i.itemId, 제목: i.title, 등록일: i.createdAt })));
      }
    }
  });
});

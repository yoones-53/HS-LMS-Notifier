import { collectCourses } from '../src/crawler/courses.js';
import { collectAssignments } from '../src/crawler/assignments.js';
import { enterCourse, withLmsPage } from '../src/crawler/navigation.js';
import { runCli, UserFacingError } from '../src/utils/cli.js';
import { loadEnvironment } from '../src/utils/environment.js';
await runCli(async () => {
  loadEnvironment();
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0]) throw new UserFacingError('사용법: npm run assignments -- <courseId 또는 --all>');
  await withLmsPage(async page => {
    const courses = (await collectCourses(page)).filter(c => args[0] === '--all' || c.courseId === args[0]);
    if (!courses.length) throw new UserFacingError('현재 학기에서 해당 과목을 찾을 수 없습니다.');
    for (const course of courses) {
      await enterCourse(page, course);
      const result = await collectAssignments(page, course);
      console.log(`[${course.name}] ASSIGNMENT: ${result.status === 'UNAVAILABLE' ? '메뉴 제공 안 됨' : `${result.items.length}건`} (Asia/Seoul)`);
      if (result.items.length) console.table(result.items.map(i => ({ ID: i.itemId, 과제명: i.title, 마감시간: i.dueAt ?? '확인 불가', 제출: i.submissionStatus ?? '알 수 없음', 진행: i.progressStatus, 날짜상태: i.dateStatus })));
    }
  });
});

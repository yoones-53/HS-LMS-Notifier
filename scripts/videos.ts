import { collectCourses } from '../src/crawler/courses.js';
import { collectVideos } from '../src/crawler/videos.js';
import { enterCourse, withLmsPage } from '../src/crawler/navigation.js';
import { runCli, UserFacingError } from '../src/utils/cli.js';
import { loadEnvironment } from '../src/utils/environment.js';
await runCli(async () => {
  loadEnvironment();
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0]) throw new UserFacingError('사용법: npm run videos -- <courseId 또는 --all>');
  await withLmsPage(async page => {
    const courses = (await collectCourses(page)).filter(c => args[0] === '--all' || c.courseId === args[0]);
    if (!courses.length) throw new UserFacingError('현재 학기에서 해당 과목을 찾을 수 없습니다.');
    for (const course of courses) {
      await enterCourse(page, course);
      const result = await collectVideos(page, course);
      console.log(`[${course.name}] VIDEO: ${result.status} / ${result.items.length}건 / 안정적 ID 없는 온라인 행 ${result.unidentifiedOnlineRows}개 제외`);
      if (result.items.length) console.table(result.items.map(i => ({ ID: i.itemId, 제목: i.title, 학습시작: i.startsAt, 학습종료: i.dueAt, 학습상태: i.statusRaw, 출석인정: i.attendanceConfirmed === true ? '출석완료' : '확인 불가', 진도율: '확인 불가' })));
    }
  });
});

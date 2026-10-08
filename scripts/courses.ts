import { collectCourses } from '../src/crawler/courses.js';
import { withLmsPage } from '../src/crawler/navigation.js';
import { runCli } from '../src/utils/cli.js';
import { loadEnvironment } from '../src/utils/environment.js';

await runCli(async () => {
  loadEnvironment();
  await withLmsPage(async page => {
    const courses = await collectCourses(page);
    console.log(`현재 학기: ${courses[0]?.semester.year} ${courses[0]?.semester.term} / ${courses.length}과목`);
    console.table(courses.map(c => ({ 강의명: c.name, LMS_ID: c.courseId, 분반: c.classNo, 강의실: c.url })));
    console.log('강의실 주소는 공통 POST 진입 주소입니다. 과목별 입장은 저장된 원본 강좌 링크를 사용합니다.');
  });
});

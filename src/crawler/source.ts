import type { Page } from 'playwright';
import { collectCourses } from './courses.js';
import { collectBoard } from './boards.js';
import { collectAssignments } from './assignments.js';
import { collectVideos } from './videos.js';
import { assertLmsPage, enterCourse } from './navigation.js';
import type { Collection, LmsSource } from '../monitor.js';
import { AppError, classifyError } from '../utils/result.js';

export function browserSource(page: Page): LmsSource {
  const checked = async <T>(action: () => Promise<T>): Promise<T> => {
    try { return await action(); }
    catch (error) {
      const code = classifyError(error);
      if (code === 'NETWORK_ERROR') throw new AppError(code);
      // A timeout after an SSO redirect is still expired auth, not merely a slow page.
      await assertLmsPage(page); throw error;
    }
  };
  return {
    courses: () => checked(() => collectCourses(page)),
    enter: course => checked(() => enterCourse(page, course)),
    collect: (course, type) => checked<Collection>(() => type === 'ASSIGNMENT' ? collectAssignments(page, course)
      : type === 'VIDEO' ? collectVideos(page, course) : collectBoard(page, course, type)),
  };
}

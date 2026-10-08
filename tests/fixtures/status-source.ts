import { parseCourse } from '../../src/crawler/courses.js';
import type { LmsSource } from '../../src/monitor.js';
export const fixtureCourses = ['합성 과목 A','합성 과목 B'].map((name, i) => parseCourse({
  id: `selfarea_TEST${i + 1}_A`, href: `javascript:fncGoClassroom('TEST${i + 1}','A','3');`, title: name,
}, { year: '2026년', term: '2학기' }));
export const fixtureSource: LmsSource = { courses: async () => fixtureCourses, enter: async () => {},
  collect: async () => ({ status: 'OK', items: [] }) };
export const fixtureOptions = { now: () => new Date('2026-10-07T12:00:00+09:00'), deliveryDelayMs: 0 };

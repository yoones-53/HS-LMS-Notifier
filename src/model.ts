import type { Assignment } from './crawler/assignments.js';
import type { BoardItem } from './crawler/boards.js';
import type { Course } from './crawler/courses.js';
import type { OnlineLecture } from './crawler/videos.js';

// Shared data contracts only; database/detector modules never control browsers.
export type LmsItem = BoardItem | Assignment | OnlineLecture;
export type ItemType = LmsItem['type'];
export interface ItemChange { before: LmsItem | null; after: LmsItem; version: number }
export interface ScopeSnapshot { course: Course; type: ItemType; items: LmsItem[] }
export const courseKey = (course: Pick<Course, 'courseId' | 'classNo'>): string => `${course.courseId}:${course.classNo}`;
export const itemKey = (item: LmsItem): string => `${courseKey(item)}:${item.type}:${item.itemId}`;

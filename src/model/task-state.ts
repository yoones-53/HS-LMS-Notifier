export type TaskState = 'PENDING' | 'COMPLETE' | 'UNKNOWN';
export const observedState = (value: boolean | null | undefined): TaskState => value === true ? 'COMPLETE' : value === false ? 'PENDING' : 'UNKNOWN';
export const assignmentState = (item: { submitted?: boolean | null }): TaskState => observedState(item.submitted);
export const lectureState = (item: { completed?: boolean | null }): TaskState => observedState(item.completed);
// Attendance credit is sufficient to suppress reminders, but is NOT proof of full viewing.
export const lectureSatisfied = (item: { completed?: boolean | null; attendanceConfirmed?: boolean | null }): boolean =>
  lectureState(item) === 'COMPLETE' || item.attendanceConfirmed === true;

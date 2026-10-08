import type { DesktopApi, DesktopStatus, Reply } from '../contracts.js';
import { todoDashboardSchema } from '../../summary/todo.js';
declare global { interface Window { lms: DesktopApi } }
const api = window.lms;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { el(id).textContent = value; };
let state: DesktopStatus | undefined;
let page: 'home' | 'settings' = location.hash === '#settings' ? 'settings' : 'home';
let step = 0;
let working = false;
let refreshing = false;
const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
function message(value: string, error = false) { text('message', value); el('message').hidden = false; el('message').classList.toggle('error', error); }
function show() {
  const wizard = state && !state.settings.setupComplete;
  el('welcome').hidden = !wizard || step !== 0;
  el('dashboard').hidden = !!wizard || page !== 'home';
  el('settings').hidden = wizard ? step === 0 : page !== 'settings';
  text('page-title', wizard ? '처음 연결하기' : page === 'home' ? '학습 현황' : '설정');
  el('nav-home').classList.toggle('active', page === 'home'); el('nav-settings').classList.toggle('active', page === 'settings');
  el('wizard-step').hidden = !wizard; el('wizard-actions').hidden = !wizard; el('wizard-note').hidden = !wizard;
  text('wizard-step', `${step} / 3 · ${['','LMS 로그인 설정','Discord 알림 설정','자동 확인 설정'][step] ?? ''}`);
  for (const [id, number] of [['lms-card',1],['discord-card',2],['monitor-card',3]] as const) el(id).hidden = !!wizard && step !== number;
  el('folders-card').hidden = !!wizard;
  el('deadline-card').hidden = !!wizard && step !== 3;
  el('remove-login').hidden = !!wizard;
  text('wizard-next', step === 3 ? '설정 완료하고 첫 확인' : '다음');
  const next = el<HTMLButtonElement>('wizard-next');
  next.disabled = working || step === 1 && !state?.settings.lmsVerifiedAt || step === 2 && !state?.settings.discordVerifiedAt;
}
function render() {
  if (!state) return;
  const latest = state.recent[0];
  text('header-status', working || state.busy ? '확인 중…' : latest?.result.title ?? '설정 대기');
  text('outcome', working || state.busy ? 'LMS를 확인하고 있어요' : latest?.result.title ?? '첫 확인을 기다리고 있어요');
  text('outcome-detail', working || state.busy ? '과목을 차례로 확인합니다. 창을 닫아도 트레이에서 계속 진행됩니다.' : latest?.result.reason ?? '지금 확인을 눌러 학습 현황을 가져오세요.');
  text('last-run', date(latest?.result.occurredAt)); text('next-run', state.nextAt ? date(state.nextAt) : '자동 확인 대기 / 중지');
  text('lms-connection', `LMS · ${state.credentialsConfigured ? '로그인 정보 등록됨' : '등록 필요'}`);
  text('discord-connection', `Discord · ${state.discordConfigured ? '알림 주소 등록됨' : '등록 필요'}`);
  text('lms-setting-status', state.credentialsConfigured ? '등록됨' : '미등록');
  text('discord-setting-status', state.discordConfigured ? '등록됨' : '미등록');
  text('login-tested', state.settings.lmsVerifiedAt ? '✓ LMS 로그인 확인 완료' : '저장한 뒤 로그인 테스트를 실행해 주세요.');
  text('discord-tested', state.settings.discordVerifiedAt ? '✓ Discord 연결 확인 완료' : '저장한 뒤 테스트 알림을 보내 주세요.');
  for (const key of ['courses','notices','materials','assignments','videos'] as const) text(`count-${key}`, latest ? String(latest.counts[key]) : '—');
  text('changes', latest ? `최근 확인 · 변경 ${latest.counts.changes}건 / 전송 ${latest.counts.sent}건` : '최근 확인 결과가 여기에 표시됩니다.');
  renderTodo();
  const mode = state.scheduler.mode;
  text('schedule-note', !state.settings.autoEnabled ? '자동 확인이 꺼져 있습니다.' : mode === 'PRODUCTION' ? 'Windows 예약 작업으로 자동 확인 중입니다.' : mode === 'LEGACY' ? '기존 개발용 예약 작업을 발견했습니다.' : mode === 'CONFLICT' ? '동일한 이름의 예약 작업을 안전하게 변경할 수 없습니다.' : mode === 'UNKNOWN' ? '예약 작업 상태를 확인할 수 없습니다. 지금 확인은 사용할 수 있습니다.' : '자동 확인 준비 중입니다.');
  text('scheduler-detail', mode === 'LEGACY' ? '전환하면 기존 작업은 삭제하지 않고 비활성화한 뒤 설치본 전용 작업을 만듭니다.' : mode === 'PRODUCTION' ? '다음 확인 시간은 위에 표시됩니다.' : '');
  el<HTMLButtonElement>('migrate-scheduler').hidden = mode !== 'LEGACY' || !state.scheduler.legacyActive;
  const recent = el('recent'); recent.replaceChildren();
  for (const run of state.recent) { const li = document.createElement('li'); const time = document.createElement('time'); time.textContent = date(run.result.occurredAt); const label = document.createElement('span'); label.textContent = run.result.title; li.append(time,label); recent.append(li); }
  if (!state.recent.length) recent.textContent = '아직 실행 기록이 없습니다.';
  const issues = el('incidents'); issues.replaceChildren();
  for (const issue of state.incidents) { const item = document.createElement('div'); item.className = 'incident'; const title = document.createElement('strong'); title.textContent = issue.courseName ?? '확인이 필요합니다'; const detail = document.createElement('p'); detail.textContent = issue.safeReason; const action = document.createElement('p'); action.textContent = issue.action.includes('npm run') ? '설정에서 연결 정보를 확인해 주세요.' : issue.action; item.append(title,detail,action); issues.append(item); }
  if (!state.incidents.length) issues.textContent = '현재 확인이 필요한 오류가 없습니다.';
  text('recovery', state.recovery ? `최근 복구 · ${date(state.recovery.occurredAt)} / ${state.recovery.issue.courseName ?? '정상 상태로 돌아왔습니다.'}` : '');
  el<HTMLButtonElement>('check').disabled = working || state.busy;
  text('check', working || state.busy ? '확인 중…' : '지금 확인');
  show();
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try { const reply = await api.getStatus(); if (reply.ok && reply.data) { const first = !state; state = reply.data; if (first) fillOptions(); render(); } else message(reply.message ?? '상태를 읽을 수 없습니다.', true); }
  catch { message('앱 연결을 확인할 수 없습니다. 다시 실행해 주세요.', true); }
  finally { refreshing = false; }
}
const deadlineKeys = ['d7','d3','d1','d0'] as const;
function fillOptions() { if (state) { el<HTMLInputElement>('auto-enabled').checked = state.settings.autoEnabled; el<HTMLInputElement>('retention').value = String(state.settings.retentionDays);
  for (const key of deadlineKeys) el<HTMLInputElement>(`deadline-${key}`).checked = state.settings.deadlineNotifications[key]; } }
function renderTodo() {
  const parsed = todoDashboardSchema.safeParse(state?.todo);
  const list = el('todo-list'); list.replaceChildren(); el('todo-empty').hidden = true;
  if (!parsed.success || parsed.data.coverage === 'NOT_COLLECTED') {
    text('todo-coverage', parsed.success ? '아직 수집 결과가 없습니다. LMS 확인을 실행해 주세요.' : '할 일 데이터를 확인할 수 없습니다. 다시 확인해 주세요.');
    for (const id of ['assignments','lectures','unknown','nearest']) text(`todo-${id}`, '—');
    return;
  }
  const todo = parsed.data;
  text('todo-coverage', `최근 저장된 수집 범위 기준 · ${date(todo.collectedAt)}${todo.coverage === 'PARTIAL' ? ' · 일부 범위 확인 실패 또는 최신 확인 필요' : ''}`);
  text('todo-assignments', String(todo.pendingAssignments)); text('todo-lectures', String(todo.incompleteLectures));
  text('todo-unknown', String(todo.unknown)); text('todo-nearest', todo.nearest ?? '—');
  el('todo-empty').hidden = todo.pendingAssignments + todo.incompleteLectures !== 0 || todo.coverage !== 'COMPLETE';
  for (const item of todo.items) {
    const li = document.createElement('li'); li.className = 'todo-item';
    const badge = document.createElement('span'); badge.className = 'pill'; badge.textContent = item.dayLabel;
    if (item.days !== null && item.days <= 1) badge.classList.add('urgent');
    const body = document.createElement('div'); const context = document.createElement('small');
    context.textContent = `[${item.type === 'ASSIGNMENT' ? '과제' : '온라인 강의'}] ${item.courseName}`;
    const title = document.createElement('strong'); title.textContent = item.title;
    const detail = document.createElement('p'); detail.textContent = `${item.deadlineLabel} · ${item.state === 'UNKNOWN' ? '상태 확인 필요' : item.type === 'ASSIGNMENT' ? '미제출' : '미수강 (미완료 확인)'}${item.days !== null && item.days < 0 ? ' · 기한 지남 (제출 가능 여부는 LMS 확인)' : ''}`;
    body.append(context,title,detail); li.append(badge,body); list.append(li);
  }
}
async function perform(action: () => Promise<Reply>, success: string): Promise<boolean> {
  if (working) return false;
  working = true; document.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = true); render();
  for (const key of deadlineKeys) el<HTMLInputElement>(`deadline-${key}`).disabled = true;
  let okay = false;
  try { const reply = await action(); okay = reply.ok; message(reply.ok ? success : reply.message ?? '작업을 완료하지 못했습니다.', !reply.ok); }
  catch { message('작업을 완료하지 못했습니다. 연결 상태를 확인해 주세요.', true); }
  finally { working = false; document.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = false);
    for (const key of deadlineKeys) el<HTMLInputElement>(`deadline-${key}`).disabled = false;
    await refresh(); render(); }
  return okay;
}
el('nav-home').onclick = () => { page = 'home'; show(); };
el('nav-settings').onclick = () => { page = 'settings'; fillOptions(); show(); };
window.addEventListener('hashchange', () => { if (location.hash === '#settings') { page = 'settings'; fillOptions(); show(); } });
el('start').onclick = () => { step = 1; show(); };
el('wizard-back').onclick = () => { step = Math.max(0,step-1); show(); };
const saveOptions = () => api.updateSettings({ autoEnabled: el<HTMLInputElement>('auto-enabled').checked, retentionDays: Number(el<HTMLInputElement>('retention').value),
  deadlineNotifications: { d7: el<HTMLInputElement>('deadline-d7').checked, d3: el<HTMLInputElement>('deadline-d3').checked,
    d1: el<HTMLInputElement>('deadline-d1').checked, d0: el<HTMLInputElement>('deadline-d0').checked } });
for (const key of deadlineKeys) el<HTMLInputElement>(`deadline-${key}`).onchange = () => {
  void perform(saveOptions, '마감 알림 설정을 저장했습니다. 다음 확인부터 적용합니다.').then(() => fillOptions());
};
el('wizard-next').onclick = async () => {
  if (step < 3) { step++; fillOptions(); show(); return; }
  if (await perform(async () => { const saved = await saveOptions(); return saved.ok ? api.completeSetup() : saved; }, '설정 완료. 첫 LMS 확인을 시작합니다.')) {
    page = 'home'; await perform(() => api.runCheck(), '첫 확인이 완료되었습니다. 아래 결과를 확인해 주세요.');
  }
};
el('check').onclick = () => { void perform(() => api.runCheck(), '확인을 마쳤습니다. 실행 결과를 확인해 주세요.'); };
el('login-form').onsubmit = event => {
  event.preventDefault();
  const input = { id: el<HTMLInputElement>('lms-id').value.trim(), password: el<HTMLInputElement>('lms-password').value };
  el<HTMLInputElement>('lms-id').value = ''; el<HTMLInputElement>('lms-password').value = '';
  void perform(async () => { try { return await api.setupCredentials(input); } finally { input.id = ''; input.password = ''; } }, '로그인 정보를 저장했습니다. 자동 로그인 테스트를 실행해 주세요.');
};
el('discord-form').onsubmit = event => {
  event.preventDefault(); const input = { webhook: el<HTMLInputElement>('discord-webhook').value.trim() }; el<HTMLInputElement>('discord-webhook').value = '';
  void perform(async () => { try { return await api.configureDiscord(input); } finally { input.webhook = ''; } }, '알림 주소를 저장했습니다. 테스트 알림을 보내 주세요.');
};
el('test-login').onclick = () => { void perform(() => api.testCredentials(), 'LMS 로그인에 성공했습니다.'); };
el('test-discord').onclick = () => { void perform(() => api.testDiscord(), 'Discord 연결 성공. 테스트 알림을 확인해 주세요.'); };
el('remove-login').onclick = () => { if (confirm('저장된 LMS 로그인 정보만 삭제할까요? 학습 데이터와 알림 이력은 그대로 보존됩니다.')) void perform(() => api.removeCredentials(), '로그인 정보를 삭제했습니다.'); };
el('options-form').onsubmit = event => { event.preventDefault(); void perform(saveOptions, '설정을 저장했습니다. 다음 자동 확인부터 적용합니다.'); };
el('migrate-scheduler').onclick = () => { void perform(() => api.migrateLegacyScheduler(), '기존 개발용 예약 작업을 안전하게 전환했습니다.'); };
el('open-logs').onclick = () => { void perform(() => api.openLogs(), '로그 폴더를 열었습니다.'); };
el('open-data').onclick = () => { void perform(() => api.openData(), '데이터 위치를 열었습니다.'); };
el('discord-help').onclick = () => { void perform(() => api.openDiscordHelp(), '공식 Discord 도움말을 브라우저에서 열었습니다.'); };
void refresh(); setInterval(() => { void refresh(); }, 10_000);

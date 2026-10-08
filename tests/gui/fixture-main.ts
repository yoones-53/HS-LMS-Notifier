// Separate synthetic entry point; NEVER imported by the production application.
import { app } from 'electron';
import { join } from 'node:path';
import { DesktopService } from '../../src/desktop/service.js';
import { createDesktopWindow } from '../../src/desktop/window.js';
import { runtimePaths } from '../../src/runtime/paths.js';
import { LmsStore } from '../../src/database/store.js';
import { runMonitor } from '../../src/monitor.js';
import { parseCourse } from '../../src/crawler/courses.js';
import { parseAssignment } from '../../src/crawler/assignments.js';
import { parseOnlineRow } from '../../src/crawler/videos.js';
import { loadSettings } from '../../src/runtime/settings.js';
import type { SchedulerStatus } from '../../src/desktop/contracts.js';
app.setPath('userData', process.argv[2]!);
if (!app.requestSingleInstanceLock()) app.quit();
else { void app.whenReady().then(async () => {
  let lms = false, discord = false, runs = 0;
  let scheduler: SchedulerStatus = {state:'ABSENT',nextAt:null,mode:'LEGACY',legacyDetected:true,legacyActive:true,targetCurrent:false};
  const service = new DesktopService(runtimePaths(app.getPath('userData')), runtimePaths(join(app.getPath('userData'), 'legacy')), {
    configured: async kind => kind === 'LMS' ? lms : discord, readId: async () => 'synthetic-student',
    saveLogin: async () => { lms=true; }, removeLogin: async () => { lms=false; }, saveDiscord: async () => { discord=true; },
    legacyWebhook: () => undefined, testLogin: async () => {}, testDiscord: async () => {},
    scheduler: async () => scheduler, schedulerPolicy:'TASK',
    syncScheduler: async action => { if (action === 'MigrateLegacy') scheduler={state:'ACTIVE',nextAt:null,mode:'PRODUCTION',legacyDetected:true,legacyActive:false,targetCurrent:true}; return scheduler; }, open: async () => {},
    run: async paths => {
      const store=new LmsStore(paths.database);
      const course = parseCourse({id:'selfarea_TEST1_A',href:"javascript:fncGoClassroom('TEST1','A','3');",title:'합성 과목'}, {year:'2026년',term:'2학기'});
      const assignment = parseAssignment({onclick:"fncModifyReport('1', 'N', '1', 'Y','Y')",title:'합성 미제출 과제',period:null,submission:'미제출',progress:null},course);
      const video = parseOnlineRow({id:'1',contentId:null,title:'합성 미수강 강의',period:null,status:null},course)!;
      const dueAt = new Date(Date.now()+86_400_000).toISOString();
      const items = runs++ === 0 ? [{...assignment,dueAt},{...assignment,itemId:'2',title:'합성 제출 완료',submitted:true},
        {...assignment,itemId:'3',title:'합성 상태 확인 과제',submitted:null}, {...video,dueAt,completed:false},
        {...video,itemId:'2',title:'합성 상태 확인 강의'}, {...video,itemId:'3',title:'합성 출석 완료',attendanceConfirmed:true}] : [];
      try { return await runMonitor(store,{courses:async()=>[course],enter:async()=>{},collect:async(_c,type)=>({status:'OK',items:items.filter(i=>i.type===type)})},
        async()=>({status:'SENT'}),()=>{},{authenticate:async()=>{},dispose:async()=>{},deliveryDelayMs:0,deadlineNotifications:loadSettings(paths).deadlineNotifications}); }
      finally { store.close(); }
    },
  });
  await service.initialize();
  const window = await createDesktopWindow(input=>service.handle(input));
  app.on('second-instance',()=>{window.show();window.focus();});
  app.on('window-all-closed',()=>app.quit());
}).catch(error=>{ console.error(error); app.exit(1); }); }

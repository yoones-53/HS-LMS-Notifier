import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, Method } from './contracts.js';
// No event object, arbitrary channel, filesystem or secret getter crosses this bridge.
const invoke = (method: Method, payload?: unknown) => ipcRenderer.invoke('hs-lms:request', payload === undefined ? { method } : { method, payload });
const api: DesktopApi = {
  verifyCalendar:()=>invoke('verifyCalendar'),
  connectCalendar:()=>invoke('connectCalendar'),disconnectCalendar:()=>invoke('disconnectCalendar'),setCalendarEnabled:value=>invoke('setCalendarEnabled',value),
  setAutoEnabled: value => invoke('setAutoEnabled', value),
  setTodoExcluded: value => invoke('setTodoExcluded', value),
  getStatus: () => invoke('getStatus'), getSettings: () => invoke('getSettings'),
  updateSettings: value => invoke('updateSettings', value), runCheck: () => invoke('runCheck'),
  setupCredentials: value => invoke('setupCredentials', value), removeCredentials: () => invoke('removeCredentials'),
  testCredentials: () => invoke('testCredentials'), configureDiscord: value => invoke('configureDiscord', value),
  configureDiscordCourse: value => invoke('configureDiscordCourse', value),
  removeDiscordCourse: key => invoke('removeDiscordCourse', key),
  testDiscordCourse: key => invoke('testDiscordCourse', key),
  testDiscord: () => invoke('testDiscord'), completeSetup: () => invoke('completeSetup'),
  migrateLegacyScheduler: () => invoke('migrateLegacyScheduler'),
  getRecentIncidents: () => invoke('getRecentIncidents'), openLogs: () => invoke('openLogs'),
  openData: () => invoke('openData'), openDiscordHelp: () => invoke('openDiscordHelp'),
};
contextBridge.exposeInMainWorld('lms', Object.freeze(api));

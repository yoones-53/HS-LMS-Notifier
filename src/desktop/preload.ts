import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, Method } from './contracts.js';
// No event object, arbitrary channel, filesystem or secret getter crosses this bridge.
const invoke = (method: Method, payload?: unknown) => ipcRenderer.invoke('hs-lms:request', payload === undefined ? { method } : { method, payload });
const api: DesktopApi = {
  getStatus: () => invoke('getStatus'), getSettings: () => invoke('getSettings'),
  updateSettings: value => invoke('updateSettings', value), runCheck: () => invoke('runCheck'),
  setupCredentials: value => invoke('setupCredentials', value), removeCredentials: () => invoke('removeCredentials'),
  testCredentials: () => invoke('testCredentials'), configureDiscord: value => invoke('configureDiscord', value),
  testDiscord: () => invoke('testDiscord'), completeSetup: () => invoke('completeSetup'),
  migrateLegacyScheduler: () => invoke('migrateLegacyScheduler'),
  getRecentIncidents: () => invoke('getRecentIncidents'), openLogs: () => invoke('openLogs'),
  openData: () => invoke('openData'), openDiscordHelp: () => invoke('openDiscordHelp'),
};
contextBridge.exposeInMainWorld('lms', Object.freeze(api));

// Exposes the main process handlers to the renderer as window.rankTracker (nothing else of Node or Electron).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { RankTrackerApi, SerpCheckResult, SyncResult } from '../shared/types';

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const methods: Exclude<keyof RankTrackerApi, 'onSynced' | 'onSerpChecked'>[] = [
  'listProjects',
  'createProject',
  'updateProject',
  'deleteProject',
  'reorderProjects',
  'addKeywords',
  'deleteKeyword',
  'setKeywordTags',
  'setProjectNotes',
  'setKeywordLanguage',
  'getHistory',
  'syncProject',
  'getOpportunities',
  'getRankingKeywords',
  'getSerpData',
  'checkCompetition',
  'fetchPage',
  'getSerperStatus',
  'copyToClipboard',
  'saveSerperApiKey',
  'getGoogleSettings',
  'saveGoogleSettings',
  'getOptions',
  'saveOptions',
  'getAuthStatus',
  'signIn',
  'signOut',
  'listSites',
];

const api = {
  ...Object.fromEntries(methods.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(`rankTracker:${name}`, ...args)])),
  onSynced(callback: (result: SyncResult) => void): () => void {
    return subscribe('rankTracker:synced', callback);
  },
  onSerpChecked(callback: (result: SerpCheckResult) => void): () => void {
    return subscribe('rankTracker:serpChecked', callback);
  },
} as unknown as RankTrackerApi;

contextBridge.exposeInMainWorld('rankTracker', api);

// Electron main process: the window, the tray icon, the daily sync and the handlers behind window.rankTracker.
import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, Notification, powerMonitor, shell, Tray } from 'electron';
import { join } from 'node:path';
import type { AppOptions, RankAlert, RankTrackerApi, SerpCheckResult, SyncResult } from '../shared/types';
import * as google from './google';
import * as serper from './serper';
import * as store from './store';

/** A project is synced automatically when its last sync is older than this. */
const AUTO_SYNC_AGE_MS = 23 * 60 * 60 * 1000;
/** The competition of a project is checked automatically when its last check is older than this (weekly). */
const AUTO_SERP_AGE_MS = (7 * 24 - 1) * 60 * 60 * 1000;
const AUTO_SYNC_CHECK_MS = 60 * 60 * 1000;
const AUTO_SYNC_FIRST_CHECK_MS = 60 * 1000;

let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;

// ---------------------------------------------------------------- sync and notifications

function describeAlert(alert: RankAlert): string {
  const from = alert.from === undefined ? 'not ranking' : alert.from.toFixed(1);
  return alert.kind === 'drop'
    ? `▼ ${alert.keyword}: ${from} → ${alert.to.toFixed(1)}`
    : `★ ${alert.keyword}: top 10 (${from} → ${alert.to.toFixed(1)})`;
}

function notify(result: SyncResult): void {
  if (result.alerts.length === 0 || !Notification.isSupported()) return;
  // While the app has focus, the alerts are shown in the window itself.
  if (window?.isVisible() && window.isFocused()) return;
  const project = store.listProjects().find((p) => p.id === result.projectId);
  const lines = result.alerts.slice(0, 4).map(describeAlert);
  if (result.alerts.length > 4) lines.push(`and ${result.alerts.length - 4} more`);
  const notification = new Notification({
    title: `${project?.name ?? 'Rank Tracker'}: ${result.alerts.length} ranking change${result.alerts.length === 1 ? '' : 's'}`,
    body: lines.join('\n'),
  });
  notification.on('click', showWindow);
  notification.show();
}

async function syncAndNotify(projectId: string): Promise<SyncResult> {
  const result = await google.syncProject(projectId);
  window?.webContents.send('rankTracker:synced', result);
  notify(result);
  return result;
}

async function checkCompetition(projectId: string): Promise<SerpCheckResult> {
  const result = await serper.checkCompetition(projectId);
  window?.webContents.send('rankTracker:serpChecked', result);
  return result;
}

function isDue(lastAt: string, ageMs: number): boolean {
  return !lastAt || Date.now() - Date.parse(lastAt) >= ageMs;
}

let autoSyncRunning = false;

/**
 * Syncs every project with keywords whose last sync is more than a day ago, and checks its competition when
 * the last check is a week ago (with a Serper key). `force` (tray menu) syncs every project now.
 */
async function autoSync(force = false): Promise<void> {
  if (autoSyncRunning || (!force && !store.getOptions().autoSync)) return;
  autoSyncRunning = true;
  try {
    for (const project of store.listProjects()) {
      if (project.keywords.length === 0) continue;
      if (google.isSignedIn() && (force || isDue(project.lastSyncAt, AUTO_SYNC_AGE_MS))) {
        try {
          await syncAndNotify(project.id);
        } catch (error) {
          console.error(`Automatic sync of "${project.name}" failed:`, error);
        }
      }
      if (store.getSerperApiKey().key && isDue(project.lastSerpCheckAt, AUTO_SERP_AGE_MS)) {
        try {
          await checkCompetition(project.id);
        } catch (error) {
          console.error(`Automatic competition check of "${project.name}" failed:`, error);
        }
      }
    }
  } finally {
    autoSyncRunning = false;
  }
}

// ---------------------------------------------------------------- options

function applyLoginItem(options: AppOptions): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  app.setLoginItemSettings({
    openAtLogin: options.startWithWindows,
    path: process.execPath,
    // Unpackaged (development), Electron needs the app folder as argument.
    args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'],
  });
}

// ---------------------------------------------------------------- IPC

type Handlers = {
  [K in Exclude<keyof RankTrackerApi, 'onSynced' | 'onSerpChecked'>]: (
    ...args: Parameters<RankTrackerApi[K]>
  ) => Awaited<ReturnType<RankTrackerApi[K]>> | ReturnType<RankTrackerApi[K]>;
};

const handlers: Handlers = {
  listProjects: () => store.listProjects(),
  createProject: (input) => store.createProject(input),
  updateProject: (id, input) => store.updateProject(id, input),
  deleteProject: (id) => store.deleteProject(id),
  reorderProjects: (ids) => store.reorderProjects(ids),
  addKeywords: (projectId, texts, tags) => store.addKeywords(projectId, texts, tags),
  deleteKeyword: (projectId, keywordId) => store.deleteKeyword(projectId, keywordId),
  setKeywordTags: (projectId, keywordId, tags) => store.setKeywordTags(projectId, keywordId, tags),
  setProjectNotes: (projectId, notes) => store.setProjectNotes(projectId, notes),
  setKeywordLanguage: (projectId, keywordId, language) => store.setKeywordLanguage(projectId, keywordId, language),
  getHistory: (projectId) => store.readHistory(projectId),
  syncProject: (projectId) => syncAndNotify(projectId),
  getOpportunities: (projectId) => google.getOpportunities(projectId),
  getRankingKeywords: (projectId, filter) => google.getRankingKeywords(projectId, filter),
  getSerpData: (projectId) => store.readSerp(projectId),
  checkCompetition: (projectId) => checkCompetition(projectId),
  fetchPage: (url) => serper.fetchPage(url),
  getSerperStatus: () => {
    const { source } = store.getSerperApiKey();
    return { configured: source !== '', source };
  },
  copyToClipboard: (text) => {
    clipboard.writeText(text);
  },
  saveSerperApiKey: (key) => {
    store.setSerperApiKey(key);
  },

  getGoogleSettings: () => store.getGoogleSettings(),
  saveGoogleSettings: (settings) => {
    store.saveGoogleSettings(settings);
  },
  getOptions: () => store.getOptions(),
  saveOptions: (options) => {
    store.saveOptions(options);
    applyLoginItem(options);
  },
  getAuthStatus: () => {
    const settings = store.getGoogleSettings();
    return { configured: settings.clientId !== '' && settings.clientSecret !== '', signedIn: google.isSignedIn() };
  },
  signIn: () => google.signIn(),
  signOut: () => {
    google.signOut();
  },
  listSites: () => google.listSites(),
};

function registerHandlers(): void {
  for (const [name, handler] of Object.entries(handlers) as [string, (...args: unknown[]) => unknown][]) {
    ipcMain.handle(`rankTracker:${name}`, (_event, ...args: unknown[]) => handler(...args));
  }
}

// ---------------------------------------------------------------- window and tray

/** A 16x16 icon (rising bars on blue), drawn in code so the app needs no image files. */
function createIcon(): Electron.NativeImage {
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4);
  const bars = [
    { x: 3, top: 10 },
    { x: 7, top: 7 },
    { x: 11, top: 4 },
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const corner = (x === 0 || x === size - 1) && (y === 0 || y === size - 1);
      const bar = bars.some((b) => x >= b.x && x < b.x + 2 && y >= b.top && y < 13);
      const i = (y * size + x) * 4;
      // BGRA
      const [b, g, r, a] = corner ? [0, 0, 0, 0] : bar ? [255, 255, 255, 255] : [222, 111, 47, 255];
      pixels[i] = b;
      pixels[i + 1] = g;
      pixels[i + 2] = r;
      pixels[i + 3] = a;
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

function showWindow(): void {
  if (!window) createWindow(true);
  else {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
}

function createWindow(show: boolean): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'SEO Rank Tracker',
    icon: createIcon(),
    show,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Links open in the default browser, never in the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // With "keep in tray", closing only hides the window, so the daily sync keeps running.
  window.on('close', (event) => {
    if (!quitting && store.getOptions().keepInTray) {
      event.preventDefault();
      window?.hide();
    }
  });
  window.on('closed', () => {
    window = undefined;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) void window.loadURL(devServerUrl);
  else void window.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

function createTray(): void {
  tray = new Tray(createIcon());
  tray.setToolTip('SEO Rank Tracker');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open SEO Rank Tracker', click: showWindow },
      { label: 'Sync all projects now', click: () => void autoSync(true) },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', showWindow);
}

// ---------------------------------------------------------------- app

// The data folder stays %APPDATA%\seo-rank-tracker, also in the installed app (whose product name
// "SEO Rank Tracker" would otherwise give it another folder, without the existing projects).
app.setPath('userData', join(app.getPath('appData'), 'seo-rank-tracker'));

if (!app.requestSingleInstanceLock()) {
  // Already running (e.g. in the tray): that instance shows its window.
  app.quit();
} else {
  app.setAppUserModelId('com.lialis.seoranktracker');
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    // SERPER_API_KEY from a .env in the app folder (the project folder during development).
    serper.loadEnvFile([app.getAppPath(), process.cwd()]);
    registerHandlers();
    applyLoginItem(store.getOptions());
    createTray();
    createWindow(!process.argv.includes('--hidden'));

    setTimeout(() => void autoSync(), AUTO_SYNC_FIRST_CHECK_MS);
    setInterval(() => void autoSync(), AUTO_SYNC_CHECK_MS);
    powerMonitor.on('resume', () => void autoSync());
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    // Only reached without "keep in tray" (the window is hidden instead of closed otherwise).
    app.quit();
  });
}

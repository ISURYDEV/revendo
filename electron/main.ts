import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, getDataDir } from './db/connection';
import { registerIpcHandlers } from './ipc';
import { runScheduledBackup } from './services/backup/backup';
import { maybeRunMaintenance } from './services/maintenance/cleanup';
import { runAutomaticLinking } from './services/automation/startupLinking';
import { ensureStockForSalesWithSku } from './services/sales/stockAssociation';

const isDev = process.env.NODE_ENV === 'development';

function configureAppIdentityAndDataDir(): void {
  app.setName('Revendo');
  const appData = app.getPath('appData');
  const revendoDir = path.join(appData, 'Revendo');
  const legacyDirs = [
    path.join(appData, 'vinted-pro'),
    path.join(appData, 'VINTED PRO'),
    path.join(appData, 'vintedpro')
  ];

  if (!fs.existsSync(revendoDir)) {
    const legacy = legacyDirs.find((dir) => fs.existsSync(path.join(dir, 'data')) || fs.existsSync(path.join(dir, 'documents')));
    if (legacy) {
      fs.cpSync(legacy, revendoDir, { recursive: true, errorOnExist: false });
    }
  }
  if (!fs.existsSync(revendoDir)) fs.mkdirSync(revendoDir, { recursive: true });
  app.setPath('userData', revendoDir);
}

configureAppIdentityAndDataDir();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'Revendo',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  // Initialize DB on startup so migrations run before any IPC fires
  const db = getDb();
  // eslint-disable-next-line no-console
  console.log('[Revendo] data dir:', getDataDir());

  // Run periodic maintenance (audit log rotation, etc.)
  try { maybeRunMaintenance(db); } catch (err) { console.error('[Revendo] maintenance error', err); }
  registerIpcHandlers();
  createWindow();

  setTimeout(() => {
    const window = BrowserWindow.getAllWindows()[0];
    try {
      const stockSummary = ensureStockForSalesWithSku(db, {});
      void runAutomaticLinking(db)
        .then((linkSummary) => {
          const summary = { stock: stockSummary, documents: linkSummary };
          window?.webContents.send('automation:done', summary);
          // eslint-disable-next-line no-console
          console.log('[Revendo] associations automatiques:', summary);
        })
        .catch((err) => {
          window?.webContents.send('automation:done', { error: err instanceof Error ? err.message : String(err) });
          // eslint-disable-next-line no-console
          console.error('[Revendo] automatic linking error', err);
        });
    } catch (err) {
      window?.webContents.send('automation:done', { error: err instanceof Error ? err.message : String(err) });
      // eslint-disable-next-line no-console
      console.error('[Revendo] stock automatic linking error', err);
    }
  }, 2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let quitBackupDone = false;

async function performShutdownBackup(): Promise<void> {
  if (quitBackupDone) return;
  quitBackupDone = true;
  try {
    const db = getDb();
    const enabledRow = db
      .prepare(`SELECT value FROM settings WHERE key='backup_enabled'`)
      .get() as { value: string } | undefined;
    if (enabledRow?.value !== 'true') return;
    const keepRow = db
      .prepare(`SELECT value FROM settings WHERE key='backup_keep_daily_days'`)
      .get() as { value: string } | undefined;
    const keep = keepRow ? Number(keepRow.value) || 30 : 30;
    await runScheduledBackup(db, keep);
    // eslint-disable-next-line no-console
    console.log('[Revendo] backup OK');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Revendo] backup failed', err);
  }
}

app.on('window-all-closed', async () => {
  await performShutdownBackup();
  closeDb();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  if (!quitBackupDone) {
    e.preventDefault();
    await performShutdownBackup();
    closeDb();
    app.exit(0);
  }
});

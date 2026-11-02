import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// Recordings are temporary; exports default to ~/Movies/Mockup Studio (you can still pick any folder when exporting).
process.env.MOCKUP_CAPTURES_DIR = path.join(app.getPath('temp'), 'mockup-studio-captures');
process.env.MOCKUP_DATA_DIR = path.join(app.getPath('home'), 'Movies', 'Mockup Studio');
fs.mkdirSync(process.env.MOCKUP_CAPTURES_DIR, { recursive: true });
fs.mkdirSync(process.env.MOCKUP_DATA_DIR, { recursive: true });

if (!app.requestSingleInstanceLock()) app.quit();

let win;
async function createWindow() {
  const { startServer } = await import('./web/server.js');
  const port = await startServer(4173);
  win = new BrowserWindow({
    width: 1560, height: 980, minWidth: 1100, minHeight: 700, backgroundColor: '#0b0b0b', title: 'Mockup Studio',
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${port}`) && !url.startsWith(`http://localhost:${port}`)) { e.preventDefault(); shell.openExternal(url); } });
  await win.loadURL(`http://127.0.0.1:${port}/`);
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Mockup Studio', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ]));
  try { await createWindow(); }
  catch (e) { dialog.showErrorBox('Mockup Studio could not start', String(e && e.stack || e)); app.quit(); }
});

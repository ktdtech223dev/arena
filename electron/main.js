// ARENA — N Games launcher shell (Electron).
// A thin desktop window that loads the deployed ARENA client and drops straight
// into multiplayer. This is how N Games launches the game as a desktop app; the
// same URL also runs in any browser. Pointer lock + fullscreen are enabled for
// a native feel. Zero game logic lives here — the client + server are the game.
//
// Run standalone:  npx electron electron/main.js
// N Games integration: spawn this, or point the launcher at ARENA_URL directly.
const { app, BrowserWindow, session } = require('electron');

const ARENA_URL = process.env.ARENA_URL || 'https://range-production-bd9e.up.railway.app/?mode=arena';

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    fullscreen: process.env.ARENA_WINDOWED ? false : true,
    backgroundColor: '#0a0c10',
    title: 'ARENA',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // WebGPU + pointer lock work out of the box in modern Electron/Chromium.
    },
  });

  // Auto-grant pointer lock (no permission prompt) — this is a game window.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'pointerLock' || permission === 'fullscreen' ? true : true);
  });

  win.setMenuBarVisibility(false);
  win.loadURL(ARENA_URL);
  // F11 toggles fullscreen; Esc releases the mouse (handled by the game).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') win.setFullScreen(!win.isFullScreen());
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

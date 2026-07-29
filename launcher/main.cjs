// ARENA — desktop launcher (Electron). A native, full-screen window that loads
// the live game. Because it's a top-level Chromium window (not a browser tab or
// iframe), POINTER LOCK + FULLSCREEN + WebGPU all work natively with no browser
// quirks. Zero game logic here — the client + authoritative server ARE the game.
//
// Dev:   npm start           (npx electron .)
// Build: npm run dist        (electron-builder → a portable Windows .exe)
const { app, BrowserWindow, session, shell } = require('electron');

// The live game. Root URL = the main menu (Test Range / Multiplayer / Map Editor).
const BASE_URL = process.env.ARENA_URL || 'https://range-production-bd9e.up.railway.app/';

// The N Games Launcher sets NGAMES_PROFILE=<crew id> when it launches us.
// Forward it to the page as a query param — the renderer (remote URL,
// contextIsolation, no preload) can't read process.env itself.
function gameUrl() {
  try {
    const u = new URL(BASE_URL);
    // Electron's WebGPU (enable-unsafe-webgpu) miscompiles the game's shader
    // pipelines on some machines (GPUPipelineError → black screen). Boot the
    // desktop app straight onto the WebGL2 backend — no first-load flicker.
    // (The client also self-heals via a runtime fallback for older exes.)
    u.searchParams.set('webgl', '1');
    const p = process.env.NGAMES_PROFILE; // set by the N Games Launcher
    if (p) u.searchParams.set('ngames_profile', p);
    return u.toString();
  } catch { return BASE_URL; }
}
const GAME_URL = gameUrl();

// Give the GPU the best shot at WebGPU; harmless if already enabled.
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    fullscreen: !process.env.ARENA_WINDOWED,
    backgroundColor: '#0a0c10',
    title: 'ARENA',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep the sim/render running when unfocused
    },
  });

  // This IS a game window — grant pointer lock + fullscreen (and anything else the
  // page asks for) with no prompt. Top-level Electron windows lock the cursor cleanly.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());

  // external links (if any) open in the user's browser, never a new game window
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  load();

  // F11 toggles fullscreen; the game owns Esc (releases the mouse / opens menus).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
  });

  // If the game can't be reached (offline / server down), show a friendly retry page.
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted (e.g. a redirect), ignore
    win.loadURL('data:text/html,' + encodeURIComponent(offlinePage(desc || code)));
  });
}

function load() { win.loadURL(GAME_URL).catch(() => {}); }

function offlinePage(reason) {
  return `<!doctype html><meta charset="utf8"><title>ARENA — offline</title>
  <style>html,body{height:100%;margin:0;background:#0a0c10;color:#dfe7f0;font-family:Segoe UI,system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;text-align:center}
  .b{max-width:520px;padding:32px}h1{color:#7df9ff;letter-spacing:.3em;font-size:22px;margin:0 0 12px}
  p{opacity:.8;line-height:1.6}button{margin-top:18px;padding:10px 22px;font-weight:800;letter-spacing:.14em;
    background:rgba(125,249,255,.12);color:#7df9ff;border:1px solid rgba(125,249,255,.5);border-radius:6px;cursor:pointer}
  button:hover{background:rgba(125,249,255,.22)}small{opacity:.5}</style>
  <div class="b"><h1>ARENA</h1><p>Couldn't reach the game server.<br>ARENA is an online game — check your internet connection and try again.</p>
  <p><small>${String(reason).replace(/[<>&]/g, '')}</small></p>
  <button onclick="location.href='${GAME_URL}'">RETRY</button></div>`;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

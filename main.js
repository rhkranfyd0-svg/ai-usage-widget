const { app, BrowserWindow, BrowserView, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const POLL_INTERVAL_MS = 5 * 60 * 1000;

const SERVICES = [
  { id: 'claude', label: 'Claude', homeUrl: 'https://claude.ai/new', partition: 'persist:claude' },
  { id: 'chatgpt', label: 'ChatGPT', homeUrl: 'https://chatgpt.com/', partition: 'persist:chatgpt' },
  { id: 'gemini', label: 'Gemini', homeUrl: 'https://gemini.google.com/app', partition: 'persist:gemini' },
];

let mainWindow;
let tray;
const views = {};
const latestUsage = {};
let bgAlpha = 0.92;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { width: 300, height: 300, alwaysOnTop: true, bgAlpha: 0.92 };
  }
}

function saveState() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const state = { ...bounds, alwaysOnTop: mainWindow.isAlwaysOnTop(), bgAlpha };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {
    // best-effort persistence only
  }
}

function waitForIdle(view, timeoutMs) {
  return new Promise((resolve) => {
    if (!view.webContents.isLoading()) return resolve();
    const timer = setTimeout(() => {
      view.webContents.removeListener('did-stop-loading', onDone);
      resolve();
    }, timeoutMs);
    function onDone() {
      clearTimeout(timer);
      resolve();
    }
    view.webContents.once('did-stop-loading', onDone);
  });
}

const REMAINING_WORDS = ['남음', 'left', 'remaining'];
const USED_WORDS = ['사용됨', '사용', 'used'];
const RESET_WORDS = ['초기화', '재설정', 'resets', 'reset'];

function containsAny(line, words) {
  const lower = line.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

function extractMetricsByAnchors(text, anchors) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const metrics = [];
  anchors.forEach(({ match, label }) => {
    const idx = lines.findIndex((l) => match.some((m) => l.toLowerCase() === m.toLowerCase()));
    if (idx === -1) return;
    let usedPercent = null;
    let resetText = null;
    for (let k = idx + 1; k < Math.min(lines.length, idx + 8); k++) {
      const l = lines[k];
      if (usedPercent === null) {
        const m = l.match(/(\d{1,3})\s*%/);
        if (m && (containsAny(l, REMAINING_WORDS) || containsAny(l, USED_WORDS))) {
          const num = parseInt(m[1], 10);
          usedPercent = containsAny(l, REMAINING_WORDS) ? 100 - num : num;
        }
      }
      if (resetText === null && containsAny(l, RESET_WORDS)) {
        resetText = l;
      }
      if (usedPercent !== null && resetText !== null) break;
    }
    if (usedPercent !== null) {
      metrics.push({ label, usedPercent, resetText });
    }
  });
  return metrics;
}

const ANCHORS = {
  claude: [
    { match: ['현재 세션', 'Current session'], label: '5h' },
    { match: ['주간 한도', 'Weekly limit'], label: 'Weekly' },
  ],
  chatgpt: [{ match: ['주간 사용량 한도', 'Weekly usage limit'], label: 'Weekly' }],
  gemini: [
    { match: ['현재 사용량', 'Current usage'], label: 'Current' },
    { match: ['주간 한도', 'Weekly limit'], label: 'Weekly' },
  ],
};

function findByTextJs(candidates) {
  return `
(function(){
  const targets = ${JSON.stringify(candidates.map((c) => c.toLowerCase()))};
  const cands = Array.from(document.querySelectorAll('button, [role="menuitem"], a, div, span'));
  const el = cands.find(e => e.textContent && targets.includes(e.textContent.trim().toLowerCase()));
  if (el) { el.click(); return true; }
  return false;
})()`;
}

function clickByLabelJs(candidates) {
  return `
(function(){
  const targets = ${JSON.stringify(candidates.map((c) => c.toLowerCase()))};
  const cands = Array.from(document.querySelectorAll('button, [role="button"], a'));
  const el = cands.find(e => {
    const label = ((e.getAttribute('aria-label')||e.title||'')+'').toLowerCase();
    return targets.some(t => label.includes(t));
  });
  if (el) { el.click(); return true; }
  return false;
})()`;
}

// Page dumps contain the user's chat titles and account email, so they are
// written only when explicitly enabled via AI_USAGE_DEBUG=1.
const DEBUG_ENABLED = process.env.AI_USAGE_DEBUG === '1';
const DEBUG_DIR = path.join(app.getPath('userData'), 'debug');

function saveDebugDump(id, text) {
  if (!DEBUG_ENABLED) return;
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DEBUG_DIR, `${id}-last.txt`), text, 'utf-8');
  } catch {
    // best-effort debug artifact only
  }
}

function appendLog(line) {
  if (!DEBUG_ENABLED) return;
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.appendFileSync(path.join(DEBUG_DIR, 'debug.log'), `[${new Date().toISOString()}] ${line}\n`, 'utf-8');
  } catch {
    // best-effort debug artifact only
  }
}

async function fetchClaudeUsage(attempt) {
  const view = views.claude;
  appendLog(`claude attempt${attempt}: loadURL billing`);
  await view.webContents.loadURL('https://claude.ai/new#settings/billing');
  await waitForIdle(view, 15000);
  await wait(4500);
  appendLog(`claude attempt${attempt}: click usage tab`);
  const clicked = await view.webContents.executeJavaScript(findByTextJs(['사용량', 'Usage']));
  appendLog(`claude attempt${attempt}: clicked=${clicked}`);
  await wait(2500);
  const text = await view.webContents.executeJavaScript('document.body.innerText');
  saveDebugDump(`claude-attempt${attempt}`, text);
  saveDebugDump('claude', text);
  const metrics = extractMetricsByAnchors(text, ANCHORS.claude);
  appendLog(`claude attempt${attempt}: metrics=${JSON.stringify(metrics)}`);
  return metrics;
}

async function fetchChatgptUsage(attempt) {
  const view = views.chatgpt;
  appendLog(`chatgpt attempt${attempt}: loadURL home`);
  await view.webContents.loadURL('https://chatgpt.com/');
  await waitForIdle(view, 15000);
  await wait(3500);
  appendLog(`chatgpt attempt${attempt}: loadURL usage hash`);
  await view.webContents.loadURL('https://chatgpt.com/#settings/Usage');
  await waitForIdle(view, 15000);
  await wait(5000);
  const text = await view.webContents.executeJavaScript('document.body.innerText');
  saveDebugDump(`chatgpt-attempt${attempt}`, text);
  saveDebugDump('chatgpt', text);
  const metrics = extractMetricsByAnchors(text, ANCHORS.chatgpt);
  appendLog(`chatgpt attempt${attempt}: metrics=${JSON.stringify(metrics)}`);
  return metrics;
}

async function fetchGeminiUsage(attempt) {
  const view = views.gemini;
  appendLog(`gemini attempt${attempt}: loadURL app`);
  await view.webContents.loadURL('https://gemini.google.com/app');
  await waitForIdle(view, 15000);
  await wait(2500);
  await view.webContents.executeJavaScript(clickByLabelJs(['설정', 'Settings']));
  await wait(1500);
  const usageItemFound = await view.webContents.executeJavaScript(
    findByTextJs(['사용량 한도', 'Usage limits', 'Usage limit'])
  );
  usageScreenMissing.gemini = !usageItemFound;
  appendLog(`gemini attempt${attempt}: usageItemFound=${usageItemFound}`);
  await wait(2500);
  const text = await view.webContents.executeJavaScript('document.body.innerText');
  saveDebugDump('gemini', text);
  const metrics = extractMetricsByAnchors(text, ANCHORS.gemini);
  appendLog(`gemini attempt${attempt}: metrics=${JSON.stringify(metrics)}`);
  return metrics;
}

const FETCHERS = { claude: fetchClaudeUsage, chatgpt: fetchChatgptUsage, gemini: fetchGeminiUsage };

const LOGIN_URL_HINTS = ['/login', '/auth', 'accounts.google.com', 'signin', 'sign-in'];

const HAS_SIGNIN_CONTROL_JS = `
(function(){
  const words = ['로그인', 'sign in', 'log in', 'sign-in'];
  const cands = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  return cands.some(e => {
    const t = (e.textContent || '').trim().toLowerCase();
    if (t.length > 20) return false;
    return words.some(w => t === w);
  });
})()`;

// Set by a fetcher when it could not even reach the usage screen — a strong
// logged-out signal for services that render no explicit sign-in control.
const usageScreenMissing = {};

async function looksLoggedOut(id) {
  const view = views[id];
  if (!view) return false;
  const url = (view.webContents.getURL() || '').toLowerCase();
  if (LOGIN_URL_HINTS.some((h) => url.includes(h))) return true;
  if (usageScreenMissing[id]) return true;
  try {
    return await view.webContents.executeJavaScript(HAS_SIGNIN_CONTROL_JS);
  } catch {
    return false;
  }
}

const MAX_ATTEMPTS = 4;

async function pollService(id, attempt = 1) {
  try {
    const metrics = await FETCHERS[id](attempt);
    if (metrics.length === 0 && (await looksLoggedOut(id))) {
      appendLog(`${id} attempt${attempt}: needsLogin`);
      latestUsage[id] = { metrics: [], ok: false, needsLogin: true, updatedAt: Date.now() };
      if (mainWindow) mainWindow.webContents.send('usage-update', { id, data: latestUsage[id] });
      return;
    }
    if (metrics.length === 0 && attempt < MAX_ATTEMPTS) {
      await wait(1500 * attempt);
      return pollService(id, attempt + 1);
    }
    latestUsage[id] = { metrics, ok: metrics.length > 0, updatedAt: Date.now() };
  } catch (e) {
    appendLog(`${id} attempt${attempt} THROW: ${e.stack || e}`);
    if (attempt < MAX_ATTEMPTS) {
      await wait(1500 * attempt);
      return pollService(id, attempt + 1);
    }
    latestUsage[id] = { metrics: [], ok: false, error: String(e), updatedAt: Date.now() };
  }
  if (mainWindow) {
    mainWindow.webContents.send('usage-update', { id, data: latestUsage[id] });
  }
}

async function pollAll() {
  for (const svc of SERVICES) {
    await pollService(svc.id);
  }
}

let pollTimer = null;
function schedulePolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await pollAll();
    schedulePolling();
  }, POLL_INTERVAL_MS);
}

function createWindow() {
  const state = loadState();
  bgAlpha = typeof state.bgAlpha === 'number' ? state.bgAlpha : 0.92;

  mainWindow = new BrowserWindow({
    width: state.width || 300,
    height: state.height || 340,
    x: state.x,
    y: state.y,
    minWidth: 260,
    minHeight: 220,
    resizable: true,
    alwaysOnTop: state.alwaysOnTop !== false,
    title: 'AI 사용량',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  SERVICES.forEach((svc) => {
    const view = new BrowserView({
      webPreferences: {
        partition: svc.partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    view.webContents.loadURL(svc.homeUrl);
    views[svc.id] = view;
  });

  mainWindow.on('resize', () => {
    layoutLoginView();
    if (!loginState) saveState();
  });
  mainWindow.on('move', () => {
    if (!loginState) saveState();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  createTray();

  setTimeout(async () => {
    await pollAll();
    schedulePolling();
  }, 10000);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('AI 사용량 위젯');

  const menu = Menu.buildFromTemplate([
    {
      label: '보이기/숨기기',
      click: () => (mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()),
    },
    {
      label: '항상 위',
      type: 'checkbox',
      checked: mainWindow.isAlwaysOnTop(),
      click: (item) => {
        mainWindow.setAlwaysOnTop(item.checked);
        saveState();
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => (mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()));
}

ipcMain.on('toggle-pin', () => {
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next);
  saveState();
  mainWindow.webContents.send('pin-state', next);
});

ipcMain.on('refresh-all', () => {
  pollAll();
});

ipcMain.on('open-external', (_e, id) => {
  const svc = SERVICES.find((s) => s.id === id);
  if (svc) shell.openExternal(svc.homeUrl);
});

const LOGIN_BAR_HEIGHT = 34;
let loginState = null;

function layoutLoginView() {
  if (!loginState || !mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  views[loginState.id].setBounds({
    x: 0,
    y: LOGIN_BAR_HEIGHT,
    width,
    height: Math.max(0, height - LOGIN_BAR_HEIGHT),
  });
}

ipcMain.on('start-login', (_e, id) => {
  const svc = SERVICES.find((s) => s.id === id);
  if (!svc || !views[id] || loginState) return;

  loginState = { id, bounds: mainWindow.getBounds(), wasOnTop: mainWindow.isAlwaysOnTop() };

  mainWindow.setAlwaysOnTop(false);
  mainWindow.setBounds({
    x: loginState.bounds.x,
    y: loginState.bounds.y,
    width: 520,
    height: 720,
  });
  mainWindow.setBrowserView(views[id]);
  layoutLoginView();
  views[id].webContents.loadURL(svc.homeUrl);
  mainWindow.webContents.send('login-mode', { id, label: svc.label });
});

ipcMain.on('end-login', async () => {
  if (!loginState) return;
  const { id, bounds, wasOnTop } = loginState;
  loginState = null;

  mainWindow.setBrowserView(null);
  mainWindow.setBounds(bounds);
  mainWindow.setAlwaysOnTop(wasOnTop);
  mainWindow.webContents.send('login-mode', null);
  saveState();

  await pollService(id);
});

ipcMain.on('set-bg-alpha', (_e, value) => {
  bgAlpha = Math.max(0.15, Math.min(1, value));
  saveState();
});

ipcMain.on('hide-window', () => {
  mainWindow.hide();
});

ipcMain.handle('get-init-state', () => ({
  alwaysOnTop: mainWindow.isAlwaysOnTop(),
  services: SERVICES.map((s) => ({ id: s.id, label: s.label })),
  usage: latestUsage,
  bgAlpha,
}));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuiting = true;
});

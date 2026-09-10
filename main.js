// 360News — Electron 主进程
// 基于 RSS-to-Telegram-Bot，MacOS 桌面 RSS 聚合推送工具
'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const APP_VERSION = app.getVersion();

// ----- 路径常量 -----
// 开发模式：RSStT 源码在上级目录的 ../RSStT（即 ZCodeProject/RSStT）
// 打包后：优先找 .app 内的 RSStT，找不到则回退到开发目录
const DEV_RSSTT = '/Users/henry/ZCodeProject/RSStT';  // 开发目录绝对路径
const PKG_RSSTT = app.isPackaged ? path.join(process.resourcesPath, 'RSStT') : null;
// 优先开发目录（实时数据），次选.app内的（打包时快照）
const RSSTT_ROOT = (fs.existsSync(path.join(DEV_RSSTT, 'telegramRSSbot.py')))
  ? DEV_RSSTT
  : (PKG_RSSTT && fs.existsSync(path.join(PKG_RSSTT, 'telegramRSSbot.py'))
    ? PKG_RSSTT
    : path.join(__dirname, 'RSStT'));
const CONFIG_DIR = path.join(RSSTT_ROOT, 'config');
const ENV_FILE = path.join(CONFIG_DIR, '.env');

// Python 虚拟环境：先找 app 内的，再找开发目录的
function findVenv(root) {
  const dev = path.join(root, '.venv', 'bin', 'python');
  if (fs.existsSync(dev)) return dev;
  // 打包后 .venv 可能在开发目录
  const devFallback = '/Users/henry/ZCodeProject/RSStT/.venv/bin/python';
  if (fs.existsSync(devFallback)) return devFallback;
  return dev; // 返回预期路径，让错误提示显示正确位置
}
const VENV_PYTHON = findVenv(RSSTT_ROOT);
const ENTRY = path.join(RSSTT_ROOT, 'telegramRSSbot.py');
const DB_FILE = path.join(CONFIG_DIR, 'db.sqlite3'); // ZCode: 订阅管理 DB

// ZCode: Python 脚本 DB 桥
const DB_SCRIPT = path.join(RSSTT_ROOT, 'scripts', 'db_query.py');
const VENV_PY = VENV_PYTHON;  // 复用同一个查找逻辑

function dbQuery(...args) {
  return new Promise((resolve) => {
    const proc = spawn(VENV_PY, [DB_SCRIPT, ...args], { cwd: RSSTT_ROOT });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => { /* ignore */ });
    proc.on('close', () => {
      try { resolve(JSON.parse(out)); }
      catch { resolve({ ok: false, error: 'DB 查询失败' }); }
    });
  });
}

// ----- X/Twitter RSS Bridge 路径 -----
const BRIDGE_SCRIPT = path.join(RSSTT_ROOT, 'src', 'twitter_rss_bridge.py');
const BRIDGE_PORT = 1200;
const BRIDGE_CONFIG = path.join(CONFIG_DIR, 'xbridge_config.json');
const ROUTES_FILE = path.join(CONFIG_DIR, 'push_routes.json');

// 读取 X/Twitter 桥接配置
function readBridgeConfig() {
  try {
    if (fs.existsSync(BRIDGE_CONFIG)) {
      return JSON.parse(fs.readFileSync(BRIDGE_CONFIG, 'utf8'));
    }
  } catch (e) { console.error('readBridgeConfig error:', e.message); }
  return { interval: 600 };
}

// 保存 X/Twitter 桥接配置
function saveBridgeConfig(config) {
  try {
    fs.mkdirSync(path.dirname(BRIDGE_CONFIG), { recursive: true });
    fs.writeFileSync(BRIDGE_CONFIG, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) { console.error('saveBridgeConfig error:', e.message); return false; }
}

function readPushRoutes() {
  try {
    if (fs.existsSync(ROUTES_FILE)) return JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8'));
  } catch (e) { console.error('readPushRoutes error:', e.message); }
  return { defaultBot: 'primary', rules: [] };
}

function savePushRoutes(config) {
  try {
    const rules = Array.isArray(config?.rules) ? config.rules
      .filter(r => r && r.pattern && ['primary', 'secondary'].includes(r.bot))
      .map(r => ({ pattern: String(r.pattern).trim().toLowerCase(), bot: r.bot })) : [];
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(ROUTES_FILE, JSON.stringify({ defaultBot: config?.defaultBot === 'secondary' ? 'secondary' : 'primary', rules }, null, 2), 'utf8');
    return true;
  } catch (e) { console.error('savePushRoutes error:', e.message); return false; }
}

function parseEnv(content) {
  const result = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return result;
}

function updateEnvValues(values) {
  const original = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : defaultEnv();
  const lines = original.split(/\r?\n/);
  const seen = new Set();
  const output = lines.map(line => {
    const match = line.match(/^(\s*)([A-Z0-9_]+)(\s*=\s*).*$/);
    if (!match || !(match[2] in values)) return line;
    if (values[match[2]] === null) return null;
    if (values[match[2]] === '') return line;
    seen.add(match[2]);
    return `${match[1]}${match[2]}=${values[match[2]]}`;
  }).filter(Boolean);
  for (const [key, value] of Object.entries(values)) {
    if (value && !seen.has(key)) output.push(`${key}=${value}`);
  }
  fs.writeFileSync(ENV_FILE, output.join('\n'), 'utf8');
}

// ----- 全局状态 -----
let mainWindow = null;
let tray = null;
let botProcess = null;
let botState = 'idle'; // idle | starting | running | stopping | error
let bridgeProcess = null;
let logLines = [];    // 内存中的日志缓冲（UI 重连时回放）
const MAX_LOG = 2000;

// ----- 单实例锁：防止多开导致 bot.session 冲突 -----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// =========================================================
// Bot 子进程管理
// =========================================================

function appendLog(line) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const entry = `[${ts}] ${line}`;
  logLines.push(entry);
  if (logLines.length > MAX_LOG) logLines.shift();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bot:log', entry);
  }
}

// =========================================================
// X/Twitter RSS Bridge 管理
// =========================================================

function isBridgeRunning() {
  return bridgeProcess !== null && bridgeProcess.exitCode === null;
}

async function startBridge() {
  if (isBridgeRunning()) {
    appendLog('[BRIDGE] X/Twitter RSS 桥已在运行');
    return true;
  }
  appendLog(`[BRIDGE] 启动 X/Twitter RSS 桥 (端口 ${BRIDGE_PORT})...`);

  // 先杀残留进程
  try {
    require('child_process').execSync('pkill -9 -f "twitter_rss_bridge" 2>/dev/null || true');
  } catch {}

  if (!fs.existsSync(VENV_PYTHON)) {
    appendLog(`[BRIDGE] 找不到 Python: ${VENV_PYTHON}`);
    return false;
  }
  if (!fs.existsSync(BRIDGE_SCRIPT)) {
    appendLog(`[BRIDGE] 找不到桥接脚本: ${BRIDGE_SCRIPT}`);
    return false;
  }

  try {
    const bridgeCfg = readBridgeConfig();
    const configuredUsers = Array.isArray(bridgeCfg.users)
      ? bridgeCfg.users.filter(Boolean).length
      : 1;
    const expectedUsers = Math.max(1, configuredUsers);
    const envVars = { ...process.env, PYTHONUNBUFFERED: '1', RSSTT_APP_VERSION: APP_VERSION };
    envVars.XBRIDGE_INTERVAL = String(bridgeCfg.interval || 600);
    
    bridgeProcess = spawn(VENV_PYTHON, ['-u', BRIDGE_SCRIPT], {
      cwd: RSSTT_ROOT,
      env: envVars,
    });
  } catch (e) {
    appendLog(`[BRIDGE] 启动失败: ${e.message}`);
    bridgeProcess = null;
    return false;
  }

  bridgeProcess.stdout.on('data', (data) => {
    data.toString().split(/\r?\n/).forEach((l) => l.trim() && appendLog(`[BRIDGE] ${l}`));
  });
  bridgeProcess.stderr.on('data', (data) => {
    data.toString().split(/\r?\n/).forEach((l) => l.trim() && appendLog(`[BRIDGE:err] ${l}`));
  });
  bridgeProcess.on('error', (err) => {
    appendLog(`[BRIDGE] 进程错误: ${err.message}`);
    bridgeProcess = null;
  });
  bridgeProcess.on('exit', (code, signal) => {
    if (bridgeProcess && bridgeProcess.exitCode !== null) {
      appendLog(`[BRIDGE] 进程退出 (code=${code}, signal=${signal})`);
      bridgeProcess = null;
    }
  });

  // 等待桥接服务就绪（检查端口 + 至少缓存了几个用户）
  const maxWait = 60; // 最多等 60 秒
  for (let i = 0; i < maxWait; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const http = require('http');
      const body = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${BRIDGE_PORT}/health`, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(3000, () => { req.destroy(); reject('timeout'); });
      });
      const info = JSON.parse(body);
      if (info.users_cached >= expectedUsers) {
        appendLog(`[BRIDGE] ✓ X/Twitter RSS 桥已就绪 (${info.users_cached} 个用户已缓存)`);
        return true;
      }
      if (i % 10 === 0) appendLog(`[BRIDGE] 等待缓存... (${info.users_cached}/${expectedUsers} 用户)`);
    } catch {
      if (i % 5 === 0) appendLog(`[BRIDGE] 等待服务就绪... (${i + 1}s)`);
    }
  }

  appendLog('[BRIDGE] ⚠ 桥接服务未能完全就绪，继续启动 Bot...');
  return true; // 不阻塞 Bot 启动
}

function stopBridge() {
  if (!bridgeProcess) return;
  appendLog('[BRIDGE] 停止 X/Twitter RSS 桥...');
  try {
    bridgeProcess.kill('SIGTERM');
  } catch (e) {
    appendLog(`[BRIDGE] 停止失败: ${e.message}`);
  }
  // 兜底
  setTimeout(() => {
    if (bridgeProcess && bridgeProcess.exitCode === null) {
      try { bridgeProcess.kill('SIGKILL'); } catch {}
    }
  }, 5000);
}

function setState(state) {
  botState = state;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bot:state', state);
  }
  updateTray();
}

function isConfigured() {
  try {
    if (!fs.existsSync(ENV_FILE)) return false;
    const txt = fs.readFileSync(ENV_FILE, 'utf8');
    const hasToken = /(^|\n)\s*TOKEN\s*=\s*([^\s#]+)/.exec(txt);
    const hasManager = /(^|\n)\s*MANAGER\s*=\s*([^\s#]+)/.exec(txt);
    const token = hasToken ? hasToken[2].trim() : '';
    const mgr = hasManager ? hasManager[2].trim() : '';
    return token && !token.startsWith('__FILL') && /^\d+$/.test(mgr);
  } catch {
    return false;
  }
}

async function startBot() {
  // 先启动 X/Twitter RSS 桥接服务
  await startBridge();

  // 再杀任何残留的 Bot 进程
  if (botProcess) {
    appendLog('[INFO] 发现已有 Bot 进程，先清理...');
    try { botProcess.kill('SIGKILL'); } catch {}
    botProcess = null;
  }
  // 也查杀外部 Bot 进程（命令行的）
  try {
    require('child_process').execSync('pkill -9 -f "telegramRSSbot" 2>/dev/null || true');
  } catch {}
  // 清理 session 锁
  try {
    const journal = path.join(CONFIG_DIR, 'bot.session-journal');
    if (fs.existsSync(journal)) fs.unlinkSync(journal);
  } catch {}
  setState('idle');
  // 等 500ms 确保资源释放
  await new Promise(r => setTimeout(r, 500));
  if (!fs.existsSync(VENV_PYTHON)) {
    appendLog(`[ERROR] 找不到 Python 虚拟环境：${VENV_PYTHON}`);
    appendLog('[ERROR] 请先运行环境引导脚本（见 README），或重新安装依赖。');
    setState('error');
    return;
  }
  if (!fs.existsSync(ENTRY)) {
    appendLog(`[ERROR] 找不到 RSStT 入口：${ENTRY}`);
    setState('error');
    return;
  }
  if (!isConfigured()) {
    appendLog('[ERROR] 配置未完成：请在「编辑配置」中填入真实的 TOKEN 和 MANAGER。');
    setState('error');
    return;
  }

  setState('starting');
  appendLog(`[INFO] 启动 Bot 子进程...`);
  appendLog(`[INFO] Python: ${VENV_PYTHON}`);
  appendLog(`[INFO] 入口:   ${ENTRY}`);
  appendLog(`[INFO] 配置:   ${CONFIG_DIR}`);

  // 清理可能锁定的旧 session journal 文件
  try {
    const journalFile = path.join(CONFIG_DIR, 'bot.session-journal');
    if (fs.existsSync(journalFile)) fs.unlinkSync(journalFile);
  } catch {}

  try {
    botProcess = spawn(VENV_PYTHON, ['-u', ENTRY, '-c', CONFIG_DIR], {
      cwd: RSSTT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', RSSTT_APP_VERSION: APP_VERSION },
    });
  } catch (e) {
    appendLog(`[ERROR] 启动失败：${e.message}`);
    setState('error');
    botProcess = null;
    return;
  }

  botProcess.stdout.on('data', (data) => {
    data.toString().split(/\r?\n/).forEach((l) => l.trim() && appendLog(l));
  });
  botProcess.stderr.on('data', (data) => {
    data.toString().split(/\r?\n/).forEach((l) => l.trim() && appendLog(`[stderr] ${l}`));
  });

  botProcess.on('error', (err) => {
    appendLog(`[ERROR] 进程错误：${err.message}`);
    botProcess = null;
    setState('error');
  });

  botProcess.on('exit', (code, signal) => {
    appendLog(`[INFO] Bot 进程退出 (code=${code}, signal=${signal})`);
    botProcess = null;
    if (code !== 0 && code !== null) {
      setState('error');
      appendLog('[HINT] 常见原因: API_ID/API_HASH 被限流，请在 .env 中添加自己的 API_ID 和 API_HASH');
      appendLog('[HINT] 获取地址: https://core.telegram.org/api/obtaining_api_id');
    } else {
      setState('idle');
    }
  });

  // 给一点缓冲，进程没立刻挂掉就算 running
  setTimeout(() => {
    if (botProcess && botProcess.exitCode === null) {
      setState('running');
    }
  }, 3000);
}

function stopBot() {
  // 停止 X/Twitter RSS 桥
  stopBridge();

  if (!botProcess) {
    appendLog('[WARN] Bot 未在运行。');
    setState('idle');
    return;
  }
  setState('stopping');
  appendLog('[INFO] 发送 SIGTERM，等待 Bot 优雅退出...');
  try {
    botProcess.kill('SIGTERM');
  } catch (e) {
    appendLog(`[ERROR] 停止失败：${e.message}`);
  }
  // 兜底：15 秒后强杀
  const pid = botProcess.pid;
  setTimeout(() => {
    if (botProcess && botProcess.pid === pid) {
      appendLog('[WARN] 优雅退出超时，发送 SIGKILL 强制结束。');
      try { botProcess.kill('SIGKILL'); } catch {}
    }
  }, 15000);
}

// =========================================================
// 窗口与托盘
// =========================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 880,
    height: 620,
    minWidth: 640,
    minHeight: 480,
    title: '360News',
    show: false,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // 回放历史日志 & 当前状态
    logLines.forEach((l) => mainWindow.webContents.send('bot:log', l));
    mainWindow.webContents.send('bot:state', botState);
    mainWindow.webContents.send('app:configured', isConfigured());
  });

  // 关闭窗口 → 最小化到托盘而非退出（让 Bot 后台继续跑）
  mainWindow.on('close', (e) => {
    if (botProcess && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (process.platform === 'darwin') app.dock.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  const iconPath = path.join(__dirname, 'build', 'trayTemplate.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  icon.setTemplateImage(true); // 适配深浅色菜单栏
  tray = new Tray(icon);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const running = botState === 'running';
  const ctx = Menu.buildFromTemplate([
    { label: `状态：${stateLabel(botState)}`, enabled: false },
    { type: 'separator' },
    { label: '启动 Bot', enabled: !running && botState !== 'starting', click: () => startBot() },
    { label: '停止 Bot', enabled: running, click: () => stopBot() },
    { type: 'separator' },
    { label: '显示主窗口', click: () => {
      if (mainWindow) { mainWindow.show(); if (process.platform === 'darwin') app.dock.show(); mainWindow.focus(); }
    }},
    { label: '退出', click: () => quitApp() },
  ]);
  tray.setContextMenu(ctx);
  tray.setToolTip(`360News — ${stateLabel(botState)}`);
}

function stateLabel(s) {
  return ({
    idle: '已停止',
    starting: '启动中...',
    running: '运行中',
    stopping: '停止中...',
    error: '错误',
  })[s] || s;
}

function quitApp() {
  app.isQuitting = true;
  stopBridge(); // 停止 X/Twitter RSS 桥
  if (botProcess) {
    appendLog('[INFO] 应用退出，停止 Bot...');
    botProcess.kill('SIGTERM');
  }
  tray && tray.destroy();
  app.quit();
}

// =========================================================
// IPC：渲染进程 ↔ 主进程
// =========================================================
ipcMain.handle('bot:start', () => { startBot(); });
ipcMain.handle('bot:stop', () => { stopBot(); });
ipcMain.handle('bot:getState', () => botState);
ipcMain.handle('app:getStatus', () => ({
  version: APP_VERSION,
  state: botState,
  configured: isConfigured(),
  rssttRoot: RSSTT_ROOT,
  configDir: CONFIG_DIR,
  envFile: ENV_FILE,
  venvPython: VENV_PYTHON,
  venvReady: fs.existsSync(VENV_PYTHON),
}));
ipcMain.handle('config:read', () => {
  try { return fs.readFileSync(ENV_FILE, 'utf8'); }
  catch { return ''; }
});
ipcMain.handle('config:save', (_e, content) => {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(ENV_FILE, content, 'utf8');
    const ok = isConfigured();
    if (mainWindow) mainWindow.webContents.send('app:configured', ok);
    return { ok: true, configured: ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('config:structuredRead', () => {
  const env = parseEnv(fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '');
  const mask = (value) => value ? `${value.slice(0, 4)}••••${value.slice(-4)}` : '';
  const routes = readPushRoutes();
  if (!routes.rules.length && env.ROUTED_BOT_FEEDS) {
    routes.rules = env.ROUTED_BOT_FEEDS.split(/[\s,;，；]+/).filter(Boolean).map(pattern => ({ pattern: pattern.toLowerCase(), bot: 'secondary' }));
  }
  return {
    ok: true,
    primary: { token: mask(env.TOKEN), manager: env.MANAGER || '', apiId: env.API_ID || '', apiHash: mask(env.API_HASH), proxy: env.TELEGRAM_PROXY || '' },
    secondary: { token: mask(env.ROUTED_BOT_TOKEN), manager: env.ROUTED_MANAGER || '' },
    bridge: readBridgeConfig(),
    routes,
  };
});
ipcMain.handle('config:structuredSave', (_e, payload = {}) => {
  try {
    const values = {};
    const put = (key, value) => { if (String(value || '').trim() && !String(value).includes('••••')) values[key] = String(value).trim(); };
    put('TOKEN', payload.primary?.token); put('MANAGER', payload.primary?.manager);
    put('API_ID', payload.primary?.apiId); put('API_HASH', payload.primary?.apiHash); put('TELEGRAM_PROXY', payload.primary?.proxy);
    put('ROUTED_BOT_TOKEN', payload.secondary?.token); put('ROUTED_MANAGER', payload.secondary?.manager);
    // Source routing is now authoritative; remove the legacy username list
    // after the first structured save.
    values.ROUTED_BOT_FEEDS = null;
    updateEnvValues(values);
    saveBridgeConfig({ ...readBridgeConfig(), ...(payload.bridge || {}) });
    savePushRoutes(payload.routes || {});
    const configured = isConfigured();
    if (mainWindow) mainWindow.webContents.send('app:configured', configured);
    return { ok: true, configured, restartRequired: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('routes:read', () => ({ ok: true, data: readPushRoutes() }));
ipcMain.handle('routes:save', (_e, config) => ({ ok: savePushRoutes(config) }));
ipcMain.handle('bridge:readConfig', () => {
  return readBridgeConfig();
});
ipcMain.handle('bridge:saveConfig', (_e, cfg) => {
  const ok = saveBridgeConfig(cfg);
  // 如果桥接正在运行，下一个刷新周期即生效
  if (ok && isBridgeRunning()) {
    appendLog('[BRIDGE] 配置已保存，将在下一刷新周期生效');
  }
  return { ok };
});

// ── X/Twitter Cookie 管理 ──
const SESSION_FILE = path.join(CONFIG_DIR, 'x_session.json');

ipcMain.handle('bridge:sessionStatus', async () => {
  try {
    const http = require('http');
    const body = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${BRIDGE_PORT}/session`, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject('timeout'); });
    });
    return JSON.parse(body);
  } catch (e) {
    return { has_session: false, has_auth: false, is_expired: true,
             expires_in_human: '桥接未运行', error: e.message };
  }
});

ipcMain.handle('bridge:importCookies', async (_e, jsonStr) => {
  try {
    const rawText = String(jsonStr || '').trim();
    let cookies;
    try {
      const parsed = JSON.parse(rawText);
      cookies = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cookies) ? parsed.cookies : null);
    } catch { /* try browser text formats below */ }
    // Netscape seven-column export, including #HttpOnly_ lines.
    if (!cookies && rawText.includes('\t')) {
      cookies = rawText.split(/\r?\n/).filter(line => line && !(/^#/.test(line) && !line.startsWith('#HttpOnly_'))).map(line => {
        const httpOnly = line.startsWith('#HttpOnly_');
        const fields = line.replace(/^#HttpOnly_/, '').split('\t');
        if (fields.length < 7) return null;
        const [domain, , pathName, secure, expires, name, ...value] = fields;
        return { domain, path: pathName || '/', secure: secure.toUpperCase() === 'TRUE', expires: Number(expires) || -1, name, value: value.join('\t'), httpOnly };
      }).filter(Boolean);
    }
    // Cookie header copied from DevTools: name=value; name2=value2
    if (!cookies && rawText.includes('=')) {
      cookies = rawText.split(';').map(part => {
        const i = part.indexOf('=');
        return i > 0 ? { name: part.slice(0, i).trim(), value: part.slice(i + 1).trim(), domain: '.x.com', path: '/', secure: true } : null;
      }).filter(Boolean);
    }
    if (!cookies?.length) return { ok: false, error: '无法识别 Cookie。支持 JSON、Playwright、Netscape 导出和 name=value; 格式' };

    // 转换为 Playwright storage_state 格式
    const sameSiteMap = { 'unspecified': 'None', 'no_restriction': 'None',
                          'lax': 'Lax', 'strict': 'Strict' };
    const converted = cookies.map(c => ({
      name: c.name || '',
      value: c.value || '',
      domain: c.domain || '.x.com',
      path: c.path || '/',
      expires: c.expires !== undefined ? c.expires : (c.expirationDate || -1),
      httpOnly: c.httpOnly || false,
      secure: c.secure !== undefined ? c.secure : true,
      sameSite: sameSiteMap[c.sameSite] || c.sameSite || 'None',
    }));

    // 过滤掉不需要的 cookie
    const filtered = converted.filter(c => !['g_state', '__cf_bm'].includes(c.name));

    const sessionData = { cookies: filtered, origins: [] };
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2), 'utf8');
    appendLog(`[BRIDGE] Cookie 已导入 (${filtered.length} 个)，正在重启桥接...`);

    // 重启桥接
    stopBridge();
    await new Promise(r => setTimeout(r, 2000));
    await startBridge();

    return { ok: true, cookieCount: filtered.length };
  } catch (e) {
    appendLog(`[BRIDGE] Cookie 导入失败: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('bridge:restart', async () => {
  try {
    appendLog('[BRIDGE] 手动重启桥接...');
    stopBridge();
    await new Promise(r => setTimeout(r, 2000));
    await startBridge();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('config:openInEditor', async () => {
  try {
    // 先确保文件存在
    if (!fs.existsSync(ENV_FILE)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(ENV_FILE, defaultEnv(), 'utf8');
    }
    await shell.openPath(ENV_FILE);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('log:clear', () => { logLines = []; return true; });
ipcMain.handle('log:getAll', () => logLines);
ipcMain.handle('app:openExternal', (_e, url) => {
  // 仅允许 http/https
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  return true;
});

// =========================================================
// ZCode: 订阅管理 IPC（基于 Python 脚本 DB 桥）
// =========================================================

ipcMain.handle('subs:list', async () => {
  return await dbQuery('list');
});

ipcMain.handle('subs:toggle', async (_e, subId) => {
  return await dbQuery('toggle', String(subId));
});

ipcMain.handle('subs:delete', async (_e, subId) => {
  return await dbQuery('delete', String(subId));
});

ipcMain.handle('subs:add', async (_e, { url, title, category, managerId }) => {
  return await dbQuery('add', url, title || '', category || '', String(managerId || ''));
});

ipcMain.handle('subs:reimport', async () => {
  return await dbQuery('reimport');
});

ipcMain.handle('subs:getManagerId', async () => {
  const res = await dbQuery('get_manager');
  return res.ok ? res.manager_id : null;
});

// =========================================================
// ZCode: 推送历史 IPC
// =========================================================
ipcMain.handle('history:list', async () => {
  return await dbQuery('history_list');
});
ipcMain.handle('history:count', async () => {
  return await dbQuery('history_count');
});
ipcMain.handle('history:delete', async (_e, id) => {
  return await dbQuery('history_delete', String(id));
});
ipcMain.handle('history:clear', async () => {
  return await dbQuery('history_clear');
});

// =========================================================
// ZCode: 用户管理 IPC
// =========================================================
ipcMain.handle('users:list', async () => {
  return await dbQuery('users_list');
});
ipcMain.handle('users:add', async (_e, userId) => {
  return await dbQuery('user_add', String(userId));
});
ipcMain.handle('users:remove', async (_e, userId) => {
  return await dbQuery('user_remove', String(userId));
});

function defaultEnv() {
  return [
	    '# 360News 配置',
    '# TOKEN: 从 @BotFather 获取的 Bot Token',
    'TOKEN=__FILL_ME_BOT_TOKEN__',
    '',
    '# MANAGER: 你的 Telegram 数字 user id（从 @userinfobot 获取），多个用分号分隔',
    'MANAGER=__FILL_ME_YOUR_USER_ID__',
    '',
    '# API_ID / API_HASH（推荐填写，避免使用公共 sample API 被限流）',
    '# 获取: https://core.telegram.org/api/obtaining_api_id',
    '# API_ID=1025907',
    '# API_HASH=452b0359b988148995f22ff0f4229750',
    '',
    '# 可选：Telegraph token（用于长文转码），不需要可保持注释',
    '# TELEGRAPH_TOKEN=',
    '',
    '# 更多选项见 https://github.com/Rongronggg9/RSS-to-Telegram-Bot/blob/master/docs/advanced-settings.md',
    ''
  ].join('\n');
}

// =========================================================
// App 生命周期
// =========================================================
app.whenReady().then(() => {
  // 确保 config 目录和占位 .env 存在
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    if (!fs.existsSync(ENV_FILE)) {
      fs.writeFileSync(ENV_FILE, defaultEnv(), 'utf8');
    }
  } catch (e) {
    console.error('初始化 config 失败：', e);
  }

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else { mainWindow.show(); if (process.platform === 'darwin') app.dock.show(); }
  });
});

app.on('window-all-closed', () => {
  // macOS：窗口全关时保留 Bot 后台运行（托盘），不退出 app
  if (process.platform !== 'darwin' && !botProcess) {
    quitApp();
  }
});

// 应用真正退出前确保 Bot 停止
app.on('before-quit', (e) => {
  if (botProcess && !app.isQuitting) {
    e.preventDefault();
    quitApp();
  }
});

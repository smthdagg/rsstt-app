// renderer/app.js — 前端逻辑（含 Bot 控制 + 订阅管理）
'use strict';

const $ = (id) => document.getElementById(id);

// ---- DOM 引用 ----
const els = {
  statusPill: $('statusPill'), statusText: $('statusText'),
  btnStart: $('btnStart'), btnStop: $('btnStop'),
  btnEdit: $('btnEdit'), btnEditor: $('btnEditor'), btnClear: $('btnClear'),
  envWarn: $('envWarn'),
  configPanel: $('configPanel'), envPath: $('envPath'),
  configArea: $('configArea'), btnSaveConfig: $('btnSaveConfig'), btnCloseConfig: $('btnCloseConfig'),
  primaryToken: $('primaryToken'), primaryManager: $('primaryManager'), primaryApiId: $('primaryApiId'), primaryApiHash: $('primaryApiHash'), primaryProxy: $('primaryProxy'),
  secondaryToken: $('secondaryToken'), secondaryManager: $('secondaryManager'), defaultRoute: $('defaultRoute'), routeConfigList: $('routeConfigList'),
  btnSaveStructured: $('btnSaveStructured'),
  logBox: $('logBox'), autoscroll: $('autoscroll'),
  envInfo: $('envInfo'),
  // Subs
  tabBar: document.querySelectorAll('.tab'),
  tabControl: $('tab-control'), tabSubs: $('tab-subs'), tabHistory: $('tab-history'),
  subCount: $('subCount'), subsContainer: $('subsContainer'),
  btnAddSub: $('btnAddSub'), btnRefreshSubs: $('btnRefreshSubs'),
  addSubPanel: $('addSubPanel'),
  newUrl: $('newUrl'), newTitle: $('newTitle'), newCategory: $('newCategory'),
  btnAddSubConfirm: $('btnAddSubConfirm'), btnAddSubCancel: $('btnAddSubCancel'),
  subSearch: $('subSearch'), btnReimport: $('btnReimport'),
  // History
  historyCount: $('historyCount'), historyContainer: $('historyContainer'),
  btnRefreshHistory: $('btnRefreshHistory'), btnClearHistory: $('btnClearHistory'),
  // Bridge
  bridgeInterval: $('bridgeInterval'),
  bridgeIntervalDisplay: $('bridgeIntervalDisplay'),
  btnSaveBridgeConfig: $('btnSaveBridgeConfig'),
  // Cookie 管理
  cookieStatus: $('cookieStatus'),
  cookieInput: $('cookieInput'),
  btnImportCookies: $('btnImportCookies'),
  btnRestartBridge: $('btnRestartBridge'),
  btnRefreshCookieStatus: $('btnRefreshCookieStatus'),
};

const STATE_LABEL = {
  idle: '已停止', starting: '启动中…', running: '运行中', stopping: '停止中…', error: '错误',
};

// ---- 日志 ----
function appendLogLine(line) {
  const div = document.createElement('div');
  div.className = 'log-line ' + classify(line);
  div.textContent = line;
  els.logBox.appendChild(div);
  while (els.logBox.children.length > 2000) els.logBox.removeChild(els.logBox.firstChild);
  if (els.autoscroll.checked) els.logBox.scrollTop = els.logBox.scrollHeight;
}
function classify(line) {
  const l = line.toLowerCase();
  if (l.includes('[stderr]')) return 'stderr';
  if (/\berror\b|\[error\]|critical/.test(l)) return 'error';
  if (/\bwarn/.test(l)) return 'warn';
  if (/\bdebug\b/.test(l)) return 'debug';
  if (/\binfo\b/.test(l)) return 'info';
  return '';
}

// ---- Bot 状态 ----
function applyState(state) {
  els.statusPill.dataset.state = state;
  els.statusText.textContent = STATE_LABEL[state] || state;
  const running = state === 'running';
  const busy = state === 'starting' || state === 'stopping';
  els.btnStart.disabled = running || busy;
  els.btnStop.disabled = !running;
}

// ---- 配置面板 ----
function openConfig() {
  els.configPanel.setAttribute('open', '');
  // 加载 .env 内容
  window.botAPI.readConfig().then(v => els.configArea.value = v);
  // 加载桥接配置
  window.botAPI.bridgeReadConfig().then(cfg => {
    const val = Math.max(60, cfg.interval || 600);
    els.bridgeInterval.value = val;
    els.bridgeIntervalDisplay.textContent = val;
  });
  window.botAPI.structuredConfigRead().then(res => {
    if (!res.ok) return;
    const p = res.primary || {}, s = res.secondary || {};
    els.primaryToken.value = p.token || ''; els.primaryManager.value = p.manager || '';
    els.primaryApiId.value = p.apiId || ''; els.primaryApiHash.value = p.apiHash || ''; els.primaryProxy.value = p.proxy || '';
    els.secondaryToken.value = s.token || ''; els.secondaryManager.value = s.manager || '';
    routeConfig = res.routes || routeConfig;
    els.defaultRoute.value = routeConfig.defaultBot || 'primary';
    renderRouteConfigList();
  });
  // 加载 Cookie 状态
  loadCookieStatus();
  // 加载用户列表
  loadUsers();
  window.botAPI.subsList().then(res => {
    if (res.ok) { allSubs = res.data || []; renderRouteConfigList(); }
  });
}
function closeConfig() { els.configPanel.removeAttribute('open'); }
// 点击背景关闭
els.configPanel.addEventListener('click', (e) => { if (e.target === els.configPanel) closeConfig(); });

// 配置面板标签切换
document.querySelectorAll('.config-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.config-tab').forEach(x => x.classList.remove('config-tab-active'));
    document.querySelectorAll('.config-tab-content').forEach(x => x.classList.remove('config-tab-content-active'));
    t.classList.add('config-tab-active');
    const tab = t.dataset.configTab;
    document.getElementById(`config-tab-${tab}`).classList.add('config-tab-content-active');
    if (tab === 'users') loadUsers();
    if (tab === 'cookie') loadCookieStatus();
    if (tab === 'routing') renderRouteConfigList();
    if (tab === 'advanced') setTimeout(() => els.configArea.focus(), 100);
  });
});

async function saveConfig() {
  const res = await window.botAPI.saveConfig(els.configArea.value);
  flash(els.btnSaveConfig, res.ok ? '已保存 ✓' : '保存失败 ✗', !res.ok);
  refreshConfigured();
}

async function saveStructuredConfig() {
  const res = await window.botAPI.structuredConfigSave({
    primary: { token: els.primaryToken.value, manager: els.primaryManager.value, apiId: els.primaryApiId.value, apiHash: els.primaryApiHash.value, proxy: els.primaryProxy.value },
    secondary: { token: els.secondaryToken.value, manager: els.secondaryManager.value },
    bridge: { interval: Math.max(60, parseInt(els.bridgeInterval.value) || 600) },
    routes: { defaultBot: els.defaultRoute.value, rules: routeConfig.rules || [] },
  });
  flash(els.btnSaveConfig, res.ok ? '已保存 ✓' : '保存失败 ✗', !res.ok);
  if (res.ok) refreshConfigured();
}

function flash(btn, text, isError) {
  const orig = btn.textContent;
  btn.textContent = text;
  btn.style.background = isError ? 'var(--red)' : 'var(--green)';
  setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1200);
}

async function refreshConfigured() {
  const st = await window.botAPI.getStatus();
  els.envWarn.hidden = st.configured;
  updateEnvInfo(st);
}

function updateEnvInfo(st) {
  const py = st.venvReady ? '✓ 已就绪' : '✗ 未安装';
  const cfg = st.configured ? '✓ 已配置' : '✗ 待填写凭证';
  els.envInfo.textContent = `360News v${st.version || 'dev'}  ·  Python venv: ${py}  ·  配置: ${cfg}`;
}

// ---- 标签导航 ----
function switchTab(tabId) {
  els.tabBar.forEach(t => t.classList.toggle('tab-active', t.dataset.tab === tabId));
  [els.tabControl, els.tabSubs, els.tabHistory].forEach(el => {
    if (el) el.classList.toggle('tab-content-active', el.id === `tab-${tabId}`);
  });
  if (tabId === 'subs') loadSubs();
  if (tabId === 'history') loadHistory();
}
els.tabBar.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

// ---- 订阅管理 ----
let allSubs = [];
let routeConfig = { defaultBot: 'primary', rules: [] };

function routePattern(link) {
  const m = String(link || '').match(/\/twitter\/user\/([A-Za-z0-9_]{1,15})/i);
  return m ? m[1].toLowerCase() : String(link || '').toLowerCase();
}
function routeFor(link) {
  const pattern = routePattern(link);
  return (routeConfig.rules || []).find(r => r.pattern === pattern)?.bot || routeConfig.defaultBot || 'primary';
}

function renderRouteConfigList() {
  if (!els.routeConfigList) return;
  if (!allSubs.length) {
    els.routeConfigList.innerHTML = '<div class="hint">暂无订阅来源，请先在“订阅管理”添加。</div>';
    return;
  }
  const unique = new Map(allSubs.map(s => [s.link, s]));
  els.routeConfigList.innerHTML = [...unique.values()].map(s => `
    <div class="route-config-row">
      <span title="${esc(s.link)}">${esc(s.sub_title || s.feed_title || shortUrl(s.link))}</span>
      <select data-route-pattern="${esc(routePattern(s.link))}">
        <option value="primary" ${routeFor(s.link) === 'primary' ? 'selected' : ''}>BOT 1</option>
        <option value="secondary" ${routeFor(s.link) === 'secondary' ? 'selected' : ''}>BOT 2</option>
      </select>
    </div>`).join('');
  els.routeConfigList.querySelectorAll('select').forEach(select => select.addEventListener('change', async () => {
    const pattern = select.dataset.routePattern;
    routeConfig.rules = (routeConfig.rules || []).filter(r => r.pattern !== pattern);
    if (select.value !== routeConfig.defaultBot) routeConfig.rules.push({ pattern, bot: select.value });
    await window.botAPI.routesSave(routeConfig);
    renderSubs(allSubs);
  }));
}

async function loadSubs() {
  const savedScroll = els.subsContainer.scrollTop;
  els.subsContainer.innerHTML = '<div class="subs-loading">加载中…</div>';
  const res = await window.botAPI.subsList();
  if (!res.ok) {
    els.subsContainer.innerHTML = `<div class="subs-loading" style="color:var(--red)">${esc(res.error)}</div>`;
    return;
  }
  allSubs = res.data;
  const routes = await window.botAPI.routesRead();
  if (routes.ok) routeConfig = routes.data || routeConfig;
  renderRouteConfigList();
  els.subCount.hidden = false;
  els.subCount.textContent = allSubs.length;
  renderSubs(allSubs);
  requestAnimationFrame(() => { els.subsContainer.scrollTop = savedScroll; });
}

function renderSubs(subs) {
  const groups = {};
  for (const s of subs) {
    const cat = s.category || '未分类';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(s);
  }
  const query = els.subSearch.value.toLowerCase();
  const c = els.subsContainer;
  c.innerHTML = '';

  const sortedCats = Object.keys(groups).sort();
  for (const cat of sortedCats) {
    const items = groups[cat];
    const filtered = query ? items.filter(s =>
      (s.sub_title || s.feed_title || '').toLowerCase().includes(query) ||
      s.link.toLowerCase().includes(query)
    ) : items;
    if (filtered.length === 0) continue;

    const activeCount = items.filter(s => s.state === 1).length;
    const group = document.createElement('div');
    group.className = 'sub-group';

    const header = document.createElement('div');
    header.className = 'sub-group-header';
    header.innerHTML = `<span class="arrow">▼</span> ${esc(cat)} <span class="count">${activeCount}/${items.length} 活跃</span>`;
    header.addEventListener('click', () => header.classList.toggle('collapsed'));
    group.appendChild(header);

    const list = document.createElement('div');
    list.className = 'sub-items';
    for (const s of filtered.slice(0, 100)) {
      const item = document.createElement('div');
      item.className = 'sub-item';
      const isActive = s.state === 1;
      const displayTitle = s.sub_title || s.feed_title || '(无标题)';
      const isBridge = s.link && s.link.includes('127.0.0.1');
      const isPlaywright = isBridge && (s.link.includes('/scrape') || s.link.includes('/twitter/user/'));
      const typeBadge = isBridge
        ? '<span class="type-badge type-badge-x" title="Playwright 爬虫">🕷️ PW</span>'
        : '<span class="type-badge type-badge-rss" title="标准 RSS 订阅">📡 RSS</span>';
      item.innerHTML = `
        <span class="sub-item-title" title="${esc(displayTitle)}">${typeBadge} ${esc(displayTitle)}</span>
        <span class="sub-item-url" title="${esc(s.link)}">${esc(shortUrl(s.link))}</span>
        <select class="route-select" data-action="route" data-pattern="${esc(routePattern(s.link))}" title="推送到哪个 Bot">
          <option value="primary" ${routeFor(s.link) === 'primary' ? 'selected' : ''}>BOT 1</option>
          <option value="secondary" ${routeFor(s.link) === 'secondary' ? 'selected' : ''}>BOT 2</option>
        </select>
        <span class="sub-item-actions">
          <button class="btn-sm ${isActive ? 'on' : 'off'}" data-action="toggle" data-id="${s.id}">
            ${isActive ? '● 开启' : '○ 关闭'}
          </button>
          <button class="btn-sm danger" data-action="delete" data-id="${s.id}">✕</button>
        </span>
      `;
      item.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.id);
          if (btn.dataset.action === 'toggle') {
            const r = await window.botAPI.subsToggle(id);
            if (r.ok) loadSubs();
          } else if (btn.dataset.action === 'delete') {
            if (confirm('确定删除此订阅？')) {
              const r = await window.botAPI.subsDelete(id);
              if (r.ok) loadSubs();
            }
          }
        });
      });
      const routeSelect = item.querySelector('[data-action="route"]');
      routeSelect.addEventListener('change', async () => {
        const pattern = routeSelect.dataset.pattern;
        routeConfig.rules = (routeConfig.rules || []).filter(r => r.pattern !== pattern);
        if (routeSelect.value !== routeConfig.defaultBot) routeConfig.rules.push({ pattern, bot: routeSelect.value });
        const saved = await window.botAPI.routesSave(routeConfig);
        flash(routeSelect, saved.ok ? '✓' : '✗', !saved.ok);
      });
      list.appendChild(item);
    }
    group.appendChild(list);
    c.appendChild(group);
  }
  if (c.children.length === 0) {
    c.innerHTML = '<div class="subs-loading">无匹配结果</div>';
  }
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 28 ? u.pathname.slice(0, 26) + '…' : u.pathname);
  } catch { return url; }
}
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

els.subSearch.addEventListener('input', () => renderSubs(allSubs));
els.btnRefreshSubs.addEventListener('click', loadSubs);
els.btnReimport.addEventListener('click', async () => {
  if (!confirm('从 OPML 重新导入将清空所有现有订阅，确认？')) return;
  els.subsContainer.innerHTML = '<div class="subs-loading">正在重新导入…</div>';
  const res = await window.botAPI.subsReimport();
  if (res.ok) {
    loadSubs();
  } else {
    els.subsContainer.innerHTML = `<div class="subs-loading" style="color:var(--red)">导入失败: ${esc(res.error || res.output)}</div>`;
  }
});

// 添加订阅
els.btnAddSub.addEventListener('click', () => {
  els.addSubPanel.hidden = false;
  // 填充已有分类到下拉列表
  const catSet = new Set(allSubs.map(s => s.category).filter(Boolean));
  const datalist = $('catList');
  datalist.innerHTML = '';
  [...catSet].sort().forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    datalist.appendChild(opt);
  });
  els.newUrl.focus();
});
els.btnAddSubCancel.addEventListener('click', () => { els.addSubPanel.hidden = true; });
els.btnAddSubConfirm.addEventListener('click', async () => {
  const url = els.newUrl.value.trim();
  if (!url) { flash(els.btnAddSubConfirm, 'URL 必填', true); return; }
  const managerId = await window.botAPI.subsGetManagerId();
  if (!managerId) { flash(els.btnAddSubConfirm, 'MANAGER 未配置', true); return; }
  
  // 获取类型（RSS / Playwright）
  const typeRadio = document.querySelector('input[name="subType"]:checked');
  const subType = typeRadio ? typeRadio.value : 'rss';
  
  // Playwright 类型的走桥接
  let finalUrl = url;
  if (subType === 'playwright') {
    finalUrl = 'http://127.0.0.1:1200/scrape?url=' + encodeURIComponent(url);
  }
  
  const data = { url: finalUrl, title: els.newTitle.value.trim() || undefined, category: els.newCategory.value.trim() || undefined, managerId };
  const res = await window.botAPI.subsAdd(data);
  if (res.ok) {
    els.addSubPanel.hidden = true;
    els.newUrl.value = ''; els.newTitle.value = ''; els.newCategory.value = '';
    loadSubs();
  } else {
    flash(els.btnAddSubConfirm, res.error, true);
  }
});

// ---- 事件绑定（Bot 控制）----
els.btnStart.addEventListener('click', () => window.botAPI.start());
els.btnStop.addEventListener('click', () => window.botAPI.stop());
els.btnEdit.addEventListener('click', openConfig);
els.btnEditor.addEventListener('click', () => window.botAPI.openConfigInEditor());
els.btnCloseConfig.addEventListener('click', closeConfig);
els.btnSaveStructured.addEventListener('click', saveStructuredConfig);

// ---- X/Twitter 桥接配置 ----
els.bridgeInterval.addEventListener('input', () => {
  const v = parseInt(els.bridgeInterval.value) || 600;
  els.bridgeIntervalDisplay.textContent = Math.max(60, v);
});
els.btnSaveBridgeConfig.addEventListener('click', async () => {
  let val = parseInt(els.bridgeInterval.value) || 600;
  val = Math.max(60, val);
  const res = await window.botAPI.bridgeSaveConfig({ interval: val });
  flash(els.btnSaveBridgeConfig, res.ok ? '已保存 ✓' : '保存失败 ✗', !res.ok);
  if (res.ok) els.bridgeInterval.value = val;
});

// ---- X/Twitter Cookie 管理 ----
async function loadCookieStatus() {
  els.cookieStatus.textContent = '加载中...';
  els.cookieStatus.className = 'cookie-status loading';
  const status = await window.botAPI.bridgeSessionStatus();
  renderCookieStatus(status);
}

function renderCookieStatus(s) {
  const el = els.cookieStatus;
  if (!s || (!s.has_session && !s.has_auth)) {
    el.className = 'cookie-status expired';
    el.innerHTML = '<span class="cookie-dot"></span> ❌ 未导入 Cookie — 请粘贴 Cookie JSON 后点导入';
    return;
  }
  if (s.is_expired) {
    el.className = 'cookie-status expired';
    el.innerHTML = `<span class="cookie-dot"></span> ❌ Cookie 已失效！${s.expires_in_human || ''} — 请更新 Cookie`;
    return;
  }
  if (s.expires_in_seconds !== null && s.expires_in_seconds !== undefined && s.expires_in_seconds < 259200) {
    // <3 天
    el.className = 'cookie-status warn';
    el.innerHTML = `<span class="cookie-dot"></span> ⚠️ Cookie 即将过期 — ${s.expires_in_human}（${s.cookie_count || 0} 个 Cookie）`;
    return;
  }
  el.className = 'cookie-status ok';
  el.innerHTML = `<span class="cookie-dot"></span> ✅ Cookie 有效 — ${s.expires_in_human || '未知'}（${s.cookie_count || 0} 个 Cookie）`;
}

els.btnImportCookies.addEventListener('click', async () => {
  const jsonStr = els.cookieInput.value.trim();
  if (!jsonStr) {
    flash(els.btnImportCookies, '请粘贴 Cookie ✗', true);
    return;
  }
  els.btnImportCookies.disabled = true;
  els.btnImportCookies.textContent = '导入中...';
  const res = await window.botAPI.bridgeImportCookies(jsonStr);
  els.btnImportCookies.disabled = false;
  els.btnImportCookies.textContent = '📥 导入 Cookie';
  if (res.ok) {
    flash(els.btnImportCookies, `已导入 ${res.cookieCount} 个 Cookie ✓`, false);
    els.cookieInput.value = '';
    // 等待桥接重启后刷新状态
    setTimeout(() => loadCookieStatus(), 3000);
  } else {
    flash(els.btnImportCookies, `导入失败: ${res.error} ✗`, true);
  }
});

els.btnRestartBridge.addEventListener('click', async () => {
  els.btnRestartBridge.disabled = true;
  els.btnRestartBridge.textContent = '重启中...';
  const res = await window.botAPI.bridgeRestart();
  els.btnRestartBridge.disabled = false;
  els.btnRestartBridge.textContent = '🔄 重启桥接';
  flash(els.btnRestartBridge, res.ok ? '已重启 ✓' : '重启失败 ✗', !res.ok);
  if (res.ok) setTimeout(() => loadCookieStatus(), 3000);
});

els.btnRefreshCookieStatus.addEventListener('click', () => loadCookieStatus());

els.btnClear.addEventListener('click', async () => {
  await window.botAPI.clearLog();
  els.logBox.innerHTML = '';
});
els.btnSaveConfig.addEventListener('click', saveConfig);
els.btnCloseConfig.addEventListener('click', closeConfig);

// ---- 初始化 ----
(async () => {
  const st = await window.botAPI.getStatus();
  applyState(st.state);
  els.envWarn.hidden = st.configured;
  updateEnvInfo(st);
  const allLog = await window.botAPI.getAllLog();
  allLog.forEach(appendLogLine);
  if (!st.configured) {
    appendLogLine('[INFO] 欢迎使用 360News！首次使用：点击「编辑配置」填入 TOKEN 和 MANAGER。');
  }
  if (!st.venvReady) {
    appendLogLine('[WARN] 未检测到 Python 虚拟环境。');
  }
})();

window.botAPI.onLog(line => appendLogLine(line));
window.botAPI.onState(state => applyState(state));
window.botAPI.onConfigured(ok => { els.envWarn.hidden = ok; refreshConfigured(); });

// ========== 推送历史 ==========

async function loadHistory() {
  els.historyContainer.innerHTML = '<div class="subs-loading">加载中…</div>';
  const res = await window.botAPI.historyList();
  if (!res.ok) {
    els.historyContainer.innerHTML = `<div class="subs-loading" style="color:var(--red)">${esc(res.error)}</div>`;
    return;
  }
  const data = res.data || [];
  els.historyCount.hidden = false;
  els.historyCount.textContent = data.length;

  if (data.length === 0) {
    els.historyContainer.innerHTML = '<div class="subs-loading">暂无推送记录</div>';
    return;
  }

  const c = els.historyContainer;
  c.innerHTML = '';

  // 按日期分组
  const groups = {};
  for (const entry of data) {
    const date = (entry.push_time || '').split('T')[0] || '未知';
    if (!groups[date]) groups[date] = [];
    groups[date].push(entry);
  }

  for (const date of Object.keys(groups).sort().reverse()) {
    const items = groups[date];
    const group = document.createElement('div');
    group.className = 'sub-group';

    const header = document.createElement('div');
    header.className = 'sub-group-header';
    header.innerHTML = `<span class="arrow">▼</span> ${esc(date)} <span class="count">${items.length} 条</span>`;
    header.addEventListener('click', () => header.classList.toggle('collapsed'));
    group.appendChild(header);

    const list = document.createElement('div');
    list.className = 'sub-items';

    for (const entry of items.slice(0, 100)) {
      const item = document.createElement('div');
      item.className = 'sub-item';
      const title = entry.post_title || entry.feed_title || '(无标题)';
      const time = entry.push_time ? entry.push_time.split('T')[1].split('.')[0].slice(0, 5) : '';
      const origTime = entry.post_time ? entry.post_time.split('T')[1].split('.')[0].slice(0, 5) : '';
      item.innerHTML = `
        <span class="sub-item-title" title="${esc(title)}">${esc(title.slice(0, 60))}</span>
        <span style="color:var(--text-dim);font-size:11px">
          ${origTime ? `🕐${origTime}` : ''} → 🚀${time}
        </span>
        <span class="sub-item-url" title="${esc(entry.post_url || '')}">${esc(entry.feed_title || '').slice(0, 20)}</span>
        <span class="sub-item-actions">
          <button class="btn-sm danger" data-action="history-del" data-id="${entry.id}">✕</button>
        </span>
      `;
      item.querySelector('[data-action="history-del"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        const r = await window.botAPI.historyDelete(parseInt(e.target.dataset.id));
        if (r.ok) loadHistory();
      });
      list.appendChild(item);
    }
    group.appendChild(list);
    c.appendChild(group);
  }
}

els.btnRefreshHistory.addEventListener('click', loadHistory);
els.btnClearHistory.addEventListener('click', async () => {
  if (!confirm('确定清空全部推送历史？')) return;
  const r = await window.botAPI.historyClear();
  if (r.ok) loadHistory();
});

// ========== 用户管理 ==========

async function loadUsers() {
  const c = document.getElementById('usersList');
  c.innerHTML = '<div class="subs-loading">加载中…</div>';
  const res = await window.botAPI.usersList();
  if (!res.ok) { c.innerHTML = `<div style="color:var(--red)">${esc(res.error)}</div>`; return; }
  const users = res.data || [];
  if (users.length === 0) { c.innerHTML = '<div class="subs-loading">暂无用户</div>'; return; }
  let html = '';
  for (const u of users) {
    const status = u.state === 1 ? '🟢 活跃' : '🔴 禁用';
    const name = u.lang || 'zh';
    html += `<div class="sub-item">
      <span class="sub-item-title">用户 ${u.id}</span>
      <span style="font-size:11px;color:var(--text-dim)">${status} · 语言: ${name}</span>
      <span class="sub-item-actions">
        <button class="btn-sm danger" data-userid="${u.id}" data-action="user-remove">✕ 移除</button>
      </span>
    </div>`;
  }
  c.innerHTML = html;
  c.querySelectorAll('[data-action="user-remove"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = parseInt(btn.dataset.userid);
      if (!confirm(`确定移除用户 ${uid}？其订阅也将一并删除。`)) return;
      const r = await window.botAPI.usersRemove(uid);
      if (r.ok) loadUsers();
      else flash(btn, r.error, true);
    });
  });
}

document.getElementById('btnAddUser').addEventListener('click', async () => {
  const input = document.getElementById('newUserId');
  const uid = parseInt(input.value.trim());
  if (!uid || isNaN(uid)) { flash(document.getElementById('btnAddUser'), '请输入有效的数字 user id', true); return; }
  const r = await window.botAPI.usersAdd(uid);
  if (r.ok) { input.value = ''; loadUsers(); }
  else flash(document.getElementById('btnAddUser'), r.error, true);
});
document.getElementById('btnRefreshUsers').addEventListener('click', loadUsers);
document.getElementById('newUserId').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btnAddUser').click();
});

// ---- 外部链接 ----
const extLinks = {
  linkBotFather: 'https://t.me/BotFather',
  linkUserInfo: 'https://t.me/userinfobot',
  linkGithub: 'https://github.com/Rongronggg9/RSS-to-Telegram-Bot',
  linkMyTelegram: 'https://my.telegram.org/apps',
  linkXLogin: 'https://x.com',
};
Object.entries(extLinks).forEach(([id, url]) => {
  const el = $(id);
  if (el) el.addEventListener('click', (e) => { e.preventDefault(); window.open(url, '_blank'); });
});

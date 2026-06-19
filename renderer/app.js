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
  // 加载用户列表
  loadUsers();
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
    if (tab === 'env') setTimeout(() => els.configArea.focus(), 100);
  });
});

async function saveConfig() {
  const res = await window.botAPI.saveConfig(els.configArea.value);
  flash(els.btnSaveConfig, res.ok ? '已保存 ✓' : '保存失败 ✗', !res.ok);
  refreshConfigured();
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
  els.envInfo.textContent = `Python venv: ${py}  ·  配置: ${cfg}`;
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

async function loadSubs() {
  const savedScroll = els.subsContainer.scrollTop;
  els.subsContainer.innerHTML = '<div class="subs-loading">加载中…</div>';
  const res = await window.botAPI.subsList();
  if (!res.ok) {
    els.subsContainer.innerHTML = `<div class="subs-loading" style="color:var(--red)">${esc(res.error)}</div>`;
    return;
  }
  allSubs = res.data;
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
};
Object.entries(extLinks).forEach(([id, url]) => {
  const el = $(id);
  if (el) el.addEventListener('click', (e) => { e.preventDefault(); window.open(url, '_blank'); });
});

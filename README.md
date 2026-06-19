# 360News

**RSS 资讯聚合推送工具** — 将 RSS 订阅自动推送到 Telegram。

基于 [RSStT (Rongronggg9/RSS-to-Telegram-Bot)](https://github.com/Rongronggg9/RSS-to-Telegram-Bot) 深度修改，遵循 [AGPL-3.0](https://github.com/Rongronggg9/RSS-to-Telegram-Bot/blob/dev/LICENSE) 许可协议。

---

## ✨ 功能特色

- **📡 标准 RSS 订阅** — 支持任意 RSS/Atom 订阅源
- **🕷️ Playwright 爬虫** — 对无 RSS 的网站（如 X/Twitter），用 Headless Chromium 抓取内容并转成 RSS
- **🌐 多源聚合** — 同时订阅数十个信息源，分类管理
- **🤖 Telegram Bot** — 通过 Telegram Bot 实时推送新内容
- **🌍 自动翻译** — 非中文内容自动翻译为中文（Google Translate）
- **🕐 24h 过滤** — 只推送 24 小时内的新内容
- **⏰ 北京时间时区** — 全部时间戳使用 UTC+8
- **🔗 MTProto 混淆** — 通过 ConnectionTcpObfuscated 绕过 DPI 封锁连接 Telegram
- **💻 macOS 原生应用** — 基于 Electron 的桌面管理面板
- **📊 订阅管理** — 可视化订阅列表，支持启用/停用/删除
- **📜 推送历史** — 查看最近推送记录

## 📦 安装

### 下载预编译版本

从 [Releases](https://github.com/smthdagg/360News/releases) 下载最新 `360News-*-arm64.dmg`，打开并拖入 Applications 文件夹。

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/smthdagg/360News.git
cd 360News

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建 DMG
npm run dist
```

## 🚀 快速开始

1. **获取 Telegram Bot Token**
   - 在 Telegram 中搜索 [@BotFather](https://t.me/botfather)
   - 发送 `/newbot` 创建新 Bot
   - 保存获取到的 `TOKEN`

2. **获取你的 Telegram User ID**
   - 搜索 [@userinfobot](https://t.me/userinfobot)
   - 发送 `/start`，记下 `Id` 数字

3. **获取 Telegram API 凭证**
   - 访问 [my.telegram.org](https://my.telegram.org/apps)
   - 创建应用，获取 `API_ID` 和 `API_HASH`

4. **配置并启动**
   - 打开 360News 应用
   - 点击「编辑配置」，填入 `TOKEN`, `MANAGER`, `API_ID`, `API_HASH`
   - 点击「保存 .env」，然后「启动 Bot」

5. **添加订阅**
   - 切换到「订阅管理」标签
   - 点击「添加订阅」
   - 选择类型：**📡 RSS**（标准订阅）或 **🕷️ Playwright**（爬虫抓取）
   - 填入 URL 和分类，点击添加

## 📋 订阅类型

### 标准 RSS 订阅

支持任意 RSS/Atom 格式的订阅源：

| 来源 | 示例 URL |
|------|---------|
| RSSHub | `https://rsshub.app/...` |
| 博客 | `https://example.com/feed.xml` |
| 新闻 | `https://example.com/rss` |

### Playwright 爬虫订阅

对不提供 RSS 的网站，使用 Playwright 无头浏览器抓取内容。系统自动转换为桥接 URL，无需手动配置。

| 场景 | 填写 URL |
|------|---------|
| X/Twitter 用户 | `https://x.com/用户名` |
| 任意动态页面 | `https://example.com` |

## ⚙️ 配置说明

### 核心配置（.env）

| 变量 | 必填 | 说明 |
|------|------|------|
| `TOKEN` | ✅ | Telegram Bot Token（从 @BotFather 获取） |
| `MANAGER` | ✅ | 管理员的 Telegram User ID |
| `API_ID` | ✅ | Telegram API ID |
| `API_HASH` | ✅ | Telegram API Hash |
| `SOCKS_PROXY` | ❌ | SOCKS5 代理地址（可选） |
| `MULTIUSER` | ❌ | 多用户模式（默认 `1`） |

### 桥接配置

通过应用面板「编辑配置 → X/Twitter 桥接设置」调节：

| 参数 | 默认 | 最小 | 说明 |
|------|------|------|------|
| 刷新间隔 | 600s | 60s | Playwright 爬虫的缓存刷新周期 |

## 🧩 技术架构

```
360News (Electron macOS App)
├── main.js              — 主进程
├── preload.js           — 渲染进程桥接
├── renderer/            — 前端界面
│   ├── index.html
│   ├── app.js
│   └── style.css
└── RSStT/ (Python 后端，编译时嵌入)
    ├── telegramRSSbot.py
    ├── src/
    │   ├── twitter_rss_bridge.py  — Playwright 网页爬虫桥接
    │   └── helpers/
    │       ├── translate.py       — 翻译模块
    │       └── push_history.py    — 推送历史
    └── config/
```

## 🔄 数据流

```
RSS 源 / 网页 → Playwright 桥接 → 内存 RSS 缓存 → RSStT Bot → Telegram → 你的手机
```

## 🙏 致谢

- 核心 Bot 引擎：[Rongronggg9/RSS-to-Telegram-Bot](https://github.com/Rongronggg9/RSS-to-Telegram-Bot)
- Playwright: [Microsoft/playwright-python](https://github.com/microsoft/playwright-python)
- Telegram 客户端: [LonamiWebs/Telethon](https://github.com/LonamiWebs/Telethon)
- Electron: [electron/electron](https://github.com/electron/electron)

## 📄 许可

[AGPL-3.0](LICENSE) — 基于 [RSStT](https://github.com/Rongronggg9/RSS-to-Telegram-Bot) 修改。

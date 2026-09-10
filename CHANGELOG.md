# 360News 变更记录

## 1.1.0 — 2026-09-10

- 修复单个 X 用户配置时桥接服务被误判为未就绪。
- X 截图改为 Retina 2 倍像素，并保留完整嵌套推文。
- X 推送增加作者、发文时间、截图推送时间、时间差和原文链接。
- Telegram 截图 URL 增加版本标记，避免复用旧图片缓存。

后续版本遵循 `主版本.次版本.修订版本`：功能变更递增次版本，兼容性/重大变更递增主版本，普通修复递增修订版本。
## 1.1.1 - 2026-09-10

- Automatically subscribe authorized groups to Bot2-routed feeds.
- Fix X monitoring interval to use the configured five-minute schedule.
- Preserve complete X screenshots and delivery metadata.

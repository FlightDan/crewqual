# CrewQual i18n 改造目标

版本：1.0  
适用仓库：`/root/crewqual`  
目标语言：`zh-CN`（简体中文）、`en-US`（English）

## Goal

在不改变认证、权限、路由、API、数据库字段、业务日期计算和通知模板语义的前提下，为 CrewQual 全部正式用户界面提供中英文双语支持，并支持浏览器自动识别和用户手动切换。

正式页面包括：setup、deployment、admin、member，以及仍由产品支持的 pilot 兼容入口。`src/app/dev/**`、测试 fixture、数据库种子、审计原文和纯后端运维日志不属于本目标。

允许保留原文的范围：metadata 的中文 fallback（由 `localizedTitle` 按请求语言选择）、API/服务端错误和审计业务原文、开发预览页面、以及演示 Mock/持久化业务数据（人员姓名、组织名称、证照名称和示例文件名）。这些内容不是用户界面的固定翻译文案。

## 语言解析规则

语言优先级必须固定为：

1. 合法的 `crewqual_locale` Cookie；
2. 请求 `Accept-Language` 中的浏览器语言；
3. `zh-CN`。

`zh-*` 统一解析为 `zh-CN`，`en-*` 统一解析为 `en-US`，其他语言回退到 `zh-CN`。Cookie 保存一年，作用域为 `/`，使用 `SameSite=Lax`；生产 HTTPS 下设置 `Secure`。

组织的 `Organization.defaultLocale` 继续作为通知、模板和业务内容的默认语言，不覆盖用户 UI 的 Cookie 或浏览器语言。初始化向导的语言选择仍保存为组织默认语言。

## 执行清单

- [x] 建立统一 locale 类型、解析器、消息加载器和日期/数字格式化接口。
- [x] 根布局输出正确的 `<html lang>` 和本地化 metadata。
- [x] 管理端、成员端和 pilot 兼容入口提供语言切换并持久化。
- [x] 将 setup、deployment、admin、member、pilot 的标题、导航、按钮、表单、placeholder、校验、Toast、Dialog、空状态、加载状态、错误状态和 ARIA 文案迁移到消息键。
- [x] API 错误优先通过稳定错误码在 UI 层本地化，未知错误使用当前语言的通用兜底。
- [x] 日期、日期时间、数字、复数和排序使用当前 locale；业务日期值仍保持原有 ISO 语义。
- [x] 保留组织名称、人员姓名、资质自定义名称等业务数据原值；不得机器翻译持久化数据。
- [x] 为语言解析、消息完整性、切换持久化、关键页面和错误状态补充自动化测试。
- [x] 维护 `docs/i18n-execution-report.md`，记录迁移范围、测试命令、结果和例外。

## Definition of Done

只有全部条件满足时才能将本目标标记为 complete：

1. 中英文消息键集合完全一致；运行时没有缺失键或静默 fallback 警告。
2. 全部正式页面和关键错误路径均能完整显示两种语言；英文模式不出现来源于 UI 硬编码的中文（业务数据和显式 allowlist 除外）。
3. 无 Cookie 时，中文浏览器显示中文，英文浏览器显示英文；非法 Cookie 和不支持语言安全回退。
4. 切换语言后刷新、跨路由和重新打开浏览器仍保持选择，路径、查询参数和会话不变。
5. `<html lang>`、metadata、日期时间、数字、排序和无障碍名称与当前语言一致。
6. 不新增 locale URL 前缀，不改变业务 API 契约、权限行为、数据库结构或通知投递语义。
7. `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和相关 Playwright 测试通过；未运行项必须明确记录。
8. 不得以只接入 Provider、只迁移少量页面、隐藏语言切换、删除文案或放宽断言来宣称完成。

## Codex 执行要求

每次执行前先读取本文件和 `docs/i18n-execution-report.md`；实现后更新报告。发现硬编码文案时，优先迁移到消息键并补回归测试，不得直接修改测试断言绕过缺失翻译。所有失败、跳过和环境阻塞必须如实记录。

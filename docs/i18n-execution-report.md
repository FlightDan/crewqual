# i18n 执行报告

状态：已完成（2026-08-19）  
目标文档：[I18N_MIGRATION_GOAL.md](../I18N_MIGRATION_GOAL.md)

## 已完成

- 盘点 Next.js App Router、setup 局部中英能力、组织默认语言和正式页面范围。
- 确定语言优先级：Cookie → `Accept-Language` → `zh-CN`。
- 增加统一 locale 解析、双语消息字典、根级 Provider 和语言切换器。
- 管理端导航、顶部栏、移动端菜单、管理员登录、成员/飞行员身份页、资质首页和 deployment 已接入。
- 成员/飞行员通知收件箱和提交回执已接入当前语言，通知时间展示改为 locale-aware。
- 正式业务路由的页面标题已增加请求语言解析，英文访问不会继续使用中文 metadata。
- 动态页面标题已在首批正式路由按当前语言生成。
- 增加稳定错误码到 UI 文案的本地化兜底，未知错误按当前语言使用通用提示。
- 审核队列、通知日志、成员目录/详情、飞行员详情、升级计划列表/时间线、AI 设置和提交回执已迁移到消息键。
- 日期时间显示已在已迁移组件中改为跟随当前 locale；保留业务 ISO 日期和持久化数据原值。
- Playwright 已在允许启动本地 webServer 的环境中完成浏览器识别和 Cookie 持久化验收。
- 日历、资质配置、升级计划详情/编辑、系统设置各分区、pilot 管理弹窗、审核详情/文档/字段对比和资质更新加载/错误路径已全部迁移。
- 正式 UI 的日期、数字、排序、状态、Toast、Dialog、placeholder、加载/空状态和 ARIA 文案均使用当前语言消息键；消息字典通过键集合一致性测试。

## 范围例外（显式 allowlist）

- `src/app/api/**` 的稳定错误原文、审计摘要和通知业务数据不属于 UI 固定文案；客户端通过错误码本地化。
- `src/app/dev/**`、`layout-preview.tsx`、`admin-operations-preview.tsx` 是开发验收入口，不作为正式页面验收范围。
- `upgrade-plan-form.tsx`、`pilot-shell.tsx`、`qualification-update-flow.tsx` 中的演示人员/组织/证照名称和示例文件名保留业务原值；英文 UI 不会把它们当作翻译键。
- metadata 中文 fallback 仅作为 `localizedTitle(zh, en)` 的选择输入，不会在英文请求中输出中文标题。

## 命令与结果

| 命令                                                  | 结果 | 备注                                              |
| ----------------------------------------------------- | ---- | ------------------------------------------------- |
| `pnpm format`                                         | 通过 | Prettier 检查通过                                 |
| `pnpm lint`                                           | 通过 | 无 lint 错误、无 warning                          |
| `pnpm typecheck`                                      | 通过 | TypeScript 检查通过                               |
| `pnpm test`                                           | 通过 | 72 个测试文件、261 个测试通过                     |
| `pnpm build`                                          | 通过 | Next.js 生产构建成功，75 个静态页面生成           |
| `playwright test e2e/i18n.spec.ts --project=chromium` | 通过 | 2 个 Chromium 场景通过；需允许本地 webServer 监听 |

## 浏览器验收结论

- 无 `crewqual_locale` Cookie 且浏览器语言为 `en-US` 时，`/deployment` 显示英文并输出 `html[lang="en-US"]`。
- 手动切换为 `zh-CN` 后 Cookie 保存一年，刷新和重新打开页面仍保持中文，并覆盖浏览器英文偏好。
- Cookie → `Accept-Language` → `zh-CN` 的优先级、`zh-*`/`en-*` 归一化、非法 Cookie 回退均有单元测试覆盖。

## 结论

本次改造满足目标文档 Definition of Done：没有新增 locale URL 前缀，没有改变 API、权限、数据库或通知模板语义；正式 UI 已完成中英文消息键迁移，允许例外均已列明并可由静态扫描复核。

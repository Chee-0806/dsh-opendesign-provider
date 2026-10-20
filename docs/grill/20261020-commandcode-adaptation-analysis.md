# Command Code 插件 → OpenDesign provider 改造面分析

- 分析对象：`/Users/xuqi/Codes/dsh-opendesign-provider`（git remote 已改名，内容仍是 `@mars-sea/dsh-commandcode-provider` **v0.14.4** 的完整克隆，HEAD `cacd3f0`）
- 代码规模实测：`src/*.ts` **40 个** / 14 426 行；`src/client/*` **31 个** / 10 365 行；合计 **71 文件 / 24 791 行**（任务描述里的「约 43 个」是 top-level 与 client 混算，实际 40 + 31，见 `ls src/*.ts | wc -l`）。
- 工程状态：**无 `node_modules`**（`ls -d node_modules` → 不存在），`lib/` 是已构建产物（`lib/index.js` 437 563 B、`lib/client.js` 440 460 B、`lib/index.d.ts` 122 794 B，banner 里写死 `@mars-sea/dsh-commandcode-provider`）。
- 因此：**所有命令耗时都未实跑**，文中标注「估计」；所有代码结论都给 `文件:行`。

---

## 1. 架构总图

### 1.1 一次加载发生什么

```
cordis.patch.yml:11-15            bundle 层插入一行 id=llm-commandcode / name=@mars-sea/… / config.apiKeyEnv
  → package.json:20-38            dsh.bundle.patch 指向该文件；dsh.client.inject 声明 boot 前置；exports["./client"]
  → lib/index.js (tsdown 产物)     apply(ctx, config)
       index.ts:462                export function apply(ctx, config)
       index.ts:463                installCostProjection(ctx)               ← 会话成本投影（持久化）
       index.ts:633-636            ctx.llm.registerConfigurableProviders([…]) + ctx.llm.registerAdapter([PROVIDER], adapter)
       index.ts:666/700/713        三个事件监听：agent/request-error、session/event、agent/status（重试预算）
       index.ts:775-777            ctx.inject(['commands'])      → /commandcode 命令
       index.ts:848                applyUsageRemote(...)         → typert 网关的 8 个 Remote 端点
       index.ts:879-910            ctx.inject(['web'])           → web_search 后端 + 选择开关
       index.ts:916-934            ctx.inject(['tuiSettingsSections']) → 终端设置页
       index.ts:945-969            ctx.inject(['settings'])      → settings.describe/mutate 桥
       index.ts:983-991            loader/volatile-update        → 热更后重算 web 选择 / TUI 页
  → lib/client.js (浏览器)          window.__ModuleLoader__.load({ id: "@mars-sea/…" })（tsdown.config.ts:64）
       client/index.ts:108-133     apply(ctx)：注入 CSS、注册两个 locale 命名空间、等 remote.credentials
       client/index.ts:416-423     settings.section  id='commandcode'
       client/index.ts:439-454     settings.models.provider-card  key='llm-commandcode'
       client/index.ts:532-535     main  key='commandcode-panel'
       client/index.ts:547-555     sidebar.footer.action  id='commandcode-panel'
       client/index.ts:580-585     conversation.composer.dock  id='commandcode-session-cost'
```

### 1.2 provider 路由与 adapter 注册

| 事实 | 证据 |
| --- | --- |
| 插件名 `llm-commandcode`、注入 `llm` | `src/index.ts:171-172` |
| 唯一 provider 路由 `commandcode` | `src/index.ts:178`（`export const PROVIDER = 'commandcode'`） |
| 注册成"可配置 provider"（Models 页出现卡片） | `src/index.ts:633-635`：`{ provider: PROVIDER, displayName: 'Command Code', settingsNs: NS, settingsPath: [] }` |
| adapter 绑定到该路由 | `src/index.ts:636`：`ctx.llm.registerAdapter([PROVIDER], adapter)` |
| adapter 类 | `src/adapter.ts:2325`：`class CommandCodeAdapter extends LlmAdapter` |
| 选择器里的 provider 组标题 | `src/adapter.ts:2440-2442`：`providerInfo()` 返回 `{ id: provider, name: 'Command Code' }` |
| 设置在 Host 侧的命名空间 | `src/index.ts:174`：`const NS = 'llm-commandcode'` |
| 设置页命名空间（客户端） | `src/client/settings.ts:13`：`COMMANDCODE_NS = 'llm-commandcode'` |

### 1.3 模型目录：从哪个端点来、如何进选择器

| 环节 | 证据 |
| --- | --- |
| 目录抓取端点 | `src/adapter.ts:2326-2334`：`GET ${apiBase}/provider/v1/models`，`Accept: application/json`，`MODELS_TIMEOUT_MS = 10_000`（`adapter.ts:106`） |
| 响应形状校验 | `src/gateway-facts.ts:71-76`：要求 `{ object: 'list', data: [...] }`，否则抛 `PROVIDER_PROTOCOL_ERROR` |
| 每条模型字段 | `src/gateway-facts.ts:57-69`：`id` / `name` / `context_length` / `max_output_tokens` / `supported_endpoints`（磁盘缓存用驼峰同名键，`gateway-facts.ts:60-68`） |
| TTL / 重试 TTL / 缓存版本 | `src/gateway-facts.ts:11-13`：5 min / 10 s / version 3 |
| 磁盘缓存路径 | `src/index.ts:180`：`~/.commandcode/models-cache.json`；写入带 `apiBase` 与 0600 权限（`gateway-facts.ts:87-94`） |
| 目录如何进选择器 | `src/adapter.ts:2513-2565` `listModels()`：`gatewayFacts.refresh()` → `toInfo()` → `name` 追加 `" (CC)"`（`adapter.ts:2524`）、`description` 由 `capabilityDescription()` 生成（`capabilities.ts:1374`）、按 `compareByPlan` 排序（`capabilities.ts:1026`） |
| 单模型解析 | `src/adapter.ts:2595-2652` `resolveModel()`：上下文窗口、`defaultMaxTokens`、reasoning efforts（`KNOWN_EFFORTS`，`capabilities.ts:25`）、`toolUpdate: 'addition-only'`（`adapter.ts:2626`） |
| 计划过滤 | `src/adapter.ts:2547-2559`：`filterModelsByPlan` + `loadPoolBillingAccess()`（读 `/alpha/billing/*`，`adapter.ts:2804-2836`）＋ `visibleModels`/`modelVisibility`（`model-visibility.ts:2`） |
| 设置页用的"全量、不过滤"目录 | `src/index.ts:806-826` `catalogForEditors()` → `adapter.listModels(PROVIDER, { unfiltered: true })`，再加 `KNOWN_PLANS` tier 与 `modelAllowanceFor()` 月额度 |

### 1.4 价格表结构

- 类型（Host 与浏览器共用）：`src/usage-wire.ts:359-403`
  - `CommandCodeModelRates { inputCost, outputCost, cacheReadCost, cacheWriteCost? }`（USD / 1M tokens，`usage-wire.ts:359-373`）
  - `CommandCodeContextTier extends rates { maxContext? }`（`usage-wire.ts:376-378`）
  - `CommandCodeModelPrice extends rates { id, slug, peak?, contextTiers?, free? }`（`usage-wire.ts:381-403`）
  - `CommandCodePriceTable { models: CommandCodeModelPrice[], peakHours: [number,number][] }`（`usage-wire.ts:406-420`，`peakHours` 为 UTC、周一至周五、右开区间）
- 数据源：**手工/脚本生成的 vendored 表** `src/model-prices.ts:149-243`（93 行 `MODEL_PRICE_ROWS`），来源是 `https://commandcode.ai/docs/resources/pricing-limits` 的 Next.js flight payload（`model-prices.ts:6-15`），由 `scripts/sync-model-prices.mjs` 重写（`model-prices.ts:44-50`）。
- 组装：`modelPriceTable(now)`（`model-prices.ts:348-376`）：先用 `KNOWN_PLANS` 的 catalog id 做 join（`priceSlugCandidates`/`PRICE_SLUG_OVERRIDES`，`model-prices.ts:251-289`），再补未被认领的 slug 行；`:free`/`isFreeModel` 直接零价（`model-prices.ts:355-357`）。
- 套餐月额度（美元/月，**不是** per-token）：`ModelAllowance { go?, goat, pro }`（`model-prices.ts:81-85`），仅供设置页展示（`model-prices.ts:397-401`）。
- 峰谷价：`peak` 三元组 + `PEAK_HOUR_RANGES`（`capabilities.ts:1277`）/`isPeakPricingHour()`（`capabilities.ts:1292`）。
- 消费方两条：
  - Host 侧持久化投影 `installCostProjection(ctx)`（`index.ts:463` → `src/cost-projection.ts`，`cost-facts.ts` 定义 `CostTokens`/`pricingKey`/`requestCost`）
  - 浏览器 Remote `commandcode/prices`（`usage-wire.ts:423`，Host 实现在 `usage-remote.ts:148-150`），客户端 `src/client/prices.ts` 缓存后供 `session-cost.ts` 与 `session-cost-display.ts` 使用。

### 1.5 设置页 read / mutate 契约

| 层 | 证据 |
| --- | --- |
| Host 端读：拿到该 ns 的 descriptor | `src/index.ts:951-953`：`settings.describe().find(item => item.ns === NS)` → `{ value, revision, base? }` |
| Host 端写：整批 + 版本检查 | `src/index.ts:955`：`settings.mutate(NS, ops, revision)` |
| 关闭自动表单（页面自己画） | `src/index.ts:959`：`settings.configure({ auto: false }, ctx.fiber)` |
| 字段集合 | `src/index.ts:346-400`（`apiKeyEnv`/`apiKey`(secret)/`apiBase`/`workingDir`/`modelsCachePath`/`requestTimeoutMs`/`streamIdleTimeoutMs`/`offloadSeenImagesForCache`/`transportMaxRetries`/`filterModelsByPlan`/`visibleModels`/`modelVisibility`/`contextWindow`/`contextWindowOverrides`/`maxOutputTokens`/`webSearch`/`showSidebarQuota`/`accounts`/`activeAccount`/`credentialCleanupRefs`/`accountEnrollmentTasks`/`modelAccountRules`/`zdr`/`lang`） |
| 易变字段机制 | `src/config-volatile.ts`（`.volatile()` 标记 + `unwrapVolatileConfig()` 每读解引用）；除 `apiKey` 外全部标记（`index.ts:346-400`，`markVolatileFields(..., ['apiKey'])`） |
| 客户端 wire | `src/client/settings-scope.ts:36-75`：`describe(): { namespaces[], writable }`、`mutate(ns, ops, revision?) → 该 ns 的新行`；op 形状 `{ op:'set'|'unset', path: string[], value? }`（`settings-scope.ts:30-35`） |
| 客户端写入生命周期 | `src/client/settings-write.ts:77` `class SettingsWriter`：排队、冻结输入、基线与版本、凭据另行确认（`settings-write.ts:101-120`、`200-215`）；`visibleModels` 与 `modelVisibility` 必须同批写（`settings-write.ts:108-109`） |
| 页面可编辑字段（拒绝 Host 不认的形状） | `src/client/settings.ts:418-442`：`apiBase`、两个 seconds 字段、`transportMaxRetries`(0..50 镜像字面量)、`contextWindow`、`maxOutputTokens`、`offloadSeenImagesForCache`、`filterModelsByPlan`、`webSearch`、`showSidebarQuota`、`zdr` |

### 1.6 TUI 设置

- 声明式 section：`src/tui-settings.ts:233-475` `buildCommandCodeTuiSection(deps)`，title 默认 `'Command Code'`（`tui-settings.ts:292`）、`apiBase` 占位符 `https://api.commandcode.ai`（`tui-settings.ts:318`）、字段含 `apiKey`（引用式，`apiKeyRef()` 每次注册读活值，`index.ts:921`）、`apiBase`、`zdr`、`filterModelsByPlan`、每模型复选框（`modelVisibility`，`tui-settings.ts:265-290`）、`activeAccount`（`ACTIVE_ACCOUNT_AUTO`，`tui-settings.ts:124`）、`lang`（`tui-settings.ts:403-409`）。
- 注册：`ctx.inject(['tuiSettingsSections'])`（`src/index.ts:916-934`），命名空间复用 `NS`；`refreshTuiSettings` 在易变配置更新时重注册（`index.ts:986`）。

### 1.7 bundle patch 与 client 入口装配

| 事实 | 证据 |
| --- | --- |
| bundle 声明 | `package.json:20-23`：`dsh.bundle.patch = './cordis.patch.yml'` |
| 客户端声明 | `package.json:31-38`：`dsh.client.inject = [dsh-client-locale, dsh-client-ui-settings, dsh-api-remotes]`、`platform: 'web'` |
| exports | `package.json:9-19`：`.` → `lib/index.js` + `lib/index.d.ts`；`./client` → `lib/client.js`；`./locale/*.json` |
| patch 行 | `cordis.patch.yml:11-15`：`- insert: [{ id: llm-commandcode, name: "@mars-sea/dsh-commandcode-provider", config: { apiKeyEnv: COMMANDCODE_API_KEY } }]` |
| Host 构建 | `tsdown.config.ts:17-38`：单入口 `src/index.ts`、ESM、`dts: true`、`neverBundle` 7 个 peer |
| Client 构建 | `tsdown.config.ts:40-68`：CJS、`platform: browser`、只 external `cordis`/`react`/`react/jsx-runtime`/`dsh-client-ui-primitives`；banner 写死包名与 `window.__ModuleLoader__.load`（`tsdown.config.ts:64-66`） |
| client 启动 inject 列表 | `src/client/index.ts:591-595`：只有 `slots`、`locale`、`remote`（刻意不含 `settingsScope`，见 `client/index.ts:100-107`） |
| 样式注入 id | `src/client/page-styles.ts` `PAGE_CSS_ID`、`panel-styles.ts` `PANEL_CSS_ID`，`client/index.ts:57-67` 以 `data-plugin-css` 幂等插入 |
| 插件元数据本地化 | `locale/en.json:1-6`、`locale/zh.json`（`meta.title = "Command Code"` / `"Command Code 提供方"`） |

---

## 2. 模块清单（71 个文件：职责 / 档位 / 判断依据）

档位定义：
- **专有** = 逻辑或数据绑定 Command Code 网关/账号/套餐，OpenDesign 下无意义，必须删除或重写；
- **半通用** = 骨架可直接留用，但常量、文案、字段名或协议细节需小改；
- **通用** = 与 provider 无关，几乎零改动。

### 2.1 `src/`（40 个）

| # | 文件 | 行 | 职责 | 档位 | 判断依据 |
| --- | --- | --- | --- | --- | --- |
| 1 | `adapter.ts` | 3512 | 三传输 adapter：请求体、账号轮换、目录/计费、用量、图片 | **专有** | `/alpha/generate`、`/provider/v1/*` 端点（2138-2143）、`x-command-code-version`（2252）、`x-cmd-zdr`（2246）、`COMMAND_CODE_CLI_VERSION`（94）、`DEFAULT_API_BASE`（95） |
| 2 | `capabilities.ts` | 1390 | 静态能力快照：efforts/vision/thinking/最低套餐/订阅套餐/deals/峰谷价 | **专有** | 94 条 `KNOWN_PLANS`（822-1010）、`KNOWN_SUBSCRIPTION_PLANS`（1052-1067）、`KNOWN_DEALS`（1170）、`MESSAGES_ONLY_MODELS`（558） |
| 3 | `model-prices.ts` | 401 | vendored per-token 价表 + catalog id→slug join | **专有（数据）/可复用（结构）** | 93 行价目（149-243）、来源是 commandcode.ai 定价页（6-15）、`scripts/sync-model-prices.mjs`（44-50） |
| 4 | `stream-response.ts` | 1067 | 已连接响应的解析、块装配、终态、用量、取消收束 | **专有** | 三协议分派 `handleCliEvent`/`handleOpenAIEvent`/`handleMessagesEvent`（621/726/872）、CLI `finish` 终止符（163-164）、`[DONE]`（180-181） |
| 5 | `provider-errors.ts` | 692 | 连接拒绝/流内错误/轮换分类 | **专有** | `upgrade_required`、`cmd_zdr_no_providers`、`MODEL_NOT_IN_PLAN`、CLI 终止标记（`provider-errors.ts` 头部注释 12-16） |
| 6 | `accounts.ts` | 726 | 多账号池：轮换、健康标记、探测复活、耗尽诊断 | **半通用** | 池机制通用，但探测依赖 `/alpha/billing/credits`（`accounts.ts:92,112`）、auth 文件兜底（477）、`RETRY_MAX_DELAY_MS=900_000`（31） |
| 7 | `gateway-facts.ts` | 166 | 目录抓取/校验/磁盘缓存/学习上限 | **半通用** | 机制通用；`parseCatalog` 认 `object:'list'`+`context_length`+`supported_endpoints`（57-76），`MODEL_CACHE_VERSION=3` 带 `apiBase`（13,79） |
| 8 | `login.ts` | 637 | 浏览器登录：loopback 服务器 + Studio 跳转 + whoami 校验 | **专有** | `STUDIO_AUTH_PATH='/studio/auth/cli'`（59）、允许来源含 `commandcode.ai`（52-56）、`studioBaseForApiBase`（121-125）、`validateCommandApiKey` 打 `/alpha/whoami`（139） |
| 9 | `login-wire.ts` | 166 | 三个 login Remote 的严格契约 | **专有** | 端点 `commandcode/loginBegin|Status|Cancel`（66-68）、失败原因词表（29-43） |
| 10 | `enrollment.ts` | 287 | 账号开通流程（浏览器登录/手动粘贴）与恢复日志 | **半通用** | 概念绑定"账号槽位 + 登录流程"；OpenDesign 若无多账号可整体删 |
| 11 | `enrollment-wire.ts` | 154 | 开通的 7 个 Remote + 消息键词表 | **半通用** | 端点 `commandcode/enrollment*`（141-154），改命名空间即可 |
| 12 | `usage-remote.ts` | 261 | `commandcodeUsage` 服务 + typert 注册 | **半通用** | 服务名/命名空间硬编码（106，`{ namespace: 'commandcode' }`） |
| 13 | `usage-wire.ts` | 519 | report/models/prices 三组严格契约与 descriptor | **半通用** | 结构可留；字段与语义是 CC 的（credits 五小时/周窗口 154-157、套餐 161-175） |
| 14 | `analytics.ts` | 163 | 历史折叠 → 请求事实 → 聚合/试算 | **半通用** | 过滤条件写死 `provider === 'commandcode'`（30、42、44、53） |
| 15 | `analytics-history.ts` | 70 | 通过宿主 history 服务读会话语料 | **半通用** | 与 provider 无关，但同样按 `commandcode` 过滤（经 `analytics.ts`） |
| 16 | `analytics-wire.ts` | 81 | 分析只读契约 + descriptor | **半通用** | 端点 `commandcode/analytics`（78） |
| 17 | `web-search.ts` | 702 | `ctx.web` 搜索后端 + 选择开关（写 `web.searchProvider`） | **半通用** | 选择逻辑与 provider 无关（100-475），但 `POST /alpha/web-search`（505）与 `{query,numResults}`（586-589）是 CC 私有 |
| 18 | `tui-settings.ts` | 518 | 终端设置 section 声明 | **半通用** | 字段就是 CC 的 config（apiBase 占位符 318、zdr 327、`/commandcode` 文案 409） |
| 19 | `commands.ts` | 229 | `/commandcode` 用量看板命令 | **半通用** | 命令名（192）与文案（`command-locales.ts`）可换；渲染逻辑通用 |
| 20 | `command-locales.ts` | 143 | 命令的 zh/en 文案 | **半通用** | 纯文案，"Command Code"字样 16 处 |
| 21 | `cost-projection.ts` | 150 | 持久化 `commandCodeCost` 投影：逐请求折叠 | **半通用** | 机制通用，投影键与 `modelPriceTable()` 绑定（1-6） |
| 22 | `cost-facts.ts` | 126 | 纯 JSON 计费事实：分组、峰谷、`pricingKey` | **半通用** | 结构通用；`peak` 语义来自 CC 定价（见 `model-prices.ts:23-28`） |
| 23 | `index.ts` | 992 | 插件入口：Config、凭据、池、注册、8 个 optional inject | **半通用** | 骨架是标准 dsh bundle；`PROVIDER`/`NS`/默认 env/缓存路径/displayName 全是 CC（174-180、634） |
| 24 | `image-tokens.ts` | 190 | 按模型家族的视觉 token 估算 | 通用 | 公式来自各家公开规则，按 catalog id 前缀分派（1-16） |
| 25 | `image-request.ts` | 75 | 请求图片目标（长边 1568 / 1 MiB） | 通用 | 纯几何 + 预算，无 provider 依赖（1-16） |
| 26 | `output-budget.ts` | 113 | 输出预算三态（未设/收紧/省略） | **半通用** | 规则通用；`MAX_OUTPUT_TOKEN_LIMIT=131_072` 是对 CC 网关实测的（10-20） |
| 27 | `context-window.ts` | 58 | 自定义上下文窗口的界与优先级 | 通用 | 纯函数、无 node 依赖 |
| 28 | `model-visibility.ts` | 12 | 白名单 vs 显式开关 | 通用 | 纯规则 |
| 29 | `plan-tiers.ts` | 15 | 套餐 tier 词表与顺序 | **半通用** | 词表是 CC 的（go/goat/pro/provider/max） |
| 30 | `config-volatile.ts` | 142 | dsh 易变配置标记/解引用 | 通用 | 纯宿主适配（1-16） |
| 31 | `display-format.ts` | 85 | 金额/数字/重置时间格式化 | 通用 | 无依赖 |
| 32 | `readable-error.ts` | 38 | 跨 webview 边界的错误文本 | 通用 | 纯工具（1-16） |
| 33 | `response-encoding.ts` | 6 | `accept-encoding: identity` | 通用 | 一行常量 |
| 34 | `timeout-limits.ts` | 3 | 超时上下界 | 通用 | 两行常量 |
| 35 | `transient-retry.ts` | 23 | 临时错误 3 次预算 | 通用 | WeakMap 计数，与 provider 无关 |
| 36 | `transport-retry.ts` | 99 | TRANSPORT 独立预算 | 通用 | 同上（1-20） |
| 37 | `request-timing.ts` | 81 | opt-in 阶段耗时（`DSH_COMMANDCODE_TIMING`） | **半通用** | 逻辑通用，env 名与文件名带 commandcode（5） |
| 38 | `stream-trace.ts` | 195 | opt-in 原始流 trace（`DSH_COMMANDCODE_TRACE`） | **半通用** | 逻辑通用，env 名带 commandcode |
| 39 | `wire-shared.ts` | 107 | 边界校验 + descriptor 工厂 | **半通用** | 三个常量写死包名/服务名/命名空间（18/21/24） |
| 40 | `wire-guards.ts` | 32 | `isRecord`/`stringValue`/`numberValue` | 通用 | 纯守卫 |

（`src/` 只有 40 个 top-level `.ts`，无第 41-43 个；任务描述的数量为近似值。）

### 2.2 `src/client/`（31 个）

| # | 文件 | 行 | 职责 | 档位 | 判断依据 |
| --- | --- | --- | --- | --- | --- |
| 1 | `index.ts` | 595 | 客户端入口：5 个插槽注册、Remote 挂载、控制器装配 | **半通用** | 骨架可留；id/key 全是 CC（76/84/115/418/441/533/583） |
| 2 | `section.tsx` | 2006 | 设置页主界面（账号列表、模型与上下文、隐私、集成、高级） | **半通用** | 字段与文案绑定（如 zdr、webSearch、套餐分组）；折叠判据导出被 `section.test.ts` 直接测 |
| 3 | `settings.ts` | 1037 | 设置页控制器：草稿、校验、页面投影 | **半通用** | `COMMANDCODE_NS`（13）、字段表（418-442） |
| 4 | `settings-write.ts` | 318 | 写入过程：排队、整批提交、凭据确认 | **半通用** | `DEFAULT_API_KEY_REF='COMMANDCODE_API_KEY'`（7）、ops 路径（108-114） |
| 5 | `settings-scope.ts` | 537 | `remote.settings` 的 describe/mutate 客户端封装 | 通用 | 只依赖 wire 形状（36-75） |
| 6 | `card.tsx` | 318 | Models 页 provider 卡片 | **半通用** | 通过 `settingsNs` key 挂载，文案与字段是 CC |
| 7 | `panel.ts` | 610 | 配额面板 view model + 自动刷新 | **半通用** | 展示套餐/5h/周窗口（CC 计费语义） |
| 8 | `panel-view.tsx` | 525 | 侧栏卡片 + 中央仪表盘组件 | **半通用** | 同上 |
| 9 | `panel-copy.ts` | 237 | 面板 zh/en 文案 + `panel.commandcode` 命名空间 | **半通用** | 命名空间名（104） |
| 10 | `panel-slots.ts` | 31 | `main`/`sidebar.footer.action` SlotMap 合并 | 通用 | 类型合并 |
| 11 | `panel-styles.ts` | 274 | 面板样式表 | 通用 | CSS |
| 12 | `page-styles.ts` | 271 | 设置页样式表 | 通用 | CSS |
| 13 | `usage.ts` | 181 | 账号卡控制器 + Remote 命名空间类型声明 | **半通用** | 三个端点名（32-34）、`commandcode` 成员（26-28） |
| 14 | `prices.ts` | 182 | 价格表控制器（缓存/重试/重绑） | 通用 | 只认 `prices()` 形状 |
| 15 | `session-cost.ts` | 440 | 会话成本计算与文案 | **半通用** | 依赖 CC 价表语义（峰谷/contextTiers） |
| 16 | `session-cost-view.tsx` | 160 | composer dock 入口 | 通用 | 只读投影 + 价格 store |
| 17 | `session-cost-display.ts` | 524 | 把成本注入宿主的 token 胶囊/用量弹窗（DOM 注入） | 通用 | 依赖宿主类名，非 provider 事实（脆弱） |
| 18 | `session-cost-slots.ts` | 33 | `conversation.composer.dock` SlotMap 合并 | 通用 | 类型合并 |
| 19 | `login.ts` | 324 | 登录面板控制器（轮询生命周期） | **半通用** | 调 `loginBegin/Status/Cancel`（Remote 名） |
| 20 | `login-row.tsx` | 54 | 登录行共享组件 | **半通用** | 文案/URL 由状态携带 |
| 21 | `login-page.ts` | 9 | 登录页常量 | 通用 | 极小 |
| 22 | `enrollment.ts` | 156 | 页面侧开通控制器与流生命周期 | **半通用** | 端点 `enrollment*` |
| 23 | `locales.ts` | 727 | 设置页 zh/en 全量文案 | **专有（文案）** | 35 处 Command Code 字样 |
| 24 | `model-select.ts` | 206 | 模型多选下拉的数据整形（搜索/tier 分组/陈旧 id） | 通用 | `knownPlans` 由调用方注入（21-29） |
| 25 | `analytics.ts` | 34 | 分析查询生命周期 | 通用 | 只认 `analytics(query)` |
| 26 | `analytics-view.tsx` | 186 | 分析筛选与对比表 | **半通用** | 场景列 = 目录模型，成本=CC 价表 |
| 27 | `analytics-comparison.ts` | 44 | 对比表数学 | 通用 | 纯计算 |
| 28 | `analytics-copy.ts` | 55 | 分析文案 | **半通用** | 文案 |
| 29 | `update.ts` | 217 | npm registry 版本提示 | **半通用** | registry URL 与 cache key 写死包名（34、145） |
| 30 | `version.ts` | 25 | 版本号与 releases URL | 通用 | 从 `package.json` 推导（11、21-25，含 Mars-Sea 兜底） |
| 31 | `snapshot-store.ts` | 49 | getSnapshot/subscribe 小 store | 通用 | 纯工具 |

---

## 3. 硬编码 Command Code 事实清单（文件:行 — 内容）

### 3.1 端点与 base URL

| 位置 | 内容 |
| --- | --- |
| `src/adapter.ts:95` | `DEFAULT_API_BASE = 'https://api.commandcode.ai'` |
| `src/adapter.ts:2138-2143` | `protocolEndpoint()`：`/alpha/generate`、`/provider/v1/messages`、`/provider/v1/chat/completions` |
| `src/adapter.ts:2328` | 目录：`GET ${apiBase}/provider/v1/models` |
| `src/adapter.ts:2810` | `GET /alpha/whoami`（套餐探测） |
| `src/adapter.ts:2814-2817` | `GET /alpha/billing/subscriptions?orgId=`、`GET /alpha/billing/credits` |
| `src/adapter.ts:2971` | `GET /alpha/whoami`（用量报表） |
| `src/adapter.ts:2982-2983` | `GET /alpha/billing/credits`、`/alpha/billing/subscriptions` |
| `src/adapter.ts:2991` | `GET /alpha/usage/summary?since=` |
| `src/adapter.ts:3049` | `GET /alpha/billing/credits`（池探测复活） |
| `src/web-search.ts:505` | `SEARCH_ROUTE = '/alpha/web-search'` |
| `src/login.ts:59` | `STUDIO_AUTH_PATH = '/studio/auth/cli'` |
| `src/login.ts:139` | 登录后校验 `GET ${apiBase}/alpha/whoami` |
| `src/login.ts:52-56` | 允许的 Studio 来源：`http://localhost:3000`、`https://staging.commandcode.ai`、`https://commandcode.ai` |
| `src/login.ts:121-125` | `studioBaseForApiBase()`：staging-api → staging studio、localhost → `:3000`、否则 `https://commandcode.ai` |
| `src/login.ts:43-46` | loopback 端口从 5959 起 10 次尝试 |
| `src/index.ts:180` | 目录缓存 `~/.commandcode/models-cache.json` |
| `src/adapter.ts:540` | 凭据兜底文件 `~/.commandcode/auth.json`（解析 `apiKey`/`commandcode`/`command-code`，`adapter.ts:530-555`） |
| `src/client/update.ts:34` | `https://registry.npmjs.org/@mars-sea%2Fdsh-commandcode-provider/latest` |
| `src/client/update.ts:145` | 缓存键 `'@mars-sea/dsh-commandcode-provider/update-check'` |
| `src/client/version.ts:24` | 兜底仓库 `https://github.com/Mars-Sea/dsh-commandcode-provider` |

### 3.2 鉴权头与身份头（遥测）

| 位置 | 内容 |
| --- | --- |
| `src/adapter.ts:94` | `COMMAND_CODE_CLI_VERSION = '1.84.0'` |
| `src/adapter.ts:2242-2248` | 共享头：`Content-Type`、`accept-encoding: identity`、`Authorization: Bearer`、`x-cmd-zdr`（仅 ZDR）、`attributionHeaders()` |
| `src/adapter.ts:2249-2257` | CLI 专有头：`x-command-code-version`、`x-cli-environment: production`、`x-project-slug`、`x-taste-learning: false`、`x-co-flag: false` |
| `src/adapter.ts:2258-2264` | Provider API 头：仅 `Accept: text/event-stream`（注释说明刻意不发 CLI 头） |
| `src/adapter.ts:2667-2673` | 账号端点头：`Authorization`、`accept-encoding`、`x-command-code-version`、`x-cli-environment`、`attributionHeaders()` |
| `src/web-search.ts:599-600` | 搜索头：`x-command-code-version`、`x-cli-environment: production` |
| `src/provider-errors.ts`（头部注释 12-16） | CLI 终止标记集合（`Xw`）用于"重试无意义"判定 |
| `src/response-encoding.ts:6` | `accept-encoding: identity`（因宿主 dispatcher 兼容问题） |
| `src/request-timing.ts:5` / `src/stream-trace.ts` | 本地遥测：`DSH_COMMANDCODE_TIMING` / `DSH_COMMANDCODE_TRACE` 落地 JSONL |

### 3.3 请求 / 响应 wire 形状

| 位置 | 内容 |
| --- | --- |
| `src/adapter.ts:1957-2008` | CLI 体：`config{workingDir,date,environment,structure,isGitRepo,…}` + `memory/taste/skills: null` + `permissionMode:'standard'` + `params{model,messages,tools(扁平 name/input_schema),system,max_tokens,temperature:0.3,stream,reasoning_effort}` + `threadId` |
| `src/adapter.ts:2010-2036` | OpenAI 体：`{model, messages, tools[{type:'function',function:{…}}], max_tokens, temperature, stream, reasoning_effort?}` |
| `src/adapter.ts:2068-2117` | Messages 体：`thinking:{type:'adaptive'}`、`output_config:{effort}`、`system` 数组 + `cache_control`、`tools[-1].cache_control`、**不发 `temperature`** |
| `src/adapter.ts:2145-2317` | 连接：`POST`，错误体最多 64 KB（2161）、`Retry-After` 解析（2310） |
| `src/adapter.ts:3174-3178` | `stop` 直接拒绝：`UNSUPPORTED_OPTION`（"Command Code wire format has no documented stop field"） |
| `src/adapter.ts:3190-3196` | 图片能力闸门按 `KNOWN_IMAGE_MODELS`，否则 `UNSUPPORTED_CONTENT` |
| `src/adapter.ts:3200-3204` | 无附件服务时 `UNSUPPORTED_CONTENT` |
| `src/stream-response.ts:621-724` | CLI 事件：`text-delta`/`reasoning-delta`/`reasoning-start|end`/`tool-call`/`cache-write-tokens`/`finish`/`error` |
| `src/stream-response.ts:726-833` | OpenAI 事件：`choices[].delta`、`[DONE]`、尾部 usage |
| `src/stream-response.ts:872-995` | Messages 事件：`message_start`/`content_block_start|delta|stop`/`message_delta`/`message_stop`/`ping`/`error` |
| `src/usage-wire.ts:90-178` | 用量报告字段：`account{id,name,userName}`、`usage{totalCount,totalCost,successRate,completedCount,failedCount,totalTokensIn/Out,totalCredits,periodBasis,periodStart}`、`credits{monthlyCredits,purchasedCredits,freeCredits,fiveHour,weekly}`、`plan{planId,name,status,monthlyCredits,currentPeriodEnd,currentPeriodStart}` |
| `src/adapter.ts:1550-1560` | `/alpha/whoami`、`/alpha/usage/summary` 的内部形状 |
| `src/web-search.ts:586-589` | 搜索体：`{ query, numResults }`；结果读 `{ results: [{title,url,snippet}] }`（649-665） |
| `src/login.ts:165-173` | 回调体必须含 `apiKey/state/userId/userName/keyName` |

### 3.4 协议路由与降级（语义专有）

| 位置 | 内容 |
| --- | --- |
| `src/adapter.ts:2864-2869` | `routesToMessages()`：目录 `supported_endpoints` 含 `/messages`，兜底 `claude-*` 前缀 |
| `src/adapter.ts:2891-2903` | `resolveProtocol()`：`Go` 套餐（tierWeight 0）→ CLI；否则 OpenAI；Messages 模型强制 messages |
| `src/adapter.ts:3381-3400` | `upgrade_required` 或 Messages `permission_error` → 降级到 `/alpha/generate`（且 Messages 拒绝不写 protocolCache） |
| `src/adapter.ts:3422-3449` | 账号轮换：`classifyAccountRejection` → `rotateApiKey`，上限 16 次（`adapter.ts:120`） |
| `src/adapter.ts:3463-3486` | 429 + 明确额度窗口 → `RATE_LIMIT`（带 `providerRetryAfterMs`）；否则 `THROTTLED` |
| `src/capabilities.ts:552-575` | `MESSAGES_ONLY_MODELS`（Claude 全家） |

### 3.5 模型 id、套餐、价格、额度

| 位置 | 内容 |
| --- | --- |
| `src/capabilities.ts:25-203` | `KNOWN_EFFORTS`：按 catalog id 写死 effort 列表（如 `deepseek/deepseek-v4.1-flash: ['off','low','high','max']` 73 行） |
| `src/capabilities.ts:220-335` | `KNOWN_IMAGE_MODELS`（Vision 白名单） |
| `src/capabilities.ts:411-468` | `KNOWN_NON_ZDR_MODELS`（25 个） |
| `src/capabilities.ts:493-521` | `KNOWN_THINKING_MODELS` |
| `src/capabilities.ts:613-775` | `MODEL_OUTPUT_TOKEN_LIMITS`（按 id 的输出上限，来自 models.dev，`scripts/sync-output-limits.mjs`） |
| `src/capabilities.ts:822-1010` | `KNOWN_PLANS`：94 条 id → 最低套餐 tier |
| `src/capabilities.ts:1052-1067` | `KNOWN_SUBSCRIPTION_PLANS`：`individual-go|go-v1|goat|pro|pro-v1|provider|max|ultra|teams-pro` + 月额度 + tierWeight |
| `src/capabilities.ts:1170-1252` | `KNOWN_DEALS`（含 `expiresAt` 与 `free`） |
| `src/capabilities.ts:1254-1276` | `KNOWN_PEAK_PRICING` |
| `src/capabilities.ts:1277-1280` | `PEAK_HOUR_RANGES` |
| `src/model-prices.ts:149-243` | 93 条 `{ id, rates:[in,out,cacheRead,cacheWrite?], listRates?, peak?, allowance?, contextTiers? }` |
| `src/model-prices.ts:251-254` | `PRICE_SLUG_OVERRIDES` |
| `src/index.ts:816-817` | `KNOWN_PLANS[model.id]` 作为 tier、`modelAllowanceFor(model.id)?.[bracket]` 作为月额度发到设置页 |
| `src/adapter.ts:2524`、`2615` | 展示名后缀 `" (CC)"` |
| `src/adapter.ts:2520`、`2604-2605` | Vision 与 efforts 由 `KNOWN_IMAGE_MODELS`/`KNOWN_EFFORTS` 决定 |

### 3.6 ZDR / 隐私

| 位置 | 内容 |
| --- | --- |
| `src/index.ts:311-323` | Config 注释：ZDR 语义、`CMD_ZDR=1`、`x-cmd-zdr: 1`、422 `cmd_zdr_no_providers` |
| `src/index.ts:398` | `zdr: z.boolean().default(false)` |
| `src/adapter.ts:1461-1468` | `connection.zdr` |
| `src/adapter.ts:2241-2246` | 每个 chat 请求按开关加 `x-cmd-zdr: 1` |
| `src/capabilities.ts:470-477` | `supportsZeroDataRetention()` |
| `src/client/settings.ts:441` | 设置页 `zdr` 布尔字段 |
| `src/tui-settings.ts:327` | TUI `zdr` 字段 |
| `tests/zdr.test.ts:20-59` | 钉住 25 个非 ZDR 模型 id |

### 3.7 登录 / 开通 / 账号

| 位置 | 内容 |
| --- | --- |
| `src/index.ts:785-799` | `CommandCodeLoginFlow` 装配（apiBase 动态、targetRef 校验、`credentials.set`） |
| `src/index.ts:828-847` | `AccountEnrollmentManager` 装配 |
| `src/index.ts:541-557` | 账号池 + `probeWindowLimits` 作用域 |
| `src/index.ts:559-574` | 无凭据错误文案：提示 `command-code login` 与 `~/.commandcode/auth.json` |
| `src/index.ts:477-508` | 账号槽位构造：`default` + `accounts[]`，slot id = 凭据引用 |
| `src/accounts.ts:477` | 默认槽才允许读 CLI auth 文件 |
| `src/web-search.ts:696` | 同样的 `command-code login` 提示文案 |
| `src/enrollment-wire.ts:141-154` | `commandcode/enrollment*` 七个端点 |

### 3.8 命名与元数据（字面量）

| 位置 | 内容 |
| --- | --- |
| `package.json:2-4` | `name`、`version`、`description`（"Unofficial … for Command Code"） |
| `package.json:71-76` | `repository`/`bugs`/`homepage` 指向 `Mars-Sea/dsh-commandcode-provider` |
| `package.json:77-87` | keywords 含 `commandcode`、`command-code` |
| `package.json:25-29` | `dsh.compatibility.dshReleases` 两条 RC、`dsh: "0.2.0-rc.2 || 0.2.1-rc.2"` |
| `package.json:30`、`64` | `engines.dsh` 同一析取式 |
| `package.json:89-107` | 15 个 peer 的版本析取式（换引擎才动） |
| `cordis.patch.yml:1-15` | 注释 + `id: llm-commandcode` + `name: "@mars-sea/dsh-commandcode-provider"` + `config.apiKeyEnv: COMMANDCODE_API_KEY` |
| `tsdown.config.ts:64` | client banner 里的 `id: "@mars-sea/dsh-commandcode-provider"` |
| `src/index.ts:171-180` | `name='llm-commandcode'`、`NS`、`DEFAULT_API_KEY_ENV='COMMANDCODE_API_KEY'`、`PROVIDER='commandcode'`、缓存路径 |
| `src/wire-shared.ts:18/21/24` | `REMOTE_PACKAGE`、`REMOTE_SERVICE='commandcodeUsage'`、`REMOTE_NAMESPACE='commandcode'` |
| `src/usage-wire.ts:54/285/423` | `commandcode/report`、`commandcode/models`、`commandcode/prices` |
| `src/analytics-wire.ts:78` | `commandcode/analytics` |
| `src/commands.ts:192-193` | 命令 `commandcode` / 描述 `Command Code account usage dashboard` |
| `src/tui-settings.ts:292/318` | TUI 标题 `Command Code`、`apiBase` 占位符 |
| `src/client/index.ts:76/84` | `commandcode-panel`、`commandcode-session-cost` |
| `src/client/index.ts:115/121` | locale 命名空间 `settings.commandcode`、`panel.commandcode` |
| `src/client/index.ts:418/441/533/553` | 插槽 id/key（`commandcode` / `llm-commandcode` / `commandcode-panel`） |
| `src/client/settings.ts:13` | `COMMANDCODE_NS` |
| `src/client/settings-write.ts:7` | `DEFAULT_API_KEY_REF='COMMANDCODE_API_KEY'` |
| `src/client/update.ts:34/145` | registry URL / 缓存键 |
| `locale/en.json:2-5`、`locale/zh.json` | 插件管理器标题与描述 |
| `src/provider-errors.ts`、`src/transport-retry.ts`、`src/accounts.ts` 等 | 错误与诊断文案里 "Command Code"（`grep -r "Command Code" src` 命中 198 行；`grep -rn "commandcode" src` 命中 296 行，均为区分大小写的字面量统计） |

---

## 4. 改造方案草案

### 4.0 前置假设（**必须先用真实 OpenDesign 侧证据替换，本文不臆造**）

以下 5 项决定改造形态，当前**未验证**：

1. OpenDesign 是否**只有一个** OpenAI Chat Completions 兼容端点（若是，adapter 从 3 传输降到 1 传输，删 `protocolEndpoint` 与全部降级分支）。
2. 是否**有** `/models` 目录端点、字段名是否与 OpenAI `{object:'list',data:[{id,context_length,...}]}` 一致（决定 `gateway-facts.ts:57-76` 是改键名还是整体替换）。
3. 鉴权是 `Authorization: Bearer` 还是 `x-api-key`（决定 `adapter.ts:2242-2248`、`2667-2673`、`login.ts:141`）。
4. 是否存在**套餐/tier/额度/deals**概念（若否，`capabilities.ts`/`plan-tiers.ts`/`model-prices.ts` 的 tier 与 allowance 部分整体删除，`listModels` 的 plan filter 与 `fetchBillingAccess` 一起删）。
5. 是否**有**浏览器登录或 API-key 自助页（若否，`login*.ts`、`enrollment*.ts`、`section.tsx` 的账号区整块删除）。

### 4.1 必改（文件级）

| 文件 | 改什么 | 预估量 |
| --- | --- | --- |
| `src/adapter.ts` | 删 CLI/Messages 两传输（`buildCliBody` 1957-2008、`buildMessagesBody` 2068-2117、`messagesMessageCodec` 1326-1379、`imageToMessages` 1284-1293）、删 `protocolEndpoint` 三选一（2139-2143）、删 `resolveProtocol`/`protocolCache`（2846-2903）、删 Messages 降级与 `upgrade_required`（3381-3400）、删 `zdr` 头（2246）、删计费探测（`loadPoolBillingAccess` 2744、`fetchBillingAccess` 2804-2836、`cachedBillingTierWeight` 2839-2843）与 `allowanceTier`（2580-2593）、改名/改默认 base（94-95） | **3512 → ~900-1200 行**（−65%~−74%） |
| `src/capabilities.ts` | 删 `KNOWN_PLANS`/`KNOWN_SUBSCRIPTION_PLANS`/`KNOWN_DEALS`/`KNOWN_PEAK_PRICING`/`MESSAGES_ONLY_MODELS`/`KNOWN_NON_ZDR_MODELS`/`KNOWN_THINKING_MODELS`；efforts 与 vision 改为"目录公布优先、无快照"；`capabilityDescription` 保留但去套餐/deal 文案 | **1390 → ~150-250 行**（−82%~−89%） |
| `src/model-prices.ts` | 换成 OpenDesign 的价目来源（或整体删除，改由服务端/无价目） | **401 → 0-150 行** |
| `src/provider-errors.ts` | 删 `upgrade_required`/`cmd_zdr_no_providers`/`MODEL_NOT_IN_PLAN`/CLI 终止标记分支，保留 HTTP→LlmError 映射与 Retry-After | **692 → ~250-350 行** |
| `src/stream-response.ts` | 只留 OpenAI 分支（删 621-724 CLI、872-995 Messages、`CommandCodeProtocol` 三值 387） | **1067 → ~500-600 行** |
| `src/gateway-facts.ts` | `normalizeModel`/`parseCatalog` 改键名与形状（57-76）；`requiresMessagesEndpoint` 兜底（29、66）删除 | **166 → ~130 行** |
| `src/login.ts` + `src/login-wire.ts` | OpenDesign 无浏览器登录则**整体删除**；有则换 URL/允许来源/校验端点 | **803 → 0 或 ~300 行** |
| `src/enrollment.ts` + `src/enrollment-wire.ts` | 多账号开通无对应概念则删除；保留则删"浏览器登录"分支 | **441 → 0 或 ~200 行** |
| `src/accounts.ts` | 单密钥则退化为 `resolveApiKey`（保留 `assertUsableApiKey` 与 `~/.opendesign/auth.json` 等价物或直接删）；多账号则保留骨架、改探测端点 | **726 → ~120 或 ~600 行** |
| `src/usage-remote.ts` + `src/usage-wire.ts` | 服务名/命名空间改名；删 credits 五小时/周窗口与 plan 段（`usage-wire.ts:132-175`）；`report` 只留"能/不能取用量" | **780 → ~350 行** |
| `src/web-search.ts` | 无 `/alpha/web-search` 等价物则删 provider（562-668），只保留选择开关逻辑（100-475）；或换端点与体 | **702 → ~450 或 0 行** |
| `src/commands.ts` + `src/command-locales.ts` | 命令改名（如 `/opendesign`）、文案替换；用量字段裁剪 | **372 → ~200 行** |
| `src/index.ts` | `NS`/`PROVIDER`/`DEFAULT_API_KEY_ENV`/缓存路径（174-180）、`displayName`（634）、错误文案（566-571）、`slots`/`preferredId`（477-514）、`resolveApiKey`（559-574）、`usageReports`（723-765）、`catalogForEditors` 的 tier/allowance（806-826）、web/tui/settings 三处 inject 的字段 | **992 → ~550-700 行** |
| `src/tui-settings.ts` | 字段改为 OpenDesign 的（apiBase/apiKey/modelVisibility/contextWindow/maxOutputTokens…），删 `zdr`/`activeAccount`/套餐分组 | **518 → ~250 行** |
| `src/plan-tiers.ts` | 无 tier 概念则删除 | **15 → 0 行** |
| `src/analytics.ts` + `analytics-history.ts` + `analytics-wire.ts` | `provider === 'commandcode'` 三处改新路由 id；端点改名 | **314 → ~300 行** |
| `src/cost-facts.ts` + `cost-projection.ts` | 价表语义换成 OpenDesign（峰谷/contextTiers 若无则删） | **276 → ~150 行** |
| `src/wire-shared.ts` + `src/usage-wire.ts` 端点 | 三个常量（18/21/24）与全部 `commandcode/*` 端点串 | 4 行 + 若干字符串 |
| `src/client/index.ts` | 插槽 id/key、locale 命名空间、`PANEL_ID`/`SESSION_COST_ID`（76/84/115/121/418/441/533/553/583） | **595 → ~520 行** |
| `src/client/section.tsx` | 账号/登录/套餐区删除或替换，字段表跟随 Host schema | **2006 → ~700-1000 行** |
| `src/client/settings.ts` | `COMMANDCODE_NS`（13）、字段表（418-442）删 `zdr`/`offloadSeenImagesForCache` 等 | **1037 → ~800 行** |
| `src/client/settings-write.ts` | `DEFAULT_API_KEY_REF`（7） | 1 行 + 文案 |
| `src/client/locales.ts` | 全量文案替换（35 处） | **727 → ~600 行** |
| `src/client/panel*.ts(x)` + `session-cost*` | 配额面板若 OpenDesign 无套餐则整体删除；`session-cost` 跟随价表 | **~1 500 → 0 或 ~500 行** |
| `src/client/update.ts` | registry URL 与缓存键（34/145） | 2 行 |
| `src/client/version.ts` | 兜底仓库（24） | 1 行 |
| `package.json` | name/version/description/repository/keywords/`files` 不变项核对；`dsh.client.inject` 不动 | ~10 行 |
| `cordis.patch.yml` | id、name、`apiKeyEnv` | 3 行 |
| `tsdown.config.ts` | banner 包名（64） | 1 行 |
| `locale/*.json` | 标题/描述 | 4 行 |

**必改量级合计（估计）**：
- 必改/重写文件 **约 26-30 个**，改动 **约 9 000-13 000 行**（其中删除占 ~7 000-10 000 行，新写 ~2 000-3 000 行）。
- 净残量估计 **8 000-11 000 行**（原 24 791 行的 32%-45%）。
- 新增文件估计 **3-6 个**（如 `src/opendesign-catalog.ts`、`src/openai-wire.ts`），或把 OpenAI 分支抽成 `src/transports/openai.ts`。

### 4.2 可删（无 OpenDesign 对应物，删了不影响骨架）

| 文件/区块 | 理由 |
| --- | --- |
| `src/login.ts`、`src/login-wire.ts`、`src/client/login.ts`、`src/client/login-row.tsx`、`src/client/login-page.ts` | 目标是 Command Code Studio 的 loopback 登录（`login.ts:1-28`、`52-59`） |
| `src/enrollment.ts`、`src/enrollment-wire.ts`、`src/client/enrollment.ts` | 绑定"账号槽位 + 浏览器登录"（`GLOSSARY.md:8-14`） |
| `src/capabilities.ts` 中的 `KNOWN_SUBSCRIPTION_PLANS`/`KNOWN_DEALS`/`KNOWN_PEAK_PRICING`/`KNOWN_NON_ZDR_MODELS`/`MESSAGES_ONLY_MODELS` | 全是 CC 套餐/促销/ZDR/Claude 路由事实（1052-1067、1170-1252、1254-1280、411-468、558-575） |
| `src/model-prices.ts` 全表 | 来自 commandcode.ai 定价页（6-15）；除非 OpenDesign 也发价目 |
| `src/plan-tiers.ts` | CC 的 go/goat/pro/provider/max 词表 |
|  | 打 `/alpha/billing/*` |
| `src/adapter.ts` 的 `getUsage`/`probeWindowLimits`（2926-3080） | 打 `/alpha/whoami|usage/summary|billing/credits` |
| `src/web-search.ts:562-668`（`CommandCodeSearchProvider`） | `/alpha/web-search` 私有端点 |
| `src/client/panel*.ts(x)`、`panel-copy.ts`、`panel-slots.ts`、`panel-styles.ts` | 展示套餐与 5h/周额度 |
| `src/client/session-cost-display.ts` | DOM 注入依赖宿主 token 胶囊结构（1-40），与 provider 无关但维护成本高，若价目缺失则无意义 |
| `scripts/sync-model-prices.mjs`、`scripts/sync-output-limits.mjs`、`scripts/probe-*`、`scripts/verify-messages-live.mjs` | 全部打 CC 或 Claude 端点 |
| `docs/agent-reference/model-catalog.md`、`accounts-and-retry.md`、`adapter-protocol.md` 等 | CC 协议记录，改造后失效（保留为历史需明确标注） |
| `.agents/skills/dsh-commandcode-upstream/` | 上游同步技能，改造后无对象 |

### 4.3 可保留（几乎零改动）

`src/config-volatile.ts`、`src/context-window.ts`、`src/model-visibility.ts`、`src/display-format.ts`、`src/readable-error.ts`、`src/response-encoding.ts`、`src/timeout-limits.ts`、`src/transient-retry.ts`、`src/transport-retry.ts`、`src/wire-guards.ts`、`src/image-request.ts`、`src/image-tokens.ts`、`src/output-budget.ts`（只改 `MAX_OUTPUT_TOKEN_LIMIT` 依据）、`src/client/settings-scope.ts`、`src/client/snapshot-store.ts`、`src/client/prices.ts`、`src/client/model-select.ts`、`src/client/analytics-comparison.ts`、`src/client/session-cost-view.tsx`、`src/client/session-cost-slots.ts`、`src/client/panel-slots.ts`（若面板保留）、`src/client/page-styles.ts`、`src/client/panel-styles.ts`、`tests/_css-module-loader.mjs`、`tests/_primitives-stub.mjs`、`scripts/npm-pack-json.mjs`、`scripts/verify-package-exports.mjs`、`scripts/verify-isolated-install.mjs`（只需包名断言同步）、`scripts/verify-engine-load.mjs`（需改 provider id 与三协议断言）。

### 4.4 最高风险点（5 个）

1. **adapter 的三传输分支是整份代码的承重墙**（`adapter.ts:1957-2143`、`3285-3400`）。删 CLI/Messages 会同时拆掉：`protocolCache`、`upgrade_required` 降级、`omitMaxTokens` 的"Messages 必填"特例（`output-budget.ts` `omitOutputTokens` 按 target 判定）、`assignMaxTokens` 的嵌套路径（`adapter.ts:2125-2128`）、以及 `tests/adapter.test.ts` 里按三种协议参数化的结算帧（`tests/adapter.test.ts:130-230`）。**建议先加一层 `Transport` 接口再逐个摘除**，否则单次改动量过大、回归定位困难。
2. **accounts 池与计费探测是隐式耦合**：`resolveApiKey`（`index.ts:559-574`）→ `pool.resolveKey` → `probeWindowLimits`（`adapter.ts:3046`）→ `/alpha/billing/credits`；`usageReports`（`index.ts:723-765`）、`/commandcode` 命令、面板、`activeAccount` 展示全挂在上面。删除探测但保留池，会留下"永远无法复活"的标记路径（`accounts.ts:616-712` 的耗尽诊断）。
3. **成本/分析口径与 vendored 价表强绑定**：`analytics.ts:105-123` 用 `requestCost` + `modelPriceTable`；`cost-projection.ts` 注册持久化投影；`model-prices.test.ts:18-30` 断言"每个 catalog 模型要么有价、要么显式免费"。换价目源（或没有价目）会同时打破 Host 投影、浏览器读数与 3 个测试文件。
4. **测试夹具（`tests/adapter.test.ts` 279 个 `test()`）**：`/alpha/` 命中 79 次、`/provider/v1` 75 次、`api.commandcode.ai` 51 次、模型 id（claude-/deepseek-/gpt-）315 次。这些不是"改断言"能过的，是"重新定义被测对象"。加上 `gateway-request.test.ts`（9 个，全打 `/provider/v1`）、`zdr.test.ts`（25 个 id）、`model-prices.test.ts`（93 行价表 join）。
5. **客户端与宿主 DOM/插槽的隐式契约**：`session-cost-display.ts` 直接改宿主 token 胶囊与用量弹窗 DOM；`styles.test.ts`（6 个）审计选择器必须"只碰自己的类或已记录的 sidebar 锚点"；`client-boot.test.ts`（15 个）用真实客户端装配跑 `apply()`。改 id/key（`client/index.ts:418/441/533`）会一起动这三处。

### 4.5 建议的落地顺序（降低一次性 diff）

1. 先把 **通用骨架**（4.3）原样拷到新树，跑通 `typecheck` + 对应测试，确认零改动可用。
2. 再写**单一 OpenAI 传输**的最小 adapter（含目录、`resolveModel`、图片、错误映射），只保留 4.1 中 OpenAI 分支。
3. 再替换 **wire 层**（`usage-wire`/`wire-shared`/`analytics-wire` 改名 + 字段裁剪），Host 与 Client 同步改，跑 `usage-wire.test.ts`/`wire-shared.test.ts`。
4. 最后改**客户端页面**（`section.tsx` 分块删账号/套餐区），每删一块跑 `section.test.ts` 与 `client-boot.test.ts`。
5. 全程把 `lib/` 重建纳入提交（CI 有 `git diff --exit-code -- lib/`，`.github/workflows/ci.yml:26`）。

---

## 5. 验证链

### 5.1 命令与耗时（**本机无 `node_modules`，全部为估计，未实跑**）

| 步骤 | 命令 | 依据 | 估计耗时 |
| --- | --- | --- | --- |
| 装依赖 | `npm ci` | `package-lock.json` 83 KB；`package.json:120-148` 26 个 devDeps | 30-90 s |
| 类型检查 | `npm run typecheck` → `tsc --noEmit` | `package.json:59`、`tsconfig.json:25`（include src+tests+tsdown） | 10-25 s |
| 单测 | `npm test` → `node --import tsx --test tests/**/*.test.ts` | `package.json:60`；44 个测试文件、985 个 `test()` 声明 | 60-120 s |
| 构建 | `npm run build` → `tsdown` | `package.json:54`、`tsdown.config.ts:70`（两个 config） | 5-15 s |
| 产物一致性 | `git diff --exit-code -- lib/` | `.github/workflows/ci.yml:26` | <1 s |
| 引擎加载 | `npm run test:engine` → `scripts/verify-engine-load.mjs` | `package.json:57`；脚本会**逐个安装**声明的每个 release（`0.2.0-rc.2`、`0.2.1-rc.2`） | **3-10 min**（网络+安装为主） |
| 隔离安装 | `npm run test:install` → `scripts/verify-isolated-install.mjs` | `package.json:56`；pnpm `10.34.5`、逐个版本 generation | 1-3 min |
| 打包内容 | `npm run test:pack` → `scripts/verify-package-exports.mjs` | `package.json:58` | 2-5 s |

### 5.2 改完后的最小可验证路径（由快到慢，逐级加证据）

1. `npm run typecheck` —— 最快发现 4.1 里"删了还在被引用"的符号（改造主要失败模式）。
2. `node --import tsx --test tests/adapter.test.ts` —— 只跑 wire 层，是唯一能证明"请求体/流解析没退化"的快速信号。
3. `npm run build && git diff --exit-code -- lib/` —— 证明 `lib/` 与 `src/` 同步（CI 门槛）。
4. `npm run test:engine -- --engine ~/.dsh/profiles/<profile>` —— 证明 bundle 在**真实引擎**上能 link、`name/apply/Config` 仍在、`lib/client.js` 的 `require()` 只在预置表内（脚本 3/3b/4 步，见 `scripts/verify-engine-load.mjs:19-60`）。
5. 装进一次性 profile 并在浏览器里点开设置页：`dsh plugin --profile <p> add file:<tgz>`（隔离安装已在第 4 步之外的 `test:install` 覆盖依赖解析）。**这一步只验证 Host 半加载与页面挂载**。
6. **真实一次对话 + 一次工具调用**（需真实 key）：复用 `scripts/probe-stream.mjs` 的模式另写一个最小脚本；**未验证**，且必须与 5 区分开汇报（AGENTS.md:57-58 要求区分本地检查与 live-provider 验证）。

### 5.3 绑定 commandcode 专有事实的测试（按绑定强度排序）

| 测试文件 | `test()` 数 | 绑定内容（证据） |
| --- | --- | --- |
| `tests/adapter.test.ts` | 279 | `/alpha/` 79 处、`/provider/v1` 75 处、`api.commandcode.ai` 51 处、模型 id 315 处；三协议结算帧 `settlementFrames()`（130-158）；`COMMAND_CODE_CLI_VERSION`/`DEFAULT_API_BASE` 直接 import（28-30） |
| `tests/settings.test.ts` | 108 | 65 处 commandcode、25 处 CC 模型 id、`api.commandcode.ai` 3 处（字段默认值/草稿行为） |
| `tests/accounts.test.ts` | 63 | 37 处 commandcode、18 处模型 id；池轮换/探测语义 |
| `tests/web-search.test.ts` | 32 | 62 处 commandcode、`api.commandcode.ai` 11 处、`/alpha/web-search` 3 处；请求体与选择重写 |
| `tests/usage-wire.test.ts` | 29 | 15 处 commandcode；report/models/prices 三组 schema |
| `tests/login.test.ts` | 29 | 20 处 commandcode、Studio 允许来源、`/alpha/whoami` 2 处 |
| `tests/tui-settings.test.ts` | 28 | 22 处 commandcode；字段集合（apiBase/zdr/lang） |
| `tests/panel.test.ts` | 26 | 7 处 commandcode、`/alpha/` 4 处；5h/周窗口投影 |
| `tests/model-select.test.ts` | 25 | 13 处 CC 模型 id；tier 分组 |
| `tests/analytics.test.ts` | 25 | 3 处 commandcode（provider 过滤） |
| `tests/cost-projection.test.ts` | 15 | 12 处 commandcode、6 处模型 id；按价表算钱 |
| `tests/model-prices.test.ts` | 16 | 10 处模型 id；"每个 catalog 模型都有价"（18-30） |
| `tests/commands.test.ts` | 15 | 27 处 `/alpha/`、5 处 commandcode；用量渲染 |
| `tests/client-boot.test.ts` | 15 | 47 处 commandcode；真实客户端装配 + 插槽 id |
| `tests/gateway-request.test.ts` | 9 | 9 处 `/provider/v1`；请求抓取 |
| `tests/zdr.test.ts` | 2 | 25 个非 ZDR 模型 id 全量钉死（59-…） |
| `tests/price-sync.test.ts` | 12 | 价表同步脚本的解析规则（CC 定价页 flight payload） |
| `tests/npm-pack-json.test.ts` / `tests/package.test.ts` / `tests/package-exports.test.ts` | 6 / 7 / 2 | 包名、两条 RC 兼容记录、发布文件清单 |
| `tests/styles.test.ts` | 6 | 注入样式必须只碰自家选择器或已记录锚点 |

> 合计：44 个测试文件、985 个 `test()` 声明。其中**出现过 commandcode 字样**的测试文件 25 个，合计 **约 830 个 `test()`**（上表逐文件 `test()` 数相加）；真正把 CC 专有事实写成断言的约 15-18 个文件（adapter / settings / accounts / web-search / login / model-prices / zdr / panel / commands / gateway-request / tui-settings / usage-wire / price-sync / package 系列），量级**至少 700 个 `test()`**。改造后这批测试**无法靠改断言存活**，只能重写或删除——这是改造里最容易被低估的工作量。

---

## 6. 上游同步影响（若仍想跟 Mars-Sea 上游）

前提：上游会继续因 CC 的模型/价格/CLI 版本（如 `capabilities.ts`、`model-prices.ts`、`CHANGELOG.md` 308 KB）频繁发版。

| 改造做法 | 对 `git merge upstream/main` 的代价 |
| --- | --- |
| **原地改 `src/adapter.ts` / `capabilities.ts` / `provider-errors.ts`**（本文 4.1 的默认写法） | **最贵**。这三个文件是上游每次发版的主要 diff 面（`capabilities.ts` 头部注释明说"confines those frequent sync diffs here"，1-19），改造后每版必冲突，且冲突块正好是协议分支，人工判断成本最高。 |
| **删文件**（`login*`、`enrollment*`、`panel*`、`model-prices.ts`） | 中等偏贵：`git merge` 对"我方删除 / 上游修改"会报 modify/delete 冲突，需要每次 `git rm` 确认。可接受，但要立规矩：删除清单写进 `docs/`，每次同步按清单批量 `git rm`。 |
| **新增独立目录 `src/opendesign/` + 薄壳 `src/index.ts`**（推荐） | 最便宜：上游文件不动，改造产物全部在新路径；同步时只处理 `src/index.ts`（注册与装配）与 `package.json`/`cordis.patch.yml` 的少量冲突，其余自动合并。代价是短期多写一层适配，且"通用骨架"要**原样复制而非改写**（否则又变成三方冲突）。 |
| **改 `package.json` 的 name/peer/engines** | 低：上游改 peer 范围时（如 `engines.dsh` 从单 RC 扩成析取式，`package.json:25-30`）会冲突，但上下文短、易判。 |
| **改命名空间/id 字符串**（`llm-commandcode`、`commandcode`、`COMMANDCODE_API_KEY`） | 低但**面广**：`grep -rn` 命中 296 处，散布 40 个文件；上游若在这些位置新增代码，会持续产生小冲突。用集中常量（把 4 个身份串收进一个 `src/identity.ts`）能显著降低未来冲突面。 |
| **保留 vendored 价表但换数据源** | 中：`model-prices.ts` 是脚本生成的文件（`sync-model-prices.mjs`），上游每次同步都整文件重写；我方若也生成，等于每次都整文件冲突。**建议改造后直接不跟踪该文件**（`.gitattributes` 的 `merge=ours` 或干脆删除），让价目从服务端来。 |

**结论**：若把改造做成"新增 `src/opendesign/**` + 原样保留通用骨架 + 只改入口与元数据"，上游 merge 的可控冲突面约 **5-8 个文件**；若按 4.1 原地改写，冲突面是 **20+ 个文件、其中 3 个超大文件**，实际上等于放弃上游同步。**这是一个必须由用户拍板的取舍**，本文不给默认值。

---

## 附：不确定 / 未验证项

1. OpenDesign 的端点、鉴权头、目录字段、是否有套餐/价目/登录——**全部未验证**（仓库内无任何 OpenDesign 事实；本节 4.0 已列假设）。
2. 所有耗时数字——**未实跑**（无 `node_modules`），仅为按文件规模与 CI 步骤的估计。
3. `npm test` 的实际 `test()` 计数与 `docs/决策记录.md` 提到的"1027 项"差异——本次 `grep -h "^\s*\(await \)\?\(test\|it\)("` 得 985，**未运行确认**（可能含子测试/动态生成）。
4. `tests/adapter.test.ts` 的 279 个 `test()` 中真正依赖 CC wire 的比例——只做了字符串命中统计（`/alpha/` 79、`/provider/v1` 75），**未逐个判定**。
5. 上游仓库当前是否已有针对 OpenDesign 的分支/issue——**未验证**（未联网查 Mars-Sea 仓库）。

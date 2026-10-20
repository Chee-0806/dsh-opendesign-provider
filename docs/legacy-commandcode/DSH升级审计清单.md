# DSH 升级审计清单

本清单对应 `dsh-v0.2.0-rc.2` → `dsh-v0.2.1-rc.2`（2026-10-17），聚焦视图为 `dsh-v0.2.1-alpha.5` → `dsh-v0.2.1-rc.2`。上游路径均相对[固定目标标签](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2)，结论与验证边界见[对接说明](对接说明.md)。先从完整目录、变更清单与实际导入盘点，再选择阅读；不把关键词检索命中当作全部接口或文档。**本文是当轮审计的历史记录**：其中「声明面收敛为单一 `0.2.1-rc.2`、Cordis／Schemastery 收紧为单分支」的描述已被 2026-10-18 的反转取代（现行口径见[《决策记录》第八章第14条](决策记录.md#八dsh-引擎兼容范围与验证边界)）；破坏点、逐包源码差异与接口结论仍然有效。

## 一、直接依赖与接口范围

1. 下列 20 个 DSH 包（19 个 `@deepseek-ai/dsh-*` 加两个 vendor 包）均已比对完整源码树与两版官方 npm 清单。本轮结论以**源码逐文件 diff** 为准：除 `@deepseek-ai/dsh-web` 外源码零差异，exports 漂移只有「新增 `./locale/*.json`」「删除 `./invariant`」「`typert-protocol` 新增 `./remote-info`」三类，插件都未引用被删项。包内中英文说明按契约相关章节核对，未逐篇全文阅读。逐包证据见 `/tmp/dsh-release-audit-20261017-rc2-full` 与同目录 `host-api.md`、`engine-pack.md`。

| 包名（统一前缀 `@deepseek-ai/`） | 官方目录 | 核对接口 | 本轮源码差异 |
| --- | --- | --- | --- |
| `dsh-api-remotes` | `packages/api/remotes` | 远端贡献与嵌套命名空间 | 仅注释与新增转发条目 |
| `dsh-attachment` | `packages/attachment/attachment` | 图片投影与请求编码 | 无（仅版本串） |
| `dsh-client-locale` | `packages/client/locale` | 客户端语言服务 | 无（仅新增 `locale/` 目录） |
| `dsh-client-ui-primitives` | `packages/client/ui-primitives` | 预置界面组件 | 无 |
| `dsh-client-ui-renderer` | `packages/client/ui-renderer` | 插槽渲染与页面锚点 | `inline` 锚点新增；`div` 默认路径不变 |
| `dsh-client-ui-settings` | `packages/client/ui-settings` | 设置页插槽与配置表单 | 删除 memory 持久化分支；插件未消费 |
| `dsh-client-ui-slots` | `packages/client/ui-slots` | 插槽声明与注册 | `inline?: true` 与 keyed hook 成员新增 |
| `dsh-agent` | `packages/core/agent` | 开发期代理类型与 `agent/request-error` | typert lookup 新增 `resource` |
| `dsh-scope` | `packages/core/scope` | 开发期作用域 | 无（删 `invariant.ts`） |
| `dsh-session` | `packages/core/session` | 会话事件与真实历史验证 | 新增 plugin-record API；事件类型零删除 |
| `dsh-credentials` | `packages/credentials/credentials` | 凭据解析与描述 | 仅注释；远端面同 |
| `dsh-commands` | `packages/interaction/commands` | 命令注册 | 无（删 `invariant.ts`） |
| `dsh-llm` | `packages/llm/llm` | 模型、生成、消息、错误与工具历史 | 新增 `imageRequestTarget` 钩子（插件已实现） |
| `dsh-session-projection` | `packages/session/session-projection` | 会话投影 | disposer 改为可等待 |
| `dsh-settings` | `packages/settings/settings` | 配置表单、易变字段与写入 | 无（仅版本串） |
| `dsh-typert-protocol` | `packages/typert/protocol` | 严格远端描述符 | 新增资源读者与 `./remote-info` |
| `dsh-launch-environment` | `packages/util/launch-environment` | 启动环境 | 无（仅版本串） |
| `dsh-timeout` | `packages/util/timeout` | 超时调用 | `idleWatchdog` 实现变化；插件未使用 |
| `dsh-web` | `packages/web/web` | 可选网页搜索服务 | **破坏性**：选择契约改为易变引用、`config` 必填、私有字段删除 |
| `cordis` | `vendor/cordis` | 注入、生命周期与易变配置 | 无（4.0.4 → 4.0.5 仅版本行） |
| `schemastery` | `vendor/schemastery` | 配置结构与易变标记 | 无（3.18.4 → 3.18.5 仅版本行） |

2. 额外展开 `packages/boot`（准入判定）、`packages/api/gateway`（远端载体与新增的非 owner 访问控制）、`packages/core/tools`（`tools/pre-execute`）、`packages/interaction/user-approval`（`approval/request`）、`packages/client/web`（预置模块表）、`packages/web/web-deepseek-api` 与 `packages/client/ui-deepseek-model-label-1017`（rc.2 首发两包），以及五个既用插槽的声明与渲染目录。具体文件及是否调用见[《对接说明》第三章](对接说明.md#三接口与文档盘点)。插件实际消费范围以其源码与发布产物为准，不宣称审阅了宿主全部接口实现。

3. **vendor 配对**：rc.2 是本批次第一个携带正式版配对的引擎（`cordis 4.0.5`、`schemastery 3.18.5`，两者皆为 npm `latest`；npm 上没有 `dsh-0-2-1-rc-*` 预发布标签）。插件声明随之由双通道时代的析取收紧为单分支 `~4.0.5` / `~3.18.5`，并用 `semver.maxSatisfying` 实测确认新范围命中该配对、且不再放行 `4.0.5-alpha.2` 这类无对应引擎的预发布。

4. **rc.2 首发两包**：`@deepseek-ai/dsh-web-deepseek-api`（宿主包，组合层行 id `web-deepseek-api`，向 `ctx.web` 注册 `deepseek-search-api` 与一个抓取提供方）与 `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017`（客户端包，行 id `ui-deepseek-model-label-1017`，注册 `single`（单占）类插槽 `conversation.input.model.label`）。两者与本插件的行 id、搜索提供方 id 及五个既用插槽均无冲突；后者占用的是单占类插槽，**重复注册会抛错，插件不得占用**。

5. **未逐行审查全部 9058 个变更路径**（另采集 465 路径的 `alpha.5` → `rc.2` 增量作聚焦）。取舍依据是插件实际导入面：`src/` 只引用四个 `/client` 子路径与包根，值导入集合全部落在上表 20 个包内。

## 二、本轮全部变动说明文档

1. 以下为 `0.2.1-alpha.5` → `0.2.1-rc.2` 变更清单中的全部说明类文件，共 **19 组、47 份**。`README.{md,zh.md,i18n.yaml}` 表示对应英文、中文及翻译源三份文件；双语后缀表示两份。所有组已盘点；“差异已读”表示阅读本轮完整变动，不等于整篇全文；本轮只对两组新说明做了全文阅读（见第 2 条）。

| 官方路径 | 阅读状态 |
| --- | --- |
| `.agents/notes/implemented/feature/2026-10-15-deepseek-search-fetch-api.{md,zh.md,i18n.yaml}` | **新增**；英文全文已读（84 行），中文镜像未读 |
| `.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.{md,zh.md,i18n.yaml}` | 差异已读（网页能力缝决策，选择权归属声明） |
| `docs/persistence-changes/2026-10-13-deepseek-search-thinking.{md,zh.md,i18n.yaml}` | **新增**；英文全文已读（48 行），中文镜像未读（另有配套 `.schema.json`，非说明文档） |
| `docs/persistence-changes/historical-formats/README.{md,zh.md,i18n.yaml}` | 差异已读 |
| `docs/subsystems/web.{md,zh.md,i18n.yaml}` | 差异已读 |
| `docs/capability-seams.{md,zh.md,i18n.yaml}` | 差异已读 |
| `docs/config-catalog.{md,zh.md}` | 生成物目录；已登记，未逐篇通读 |
| `docs/module-graph.{md,zh.md}` | 生成物目录；已登记，未逐篇通读 |
| `docs/persistence-catalog.{md,zh.md,i18n.yaml}` | 生成物目录；已登记，未逐篇通读 |
| `packages/client/README.{md,zh.md,i18n.yaml}` | 已扫标题与差异；未全文 |
| `packages/client/ui-deepseek-model-label-1017/README.{md,zh.md,i18n.yaml}` | **新增包说明**；已扫标题与插槽声明差异 |
| `packages/client/ui-settings-web-search/README.{md,zh.md,i18n.yaml}` | 差异已读（官方网页搜索设置卡片，与插件开关同字段） |
| `packages/web/README.{md,zh.md,i18n.yaml}` | 已扫标题与差异；未全文 |
| `packages/web/web-deepseek-api/README.{md,zh.md,i18n.yaml}` | **新增包说明**；已扫关键配置 `web-deepseek-api.baseURL` 与开关语义 |
| `packages/web/web-search-deepseek/README.{md,zh.md,i18n.yaml}` | 差异已读（Messages 路径保留、`thinking` 字段） |
| `packages/preset/agent-preset/skills/cordis-composition-reference/references/packages.md` | 组合层参考；已登记 |
| `apps/cli/composition.md` | 组合层说明；已登记 |
| `apps/web/tests/expected/plugin-config/web-search.expected.md` | 期望基线（测试资产，非说明文档）；已登记 |
| `apps/web/tests/expected/deepseek-model-label-1017/models.expected.md` | 期望基线（测试资产，非说明文档）；已登记 |

2. 本轮契约结论主要来自源码逐文件 diff（见 `host-api.md`），不依赖上述说明的记述；说明文档用于交叉印证与识别设计意图。两组新增说明提供了两处关键上下文：官方网页搜索设置卡片的「启用新版 Web 搜索 API」开关会**同时写入 `web.searchProvider` 与 `web.fetchProvider`**（提供方 id `deepseek-search-api`／`deepseek-fetch-api`，默认关闭、保存后生效），因此插件与官方卡片是同一 YAML 字段上的两个写者；`web-search-deepseek` 保留 Messages 路径并在该请求体上新增可选 `thinking` 字段（仅日志字段，不重放）。

3. 包说明的英文镜像和翻译源，除明确列出的差异审阅外未逐篇全文阅读。初次生成的临时文档清单漏掉 `.agents/notes/**` 与 `apps/**` 下的非 README 说明，已由全量变更清单补齐；本表按最终 47 份计。

## 三、全部升级主题与修订关系

1. 目标升级目录共 42 个主题，每主题均有 `guide.md`、`guide.zh.md`、`guide.i18n.yaml`，共 126 份。下表完整列出 `docs/upgrade-guide/<版本>/<主题>/` 下的主题，不只列本轮新增部分。

| 版本目录 | 全部主题 | 阅读状态 |
| --- | --- | --- |
| `v0.1.7-rc.2` | `schedule-optional-bundle`、`transcript-view-legacy-normal` | 两份中文标题与迁移条目已扫 |
| `v0.2.0-rc.2` | `account-sign-in-errors`、`bundled-python-tests`、`primary-runtime-python-aliases`、`remove-runtime-invariants`、`schedule-bundle-retired`、`subpath-plugin-display-manifest` | 六份中文标题与迁移条目已扫 |
| `v0.2.1-alpha.1` | `deepseek-model-discovery`、`desktop-test-auth-popup`、`experimental-package-composition`、`instruction-home-override`、`job-id-identity`、`jsonl-persistence-plugin`、`mock-messages-events`、`native-subagent-bundle-tools`、`new-session-generations`、`plugin-option-placement`、`python-optional-resources`、`python-ptc-sandbox`、`session-title-adapters`、`session-title-provider-strategy`、`ssh-helper-launch`、`subagent-activations`、`subagent-preset-composition`、`team-direct-inbox`、`terminal-command-labels`、`tool-presentation-mode`、`web-listener-trust-config`、`working-directory` | 22 份中文标题与迁移条目已扫 |
| `v0.2.1-alpha.2` | `deepseek-account-identity-watch`、`deepseek-account-model-catalog`、`desktop-font-size-shortcuts`、`from-default-profile-replaces-target`、`operator-connect`、`pi-ai-azure-provider`、`pi-ai-model-discovery`、`plugin-install-over-installed`、`sdk-minimal-image-compaction`、`stored-credentials-precedence` | 十份中文标题与迁移条目已扫；身份观察全文已读 |
| `v0.2.1-alpha.3` | `plugin-engines-dsh` | 中文全文已读，核实准入历史约定 |
| `v0.2.1-alpha.4` | `account-notification-fields` | 中文全文与差异已读 |

2. **本轮没有新增升级主题目录。**目标树的 `docs/upgrade-guide/` 最新目录是 `v0.2.1-alpha.4`；`v0.2.1-rc.1` 与 `v0.2.1-rc.2` 目录均不存在，两份 delta（完整与增量）的 `docs/upgrade-guide/**` 变更数均为 0。rc.2 的两项新特性（DeepSeek-V4.1-Flash-1017 适配、DeepSeek Search 与 Fetch API）不以升级主题记录，而落在包说明与上表两组 `.agents/notes/**`／`docs/persistence-changes/**` 新文档中——这也是本清单把“说明文档盘点”与“升级主题盘点”分开维护的原因。

3. 其余中文仅扫描标题及迁移条目，英文和翻译源不宣称全文阅读。完整 delta 相对 `0.2.0-rc.2` 会让 `docs/upgrade-guide/**` 整体显示为新增（基线标签早于这些目录的落库），这不代表本轮新增了主题；判断以 `alpha.5` → `rc.2` 的增量为准。Cordis 相关提案（`vendor/cordis-rc11-upgrade-plan.md`）本轮状态仍是 `proposed`，不能将拟议替代当作已发布行为。

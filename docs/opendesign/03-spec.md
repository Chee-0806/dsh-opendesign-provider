# Spec：Open Design provider（DSH 插件换血）

> 由 `/to-spec` 依据 `docs/opendesign/00-改造设计.md`、`docs/opendesign/01-任务票.md`、`docs/grill/` 四份事实报告与 `docs/adr/0001–0003` 综合而成。
> 状态：待发布到 issue tracker（当前仓库 GitHub issues 已关闭、`ready-for-agent` 标签词表未建立）。

## 问题陈述

我在 DSH 里想用 Open Design 的额度（官方支持用 Open Design API Key 在 Codex、Claude Code、DSH、OpenCode、Hermes 等 agent 里调用三种兼容协议，且与 OpenDesign 应用共享同一份额度）。当前这个仓库名义上是 `dsh-opendesign-provider`，实际是 Command Code 插件（v0.14.4）的完整克隆：它注册的是 `commandcode` 路由、模型目录来自 Command Code 的 `/provider/v1/models`、设置页全是 Command Code 的账号/套餐/ZDR/联网搜索概念、额度面板查的是 Command Code 的账期接口。

早前那版 0.3.x 只是骨架：12 个模型写死在补丁里、没有可写设置页、没有额度、没有工程化门禁，且源码已被覆盖、旧提交不在库中。所以现状是「有两个残缺的东西，没有一个能当 Open Design 的正式 provider」。

对我这个用户来说，具体痛点是：装不上一个能用的 provider；看不到我的 Design Plan 额度还剩多少；不知道哪些模型/思考等级能选；踩到上游怪癖（输出上限不生效、缺 `finish_reason`、glm 拒 `developer` 角色、上游 400 被包成 502）时无从判断；仓库里 985 个测试有 ~700 个绑定 Command Code 事实，改无可改。

## 解决方案

把这个仓库换血成 Open Design 的正式 DSH LLM provider，达到与原 Command Code 插件同等的工程水准：

- 注册自有 provider `open-design` 与自有设置命名空间 `llm-opendesign`，可与已装的 Command Code 插件共存；
- 模型目录以网关实时公布（`/v1/models`）为准，内置 12 模型静态快照作为离线兜底，并按逐模型规则收敛思考等级、输出上限、思考字段与工具调用判定；
- 只实现 Chat Completions 单传输（保留接缝），适配层自己兜住「上游不遵守输出上限」并做客户端硬截断；
- 凭据链：显式 API Key → 凭据引用 → 桌面端/CLI 登录态（`vela login` 落盘的 `~/.amr/config.json`），绝不写该文件；
- 额度：用 CLI 登录态里的控制密钥只读查询控制面，侧栏面板与 `/opendesign` 命令展示套餐档位、5 小时/7 天窗口、钱包余额与「当前走哪份额度」；没有控制密钥时整体降级、不影响推理；
- 删除所有无对等上游的能力：浏览器登录、账号开通、多账户轮换、美元价表/峰谷/会话费用、ZDR、联网搜索、套餐过滤；旧 Command Code 文档归档为历史证据。

分三阶段交付：P0 单传输 + 目录 + 凭据 + 设置页 + 真实 Key 验收；P1 额度面板与命令；P2 模型分析（无金额）与可选 Messages 传输。

## 用户故事

### 安装与共存

1. 作为 DSH 用户，我想用一条 `dsh plugin add` 把 provider 装进任意 profile，以便不用手工拼配置就能用 Open Design 的模型。
2. 作为同时在用 Command Code 的用户，我想两个插件装在同一个 profile 里互不冲突，以便不必二选一。
3. 作为新用户，我想装完并重启应用后在「设置」里看到「Open Design」，以便确认安装生效。
4. 作为用户，我想在 Models 页的 Open Design 卡片上直接看到密钥状态并粘贴 Key，以便不打开二级页面就完成关键配置。
5. 作为用户，我想密钥只以「凭据引用 + 存在性」的形式出现在设置与诊断里，以便截图、分享配置或报障时不泄露密钥。
6. 作为用户，我想安装失败/引擎不兼容时得到明确提示而不是应用起不来，以便快速回退。

### 凭据与端点

7. 作为用户，我想插件自动复用我 `vela login` 的登录态，以便不用再复制一遍 Key。
8. 作为用户，我想显式配置的 Key 优先于 CLI 登录态，以便临时换 Key 或测试别的账号。
9. 作为用户，我想自定义 apiBase，以便接入自建网关或测试环境。
10. 作为用户，当我一个凭据都没有时，我想看到两条明确路径（控制台建 Key / `vela login`），以便不靠猜。
11. 作为用户，我想 Key 无效（401）时看到「去控制台检查或重建 Key」的指引，以便自助解决。
12. 作为用户，我想「有 CLI 登录态但没有控制密钥」这种半配置状态被如实提示，以便知道额度功能为什么不可用。

### 模型目录与选择

13. 作为用户，我想选择器里显示当前 Key 可用的模型与官方显示名，以便一眼认出要用的模型。
14. 作为用户，我想看到每个模型的上下文窗口与输出上限，以便判断能塞多长的输入。
15. 作为用户，我想目录来自网关实时公布，以便服务端上新模型时不用升级插件。
16. 作为用户，我想网关不可达时仍能从内置的 12 个模型里选，以便网络/网关故障时不至于空白。
17. 作为用户，我想知道当前目录是「实时」还是「静态快照」，以便判断看到的模型是否最新。
18. 作为用户，我想服务端出现未校准的新模型时它依然可选（带「未校准」标注），以便不被旧快照挡住。
19. 作为用户，我想按能力档（standard/advanced）与成本档（low/medium/high）看到分组与标签，以便挑模型时有客观依据。
20. 作为用户，我想隐藏不用的模型，以便选择器不被一堆模型淹没。
21. 作为用户，我想覆盖上下文窗口（全局 + 逐模型），以便在业务里控制输入成本。
22. 作为用户，我想设置输出上限，以便给单次回答封顶。

### 思考等级

23. 作为用户，我想给支持的模型选思考等级，以便在回答质量与速度/额度之间取舍。
24. 作为用户，我想 glm 系列只出现 low/high/max，以便不撞 400。
25. 作为用户，我想 kimi 不出现 off 与 max，以便只看到真正可用的档。
26. 作为用户，我想选 off 时思考真的关闭，以便确定没有偷跑 token。
27. 作为用户，我想被告知哪些模型的思考在 Chat 面不可见，以便不误以为模型没思考。

### 对话行为

28. 作为用户，我想流式输出边生成边显示，以便不用等整段。
29. 作为用户，我想思考内容与正文分开呈现，以便知道 token 花在哪里。
30. 作为用户，我想工具调用（bash 等）正常往返，以便 agent 能真的干活。
31. 作为用户，我想 gpt-6-luna 缺 `finish_reason` 时不被判为失败，以便成功的一轮不被假错误打断。
32. 作为用户，我想输出上限被真正执行（包括上游不遵守的 deepseek/glm），以便额度不被单次回答吃穿。
33. 作为用户，我想在 kimi 的 medium/high 档不被「thinking 预算不足」拒掉，以便高档位可用。
34. 作为用户，我想给支持视觉的模型发图片，以便让 agent 看图。
35. 作为用户，我想给不支持 file/audio/video 的模型发这类附件时得到「能力限制」的明确错误，以便区分不是网络问题。
36. 作为用户，我想取消生成时立刻停止且不产生幽灵用量，以便不白扣额度。

### 错误与诊断

37. 作为用户，我想 402 显示「Design Plan 额度用尽，去控制台充值或改 BYOK」，以便知道下一步做什么。
38. 作为用户，我想确定性的 400（如 glm 拒 `developer`、空消息）不被反复重试，以便不浪费时间与额度。
39. 作为用户，我想网关把上游 400 包成 502 时仍能读到真实原因，以便报障说清楚。
40. 作为用户，我想 404 / nginx HTML 错误页不会让插件崩溃，以便网关异常时仍能打开设置页。
41. 作为用户，我想能复制一份「当前生效配置（密钥脱敏）」用于报障，以便对方一眼看到环境。

### 额度

42. 作为用户，我想在侧栏看到套餐档位与 7 天窗口进度，以便知道还剩多少额度。
43. 作为用户，我想看到 5 小时窗口（Go 档才有），以便短周期冲刺时知道上限。
44. 作为用户，我想看到窗口重置时间，以便安排大任务。
45. 作为用户，我想看到钱包余额以及「当前扣 Design Plan 还是钱包」的说明，以便理解计费口径。
46. 作为用户，我想在额度数据过期时看到「已过期」标注，以便不把旧数字当实时。
47. 作为用户，我想在没有控制密钥时面板自动隐藏、推理照常，以便不被永远加载的面板困扰。
48. 作为用户，我想用 `/opendesign` 命令在终端里查额度，以便不开侧栏也能看。
49. 作为用户，我想额度卡默认关闭、可一键开启，以便不强迫所有人看额度。

### 成本表述

50. 作为用户，我不想在 DSH 里看到编造的美元金额，以便不被误导；成本档位标签可以接受。

### 文档、归档与维护

51. 作为开发者，我想旧 Command Code 的专有文档归档保留而不是删空，以便踩坑记录可追溯。
52. 作为开发者，我想身份常量（provider id、命名空间、凭据名、Remote 名、插槽 id）集中在一处，以便以后改名不散落各处。
53. 作为维护者，我想每个改动都有对应测试与可复现验收命令，以便回滚有据、回归可查。
54. 作为用户，我想 README 写清安装、凭据、模型、额度、已知限制与回退步骤，以便不靠猜。
55. 作为维护者，我想升级 DSH 引擎时只改声明与兼容记录，不用改业务逻辑，以便跟进上游。

## 实现决策

### 身份与装配

- 新建一个「身份」模块集中全部身份串：provider id `open-design`、显示名 `Open Design`、设置命名空间 `llm-opendesign`、默认凭据环境变量 `OPEN_DESIGN_API_KEY`、目录缓存路径、Remote 命名空间 `opendesign`、Remote 服务名、设置页/模型卡/额度面板的插槽 id。其余模块只引用该模块，不再写字面量。
- 插件包名改为 `@mars-sea/dsh-opendesign-provider`，版本从 `0.1.0` 重新起算；bundle 补丁只 insert 自己一行（`llm-opendesign`），不改动 profile 的其他路由；保留 DSH 引擎兼容声明（`0.2.0-rc.2 || 0.2.1-rc.2`）与全部 Harness peer 声明。
- Host 半的装配收敛为：注册「可配置 provider」+ 注册 adapter + 设置 describe/mutate 桥 +（P1）命令与额度 Remote 注入；删除登录、账号开通、联网搜索、TUI 的 optional inject。
- 客户端半只注册两个插槽（设置页、Models 页卡片），（P1）再加额度面板的两个插槽；不注册会话费用 dock（无金额可显示）。

### 传输适配（P0，单传输）

- 只实现 OpenAI Chat Completions：`POST {apiBase}/chat/completions`，流式；保留传输接缝以便 P2 增加 Messages，不做 Responses。
- 请求体固定包含：模型 id、消息、工具（OpenAI function 形态）、`stream: true`、`stream_options.include_usage: true`、`max_completion_tokens`、按模型映射后的 `reasoning_effort`。不发 `max_tokens`、不发 `store`、默认不透传 `temperature`、结构化 `supportsDeveloperRole: false`（`developer` 统一降级为 `system`）。
- 输出上限 = `min(DSH 预算, output_budget, 262144)`；适配器在累计输出（含思考 token）达到上限时**主动结束读取**并以 `length` 收尾——因为 deepseek/glm 实测完全不遵守该字段，`max_tokens` 对所有模型都不生效。kimi 例外：`max_completion_tokens` 必须大于该档 thinking 预算（low 8192 / medium 32768），其 maxTokens 抬到 65536。
- 思考等级映射为「逐模型合法域」：9 个全档模型支持 off/minimal/low/medium/high/xhigh/max 且 `off` 发字面量 `none`；glm 仅 low/high/max；kimi 无 off/无 max。非法档在请求前收敛，选择器只列合法档；glm 的 off 请求收敛为 low 并在界面标注「该模型不支持关闭思考」。
- 流解析：正文读 `delta.content`；思考读 `delta.reasoning` 与 `reasoning_details`（**不是** `reasoning_content`），容忍首帧空串；工具调用按 index 累积 `id/name/arguments`；`finish_reason` 可缺省，缺省时按「有工具调用 → tool_use、达上限 → length、否则 stop」推断；`choices` 为空的尾帧若带 usage 必须计入（`prompt_tokens_details.cached_tokens`、`completion_tokens_details.reasoning_tokens`）；`[DONE]` 为终止标记。
- 错误分类按三态形状解析（JSON `{error:{code,message,type}}` / Go 纯文本 404 / nginx HTML 404），映射为：`AUTH`（401/403）、`QUOTA_EXHAUSTED`（402）、`BAD_REQUEST`（400 中确定性原因：`Incorrect role information`、`Empty input messages` 等；实现里的命名取代早期草稿的 `DETERMINISTIC_BAD_REQUEST`）、`PROTOCOL_ERROR`（404 纯文本/HTML、非 SSE 200、空响应体）、`TRANSIENT`（读不出确定性原因的 5xx）、`TRANSPORT`（连接层失败，独立重试预算）、`RATE_LIMIT`（429）、`EMPTY_RESPONSE`（200 空流，可重试）、`TIMEOUT`（首字节或流空闲超时）。确定性错误不重试；502 包 400 时先解析真因再决定是否重试；404 带 JSON `model_not_found` 归 `BAD_REQUEST`（模型 id 错，不是路径错）。
- 图片：目录声明 `image` 模态才允许；沿用通用请求图片目标（长边 1568 / 编码 1 MiB）与视觉 token 估算；`file`/`audio`/`video` 一律 `UNSUPPORTED_CONTENT` 并说明能力限制。视觉 token 按模型家族估算，裸 id 走 `generic` 保守规则（不猜厂商）。

### 目录、快照与逐模型规则

- 目录请求 `GET {apiBase}/models`，Bearer 鉴权，超时 10 秒；解析 `id/enabled/default`、`architecture.input_modalities`、`metadata.context_limit/context_budget/output_budget/cost/capability`。
- 上下文窗口取 `context_limit`（2026-10-21 实测修正；原写 `context_budget`，但网关只执行 `context_limit` 且它含输出，
  见 `docs/grill/20261020-opendesign-facts-local.md` §5.3），缺失回落 128000；输出上限取 `output_budget`，缺失 32768；kimi 特例 65536。
- 目录缓存与 `apiBase` 绑定、带版本号；TTL 5 分钟、失败重试 TTL 10 秒；缓存不可用或网关失败时回落内置 12 模型静态快照，并在目录里标记来源（实时 / 静态）。
- 静态快照包含：id、官方显示名、上下文窗口、输出上限、成本档、能力档、输入模态、思考域；网关出现快照外的新模型时按「未校准」处理（标题化显示名、全档思考、无图片能力、可见但带标注）。
- 排序：`default` 置顶，其余能力档 advanced 优先、成本档 low 优先、再按 id 字母序。显示名不带 provider 后缀。
- 逐模型规则集中在一个「兼容规则」模块：思考域收敛、`off→none`、kimi 预算门限、输出上限字段选择与硬截断开关、`finish_reason` 缺省推断、`developer` 降级、思考可见性（gpt-6-luna 与 claude-haiku-5.5 在 Chat 面不吐思考）。

### 凭据与配置

- 凭据链（只读）：配置里的字面量密钥 → 配置的凭据引用（默认 `OPEN_DESIGN_API_KEY`）→ CLI 登录态的运行时密钥（仅在未显式配置密钥时）。
- baseURL 推导：显式 `apiBase` → 若密钥来自 CLI 登录态则用登录态里的模型面地址（动态，不假定固定域名；实测 `linkUrl` 是主机名，裸源站补 `/v1`）→ 默认 `https://amr-link.open-design.ai/v1`。
- 控制密钥只从 CLI 登录态取，且只用于额度查询；插件绝不写该文件、不复用登录态做其他请求。
- Host 配置保留：`apiKeyEnv`、`apiKey`（secret 角色）、`apiBase`、`modelsCachePath`、请求超时、流空闲超时、传输重试、可见模型、模型可见性、上下文窗口与覆盖、输出上限、语言；（P1）额度卡开关与登录态文件路径。删除：账号列表、活动账号、凭据清理引用、开通任务、账号规则、ZDR、联网搜索、套餐过滤。
- 无凭据、401、402 三类错误各有固定文案与下一步动作指引；诊断只输出引用名与存在性，不出密钥。

### 额度（P1）

- 控制面客户端只读三个接口：当前工作区、账单摘要、按模型的额度预检；Bearer 控制密钥；超时 8 秒；60 秒缓存；失败保留上次值并标注过期。Node 原生 fetch 可过 Cloudflare，不使用其他 HTTP 客户端。
- 对外契约（Remote `opendesign/usage`）的额度快照形状（决策关键，冻结如下）：

```ts
type QuotaSnapshot = {
  controlPlaneAvailable: boolean
  tier?: string                 // go | plus | pro | max | …
  subscriptionStatus?: string
  currentPeriodEnd?: string
  balanceUsd?: number
  funding?: 'wallet' | 'coding_plan'
  windows: Array<{
    kind: 'five_hour' | 'seven_day' | 'other'
    durationSeconds: number
    usedCredits: number
    limitCredits: number
    remainingCredits: number
    resetsAt?: string
    resetMode?: string
  }>
  fetchedAt: string
  stale?: boolean
}
```

- 窗口按 `durationSeconds` 分类（18000 = 5 小时、604800 = 7 天），未知时长原样列出；credits 与美元按 `creditsPerUsd` 换算仅用于展示额度当量。
- 面板：侧栏卡默认关闭（开关开启后渲染），显示档位与 7 天窗口进度（Go 档额外显示 5 小时窗口）；点击进入中间栏仪表盘，含两窗口进度、重置时间、钱包余额、订阅周期与口径说明；无控制密钥 → 不渲染并给出原因；`eligible=false` → 显示钱包计费说明。
- `/opendesign` 命令输出文本看板（TUI 安全），数据源与面板一致。

### 设置页与客户端

- 四个分区：连接（密钥、apiBase、登录态状态与「使用登录态」）、模型与上下文（可见模型、上下文覆盖、输出上限）、显示（语言、额度卡开关）、高级（超时、重试、缓存路径、诊断复制）。
- 写入沿用既有「设置写入过程」语义：草稿 → 整批变更 + 版本栅栏 → 凭据单独确认；冲突保留草稿；只允许写本命名空间与自己的凭据引用。
- 文案与术语按 `GLOSSARY.md` 第七节；中英双语文案全量重写，禁止残留 Command Code 字样。

### 文档与历史

- 旧 Command Code 专有文档与上游同步技能迁入归档目录，不参与构建；新 README 重写；三份 ADR 记录「单传输」「不显示金额」「读取 CLI 登录态」三个不可从代码反推的取舍。

## 测试决策

### 好测试的标准

- 只测外部行为：对网络边界断言「发出的请求体」「接收事件后对外产出的事件序列与终态」；对装配边界断言「注册了哪些 provider/插槽/Remote」；对设置边界断言「发出的 mutate 操作与 revision」。不断言内部函数、私有字段或实现顺序。
- 单测不联网；真实 Key 验证单独成脚本、单独汇报（区分本地检查与 live 验证）。
- 夹具来自真实响应（脱敏后固化）：目录响应、SSE 帧序列（含 `reasoning`、尾帧 usage、缺 `finish_reason`、tool_calls 片段）、控制面三个接口的响应。
- 每条已知怪癖至少一个正例 + 一个负例（例如：kimi 认 `max_completion_tokens` vs deepseek 不认 → 硬截断兜底）。

### 测试接缝（4 条，已对齐：全部复用既有接缝，仅第 4 条新增「装进 profile 后冒烟」语义）

1. **HTTP 边界（主力缝）**：以 stub `fetch` 驱动目录解析、请求体构造、流解析、错误分类、硬截断、额度查询。既有先例：适配器测试用预置结算帧驱动、命令测试用 stub fetch 不联网。
2. **插件装配缝**：以假 `ctx` 驱动 Host `apply()`，断言 provider/adapter/设置桥/（P1）命令与 Remote 的注册结果、以及删除后的 optional inject 不再出现。既有先例：引擎加载脚本用真实引擎校验发布面。
3. **设置写入缝**：以假 `remote.settings` 驱动设置页控制器，断言 describe→草稿→mutate 链路、冲突保留、凭据写入只在指定引用上发生。既有先例：设置作用域测试用会抛错的假 remote 保证只能走 inject。
4. **真实 Key 验收缝（不进单测）**：`scripts/verify-live.mjs`（`npm run test:live`）逐项打印 PASS/FAIL/SKIP，覆盖目录、多模型、思考等级、工具调用、输出上限、错误分类、图片（第 8、9 条为 SKIP，留给人工/维护者）；与单测分开汇报。安装后再做一次「装进 profile + 客户端冒烟」。

### 各模块测试

- 目录与快照：真实夹具解析、字段映射、缓存来源标记、断网回落、未知模型标注。
- 兼容规则：12 模型 × 7 档映射表、kimi 预算门限、`off→none`、思考可见性、`finish_reason` 推断。
- 适配器：请求体形状、流事件序列、工具调用装配、尾帧 usage、硬截断终态、错误三态分类、图片与不支持内容。
- 凭据：三级链优先级、baseURL 推导、缺文件/坏 JSON、无控制密钥降级、诊断脱敏。
- Host 装配：注册结果、配置 schema 的 secret 角色与脱敏、删除项不可再写。
- 设置页与模型卡：字段校验、草稿与保存、冲突、插槽渲染条件、样式只碰自家选择器。
- 额度（P1）：控制面响应解析、窗口分类、credits→USD、缓存与过期标注、缺控制密钥降级。
- 命令（P1）：注册、三态输出、TUI 安全文本。

### 既有测试的处置

- 删除约 18 个绑定 Command Code 事实的测试文件（协议/登录/账号池/价表/额度/联网搜索/分析金额等），其覆盖的行为按本 spec 重写最小集。
- 保留并只做包名/字段级小改：通用工具类测试（上下文窗口、输出预算、图片 token、可见性规则、重试预算、流 trace、设置作用域、快照 store、样式审计、包元数据、打包体积与导出）。
- 门禁固定：类型检查 → 全量单测 → 构建并校验产物零差异 → 真实引擎加载 → 打包导出 → 隔离安装；（P0 另加）live 脚本九条验收。

## 范围外

- TUI 设置页（本轮不做；字段设计已记录，需要时按新 schema 重写）。
- 发布 npm、创建 GitHub Release、推送远端（本轮只本地分支与本地 tag）。
- Anthropic Messages 与 OpenAI Responses 传输（Messages 列为 P2 可选票，Responses 原则上不做）。
- 模型分析页（P2 重写为无金额版）、会话费用显示、任何美元金额。
- 设备码登录（`vela login` 同流程）、多账户轮换、BYOK 配置界面。
- 联网搜索、ZDR 承诺、套餐过滤、峰谷计价、模型价格表同步脚本。
- 与 Command Code 上游保持可合并（已决定放弃上游同步，历史留在 git）。
- 卸载/迁移用户已有的 Command Code 插件（两插件共存即可）。

## 补充说明

- 事实基线：模型面/控制面端点与鉴权、三协议并列、12 模型目录与逐模型怪癖、控制面额度响应，全部有实测记录，见 `docs/grill/` 四份报告；设计取舍与逐票拆解见 `docs/opendesign/`。
- 已知未验证项（实现时按「先实测再定」处理）：429/`Retry-After` 形状、`temperature` 行为、Messages 面 tool_use 与图片。图片输入已实测可用（16x16 PNG 被正确描述），不再列为未验证项。
- 版本与仓库状态：归档 tag `commandcode-v0.14.4`、工作分支 `feat/opendesign`，未推送；设计件已提交；`lib/` 已按新源码重建并随 ticket 09 提交（`.map` 不提交、不进 tarball），`git diff --exit-code -- lib/` 为门禁。
- 交付节奏：P0 验收后立即进 P1（额度是本次的核心诉求）；P2 按需排期。
- 发布状态：已发布到本地 markdown tracker，`Status: ready-for-agent`，位置 `.scratch/opendesign-provider/spec.md`（`.scratch/` 不入库，避免内部 spec 在 PUBLIC 仓库外泄）；实施票在开工时按 tracker 约定逐票拆到 `.scratch/opendesign-provider/issues/NN-*.md`。

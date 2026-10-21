# OpenDesign（Open Design）官方 API 事实核查（Web 调研）

- 调研时间：2026-10-20
- 目的：为 `dsh-opendesign-provider` 的 provider 改造提供可引用的上游事实
- 方法：仅使用 `web_search` / `web_fetch`（含 `r.jina.ai` 只读渲染与 GitHub Raw/API），未改动仓库代码
- 证据分级：
  - **A 官方文档/官网**：open-design.ai 的页面、`llms.txt`、`pricing.md`、`model-credits`、`privacy`、`terms`
  - **B 官方仓库源码/文档**：`github.com/nexu-io/open-design` 的 README 与 `apps/daemon` 源码
  - **C 第三方公开实现**：`pi-opendesign-bridge`、`opendesign2api`（非官方，但公开可复核）
  - **D 本次实测**：不带凭据的 GET 探测（只能证明路由存在与错误形态）
  - **E 本仓库既有本地实测**：`docs/grill/20261020-opendesign-facts-local.md`（带 Key 的真实调用记录，仅作互证）
- 重要前提：**OpenDesign 的 API Reference 不在公网**。`https://open-design.ai/cloud/docs` 是公开页但只有产品定位；
  `/cloud/docs/api`、`/cloud/docs/quickstart`、`/cloud/docs/models` 等子页一律要求登录
  （抓取均落到 `Email sign in`）。因此下文把「官方明确写了」与「第三方/实测推断」严格分开。

---

## 1. 官方站点与文档入口

| 用途 | URL | 证据 |
|---|---|---|
| 官网（canonical） | https://open-design.ai/ | A |
| 官方源码 | https://github.com/nexu-io/open-design | A/B |
| 机器可读入口清单 | https://open-design.ai/llms.txt | A |
| 定价页 | https://open-design.ai/pricing/ | A |
| 机器可读定价 | https://open-design.ai/pricing.md | A |
| 额度语义（最关键的一页） | https://open-design.ai/model-credits/ | A |
| Cloud 公开文档入口 | https://open-design.ai/cloud/docs | A |
| Cloud 控制台 | https://open-design.ai/cloud/dashboard | A |
| API Key 管理页 | https://open-design.ai/cloud/api-keys | A |
| 隐私政策 | https://open-design.ai/privacy/ | A |
| 服务条款 | https://open-design.ai/terms/ | A |

事实：

1. `llms.txt` 明确：**OpenDesign / Open Design / open-design / opendesign / OD 是同一个项目**，
   官网 `https://open-design.ai/`，源码 `github.com/nexu-io/open-design`。
   同时提醒不要引用第三方 "OpenDesigner" 镜像站（如 `opendesigner.io`）。
2. 没有 `docs.open-design.ai`（域名不解析）；`open-design.ai/docs/` 返回 404。
   真正的文档入口是 `open-design.ai/cloud/docs`（公开但极薄）和登录后的 Cloud 控制台。
3. `open-design.ai/cloud/docs` 公开部分只有四句产品定位：真实 token 计费、低价、官方产品、一把 Key 调多模型。
   **公开站没有任何 endpoint、header、参数级 API Reference。**
4. 云服务主体：**Powerformer, Inc.**（隐私政策/条款署名）。

> 结论：**找到了官方站点与官方文档入口，但没有找到公开的完整 API Reference**；
> 端点与字段级事实只能靠官方仓库源码、第三方实现和实测补齐。

---

## 2. API base URL 与三种协议的端点

### 2.1 两个平面，别混

| 平面 | Base | 用途 | 证据 |
|---|---|---|---|
| 模型面（Link / gateway） | `https://amr-link.open-design.ai/v1` | 真正跑推理：models / chat / responses / messages | C，D，E |
| 控制面（AMR API） | `https://amr-api.open-design.ai/api/v1` | 登录、设备码、套餐、钱包、计量、分析 | B，C，D |
| 控制台/网页 | `https://open-design.ai/cloud/*` | 注册登录、API Key、账单 | A |

- 模型面 base 的直接出处：`pi-opendesign-bridge` README 开头
  “OpenDesign is a gateway at `https://amr-link.open-design.ai/v1`”，
  源码常量 `OPENDESIGN_BASE_URL = "https://amr-link.open-design.ai/v1"`
  （https://github.com/Lokeraar/pi-opendesign-bridge ，文件 `opendesign-live.ts`）。
- 控制面主机出处：官方仓库 `apps/daemon/src/integrations/vela.ts` 中
  `AMR_ANALYTICS_EVENTS_URL = 'https://amr-api.open-design.ai/api/v1/analytics/events'`
  （https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/integrations/vela.ts ）；
  设备码路径见官方 issue 里的 `POST https://amr-api.open-design.ai/api/v1/cli/device-authorizations`
  （https://github.com/nexu-io/open-design/issues/3726 ）。
- 控制面不是给推理用的：`sk-amr-…`/`sk-…` 这类模型 Key 打控制面会 401；
  控制面要 `vela_ctrl_…` 形态的 control key（C/E）。

### 2.2 端点清单（含证据强度）

| 协议 | 方法+路径 | 状态 | 证据 |
|---|---|---|---|
| OpenAI Chat Completions | `POST https://amr-link.open-design.ai/v1/chat/completions` | **确认可用**（200、SSE、工具调用均有实测） | C（pi bridge / opendesign2api）、E |
| OpenAI Responses | `POST https://amr-link.open-design.ai/v1/responses` | **确认可用**（返回 `reasoning` + `message` 输出项） | 官方声明支持（A）+ E 实测 200 |
| Anthropic Messages | `POST https://amr-link.open-design.ai/v1/messages` | **官方声明支持，路由存在，但没有公开的调用样例** | A（协议支持）+ D（路由存在） |
| 模型清单 | `GET https://amr-link.open-design.ai/v1/models` | **确认可用** | C、D（未鉴权 401）、E（200，12 条） |
| 其他常见管理端点 | `/v1/me`、`/v1/usage`、`/v1/account`、`/v1/key`、`/v1/balance` | **全部 404** | E（模型面）；D 侧未鉴权为 404 page not found |

关于 `/v1/messages` 的判定依据（D）：

- `GET https://amr-link.open-design.ai/v1/messages` → 返回空 body、`unsupported content type`（疑似 405，路由存在但方法不允许）；
- `GET https://amr-link.open-design.ai/v1/messages/`（带尾斜杠）→ `404 page not found`；
- 对照 `GET /v1/nonexistent-xyz` → `404 page not found`（有 body）。
- 因此「`/v1/messages` 路由存在」是实测结论；但**是否接受 Anthropic 的 `x-api-key` + `anthropic-version`、
  `system` 顶层字段、`tool_use/tool_result` 块，均无公开资料**。
  官方只在 model-credits 写了 “The API supports OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages.”

> 给 DSH 插件的最小结论：**OpenAI Chat Completions 走 `https://amr-link.open-design.ai/v1` 是安全选择**；
> Responses 可用；Anthropic Messages 若要接，必须自己拿 Key 做一次真实 `POST /v1/messages` 验证后再上线。

---

## 3. 鉴权方式与 API Key

### 3.1 模型面

- Header：`Authorization: Bearer <Open Design API Key>`（C：pi bridge 的 `fetch` 只用这一种；
  E：真实调用同样只用 Bearer）。
- 未带 Key 的官方错误体（D，实测）：
  ```json
  {"error":{"code":"missing_api_key","message":"[code=missing_api_key] missing or invalid authorization header","type":"missing_api_key"}}
  ```
- Key 形态：第三方实现按 `sk-…` 记录（C：pi bridge `{"opendesign": {"key": "sk-…"}}`）；
  本机旧插件记录过 `sk-amr-…`（E）。**官方没有公开 Key 前缀规范。**
- 是否接受 `x-api-key`（Anthropic 风格）：**未找到公开资料**，未验证。

### 3.2 API Key 的获取/管理

- 官方明确位置：`https://open-design.ai/cloud/api-keys`（model-credits 页 “Manage API keys ↗” 指向此处），
  需要先登录 Cloud（邮箱+密码；第三方登录也可能，见隐私政策提到的 Google/GitHub 登录）。
- API Key 与 BYOK 是两件事（A，model-credits 原文）：
  - **Open Design API Key**：消耗 OpenDesign 的 credits；
  - **BYOK**：用你自己的模型厂商 Key，费用与额度归厂商。
- 所有付费档都含 “OpenDesign API access”（A，pricing 每张卡都有该条）；Free 不含模型 credits，但仍支持 BYOK。

### 3.3 CLI 登录（设备码，不是 OAuth）

- 官方 CLI 是 `vela`（随桌面端打包，`.../Open Design.app/Contents/Resources/open-design/bin/vela`）。
- 流程（B/C/E 互证）：
  1. `vela login` → `POST /api/v1/cli/device-authorizations`（body 含 `cliVersion`、`host`、`profile:"prod"`）；
  2. CLI 打印 `Open this URL to continue:` + 激活 URL + `Code:`，并尝试打开浏览器；
  3. 轮询 `POST /api/v1/cli/device-authorizations/{deviceId}/token`（body `{deviceSecret}`）拿 `controlKey` + `runtimeKey`；
  4. 凭据落到 `~/.amr/config.json` 的 `profiles.prod`：`runtimeKey`、`controlKey`、`apiUrl`、`linkUrl`、`user`。
- 隐私政策（A）写明 “CLI device authorization within 15 minutes”，即设备码 15 分钟有效。
- `runtimeKey` + `linkUrl` 就是模型面凭据；`linkUrl` 由服务端下发（不是写死常量），
  所以**桌面端并不需要知道 `amr-link` 这个主机名**——这是它与「API Key 直连」路径的关键差别（B/C/E）。

> 对插件的含义：如果只支持用户在控制台创建的 API Key，用固定 base `https://amr-link.open-design.ai/v1` 即可；
> 若要复用桌面端登录态，读 `~/.amr/config.json` 的 `profiles.<profile>.runtimeKey` / `linkUrl`，
> 不要假设 `linkUrl` 等于固定域名。

---

## 4. 模型清单接口与 Design Plan / 套餐模型的区分

### 4.1 `GET /v1/models` 存在，且是 OpenAI 风格

- 返回 `data[]`，每条大致：
  ```json
  {
    "id": "deepseek-v4.1-flash",
    "object": "model",
    "owned_by": "vela",
    "created": 1234567890,
    "enabled": true,
    "default": true,
    "architecture": {
      "input_modalities": ["text", "image"],
      "output_modalities": ["text"]
    },
    "metadata": {
      "context_limit": 1048000,
      "context_budget": 328000,
      "output_budget": 128000,
      "cost": "low",
      "capability": "advanced"
    }
  }
  ```
  字段来源：
  - `id / enabled / created / default / architecture.*_modalities / metadata.context_limit /
    metadata.context_budget / metadata.output_budget`：C 的解析器逐字段读取
    （pi bridge `fetchLiveListing`）；
  - `metadata.cost ∈ {low, medium, high}`、`metadata.capability ∈ {standard, advanced}`、
    `owned_by: "vela"`：E 的 12 条真实响应；
  - ~~`context_budget` 是"输入预算"，`output_budget` 是"回答上限"，二者都小于 `context_limit` —— 这点很重要，
    不要把 `context_limit` 当可用上下文。~~
    **⚠️ 2026-10-21 实测推翻本条**：这是从字段名推断的，不是实测。真实情况是网关**只执行
    `context_limit`**，`context_budget` 只是产品侧建议预算（占 limit 的 22%~38%），发超过它 4 倍的
    prompt 依然 200 且完整召回。`context_limit` 才是「输入 + 输出合计」的硬上限，正好是宿主
    `LlmModelContext.contextWindow` 的语义。证据与探针见 `20261020-opendesign-facts-local.md` §5.3。
- 未鉴权时 `GET /v1/models` 返回 401（D），错误体见 §3.1。
- **列表是按 Key/账号可见范围裁剪的**（C 明确写 “the endpoint scopes the catalog per key”；E 用 Go 档 Key 实测 12 条）。

### 4.2 Design Plan 模型 vs 套餐模型（Plan models）

官方口径（A，model-credits）：

- OpenDesign 有两类模型组：
  1. **Design Plan models**：共享同一个 Design Plan 额度；
  2. **Plan models**（“the other model group”）：直接消耗 plan model credits。
- 官方当前 Design Plan 模型清单（12 个，按显示名）：
  Claude Haiku 5.5、GPT-6 Luna、DeepSeek V4.1 Flash、GLM-5.3 Flash-X、MiMo V2.6 Flash、MiMo V2.6 Pro、
  Hunyuan H4 Preview、DeepSeek V4 Flash、DeepSeek V4 Flash Vision Exp、DeepSeek V4 Pro、GLM-5.3 Flash、Kimi K2.7 Code。
- 官方明确 “The model list may change as new models are released.”

API 层如何区分：

- **未找到公开资料**说明有模型 id 前缀、独立列表、或 `plan`/`tier` 字段。
- 实测/第三方可见的 `/v1/models` 字段里**没有** plan/group/tier 标记（C 的解析器、E 的 12 条原始字段都没有）。
- 因此工程上最稳的区分方式是：
  1. 以官方 Design Plan 名单（显示名 → 模型 id）做静态白名单；
  2. 其余可见模型视为 plan models；
  3. 不要依赖 id 前缀猜（`claude-*` / `gpt-*` 同时可能出现在两组里，未证实）。
- 另注：`/v1/models` 返回的是**该 Key 当前可用**的模型，因此「不在列表里」比「属于哪一组」更可靠。

### 4.3 已知模型 id（用于 catalog 对照）

第三方 catalog（C）与本地实测（E）共同覆盖的 id：

`claude-haiku-5.5`、`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`deepseek-v4-pro`、
`deepseek-v4.1-flash`、`glm-5.3-flash`、`glm-5.3-flashx`、`gpt-6-luna`、`hy4-preview`、
`kimi-k2.7-code`、`mimo-v2.6-flash`、`mimo-v2.6-pro`。

（C 的表里还有 `gpt-6.1-sol`，但在 E 的 12 条里没有，说明它属于更高档/另一组，进一步支持“按 Key 裁剪”。）

---

## 5. 额度语义：怎么扣、能不能查、有哪些窗口

官方页面：https://open-design.ai/model-credits/ （A，本节未标注的事实全部来自此页）

### 5.1 两套额度

- **Design Plan credits**：所有 Design Plan 模型共享一个池子。
- **Plan model credits**：仅 Plus/Pro/Max 有，按账单周期发放/重置。
- 扣减顺序：
  - Go：只有 Design Plan credits；
  - Plus/Pro/Max：先扣 Design Plan bonus credits，用完后自动改扣 plan model credits；
  - 两者都耗尽 → 请求停止，除非开了 auto-recharge（auto-recharge 是真扣款，与“扣已有额度”不同）。
- **API 与 OpenDesign 应用共享同一份额度与同一套窗口**；外部工具不会额外送额度，也不会重置窗口。

### 5.2 套餐与额度（常规月价，A）

| 套餐 | 月价 | 月度上限 | Plan model credits | Design Plan 7 天上限 | Design Plan 5 小时上限 |
|---|---:|---:|---:|---:|---:|
| Go | $10 | $120 | $0 | $30 | $10 |
| Plus | $20 | $180 | $20 | $40 | 无 |
| Pro | $100 | $480 | $120 | $90 | 无 |
| Max | $200 | $900 | $300 | $150 | 无 |

补充（A）：

- 上表是常规价；官网当前有首月折扣（Go $8、Plus $16、Pro $70、Max $120）与年付折扣。
- `DeepSeek V4.1 Flash` 的 Design Plan 用量是别的模型的 2 倍：
  Go/Plus/Pro/Max 分别最高 $120/$160/$360/$600 每月（是“模型级用量当量”，不是增加共享额度）。
- 7 天窗口对**新订阅**从订阅开始时刻起算，每 7 天重置（例：周三 10:00 订阅 → 下周三 10:00 重置），
  不是自然周/自然月。
- 5 小时窗口**只有 Go 有**；Plus/Pro/Max 只有 7 天窗口。
- Plan model credits 不受 5h/7d 窗口约束，按账单周期发放与重置。
- 未用完的 credits **不结转**；额度耗尽可升级、开 auto top-up、或改用 BYOK。

### 5.3 有没有“月窗口”

- 有“月度上限（Monthly maximum）”这个概念，但它是**账单周期内的总额度**，不是一个滑动的 30 天窗口；
  真正的短周期窗口只有 5 小时与 7 天（A）。
- 所以回答“5 小时/周/月窗口是否存在”：**5 小时（仅 Go）与 7 天存在；月是账单周期额度，不是独立窗口。**

### 5.4 有没有可查询用量的 API

- 官方只给控制台入口：`https://open-design.ai/cloud/dashboard`（“View credits and usage”）（A）。
- 模型面**没有** `/v1/usage`、`/v1/balance`、`/v1/me` 之类端点（E 实测全 404；D 也 404）。
- 控制面有计量/账单数据，但需要 `vela_ctrl_…` 控制键：
  - `GET /api/v1/workspaces/current` → `activeWorkspaceId`、`personalMembershipTier`；
  - `vela billing summary --format json` → `membershipTier`、`balanceUsd`、`totalAvailableCredits`、
    `subscriptionCredits`、`rechargeCredits`、`creditsPerUsd`；
  - `vela billing preflight/funding-check --workspace-id … --model …` → `codingPlan.windows[]`
    （`durationSeconds`、`resetMode: activity_triggered|anchored_recurring`、`usedCredits`、`remainingCredits`、
    `limitCredits`、`windowStart`、`resetsAt`）。
  证据：B（`apps/daemon/src/integrations/vela-billing.ts`、`runtimes/defs/amr.ts`）+ C（第三方控制面包）。
- **没有公开的 HTTP 用量查询 API**；第三方走的是 CLI/控制面内部接口，不属于官方对外契约。

---

## 6. 登录 / 设备码 / OAuth、附加 API、ZDR

### 6.1 登录

- Web 控制台：邮箱 + 密码（抓取 `/cloud/api-keys` 落到登录页，A/D）；
  隐私政策提到可能使用 Google/GitHub 等第三方登录（A）。
- CLI：设备码授权（§3.3），不是 OAuth 授权码流程；设备码 15 分钟有效（A）。
- 模型 API：只有 API Key，**没有 OAuth**（A 的文档只描述 API Key；C/E 的调用也只有 Bearer）。

### 6.2 Web search 之类的附加 API

- **未找到公开资料**。官方公开页只承诺 Chat Completions / Responses / Anthropic Messages 三种模型协议；
  没有搜索、嵌入、图片、音频等独立 API 的公开文档。
- 产品内（桌面端）有联网/工具能力，但那是 agent 侧的工具，不是 OpenDesign 暴露的 API 产品。

### 6.3 ZDR（零数据保留）

- **未找到公开的 ZDR 承诺或开关**。
- 隐私政策（A）只说：
  - 请求内容会传给上游模型/基础设施提供商；
  - OpenDesign “does not intentionally use your request content to train its own models”；
  - 上游处理受各厂商条款与双方协议约束；
  - 账号、计费、API 用量、审计记录可能因法律/税务/安全原因继续保留；
  - 产品分析事件通常保留 90 天。
- 结论：**不要对外宣称 OpenDesign 支持 ZDR**；如业务需要，只能走 BYOK 直连厂商或单独谈企业协议。

---

## 7. 定价、速率限制、流式/工具调用的已知坑

### 7.1 峰谷定价

- **未找到任何峰谷/夜间折扣定价**（中英文搜索均无；pricing 页与 pricing.md 都没有分时价格）。
- 唯一与“峰”相关的是 Max 档权益：**“Peak-time priority compute · lower latency”**（A），
  这是高峰算力优先级，不是价格随峰谷变化。

### 7.2 价格表

- 套餐价与 credits 见 §5.2（A）。
- 模型单价（每百万 token）**官方没有公开**；`/v1/models` 只给 `metadata.cost` 档位词
  （`low/medium/high`），不是美元单价（C/E）。
- 官方计费口径：真实 token 计费（A，cloud docs）。

### 7.3 速率限制

- 官方**没有公布** RPM/TPM/并发数值。
- 服务条款 §8 保留“对账号、API Key、请求速率、余额、模型、端点施加限制”的权利（A）。
- 套餐卡上的 “10/20/30 concurrent tasks” 是 OpenDesign 应用内并发任务数，**不是 API 速率限制**（A）。
- 实测已知的限流/配额信号：额度耗尽返回 **402**（C 记录 “every `/v1/chat` call answers 402”）；
  401/403 为鉴权，429 为限流（C 把它归为“不是模型能力测量”的一类）。

### 7.4 流式与工具调用

- 流式：Chat Completions 支持 SSE（C：opendesign2api 转发 JSON+SSE；E：真实 SSE 调用）。
- 工具调用：E 记录支持 tools / tool_calls；C 的实现也按 OpenAI 工具协议工作。
- 已知坑（按可信度排序）：

| 坑 | 现象 | 证据 |
|---|---|---|
| `developer` role | 部分模型直接 400/422。C 说 11 个模型里 6 个拒绝，建议统一用 `system`；E 实测只有 `glm-5.3-flash` / `glm-5.3-flashx` 报 `Incorrect role information` | C/E（两者不一致，保守做法：统一 `system`） |
| `reasoning_effort` 只认名字 | 数值型 effort 被拒；`none` 只有部分模型接受；GLM 只允许 `low/high/max`，Kimi 不允许 `max` | C/E |
| `finish_reason` 缺失 | `gpt-6-luna` 的流结束不带 `finish_reason`，插件因此设 `supportsFinishReason:false`；但同一份探测的 SSE 正则又扫到过它 | E（自相矛盾，需真实回归确认） |
| `max_tokens` 语义 | 上限受 `output_budget` 与厂商官方上限共同约束；`context_budget` 不是输出上限，拿它当输出上限会在 Claude 家族 400 | C/E |
| 上下文超限报错 | `This request needs about N tokens (messages + tools + max_tokens)`，且 `max_tokens` 不能等于整个窗口（262,144 被拒、261,120 通过） | C |
| Kimi 的 thinking 门限 | `max_completion_tokens` 必须大于该档 `thinking_budget`（low 8192、medium 32768），`max_tokens` 绝对范围 `[1, 262144]` | E |
| 上游 400 被包成 502 | 网关把 provider 的 400 变成 `502 "Inference provider returned HTTP 400"`，只看外层状态会误判 | C |
| 402 配额耗尽 | 所有 chat 调用 402，不是模型坏了 | C/E |
| 模型列表元数据很粗 | 没有 reasoning levels、没有官方输出上限；`/v1/models` 只给 id + 粗元数据 | C |

### 7.5 与 OpenAI/Anthropic 协议的差异

- 官方**没有**兼容性说明文档；唯一官方表述是“支持三种协议”（A）。
- 从实测/第三方看，OpenAI 侧是“高度兼容但非完全等价”：
  - 不支持/不保证 `developer` role；
  - `reasoning_effort` 是枚举名而非数值；
  - `max_tokens` / `max_completion_tokens` 的行为因模型而异（有的真截断，有的忽略）；
  - 错误码会包一层（502 包 400），需要解析 body 里的上游状态。
- Anthropic 侧：官方声称支持 Messages，但**没有公开的 header/字段兼容说明**；
  `/v1/messages` 路由存在（D），实际请求形态需自行验证。

---

## 8. 给 `dsh-opendesign-provider` 的落地建议（基于以上事实）

1. **默认 baseURL**：`https://amr-link.open-design.ai/v1`，协议用 OpenAI Chat Completions。
2. **鉴权**：`Authorization: Bearer <key>`；Key 从 `https://open-design.ai/cloud/api-keys` 获取，
   环境变量建议 `OPEN_DESIGN_API_KEY`（本机既有约定）。
3. **模型目录**：运行时 `GET /v1/models`，用 `id` + `metadata.context_budget`（当上下文）+
   `metadata.output_budget`（当 maxTokens 上限）+ `architecture.*_modalities`；
   不要用 `context_limit` 当上下文，不要把 `metadata.cost` 当美元价格。
4. **兼容开关**：`supportsDeveloperRole: false`；`reasoning_effort` 只发枚举名；
   `max_tokens` 取 `min(output_budget, 厂商上限)`；对 402 给出“额度耗尽/去充值”的明确错误。
5. **Design Plan 判定**：用官方 12 模型白名单，不要猜前缀；列表里没有的模型不要硬编码进 catalog。
6. **Anthropic Messages**：先不接；若要接，用真实 Key 对 `POST /v1/messages` 做一次
   `x-api-key` + `anthropic-version` 的 A/B 验证后再上线。
7. **用量展示**：模型面没有用量 API；DSH 侧成本显示只能留空或标“OpenDesign 侧计费”，
   不要伪造美元单价。
8. **ZDR/合规**：不要承诺 ZDR；如客户要求，走 BYOK 或企业协议。

---

## 9. 明确“未找到公开资料”的项

1. 公开的完整 API Reference（endpoint/参数/错误码表）——只有登录后的控制台可见。
2. `/v1/messages` 的 Anthropic 兼容细节（header、`system`、`tool_use`、`anthropic-version`）。
3. Design Plan 模型与 plan models 在 `/v1/models` 里的机器可读区分字段（前缀/分组/独立列表）。
4. 模型单价（美元/百万 token）与费率表。
5. API 速率限制（RPM/TPM/并发）的具体数值。
6. 用量查询的公开 HTTP API（只有控制台与 CLI/控制面内部接口）。
7. Web search / embedding / 图片 / 音频等附加 API。
8. ZDR（零数据保留）承诺或开关。
9. 峰谷分时定价（不存在；只有 Max 的高峰算力优先级）。
10. 官方对 OpenAI/Anthropic 协议的兼容性差异说明。

---

## 10. 来源清单（可直接复核）

官方（A/B）：

- https://open-design.ai/
- https://open-design.ai/llms.txt
- https://open-design.ai/pricing/
- https://open-design.ai/pricing.md
- https://open-design.ai/model-credits/
- https://open-design.ai/cloud/docs
- https://open-design.ai/cloud/api-keys
- https://open-design.ai/privacy/
- https://open-design.ai/terms/
- https://github.com/nexu-io/open-design
- https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/integrations/vela.ts
- https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/integrations/vela-billing.ts
- https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/runtimes/defs/amr.ts
- https://github.com/nexu-io/open-design/issues/3726

第三方（C）：

- https://github.com/Lokeraar/pi-opendesign-bridge
- https://github.com/Lokeraar/pi-opendesign-bridge/blob/main/opendesign-live.ts
- https://github.com/AstroQore/opendesign2api

本次实测（D）：

- `GET https://amr-link.open-design.ai/v1/models` → 401 `missing_api_key`
- `GET https://amr-api.open-design.ai/api/v1/models` → 401 `{"error":"unauthenticated"}`
- `GET https://amr-link.open-design.ai/v1/messages` → 空 body（路由存在、GET 不允许）
- `GET https://amr-link.open-design.ai/v1/messages/` → 404 `page not found`
- `GET https://amr-link.open-design.ai/v1/responses/` → 404 `page not found`

本仓库既有本地实测（E，仅互证）：

- `docs/grill/20261020-opendesign-facts-local.md`

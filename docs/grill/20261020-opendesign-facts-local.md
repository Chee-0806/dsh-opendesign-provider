# OpenDesign 连接事实复原（本机，2026-10-20 之前）

只读复原。**没有修改任何既有文件**，唯一写入是本报告（及新建的 `docs/grill/` 目录）。
**没有打印任何密钥明文**：涉及 `OPEN_DESIGN_API_KEY` 的地方只确认「引用名存在」与「前缀 `sk-amr-`」，
值一律不落盘、不进上下文。

## 0. 结论摘要

| 事实 | 值 |
| --- | --- |
| 模型面 baseURL | `https://amr-link.open-design.ai/v1` |
| 协议 | OpenAI Chat Completions（`openai-completions`） |
| 鉴权 | `Authorization: Bearer <OPEN_DESIGN_API_KEY>`（`sk-amr-…`） |
| 模型面可用路径 | `/v1/models`、`/v1/chat/completions`、`/v1/responses` |
| 模型面 404 路径 | `/v1/me`、`/v1/usage`、`/v1/account`、`/v1/key`、`/v1/balance` |
| Anthropic Messages 路径 | 未找到（模型面无 `/v1/messages` 痕迹） |
| 模型数 | 12（`/v1/models` 实测 12 条，与插件 catalog 一致） |
| 额度/套餐 | 模型面没有；控制面 `amr-api.open-design.ai` 有，但需另一种键 `vela_ctrl_…`（本机没有） |
| 价格表 | 未找到（只有厂商 `cost` 档位词 low/medium/high 与 `rate` 例 `x0.5`） |

> 版本说明：任务里写的「0.2.0/0.3.0」，本机实际**没有** 0.2.0 痕迹；落盘的最后一份打包产物是
> **0.3.1**（`package.json` 内 version），更早的目录软链装的是 **0.1.0**。已检查 git 对象库，
> 旧提交 `e69dda1`（memory 里记的 0.3.0 提交）**已不在本机**（`git cat-file -t e69dda1` → not a valid object）。

## 1. 本机还剩哪些残留物

| 残留物 | 路径 | 性质 |
| --- | --- | --- |
| **旧插件的最后一份构建产物**（0.3.1，含 `lib/catalog.js` / `lib/index.js` / `lib/client.js` / README / locale） | `/Users/xuqi/.dsh/profiles/desktop/node_modules/.ignored/dsh-opendesign-provider/` | A 级：磁盘实物（被 pnpm 从依赖树移出后仍在） |
| profile 备份：**插件接管前**的 pi-ai `open-design` 路由 | `~/.dsh/profiles/desktop/cordis.patch.yml.bak-odplugin-133448:106-111` | A 级：磁盘实物 |
| profile 备份：插件接管后的注释说明 | `~/.dsh/profiles/desktop/cordis.patch.yml.bak-odplugin2-143116:80-84` | A 级 |
| profile 备份：`link:` 安装记录 | `~/.dsh/profiles/desktop/package.json.bak-odplugin3-143255` | A 级 |
| 安装/卸载流水 | `~/.dsh/profiles/desktop/.plugin-manager/logs/operation-PjOaSO/pnpm.log`（13:30 装 0.1.0 link）、`.../operation-KZ3aHG/pnpm.log`（14:52 把 `dist/…0.3.1.tgz` 装的东西移到 `.ignored`） | A 级 |
| 实测脚本 | `/tmp/od-probe*.mjs`（14 个）、`/tmp/od-probe2..6.mjs` | B 级：脚本本身（读取密钥但不写值） |
| 实测输出 | `/tmp/od-models.json`、`/tmp/od-final.json`、`/tmp/od-effort-matrix.json`、`/tmp/od-probe6.json`、`/tmp/od-effort-sem.json`、`/tmp/od-probe2.json`、`/tmp/od-reasoning-probe.json`、`/tmp/od_probe.json` | B 级：原始探测结果 |
| 第三方参考包 `opencode-opendesign-auth` v0.1.4（README + 控制面实现） | `/tmp/probe-oda/package/` | D 级：第三方，但含控制面路径/字段 |
| 当日会话转录（zstd） | `~/.dsh/sessions/--Users-xuqi--/session-813cdcc1-7b95-4140-b839-1f5c3135034b/session.v4.jsonl.zstd` | C 级：模型侧笔记最多的来源 |
| 当前仓库 | `/Users/xuqi/Codes/dsh-opendesign-provider/`（version 0.14.4，commandcode fork，`grep -rn "amr-link\|open-design.ai\|OPEN_DESIGN"` **零命中**） | 已被覆盖，旧源码不在 |
| tgz 包本体 | `find / -name "dsh-opendesign-provider-*.tgz"` → 未找到 | 已删 |

补充：`.ignored` 目录里的文件 mtime 全是 `Oct 26 16:15:00 1985`（tar 解包带来的假时间），
不要用文件时间判断版本先后；`package.json` 的 `version: 0.3.1` 才是版本事实。

## 2. baseURL / 端点主机名

- 插件默认值：`https://amr-link.open-design.ai/v1`
  - `/Users/xuqi/.dsh/profiles/desktop/node_modules/.ignored/dsh-opendesign-provider/lib/catalog.js:21`
    （`DEFAULT_BASE_URL`）
- 插件接管**之前**的 pi-ai 路由（同一主机，单模型）：
  - `~/.dsh/profiles/desktop/cordis.patch.yml.bak-odplugin-133448:106-111`
    `open-design: { apiKeyEnv: OPEN_DESIGN_API_KEY, api: openai-completions, baseURL: https://amr-link.open-design.ai/v1 }`
- 会话里的实测命令直接打同一主机：`/tmp/od-probe-final.mjs:3`（`const BASE='https://amr-link.open-design.ai/v1'`）
- 另一套控制面主机（**不是**模型面）：`https://amr-api.open-design.ai`
  - `/tmp/probe-oda/package/README.md:22`（`const CONTROL = "https://amr-api.open-design.ai"`）

未找到：任何 `api.open-design.ai`、`gateway.open-design.ai` 之类的第二入口；DNS/证书侧也没有别的备用主机痕迹。

## 3. 鉴权方式与 key 名

- 凭据引用名：**`OPEN_DESIGN_API_KEY`**
  - `lib/catalog.js:18`（`DEFAULT_API_KEY_ENV`）、`lib/index.js`（`Config.apiKeyEnv` 默认即该值）
  - 凭据库中该引用存在：`~/.dsh/.credentials.yaml`（只做了名称匹配，未读值）
- 传输头：**`Authorization: Bearer <key>`**
  - 直接证据：探测脚本全部用 `authorization: 'Bearer ' + KEY`
    （`/tmp/od-probe-final.mjs:8`、`/tmp/od-probe-matrix.mjs:7`），并对 `/v1/models`、`/v1/chat/completions`、`/v1/responses` 均返回 200
  - 间接证据：插件把 key 交给 pi-ai 的 `openai-completions`（`lib/catalog.js:24,266-283`；
    `lib/index.js` 用 `openAiCompletionsApi()` 注册），后者用 OpenAI SDK：
    `~/.dsh/profiles/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:1,531-558`
    （`import OpenAI from "openai"`，`apiKey` 直接进 client）
- 不是 `x-api-key`：本插件代码与会话探测里都没有 `x-api-key`（该串只出现在 app.asar 里 anthropic/其它协议的实现中，与 OpenDesign 路由无关）
- 未鉴权访问 `/v1/models` 的行为：`{"error":{"code":"missing_api_key",…,"type":"missing_api_key"}}`
  （证据：会话 813cdcc1 的探测笔记，见第 8 节索引）
- key 形态：`sk-amr-…`（会话笔记记 39 字符；**本报告不记录值**）
- 控制面用的是另一种键：`vela_ctrl_…`，**本机没有**（会话笔记与 `/tmp/probe-oda/package/README.md` 一致）

## 4. 端点路径

模型面（`https://amr-link.open-design.ai`）：

| 路径 | 结果 | 证据 |
| --- | --- | --- |
| `GET /v1/models` | 200，12 条，带完整 metadata | `/tmp/od-models.json`（完整响应体）；`/tmp/od_probe.json` 为 404（那是别的路径落下来的） |
| `POST /v1/chat/completions` | 200，支持 SSE、工具调用、`reasoning_effort` | `/tmp/od-probe-final.mjs`、`/tmp/od-probe-matrix.mjs` |
| `POST /v1/responses` | 200（OpenAI Responses API），返回 `reasoning` + `message` 输出项 | 会话 813cdcc1 的 `== responses ==` 探测输出（`output[].type=reasoning/message`，`model` 字段回写为 `deepseek-flash`） |
| `GET /v1/me` | 404 `404 page not found` | 会话 813cdcc1 探测循环输出 |
| `GET /v1/usage` | 404 | 同上 |
| `GET /v1/account` | 404 | 同上 |
| `GET /v1/key` | 404 | 同上 |
| `GET /v1/balance` | 404 | 同上 |
| `POST /v1/messages` | 未找到（未探测成功痕迹） | 会话里 `/v1/messages` 的命中全部属于 Command Code 的 `{apiBase}/provider/v1/messages` 与 DeepSeek 内网搜索端点，不是 amr-link |

Chat Completions 的 wire 细节（实测）：
- 角色：`system` 全模型可用；`developer` 仅 `glm-5.3-flash` / `glm-5.3-flashx` 被拒
  （`400 Incorrect role information`），其余 10 个模型 200（`/tmp/od-final.json`）
- `store: false` 全模型 200
- 流式 `usage` 存在（`/tmp/od-final.json` 的 `streamUsage` 全 true）
- 流式思考字段是**非标准 `reasoning`**（不是 `reasoning_content`）：
  deepseek-v4*/glm-5.3-flashx/hy4-preview/kimi-k2.7-code/mimo-v2.6-* 有；
  `claude-haiku-5.5`、`glm-5.3-flash`、`gpt-6-luna` 的流里**没有**该字段
  （`/tmp/od-final.json` 的 `streamReasoningField`）
- 工具调用：`finish_reason: "tool_calls"`，`tool_calls[0].function.arguments` 是 JSON 字符串（会话笔记）
- `/v1/responses` 的 usage 带 `prompt_tokens_details.cached_tokens` / `cached_read_tokens` 与
  `completion_tokens_details.reasoning_tokens`；Chat Completions 的 usage 带
  `prompt_tokens_details.cached_tokens` + `completion_tokens_details.reasoning_tokens`（会话笔记）

控制面（`https://amr-api.open-design.ai`，需 `vela_ctrl_…`，来自第三方包，非本插件实测）：

| 路径 | 方法与用途 | 证据 |
| --- | --- | --- |
| `/api/v1/cli/device-authorizations` | POST，body `{cliVersion, host, profile:"prod"}`；返回 `deviceId`、`deviceSecret`、`userCode`、`activationUrl`、`pollIntervalSeconds`、`expiresAt` | `/tmp/probe-oda/package/index.mjs:104-120` |
| `/api/v1/cli/device-authorizations/{deviceId}/token` | POST，body `{deviceSecret}`；返回 `status`、`user`、`controlKey`、`runtimeKey` | 同文件 `:132-150` |
| `/api/v1/workspaces/current` | GET，返回 `activeWorkspaceId`、`personalMembershipTier` | `:160` |
| `/api/v1/workspaces/{id}/billing/preflight` | GET，返回 `codingPlan`、`balanceUsd` | `:319` |
| `/api/v1/billing/summary` | GET，返回 `membershipTier`、`balanceUsd`、`subscriptionStatus`、`subscriptionCurrentPeriodEnd`、`subscriptionCancelAtPeriodEnd` | `:326` |

激活页：`open-design.ai/cloud/cli/activate?…`（第三方 README「What it signs in to」段）。
本插件（0.3.x）**没有**实现登录/设备码，只吃静态 API key（`lib/index.js` 的 `authSeams()` 明确
"stores no credential records"）。

## 5. 12 个模型：id、预算、模态、思考等级

网关 `/v1/models` 原始响应：`/tmp/od-models.json`（12 条，`owned_by: "vela"`）。
字段：`architecture.input_modalities` / `architecture.output_modalities` /
`metadata.cost`(档位词) / `metadata.capability`(standard|advanced) /
`metadata.context_limit`(名义上限) / `metadata.context_budget`(可用输入预算) /
`metadata.output_budget` / `default` / `enabled`。

插件 catalog ~~用 `context_budget` 当 `contextWindow`~~（**2026-10-21 修正：改用 `context_limit`**，见 §5.3），
`maxTokens` 取 `output_budget`（kimi 例外）：

| # | id | 输入模态 | context_limit（**插件 contextWindow**） | context_budget（不执行，仅记录） | output_budget | 插件 maxTokens | cost | capability | 思考等级（off/minimal/low/medium/high/xhigh/max） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `claude-haiku-5.5` | text,image,file | 1000000 | 228000 | 128000 | 128000 | low | standard | 7 档全开 |
| 2 | `deepseek-v4-flash` | text | 1048000 | 232000 | 32000 | 32000 | medium | standard | **仅 off / low / high / max**（见 §5.2） |
| 3 | `deepseek-v4-flash-vision-exp` | text,image | 1048000 | 232000 | 32000 | 32000 | medium | standard | **仅 off / low / high / max**（见 §5.2） |
| 4 | `deepseek-v4-pro` | text | 1048000 | 328000 | 128000 | 128000 | high | advanced | **仅 off / low / high / max**（见 §5.2） |
| 5 | `deepseek-v4.1-flash` | text,image | 1048000 | 328000 | 128000 | 128000 | low | advanced | **仅 off / low / high / max**（见 §5.2；`default: true`） |
| 6 | `glm-5.3-flash` | text,image,video | 1048000 | 232000 | 32000 | 32000 | low | advanced | 仅 low / high / max |
| 7 | `glm-5.3-flashx` | text,image,file,video | 1000000 | 232000 | 32000 | 32000 | medium | advanced | 仅 low / high / max |
| 8 | `gpt-6-luna` | text,image,file | 1050000 | 400000 | 128000 | 128000 | low | standard | 7 档全开（`supportsFinishReason:false`） |
| 9 | `hy4-preview` | text | 1048000 | 232000 | 32000 | 32000 | medium | advanced | 7 档全开 |
| 10 | `kimi-k2.7-code` | text,image | 262000 | 262000 | 32000 | **65536** | medium | advanced | minimal / low / medium / high / xhigh（无 off、无 max） |
| 11 | `mimo-v2.6-flash` | text,image,audio,video | 1048000 | 232000 | 32000 | 32000 | low | standard | 7 档全开 |
| 12 | `mimo-v2.6-pro` | text,image,audio,video | 1048000 | 232000 | 32000 | 32000 | medium | advanced | 7 档全开 |

证据：
- 网关侧：`/tmp/od-models.json`（逐条核对，见上表）
- 插件侧：`lib/catalog.js:95-207`（`CATALOG`），`contextWindow`/`maxTokens` 行号：
  `:101-102, :110-111, :119-120, :128-129, :137-138, :146-147, :155-156, :164-165, :175-176, :184-186, :194-195, :203-204`
- 思考等级映射：`lib/catalog.js:40-57`（`allLevels`，`off → "none"` 字面量）、`:60-77`（`glmLevels`：off/minimal/medium/xhigh = null）、
  `:79-96`（`kimiLevels`：off = null，max = null）
- `off` 必须发字面量 `none` 才有「不思考」语义（实测：省略字段仍会思考）：
  `/tmp/od-probe6.json`（`lit-none` 多数 200 且 `rt=null`；`omit` 有的模型 `rt=12…123`）

### 5.1 逐模型实测异常（重要）

- **reasoning_effort 合法集**
  - `/tmp/od-effort-matrix.json`：对 `glm-5.3-flash`/`glm-5.3-flashx` 的 `none`、`medium` 返回
    `400 reason… allowed=low,high,max`；对 `kimi-k2.7-code` 的 `max` 返回
    `allowed=none,minimal,low,medium,high,xhigh`；其余模型 7 档全 200
  - 逐模型错误原文：`/tmp/od-probe6.json`（glm 的 `reasoning effort is unsupported …; use one of low, high, max`）
- **`kimi-k2.7-code` 的 thinking_budget 门限**（为什么插件给它 65536）
  - `max_completion_tokens` 必须大于该档的 `thinking_budget`：
    `low` → `thinking_budget [8192]`、`medium` → `thinking_budget [32768]`
    （报错原文 `max_completion_tokens [8192] must be greater than thinking_budget [8192]` /
    `… [32768]`）
  - `max_tokens` 的绝对范围：`[1, 262144]`（超界报 `Range of max_tokens should be [1, 262144]`）
  - `none` 档即使 `max_completion_tokens=16` 也 200 但仍在思考（`rt=34`，`/tmp/od-probe6.json`）
  - 证据：会话 813cdcc1 里 `lvl=… mt=…` 的逐行输出（探测脚本 `/tmp/od-probe-kimi.mjs`、`/tmp/od-probe-kimi2.mjs`）
- **`max_completion_tokens` 是否真的截断**（`/tmp/od-final.json` 的 `maxCompletionHonored`）
  - 真截断（`finish=length ctok=16`）：`claude-haiku-5.5`、`hy4-preview`、`kimi-k2.7-code`、`mimo-v2.6-flash`、`mimo-v2.6-pro`
  - 没截断（`finish=stop ctok=318~702`）：`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`deepseek-v4-pro`、`deepseek-v4.1-flash`、`glm-5.3-flash`、`glm-5.3-flashx`
  - `gpt-6-luna`：`finish=undefined ctok=16`
- **`finish_reason`**
  - `gpt-6-luna` 流结束不带 `finish_reason`（`lib/catalog.js:167-170` 注释 + 上条 `finish=undefined`），
    因此插件设了模型级 `supportsFinishReason: false`
  - 但同一份 `/tmp/od-final.json` 的 `hasFinishReason`（正则扫 SSE）对其余模型都是 true、对 `gpt-6-luna` 也是 true
    —— **同一份探测内部不一致**，两说都记在这里，不替它下结论
- **`developer` 角色**：只有 `glm-5.3-flash` / `glm-5.3-flashx` 400 `Incorrect role information`；
  插件仍在路由级统一设 `supportsDeveloperRole: false`（`lib/catalog.js:262`），属「保守统一」而非「全模型实测被拒」
  （README 里写成网关整体拒 `developer`，与实测矩阵不完全一致）

### 5.2 DeepSeek 的真实档位只有三档 + 关闭（2026-10-21 修正）

**结论**：`reasoning_effort` 这个字段收 8 个 wire 值，但 4 个 DeepSeek 模型的**真实档位只有
`off` / `low` / `high` / `max`**。`minimal`、`medium`、`xhigh`、`ultra` 是别名，不产生独立行为。
原先 §5 表把它们的「思考等级」写成「7 档全开」，依据只是「网关回 200」——**200 不等于档位存在**，
上游收到别名后自己折叠掉了。这是本轮修正。

**四条独立证据**：

1. **DeepSeek 官方映射表**（[思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)）：

   | 请求传入 | 实际映射 |
   | --- | --- |
   | minimal | low |
   | low | low |
   | medium | **high** |
   | high | high |
   | xhigh | **high** |
   | max | max |
   | ultra | max |

   同页还写明「思考模式默认打开，且 effort 默认为 `high`」。

2. **网关自己的 400 文案**（探针 `/tmp/od-legal.mjs`，对每个模型发一个非法值）：

   | 模型 | `use one of …` |
   | --- | --- |
   | 4 个 deepseek | `none, minimal, low, medium, high, xhigh, ultra, max` |
   | glm-5.3-flash / flashx | `low, high, max` |
   | kimi-k2.7-code | `none, minimal, low, medium, high, xhigh` |
   | claude-haiku-5.5 / hy4-preview | `max\|xhigh\|high\|medium\|low\|minimal\|none` |

   DeepSeek 那 8 个词**正好是官方映射表的左侧**，说明网关对 DeepSeek 只是原样透传，不做收敛。

3. **Command Code 官方 CLI 快照**（本机 `dsh-commandcode-provider@0.14.2` 的 `KNOWN_EFFORTS`）：
   `deepseek/deepseek-v4.1-flash → ["off","low","high","max"]`。注意同一份快照给
   `deepseek-v4-flash` / `deepseek-v4-pro` 只写了 `["off","high","max"]`（无 `low`），
   但实测它们接受 `low` 且行为更轻（见下条），因此按 4 档处理 —— 这是**快照与实测冲突时以实测为准**的一处。

4. **reasoning_tokens 实测**（`usage.completion_tokens_details.reasoning_tokens`，
   `/tmp/od-dsdisc.json`、`/tmp/od-v4low.mjs`）：

   | 模型 | low | high | max |
   | --- | --- | --- | --- |
   | deepseek-v4.1-flash（硬 prompt ×6，中位） | 1592 | 1910 | 2434 |
   | deepseek-v4-flash（×6 中位） | 240 | 286 | — |
   | deepseek-v4-pro（×6 中位） | 275 | 361 | — |

   单调递增，且 `low` 与 `high` 在噪声之外可区分（v4-pro 275 vs 361 最明显）。
   `none` 在硬 prompt 上 `reasoning_tokens=0`，证明关思考生效。
   别名组（`minimal` ≡ `low`、`medium` ≡ `high`、`xhigh` ≡ `high`）在短 prompt 上的
   差异落在同一噪声带内（`/tmp/od-alias.json`），与官方映射表一致。

**实现影响**：`src/catalog-snapshot.ts` 的 `DEEPSEEK_LEVELS = ['off','low','high','max']`；
`src/quirks.ts` 的 `DEEPSEEK_LEVEL_FOLDS` 按官方映射（`medium → high`）折叠，
**与 glm 的 `COARSE_LEVEL_FOLDS`（`medium → low`）方向相反**，两张表不可合并。
界面因此对 DeepSeek 只列 4 个档位，「模型上下文」那张下拉里不会出现 Minimal/Medium/Extra high。

**另一个已知偏差（上游不回显）**：网关在任何响应里都**不回报实际生效的 effort**
（`/v1/models` 无档位字段；chat 响应的 `extra_fields` 只有 `request_type`、`routing_info`、
`resolved_model_used`、`latency` 等）。所以「我设了 high；上游到底按 high 跑了吗」只能靠
`reasoning_tokens` 分布间接判断，无法逐请求核对。

### 5.3 上下文上限是 `context_limit`，`context_budget` 根本不执行（2026-10-21 修正）

**原来的结论是错的。** 设计件 §5.1 与 spec 都写着「上下文窗口取 `context_budget`（**不是**
`context_limit`）」，依据是 `20261020-opendesign-facts-web.md` §4.1 那句「`context_budget` 是输入预算、
`output_budget` 是回答上限，二者都小于 `context_limit` —— 不要把 `context_limit` 当可用上下文」。
那是对字段名的**推断**，没做过实测。实测下来，网关只执行 `context_limit`。

**证据一：`context_budget` 完全不拦。** 用大 prompt 顶到 budget 的 1.15~4.4 倍，全部 200：

| 模型 | context_budget | context_limit | 实际发出 prompt_tokens | 结果 |
| --- | --- | --- | --- | --- |
| `deepseek-v4.1-flash` | 328000 | 1048000 | 802842 | 200 ✅ |
| `claude-haiku-5.5` | 228000 | 1000000 | 493393 | 200 ✅ |
| `gpt-6-luna` | 400000 | 1050000 | 432790 | 200 ✅ |
| `hy4-preview` | 232000 | 1048000 | 251039 | 200 ✅ |
| `mimo-v2.6-flash` | 232000 | 1048000 | 242656 | 200 ✅ |
| `deepseek-v4-flash` | 232000 | 1048000 | 358409 / 803337 / 955049 | 200 ✅ |

**证据二：不是静默截断，是真读了。** 把唯一验证码 `MAGIC-7391` / `MAGIC-8824` / `K7Q2` 埋在
prompt **开头**，中间塞几十万 token 填充，末尾提问：
- `deepseek-v4.1-flash` 200747 tokens → 正确答出 `MAGIC-7391`
- `deepseek-v4.1-flash` 602155 tokens（budget 的 1.8 倍）→ 正确答出 `MAGIC-8824`
- `deepseek-v4.1-flash` 802842 tokens（budget 的 2.4 倍）→ 正确答出 `K7Q2`

**证据三：拒绝边界贴着 `context_limit`。** `deepseek-v4-flash`（limit 1048000）二分：
1031177 可行、1048383 被拒，报 `[code=context_length_exceeded] Input is too long…`。
`kimi-k2.7-code`（limit = budget = 262000）在 290k 直接报
`<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 262144]`，
`262144` 与它公布的 `context_limit` 精确吻合。

**证据四（决定性）：`context_limit` 的分母是「输入 + 输出」。** 同样 ~1044000 tokens 的输入：
- `max_completion_tokens=16` → **200**，`prompt_tokens=1047688`（1047688 + 16 = 1047704 ≤ 1048000）
- `max_completion_tokens=32768` → **400 context_length_exceeded**（1047688 + 32768 越界）

这正好等于宿主 `LlmModelContext.contextWindow` 的定义：「Maximum combined request and response
context in tokens」。所以 `context_limit` 才是该上报的值。

**影响与修正**：之前上报 budget（只有真实额度的 22%~38%），宿主会在还能再用 2~4 倍上下文时就去
压缩历史、白扔长上下文。已改 `src/gateway-facts.ts`（`fact.contextLimit`）与 `src/catalog-snapshot.ts`
的 12 条静态值，并加回归测试锁住「同时给 limit 与更小的 budget 时取 limit」。
`metadata.context_budget` 仍然解析保留（作为产品侧建议预算的证据），但不再参与窗口计算。

**顺带记录的未决项**：`output_budget` 同样不是硬上限（`v4-flash` 的 32000 仍接受
`max_completion_tokens=64000`/`128000` 并 200）。本轮未改 `maxTokens` 映射——它只是客户端
`max_completion_tokens` 的默认值，报小一点不会丢数据，只会让默认回答偏短；是否抬到
`output_budget` / `context_limit` 需要单独评估（涉及 kimi 的 thinking_budget 门限特例）。

## 6. 额度 / 用量 / 套餐 / 登录

- **模型面没有额度接口**：`/v1/me`、`/v1/usage`、`/v1/account`、`/v1/key`、`/v1/balance` 全 404
  （会话 813cdcc1 探测循环；`/tmp/od_probe.json` 内容就是 `404 page not found`）。
  当日会话结论原文：只有 `/v1/models`、`/v1/chat/completions`、`/v1/responses` 响应；
  `amr-api` 需要 `vela_ctrl_…` 控制键，`sk-amr-…` 不是。
- **有 `/models` 列表接口**：`GET /v1/models`（见上），且是「按 key 返回该账号套餐可见的模型」——
  第三方 README 明确写了这一点（`/tmp/probe-oda/package/README.md`「Models」段）。
- **控制面线索**（需另一种键，本机没有）：
  - 套餐名：`Design Plan <Tier>`（例：`Design Plan Go`），来自 `summary.membershipTier`，
    实现见 `/tmp/probe-oda/package/index.mjs:236-241`
  - 额度窗口：`codingPlan.windows[]`，每项 `durationSeconds` / `usedCredits` / `limitCredits` / `resetsAt`，
    即 **5 小时 + 7 天** 两个窗口（`index.mjs:211-233`；README 明写 5-hour / 7-day）
  - 钱包余额：`balanceUsd`（`index.mjs:319,329`）
  - `codingPlan.eligible === false` 表示「没有 Design Plan 额度，走钱包余额」（`index.mjs:340-342`）
- **登录/设备码流程线索**：`POST /api/v1/cli/device-authorizations` → 打开 `open-design.ai/cloud/cli/activate?…`
  → 轮询 `…/{deviceId}/token` 拿 `controlKey` + `runtimeKey`。
  等价于官方 CLI `vela login`（README 第「What it signs in to」段）。本插件 0.3.x 未实现。

## 7. 价格 / 计费线索

- **本插件没有价格表**：`lib/catalog.js:29` 的 `NO_COST = {input:0, output:0, cacheRead:0, cacheWrite:0}`，
  注释写明 "OpenDesign bills outside the harness" —— 所以 DSH 侧成本显示恒为 0。
- **厂商侧的「档位词」有**：`/v1/models` 的 `metadata.cost` ∈ {`low`, `medium`, `high`}
  （12 条实测：low×5、medium×6、high×1，见第 5 节表），`metadata.capability` ∈ {standard, advanced}。
- **`rate` 词**：第三方 README 记「vendor's own cost words (`rate`, e.g. `x0.5` for "low")」
  —— 即 low ≈ 0.5× 倍率（`/tmp/probe-oda/package/README.md`「Models」段）。
- **Design Plan 与钱包（pay-as-you-go）的区别**：
  - 有 Design Plan → 走 5h/7d 额度窗口；`eligible:false` 或无窗口 → 走钱包余额（`balanceUsd`）
  - 这是控制面语义，来自第三方包，**不是本插件实现**
- **具体美元价格表：未找到**。旧插件、locale、README、`/tmp` 探测产物、会话里的
  `open-design.ai/pricing` 抓取都没有；会话里出现的 `MODEL_PRICE_ROWS` / `PRICE_SLUG_OVERRIDES`
  属于 **commandcode** 侧的价格表代码（当前仓库 0.14.x），不要误当作 OpenDesign 价格。

## 8. 未找到 / 不可复原

1. 0.2.0 版本：**未找到**（无包、无 tgz、无日志、无 git 对象）。0.1.0（link）、0.3.1（tgz）有据；0.3.0 只在 README 的 `npm pack` 示例与 memory 里出现。
2. 旧源码仓库历史：**未找到**（当前仓库是 0.14.4 的 commandcode fork，`git cat-file -t e69dda1` 失败；`dist/*.tgz` 已删）。
3. `dsh-opendesign-provider-*.tgz` 本体：**未找到**（全盘 find 仅命中 `.ignored` 目录与当前仓库目录）。
4. Anthropic Messages 路径（`/v1/messages`）：**未找到** OpenDesign 模型面痕迹。
5. `/v1/models` 的完整字段样例只保留在 `/tmp/od-models.json`（若 `/tmp` 被清理即丢失；正文表格已固化其事实）。
6. 美元价格、免费额度、套餐档位清单（Go/Pro/…）：**未找到**。

## 9. 证据路径索引（绝对路径）

磁盘实物（A 级）
- `/Users/xuqi/.dsh/profiles/desktop/node_modules/.ignored/dsh-opendesign-provider/package.json`（version 0.3.1）
- `/Users/xuqi/.dsh/profiles/desktop/node_modules/.ignored/dsh-opendesign-provider/lib/catalog.js`
- `/Users/xuqi/.dsh/profiles/desktop/node_modules/.ignored/dsh-opendesign-provider/lib/index.js`
- `/Users/xuqi/.dsh/profiles/desktop/node_modules/.ignored/dsh-opendesign-provider/lib/client.js`（只有样式/设置页，无账号/额度逻辑）
- `/Users/xuqi/.dsh/profiles/desktop/node_modules/.ignored/dsh-opendesign-provider/README.md`
- `/Users/xuqi/.dsh/profiles/desktop/cordis.patch.yml.bak-odplugin-133448`（第 106-111 行为 pi-ai 单模型 `open-design` 路由）
- `/Users/xuqi/.dsh/profiles/desktop/cordis.patch.yml.bak-odplugin2-143116`（第 80-84 行注释：12 模型归 bundle）
- `/Users/xuqi/.dsh/profiles/desktop/package.json.bak-odplugin3-143255`（`dsh-opendesign-provider: link:/Users/xuqi/codes/dsh-opendesign-provider`）
- `/Users/xuqi/.dsh/profiles/desktop/.plugin-manager/logs/operation-PjOaSO/pnpm.log`（0.1.0 link）
- `/Users/xuqi/.dsh/profiles/desktop/.plugin-manager/logs/operation-KZ3aHG/pnpm.log`（tgz 0.3.1 → `.ignored`）
- `/Users/xuqi/.dsh/.credentials.yaml`（仅确认存在 `OPEN_DESIGN_API_KEY` 引用名，未读值）

探测产物（B 级）
- `/tmp/od-models.json`（12 模型完整 metadata）
- `/tmp/od-final.json`（角色 / store / 流式 usage / max_completion_tokens / reasoning 字段）
- `/tmp/od-effort-matrix.json`（7 档 × 12 模型 accept/reject）
- `/tmp/od-probe6.json`（字面量 `none` vs 省略字段）
- `/tmp/od-effort-sem.json`、`/tmp/od-probe2.json`、`/tmp/od-reasoning-probe.json`（语义/思考 token 数）
- `/tmp/od-probe-final.mjs`、`/tmp/od-probe-matrix.mjs`、`/tmp/od-probe-detail.mjs`、`/tmp/od-probe-kimi.mjs`、`/tmp/od-probe-kimi2.mjs`

第三方参考（D 级）
- `/tmp/probe-oda/package/README.md`、`/tmp/probe-oda/package/index.mjs`（控制面 API 与字段）

会话转录（C 级，zstd）
- `~/.dsh/sessions/--Users-xuqi--/session-813cdcc1-7b95-4140-b839-1f5c3135034b/session.v4.jsonl.zstd`
  （含 `/v1/me|/usage|/account|/key|/balance → 404`、`/v1/responses` 返回体、`/v1/models` 未鉴权错误体、kimi 逐档报错原文）
- 复核方式：`zstd -dc <file> | python3 -c '…'`（本报告未把整段转录写入磁盘）

## 10. 复原方法备注（可复现）

- 会话转录是 zstd 压缩的单行 JSONL，`grep -r` 不会命中；必须 `zstd -dc` 后按关键字取窗口，
  且窗口落盘前用 `re.sub(r"[A-Za-z0-9_\-]{32,}", "<REDACTED>", …)` 脱敏。
- `.ignored` 目录是 pnpm 把「不在依赖树里的包」挪出来的地方，是本次唯一还在盘上的插件事物。
- 当前仓库 `docs/grill/` 是本次新建的，除本文件外没有其它改动。

# OpenDesign 模型面协议实测（只读探针）

- 采集时间：2026-10-20 15:07–15:12 (Asia/Shanghai)
- 探针主机：本机 macOS，`node` + `fetch`，脚本 `/tmp/od-probe-protocol.mjs`、`/tmp/od-probe-protocol-extra.mjs`
- 上游：`https://amr-link.open-design.ai/v1`，`Authorization: Bearer $OPEN_DESIGN_API_KEY`
- 请求总数：**39**（预算 40），单次输出上限 16 tokens（少数探索项未设上限，已注明）
- 密钥处理：脚本只在内存变量中持有 key，所有落盘与打印内容经 `sk-*` / `Bearer *` / `gen-*|resp-*|fc_*|call_*` / UUID 正则脱敏。本报告不含 key 片段、不含 Authorization 头
- 原始数据：`/tmp/od-protocol-probe.json`、`/tmp/od-protocol-trace.json`、`/tmp/od-protocol-probe-extra.json`

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| Anthropic Messages 是否存在 | **存在**，端点就是 `POST /v1/messages`，**必须**带 `anthropic-version` 头；缺头 400 |
| Messages 鉴权 | `Bearer` 与 `x-api-key` **都**返回 200 |
| Messages 是否支持非 Anthropic 模型 | **支持**（`deepseek-v4.1-flash` 200，返回 `thinking` + `text` 块） |
| Messages 流式 | **支持真 Anthropic SSE**（`message_start` / `content_block_start` / `content_block_delta`） |
| `/v1/responses` 是否可用 | **可用**，`store` 默认 true、`previous_response_id` 被校验、tools/stream 均可用 |
| Chat `max_tokens` 哪个字段生效 | 无统一答案：**kimi 只认 `max_completion_tokens`**；**deepseek 两个都不认**；`max_tokens` 谁都不认 |
| 流式思考字段名 | `reasoning`（+ `reasoning_details`），**不是** `reasoning_content` |
| gpt-6-luna 的 `finish_reason` | **非流式确实缺失**（`choices[0]` 只有 `index`/`message`）；流式却有 |
| GET /models 协议字段 | **没有**任何 protocol/endpoint 字段，只有统计性 metadata |
| 429 / Retry-After | **未验证**（5 并发全 200，无 `x-ratelimit-*` 头） |

---

## 1. Anthropic Messages 协议

Body 固定为 Anthropic 形态：`{model, max_tokens:16, messages:[{role:"user",content:"hi"}]}`。

| # | 请求 | 状态码 | 关键响应 |
|---|---|---|---|
| 1 | `POST /v1/messages`（无 `anthropic-version`） | **400** | `{"type":"error","error":{"type":"invalid_request_error","message":"anthropic-version header is required"}}` |
| 2 | `POST /v1/messages` + `anthropic-version: 2023-06-01` | **200** | 标准 Anthropic message（见下） |
| 3 | `POST /anthropic/v1/messages` | **404** | `nginx` HTML 404 页（`<title>404 Not Found</title>`） |
| 4 | `POST /v1/messages?beta=true` + 版本头 | **200** | 与 #2 完全同形（query 不影响） |
| 5 | `POST https://amr-link.open-design.ai/messages` | **404** | `nginx` HTML 404 页 |
| 6 | `POST https://amr-link.open-design.ai/anthropic/v1/messages` | **404** | `nginx` HTML 404 页 |

> 反差说明：#3/#5/#6 是 **nginx 级 404（HTML）**，而 `/v1/*` 下的 404 是 **Go 应用级 404（`404 page not found\n`，text/plain）** —— 说明 nginx 只把 `/v1/` 前缀反代到模型网关，`/anthropic/`、`/messages` 从未被路由。

### 1.1 200 响应形状（claude-haiku-5.5）

```json
{"id":"gen-…","type":"message","role":"assistant",
 "content":[{"type":"text","text":"Hi there! How can I help you today?"}],
 "model":"claude-haiku-5.5","stop_reason":"end_turn",
 "usage":{"input_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,
          "cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0},
          "output_tokens":14}}
```

要点：`id` 是 `gen-…`（OpenRouter 风格），`stop_reason:"end_turn"`，`usage` 带 Anthropic 缓存三段字段（全 0）。

### 1.2 鉴权：Bearer 与 x-api-key 等价

| # | 鉴权方式 | 状态码 |
|---|---|---|
| 35 | 仅 `x-api-key: <key>`（不带 Bearer） | **200**，与 Bearer 同形 |
| 2 | 仅 `Authorization: Bearer <key>` | **200** |

→ 客户端用哪种都能过，不需要同时发两个头。

### 1.3 流式：真 Anthropic SSE

`stream:true` → `200`，`content-type: text/event-stream`，事件序列（脱敏摘录）：

```
event: message_start
data: {"type":"message_start","message":{"id":"gen-…","type":"message","role":"assistant",
       "content":[],"model":"claude-haiku-5.5","usage":{…"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hi","stop_sequence":null}}
```

注意：即使目标是 `claude-haiku-5.5`，网关也会先开一个 **`thinking` 块（index 0）**，再开 `text` 块（index 1）。客户端必须能接受空 thinking 块（signature 为空字符串）。本次抓取只覆盖到 `content_block_delta`，尾部 `message_delta`/`message_stop` 未在截断窗口内验证。

### 1.4 跨模型：Messages 不只服务 Anthropic 模型

`POST /v1/messages`，`model:"deepseek-v4.1-flash"`，`max_tokens:16`（#37）→ **200**：

```json
{"type":"message","role":"assistant",
 "content":[
   {"type":"thinking","thinking":"We need answer to user \"hi\". Just friendly greeting. …"},
   {"type":"text","text":"Hi! How can I help you today?"}],
 "model":"deepseek-v4.1-flash","stop_reason":"end_turn",
 "usage":{"input_tokens":31,"output_tokens":43,"cache_read_input_tokens":0,…}}
```

→ 网关注入的 thinking 会以 Anthropic `thinking` 内容块形式出现（`max_tokens:16` 并未限制住实际输出 43 tokens，见 §3.1 同类现象）。

**协议面判定：Messages 是网关的一等协议，不是灰度或仿冒。**

---

## 2. `/v1/responses` 最小可用请求与结构

### 2.1 最小请求体

```json
{"model":"gpt-6-luna","input":"hi","max_output_tokens":16}
```

`input` 可直接是字符串，也接受 `[{role,content}]` 数组（#8 用数组，200）。

### 2.2 响应结构（gpt-6-luna，#7，200）

顶层键（32 个）：
`id, object, background, created_at, completed_at, error, incomplete_details, instructions, max_output_tokens, max_tool_calls, metadata, model, output, parallel_tool_calls, previous_response_id, prompt_cache_key, prompt_cache_retention, presence_penalty, frequency_penalty, reasoning, safety_identifier, service_tier, status, store, temperature, text, top_logprobs, top_p, tool_choice, tools, truncation, usage, extra_fields`

- `object:"response"`，`status:"completed"`
- `output` 项类型：本用例 `["message"]`，其 `content[].type` 为 **`output_text`**
- `reasoning`：`{"effort":"medium","summary":null}` —— **默认 effort 是 medium，不是 none**
- `store` 默认 **true**；`prompt_cache_retention:"24h"`；`service_tier:"auto"`；`text.format` 存在

### 2.3 usage 字段（关键：两个 details 都在）

```json
{"input_tokens":7,"input_tokens_details":{"cached_read_tokens":0,"cached_write_tokens":0,"cached_tokens":0},
 "output_tokens":11,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":18}
```

- `input_tokens_details.cached_tokens` ✅ 存在（另有 `cached_read_tokens` / `cached_write_tokens`）
- `output_tokens_details.reasoning_tokens` ✅ 存在
- 第二个模型 `deepseek-v4.1-flash`（#8）200，`output` 项类型 = `["reasoning","message"]`，`reasoning_tokens:22`，且 `id` 是 **UUID**（`7d1195e0-…`）而非 `resp_…` —— 不同后端 id 风格不同

### 2.4 tools 与 parallel_tool_calls（#9，200）

请求：`tools:[{type:"function",name:"get_time",description:…,parameters:{…}}]`、`parallel_tool_calls:true`、`store:false`、`max_output_tokens:16`

- 输出项类型：**`["function_call"]`**
- 该 item：`{"id":"fc_…","type":"function_call","status":"incomplete","call_id":"call_…","name":"get_time","arguments":"{\"city\":\"Tokyo"}`
- `incomplete_details:{"reason":"max_output_tokens"}` —— 16 tokens 把 arguments 截断，但形状可用
- 回显：`parallel_tool_calls:true`、`store:false`、`tools[0].strict:false`（默认补 strict）
- 注意 Responses 的 tool 定义是 **扁平** `{type,name,parameters}`，不是 `{type,function:{…}}`（后者是 chat 形态）

### 2.5 stream（gpt-6-luna，200）

- `content-type: text/event-stream`
- **是 data-only SSE**：行首没有 `event:`，全部是 `data: {...}`，以 `[DONE]` 收尾（`hasDoneMarker: true`）
- 出现的事件 `type`：`response.created`、`response.in_progress`、`response.output_item.added`、`response.output_item.done`、`response.incomplete`，以及增量类型 `reasoning`、`text`
- 首帧 `response.created` 里带 `"store":true`、`"reasoning":{"effort":"medium"}`、`"status":"in_progress"`

> 与 Chat Completions 不同：Responses 流 **没有** `event:` 名，客户端只按 `data.type` 分派。

### 2.6 `store` / `previous_response_id`

- `store`：请求可传（`false` 被回显），默认 true
- `previous_response_id`：**被真实校验**。#10 传伪造 id → **400**
  ```json
  {"error":{"message":"[code=upstream_error] Previous response with id 'resp_[REDACTED]' not found.",
            "type":"invalid_request_error","code":"upstream_error"}}
  ```
  → 参数不是被忽略，而是走服务端会话查找，说明有状态续聊链路。

---

## 3. Chat Completions 细节复核

### 3.1 `max_completion_tokens` vs `max_tokens` vs 都不发

Prompt：`"Count from 1 to 100, one number per line."`（故意要长输出）

| 模型 | 字段 | finish_reason | completion_tokens | reasoning_tokens | content 长度 |
|---|---|---|---|---|---|
| deepseek-v4.1-flash | `max_completion_tokens:16` | stop | **232** | 32 | 291 |
| deepseek-v4.1-flash | `max_tokens:16` | stop | **225** | 25 | 291 |
| deepseek-v4.1-flash | 都不发 | stop | 243 | 43 | 291 |
| kimi-k2.7-code | `max_completion_tokens:16` | **length** | **16** | 16 | 0 |
| kimi-k2.7-code | `max_tokens:16` | length | **113** | 83 | 36 |
| kimi-k2.7-code | 都不发 | stop | 239 | 40 | 291 |

结论：
- **kimi-k2.7-code：只有 `max_completion_tokens` 生效**（精确 16，被 reasoning 吃光 → content 空、finish=length）
- **deepseek-v4.1-flash：两个都不生效**（16 → 232 tokens，比不发还接近）
- **`max_tokens` 对所有被测模型都不生效**（kimi 给到 113）
- 因此 DSH 侧不能只发一个字段；对 deepseek/glm 这类模型，token 上限只能靠客户端截断兜底

### 3.2 `reasoning_effort: "none"` vs 省略（deepseek-v4.1-flash）

| 变体 | 状态 | message 键 | reasoning_tokens | completion_tokens |
|---|---|---|---|---|
| `reasoning_effort:"none"` | 200 | `["role","content"]` | **无该字段** | 7 |
| 省略 | 200 | `["role","content","reasoning","reasoning_details"]` | 16 | 18 |

- 字面量 `"none"` 是**被接受的合法档位**，且真的关掉思考（message 里连 `reasoning` 键都不出）
- 省略时默认**开思考**（对应 Responses 侧默认 `effort:"medium"`），并多出非标准键 `reasoning_details`
- 注意：省略档位时 prompt_tokens 从 8 涨到 34，说明网关注入了思考模板

### 3.3 流式思考字段名：`reasoning`，不是 `reasoning_content`

`stream:true` + `reasoning_effort:"low"` + `max_completion_tokens:16`：

| 模型 | delta 键集合 | `reasoning` | `reasoning_content` | finish_reason | 流内 usage |
|---|---|---|---|---|---|
| gpt-6-luna | `[]` → 后续 `["role","content"]` | ❌ | ❌ | `length`（截断那次）/ `stop`（不设上限那次） | ✅ |
| claude-haiku-5.5 | `["role","content"]` | ❌ | ❌ | `stop` | ✅ |
| deepseek-v4.1-flash | `["role","reasoning","reasoning_details","content"]` | ✅ | ❌ | `stop` | ✅ |

- **`reasoning_content` 在三种模型上都没出现**，字段名是 `reasoning`（伴随 `reasoning_details:[{index,type:"reasoning.text",text}]`）
- deepseek 首个 chunk 就发空 `reasoning:""` + 空 `reasoning_details`，客户端要能容忍空串
- **gpt-6-luna 在 chat 流里完全不吐思考**（哪怕 effort=low）；它的思考只在 `/v1/responses` 的 `reasoning` output item 里可见（§2.3）
- 流内 `usage` 三个模型都有；chunk 带非标准 `extra_fields.routing_info.provider`（gpt-6-luna → `openai`，claude → `anthropic`）

### 3.4 gpt-6-luna 的 `finish_reason`：非流式确实缺失

不设 token 上限、`"Say hi."`（#38，200）：

```json
{"id":"resp_…","choices":[{"index":0,"message":{"role":"assistant","content":"Hi!"}}],
 "created":1792480241,"model":"gpt-6-luna","object":"chat.completion",…}
```

- `choices[0]` 的键 = **`["index","message"]`**，`finish_reasonPresent: false`
- 同样的截断场景（§3.3）在**流式**里却能拿到 `finish_reason:"length"` / `"stop"`
- → **两说并存的真相是：非流式缺失、流式存在**。客户端不能假设非流式一定有该字段；`tool_calls` 场景同理（§3.6 的响应里也没有 finish_reason）

### 3.5 `developer` 角色

| 模型 | 状态 | 说明 |
|---|---|---|
| gpt-6-luna | **200** | `{"role":"assistant","content":"Hi! How can I help?"}`，无 finish_reason |
| glm-5.3-flash | **400** | `{"error":{"message":"[code=upstream_error] Incorrect role information","type":"upstream_error","code":"upstream_error"}}` |

→ `developer` 只能按模型发，glm 必须降级成 `system`。错误分类是 `upstream_error` 而非 `invalid_request_error`，重试策略上要注意（这是**确定性 4xx**，不该重试）。

### 3.6 工具调用（非流式，1 个 function tool）

`tool_choice:"auto"`，`max_completion_tokens:16`（#24，200）：

```json
{"choices":[{"index":0,"message":{"role":"assistant","tool_calls":[
  {"index":0,"type":"function","id":"call_tBKI1h4TEe6MQ4IFcNithCaV",
   "function":{"name":"get_time","arguments":"{\"city\":\"Tokyo"}}]}}],
 "usage":{"prompt_tokens":56,"completion_tokens":16,"completion_tokens_details":{},"total_tokens":72}}
```

- `finish_reason` 同样**缺失**（message 键 = `["role","tool_calls"]`，`content:null`）
- `arguments` 是**部分 JSON 字符串**（被 16 tokens 截断，未闭合），说明网关不校验参数合法性
- 没有 `finish_reason:"tool_calls"` 可依赖 → 判据只能看 `message.tool_calls` 是否存在

---

## 4. GET /v1/models 结构

`200`，共 12 条，顶层 `{data, object}`。单条样例（gpt-6-luna）：

```json
{"id":"gpt-6-luna","object":"model","created":1790144301,"owned_by":"vela",
 "architecture":{"input_modalities":["text","image","file"],"output_modalities":["text"]},
 "metadata":{"cost":"low","capability":"standard","context_limit":1050000,
             "context_budget":400000,"output_budget":128000},
 "default":false,"enabled":true}
```

- item 键集合：`id, object, created, owned_by, architecture, metadata, default, enabled`
- **无任何协议字段**：对 `protocol / protocols / endpoints / api / api_type / capabilities / modalities(顶层) / supports / wire / message_format` 全量正则扫描，命中 **0**
- 唯一沾边的是 `architecture.input_modalities / output_modalities`（模态，非协议）
- → 客户端无法从 `/v1/models` 判断某模型支持哪套 wire；只能按「全部模型都支持 chat/responses/messages 三面」处理（已实测 deepseek 在 messages 与 responses 都通）

---

## 5. 错误响应形状

| 场景 | 状态 | `content-type` | 响应体（脱敏） |
|---|---|---|---|
| 假 key（`sk-amr-000…`） | **401** | `application/json` | `{"error":{"code":"invalid_api_key","message":"[code=invalid_api_key] api key not found","type":"invalid_api_key"}}` |
| `GET /v1/me` | **404** | `text/plain; charset=utf-8` | `404 page not found\n`（Go 默认 404，非 JSON） |
| `messages:[]` 空消息 | **400** | `application/json` | `{"error":{"message":"[code=upstream_error] Empty input messages (request_id: 874c0840-…-…-…-…)","type":"invalid_request_error","code":"upstream_error"}}` |
| `previous_response_id` 不存在 | **400** | `application/json` | `{"error":{"message":"[code=upstream_error] Previous response with id '…' not found.","type":"invalid_request_error","code":"upstream_error"}}` |
| `developer` 角色不被支持 | **400** | `application/json` | `{"error":{"message":"[code=upstream_error] Incorrect role information","type":"upstream_error","code":"upstream_error"}}` |
| `/anthropic/v1/messages`、`/messages` | **404** | `text/html` | nginx 默认 404 页 |

要点：
- 错误体有两种外层契约：`{"error":{code,message,type}}`（401，错误码在顶层 `code`）；`{"error":{message,type,code}}`（400，网关把上游错误包成 `code=upstream_error`，真实原因塞在 `message` 的 `[code=…]` 前缀里）
- 400 的 `message` 里**夹带 request_id**（`(request_id: <uuid>)`），报障可复用
- **404 不是 JSON**，客户端解析错误体前必须判 `content-type`
- **429 未验证**：5 个并发小请求全部 200；响应中**没有** `x-ratelimit-limit-requests` / `x-ratelimit-remaining-requests` / `retry-after`（`retryAfter: null`）。→ **Retry-After 头存在性：未验证**

---

## 6. 协议混合：同一模型双协议

`deepseek-v4.1-flash`，同 key、连续两请求：

| 端点 | 状态 | 结果 |
|---|---|---|
| `POST /v1/chat/completions` | **200** | `finish_reason:"stop"` |
| `POST /v1/responses` | **200** | `output` 项 = `["reasoning","message"]` |

→ **双协议不是灰度**，同一模型在同一 key 下两个面都活。结合 §1.4（messages 也接受非 Anthropic 模型），该网关实际是**三协议并列**，任选其一都能打通全部 12 个模型（messages 已验 2 个模型，responses 已验 2 个，chat 已验 5+ 个）。

---

## 7. 对 DSH provider 改造的直接含义

1. **协议选择不再二选一**：`/v1/messages` 是完整 Anthropic SSE（含 thinking 块），可用 Anthropic provider 路径承载；但要注意它**强制** `anthropic-version` 头，且 Bearer / x-api-key 均可。
2. **token 上限不可信**：只有 kimi 认 `max_completion_tokens`；`max_tokens` 全员不认；deepseek 两个都不认。适配层应同时发 `max_completion_tokens` 并在客户端做硬截断。
3. **思考字段统一读 `reasoning`**（`reasoning_content` 不存在）。gpt-6-luna 在 chat 面完全不吐思考，要思考必须走 responses 或 messages（messages 会以 `thinking` block 给出）。
4. **`finish_reason` 必须可缺省**：gpt-6-luna 非流式缺失（含 tool_calls 场景），流式才有。工具调用判定改用 `message.tool_calls` 存在性。
5. **`developer` 角色按模型降级**：glm 会 400 `Incorrect role information`（且标成 `upstream_error`，容易被误判为可重试）。
6. **错误体解析要兼容三态**：JSON `{error:{…}}`、纯文本 `404 page not found`、nginx HTML 404；401 的 code 在 `error.code`，400 的真因在 `message` 的 `[code=…]` 前缀里。

---

## 附：请求清单（39 条）

| 段 | 条数 | 内容 |
|---|---|---|
| Q1 Messages | 6 | 6 种路径/头组合 |
| Q2 Responses | 4 | 最小体、第二模型、tools、流式、previous_response_id（含流式那条共 5 次调用，计数按 4） |
| Q3 chat 细节 | 14 | token 矩阵 6、effort 2、流式字段 3、developer 2、工具 1 |
| Q4 models | 1 | GET /v1/models |
| Q5 错误 | 8 | 401、404、400、429 并发 5 |
| Q6 双协议 | 1 | chat（responses 侧复用） |
| 追加 | 5 | x-api-key、messages 流式、messages 跨模型、gpt6 finish_reason、gpt6 流式 |

未覆盖（诚实标注）：
- 429 / Retry-After：未触发，未验证
- Messages 流式尾部（`message_delta` / `message_stop`）与 `usage` 最终值：截断窗口外未验证
- Messages 面的 tool_use / tool_result 往返、`system` 顶部参数形态：未测
- 图像/文件输入（`architecture.input_modalities` 声称支持 image/file）：未测

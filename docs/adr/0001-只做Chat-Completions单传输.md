# 只实现 Chat Completions 单传输

OpenDesign 的模型面同时提供 Chat Completions、Responses、Anthropic Messages 三种协议，12 个模型在三面上都能打通；我们只实现 Chat Completions，另两条协议不实现（Messages 留作后续可选票，Responses 原则上不做）。原因是 DSH 每轮发送全量历史，Responses 的服务端续聊（`previous_response_id`）没有价值；Messages 的增量只有 gpt-6-luna 与 claude-haiku-5.5 的思考可视化，不值得在 P0 付出第二条 wire 与逐模型选路的成本。适配器保留传输接缝，P2 可加 Messages。

**Consequences**：gpt-6-luna 与 claude-haiku-5.5 在 DSH 里看不到思考内容（其余 10 个模型正常）；由于 deepseek/glm 不遵守输出上限字段、`max_tokens` 对所有模型都不生效，适配器必须自己做客户端硬截断。

## 补记（2026-10-21，ticket 13 实测）

ticket 13 把 Messages 做成可选传输，上面的结论口径不变：**默认仍是 Chat Completions**。接入前用真实 Key 复核，两条事实需要更正：

- **Messages 是网关的一等协议**：`POST {apiBase}/messages` 必须带 `anthropic-version: 2023-06-01`（缺头 400），`Bearer` 与 `x-api-key` 等价，流是真 Anthropic SSE（`message_start` / `content_block_*` / `message_delta` / `message_stop`），跨模型可用。
- **「gpt-6-luna 与 claude-haiku-5.5 的思考在 Messages 面可见」只对 claude-haiku-5.5 成立**：
  - `claude-haiku-5.5` 只有请求里显式写 `thinking: {type:"enabled", budget_tokens: >=1024}` 才会吐可读的 `thinking_delta`；不写就只有空的 thinking 块。
  - `gpt-6-luna` 在 Messages 面只回 `redacted_thinking`（加密块，无可读文本）；它的思考只在 `/v1/responses` 的 reasoning 项里，而本仓不做 Responses。自动选路因此不把它送去 Messages——切过去也看不见，只会多花思考 token。
  - `deepseek` 等模型两面都给可读思考，没有切换收益。

**Consequences（补记）**：新增 `protocol: 'chat' | 'messages' | 'auto'`，默认 `auto` = Chat 为主、只让 `claude-haiku-5.5` 走 Messages；`messages` 是用户的显式选择（失败如实报错，不静默换面），`auto` 下协议错误/不支持会回落 Chat 一次并按模型记住偏好。gpt-6-luna 的思考在 DSH 里仍不可见——这是协议面事实，不是本插件的取舍；要看它的思考只能走 Responses，而那条协议仍按本 ADR 不做。

**补记（ticket 13 实测，2026-10-21）**：可选 Messages 传输落地后，实测推翻了「两个思考不可见模型换传输就能看见思考」的假设——
`claude-haiku-5.5` 在 Messages 面确实给出可读 `thinking` 块（需请求里显式 `thinking.budget_tokens >= 1024`），
但 `gpt-6-luna` 只回 `redacted_thinking`（加密块，无可读文本），它的可读思考只在 `/v1/responses` 的 reasoning 项里。
因此默认 `auto` 只把 `claude-haiku-5.5` 送去 Messages，`gpt-6-luna` 留在 Chat；「不做 Responses」的结论不变。

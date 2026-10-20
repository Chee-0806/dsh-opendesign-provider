# 只实现 Chat Completions 单传输

OpenDesign 的模型面同时提供 Chat Completions、Responses、Anthropic Messages 三种协议，12 个模型在三面上都能打通；我们只实现 Chat Completions，另两条协议不实现（Messages 留作后续可选票，Responses 原则上不做）。原因是 DSH 每轮发送全量历史，Responses 的服务端续聊（`previous_response_id`）没有价值；Messages 的增量只有 gpt-6-luna 与 claude-haiku-5.5 的思考可视化，不值得在 P0 付出第二条 wire 与逐模型选路的成本。适配器保留传输接缝，P2 可加 Messages。

**Consequences**：gpt-6-luna 与 claude-haiku-5.5 在 DSH 里看不到思考内容（其余 10 个模型正常）；由于 deepseek/glm 不遵守输出上限字段、`max_tokens` 对所有模型都不生效，适配器必须自己做客户端硬截断。

# dsh-opendesign-provider

[English](README.md) | 简体中文

非官方的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **Open Design** LLM 提供方插件。
它在 `llm-opendesign` 插件行下注册 `open-design` 路由，因此同一个 profile 里可以和其它提供方并存，
路由与命名空间都不冲突。

本项目是社区集成，**与 Open Design / Powerformer 没有隶属或背书关系**；使用 Open Design 服务时适用其
自身的服务条款。

**状态：P0、P1 额度面与 P2 无金额分析均已交付。** Chat Completions 传输、实时模型目录、凭据链、设置页、
可选的侧栏额度卡与其仪表盘、`/opendesign` 命令，以及模型分析读口（token、速度、失败/重试、用量覆盖率、
成本档位与能力档，任何金额都不显示也不计算；见 ADR-0002）全部就绪。

## 安装

```sh
# 发布到 npm 之后
dsh plugin add @mars-sea/dsh-opendesign-provider

# 或从本地构建安装
npm ci
npm run build
npm pack
dsh plugin add ./mars-sea-dsh-opendesign-provider-0.1.0.tgz
```

装完重启应用，然后确认：

- **设置 → Open Design** 出现设置页（连接、模型与上下文、显示、高级）。
- **设置 → 模型** 出现 Open Design 卡片，显示密钥状态与目录来源。
- **设置 → 模型分析** 比较本机历史中出现的 Open Design 模型。它只读宿主自己的会话日志、不碰模型面，
  展示 token、首字/总时长、失败、重试与用量覆盖率。成本列只取目录的 `low`/`medium`/`high` 档位词，
  不显示也不折算任何美元金额。

发布产物包含 `lib/`、`cordis.patch.yml` 里的插件行与 `dsh.client` 声明。补丁只 insert 自己这一行
（`llm-opendesign`），不会改写其它提供方的路由，因此与已安装的 Command Code 插件共存。

> 插件**暂无图标**（`icon` 元数据字段刻意缺失）。品牌资产需要设计稿来源，这里不伪造。

## 身份标识

| 项 | 值 |
| --- | --- |
| 包名 | `@mars-sea/dsh-opendesign-provider` |
| provider 路由 | `open-design` |
| 显示名 | `Open Design` |
| 设置命名空间 / 插件行 | `llm-opendesign` |
| 默认凭据引用 | `OPEN_DESIGN_API_KEY` |
| 默认网关 | `https://amr-link.open-design.ai/v1` |
| 模型目录缓存 | `~/.opendesign/models-cache.json` |
| CLI 登录态（只读） | `~/.amr/config.json` |
| Remote 命名空间 | `opendesign`（`models`、`analytics`；`report`/`usage` 预留） |
| 遥测开关 | `DSH_OPENDESIGN_TIMING`、`DSH_OPENDESIGN_TRACE` |

## 凭据

解析是一次有序遍历，先命中先用：

1. **显式 Key** —— composition 里的 `config.apiKey`（secret 角色，处处脱敏）。
2. **凭据引用** —— `config.apiKeyEnv`，默认 `OPEN_DESIGN_API_KEY`，经凭据服务解析（Models 页就写这里），
   或读启动环境变量。
3. **CLI 登录态** —— `~/.amr/config.json` 的 `profiles.prod.runtimeKey`，由 `vela login` 写入。仅当前两层
   都没有值时才使用。

网关地址跟随密钥来源：显式 `config.apiBase` 永远优先；密钥来自 CLI 登录态时用其服务端下发的 `linkUrl`
（实测该值是主机名，例如 `https://amr-link.open-design.ai`，插件在裸源站上补 `/v1`）；其余情况用默认网关。

插件**从不写** `~/.amr/config.json`，也从不打印密钥。设置页与诊断只显示引用名、是否存在、密钥来源。
`profiles.prod.controlKey` 由额度功能只读使用（插件从不写回），不参与推理。

没有浏览器登录、没有设备码流程、没有账号池：Open Design 是单 Key 模型。

## 模型

选择器读取按 Key 裁剪的 `GET {apiBase}/models`。网关不可达、鉴权失败或响应形状不合法时，回落内置
12 模型静态快照，目录来源标记为 `static`；设置页与模型卡显示该来源。网关可能多于或少于 12 条，只有静态
快照是固定的。快照之外的新模型仍可选，带**未校准**标注，按全档思考、无图片能力处理。

| 模型 id | 显示名 | 上下文 | 输出上限 | 成本档 | 能力档 | 输入 |
| --- | --- | --- | --- | --- | --- | --- |
| `deepseek-v4.1-flash` | DeepSeek V4.1 Flash（默认） | 328K | 128000 | low | advanced | text, image |
| `glm-5.3-flash` | GLM-5.3 Flash | 232K | 32000 | low | advanced | text, image, video* |
| `glm-5.3-flashx` | GLM-5.3 Flash-X | 232K | 32000 | medium | advanced | text, image, file*, video* |
| `hy4-preview` | Hunyuan H4 Preview | 232K | 32000 | medium | advanced | text |
| `kimi-k2.7-code` | Kimi K2.7 Code | 262K | 65536 | medium | advanced | text, image |
| `mimo-v2.6-pro` | MiMo V2.6 Pro | 232K | 32000 | medium | advanced | text, image, audio*, video* |
| `deepseek-v4-pro` | DeepSeek V4 Pro | 328K | 128000 | high | advanced | text |
| `claude-haiku-5.5` | Claude Haiku 5.5 | 228K | 128000 | low | standard | text, image, file* |
| `gpt-6-luna` | GPT-6 Luna | 400K | 128000 | low | standard | text, image, file* |
| `mimo-v2.6-flash` | MiMo V2.6 Flash | 232K | 32000 | low | standard | text, image, audio*, video* |
| `deepseek-v4-flash` | DeepSeek V4 Flash | 232K | 32000 | medium | standard | text |
| `deepseek-v4-flash-vision-exp` | DeepSeek V4 Flash Vision Exp | 232K | 32000 | medium | standard | text, image |

\* 网关公布了该模态，但本插件只接受 **text 与 image**。file / audio / video 附件会以
`UNSUPPORTED_CONTENT` 拒绝，并点名该模型声明的能力。

上下文取网关的 `context_budget`（可用输入预算），不是名义上的 `context_limit`。kimi 的 65536 输出上限高于
其 32000 的 `output_budget`，是为了容纳思考档位。成本档与能力档是分档标签，**不是价格**。

## 模型分析

**设置 → 模型分析** 比较本机历史里出现的 Open Design 模型。它通过可选的 `sessionQuery` 服务读宿主自己的
会话日志、从不接触模型面，而且只在用户点 **读取** 时扫描；启动时不扫描，也没有后台轮询。

- 筛选：最近 1–100 个含 Open Design 请求的会话，或本地日历的日期范围（界面上开始/结束日都包含，线上是
  半开区间 `[from, to)`，最长 366 天）。
- 列：请求数、Token 总量、平均首字延迟、平均总时长、失败率、重试数，以及目录的成本档位
  （`low`/`medium`/`high`）与能力档（`standard`/`advanced`）。
- 缺数据就显示缺失：适配器没上报用量的请求仍算一条请求，但不贡献 Token；目录里没有的模型档位显示
  `未知`，不会编造数值。
- 扫描有上限（100 个候选会话、20 万个自有事件）并会标注截断。分支会话只计自己的事件，继承前缀不会把
  父会话的请求重复计数。
- 没有会话查询服务的 profile 会显示「不可用」和原因；模型对话本身不受影响。

这里**没有金额维度**：没有价表、没有美元金额、也没有 `≈` 估算。这是 ADR-0002 的刻意决定——账单请看
Open Design 控制台。

## 思考等级

| 模型 | 可选档位 | 说明 |
| --- | --- | --- |
| 九个全档模型（`claude-haiku-5.5`、`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`deepseek-v4-pro`、`deepseek-v4.1-flash`、`gpt-6-luna`、`hy4-preview`、`mimo-v2.6-flash`、`mimo-v2.6-pro`） | `off` … `max` | `off` 发字面量 `none`（省略字段仍会思考） |
| `glm-5.3-flash`、`glm-5.3-flashx` | `low`、`high`、`max` | 更轻的档收敛为 `low`，`xhigh` 收敛为 `max`；`off` 变 `low` 并在界面标注「该模型不支持关闭思考」 |
| `kimi-k2.7-code` | `minimal`、`low`、`medium`、`high`、`xhigh` | 无 `off`、无 `max`；`max_completion_tokens` 会抬到该档思考预算之上 |

`gpt-6-luna` 与 `claude-haiku-5.5` 在 Chat Completions 面完全不发思考。它们标注**思考不可见**；没有思考块
不等于模型没有思考。

## 输出上限与客户端硬截断

每个请求只发一个上限字段 `max_completion_tokens`（从不发 `max_tokens`，实测没有模型认它）。取值是
`min(宿主预算, 模型输出预算, 262144)`；模型有思考预算门限时（kimi）再抬高到该档下限。设置 `0` 表示
「没有宿主预算」，不是「省略字段」。

由于 deepseek 与 glm 实测完全不遵守该字段，适配器自己计数输出（含思考 token），达到上限就停止读取，
以 `max-tokens` 收尾并保留已经收到的内容。所以 deepseek 设 16 token 是真的在约 16 token 处停下，
而上游本会发几百 token。

## 错误

每个失败都是一个稳定错误码加一段能照做的文案；确定性错误绝不重试。

| 错误码 | 含义 | 下一步 |
| --- | --- | --- |
| `MISSING_CREDENTIAL` | 三层凭据都没有 | 在 设置 → Open Design 粘贴 Key、导出 `OPEN_DESIGN_API_KEY`，或执行 `vela login` |
| `AUTH` | 401/403：Key 被拒，或没有该模型权限 | 到 <https://open-design.ai/cloud/api-keys> 检查/重建 Key，检查工作区权限 |
| `QUOTA_EXHAUSTED` | 402：Design Plan 额度或余额用尽 | 到控制台查额度、充值，或改用 BYOK |
| `BAD_REQUEST` | 400，以及被包成 502 的确定性 400：请求本身不被接受，真因（含 `request_id`）会引用出来 | 按原因改模型 / 角色 / 消息 / 上限；重试没有意义 |
| `PROTOCOL_ERROR` | 404 纯文本或 HTML（`apiBase` 错）、200 不是 SSE、空响应体 | 检查 `apiBase` 是否指向网关的 `/v1`，以及代理是否改写了流 |
| `RATE_LIMIT` | 429；有 `Retry-After` 就按它等 | 稍后再发，降低并发 |
| `TRANSIENT` | 读不出确定性原因的 5xx | 插件会自动重试（有预算） |
| `TRANSPORT` | 连接层失败（DNS、TLS、reset） | 在有限预算内自动重试；文案会说明预算 |
| `TIMEOUT` | 首字节或流空闲超时 | 重试，或在 设置 → Open Design 调大超时 |
| `EMPTY_RESPONSE` | HTTP 200 但既无正文、思考，也无工具调用 | 自动重试；反复出现请换模型 |
| `UNSUPPORTED_CONTENT` | 发了 file/audio/video，或给纯文本模型发图 | 只发 text/image，或换视觉模型 |
| `UNSUPPORTED_OPTION` | 本路由表达不了的选项（如 `logprobs`） | 去掉该选项 |

404 按响应体形状区分：JSON `model_not_found` 是模型 id 不对 → `BAD_REQUEST`；纯文本或 HTML 是路径不对 →
`PROTOCOL_ERROR`。

## 额度面板与 `/opendesign`

侧栏卡、它的仪表盘与 `/opendesign` 文本看板都用 CLI 登录态的 `controlKey` 读控制面。侧栏卡是**可选**的：
设置 → Open Design → 显示 → 「侧栏额度卡」，默认关闭。开启后显示套餐档位与 7 天窗口（Go 档另有 5 小时
窗口）；点击进入仪表盘，含两个窗口、重置时间、钱包余额与「先扣 Design Plan 额度、再扣套餐额度、最后扣
钱包」的计费顺序。数据过期时保留旧值并标注「已过期」。

没有控制密钥时不渲染、也不刷新——设置页会说明「推理可用、额度不可用」。推理永远不被额度门禁阻塞。卡片在
打开时刷新、最多每 5 分钟一次，仪表盘的「刷新」按钮可手动拉取。

## 设置页

- **连接**：API Key（经凭据引用写入/清除）、`apiBase`、CLI 登录态状态。
- **模型与上下文**：可见模型、逐模型上下文覆盖、全局输出上限。
- **显示**：语言、侧栏额度卡（默认关闭）。
- **高级**：请求超时、流空闲超时、传输重试次数、目录缓存路径、复制脱敏后的当前有效配置诊断。

写入沿用宿主的设置写入语义：一份草稿、一次带版本栅栏的整批 mutate、凭据单独确认；冲突时保留草稿。

## 已知限制

- **不编造美元金额。** 成本只有分档标签；额度面板展示 credits 窗口与控制面给的钱包余额，不折算账单。
- **没有浏览器/设备码登录、账号池、ZDR、联网搜索、套餐过滤。** 这些在上游没有对等能力。
- **单凭据。** 解析出的最后一把 Key 服务整个 profile，没有轮换。
- **`gpt-6-luna` 与 `claude-haiku-5.5` 的思考在 Chat 面不可见。**
- **file/audio/video 输入会被拒绝**，即使网关公布了该模态。
- **暂无插件图标。**
- **没有 TUI 设置页**；设置页就是 Web UI（需要时 P2 再做）。
- **只做 Chat Completions。** Messages 传输是 P2 可选项，Responses 不在范围内。
- 不发 `temperature`、`stop`、`logprobs`、`store`。`developer` 消息统一降级为 `system`（glm 会拒该角色）。
- **429 / `Retry-After` 已实现但未在真机触发**（探测从未触发限流），也没有 `x-ratelimit-*` 响应头可依赖。
- **设置页交互由测试验证，未做浏览器会话验收**；真实 profile 安装与 Command Code 共存由维护者在合并后验证。

## 验证

```sh
npm run typecheck
npm test
npm run build && git diff --exit-code -- lib/
npm run test:pack
npm run test:engine     # 用两个声明兼容的引擎加载构建产物
npm run test:install    # 把打包产物做 pnpm 隔离安装
npm run test:live       # 真实 Key：九条 P0 用例，逐项 PASS/FAIL/SKIP
```

`npm run test:live` 从 `OPEN_DESIGN_API_KEY` 或 `~/.amr/config.json` 读 Key，从不打印、不落盘，并使用临时目录
做目录缓存。退出码：`0` 无能力失败，`1` 有能力失败，`2` 没有可用凭据（所有 live 用例 SKIP）。
`--case N` 只跑一条，`--list` 只列名字。

验收记录见 [docs/opendesign/02-P0验收记录.md](docs/opendesign/02-P0验收记录.md)。

## 回退

没有数据迁移、没有后台任务：产物只是普通 JS 加一个设置分区。

1. 用装它时同样的机制移除：`dsh plugin remove @mars-sea/dsh-opendesign-provider`，或从 profile 的插件
   配置 / `node_modules` 里删掉 `llm-opendesign` 那一行。
2. 重启应用。provider 路由、模型卡与设置页随即消失。
3. 可选清理：删掉 profile `settings.yaml` 里的 `llm-opendesign` 分区，以及
   `~/.opendesign/models-cache.json`。
4. `~/.amr/config.json` 全程未被触碰，回退后 CLI 登录态仍然可用。

移除本插件不影响已安装的 Command Code 插件。

## 文档

- 设计与分阶段计划：[docs/opendesign/00-改造设计.md](docs/opendesign/00-改造设计.md)
- 规格：[docs/opendesign/03-spec.md](docs/opendesign/03-spec.md)
- P0 验收记录：[docs/opendesign/02-P0验收记录.md](docs/opendesign/02-P0验收记录.md)
- 决策：[docs/adr/](docs/adr/)
- 术语：[GLOSSARY.md](GLOSSARY.md) 第七节
- 旧提供方历史（只读归档）：[docs/legacy-commandcode/](docs/legacy-commandcode/)

## 许可

MIT。上游骨架归属与 Open Design 非关联声明见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

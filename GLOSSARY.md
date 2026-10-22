# 领域词汇

## 一、账号与凭据

1. **账号（Account）**：默认账号或 `accounts` 中的额外账号；额外账号以凭据引用作为稳定身份。
2. **凭据引用（Credential reference）**：凭据服务解析的标识，不是密钥值。设置和诊断只保存引用。

## 二、账号开通

1. **账号开通过程（Account enrollment）**：从新增意图到账号可用或补偿完成的宿主过程。统一覆盖浏览器登录和手动粘贴密钥。
2. **页面所有者（Page owner）**：本次设置页挂载及其独立观察流；页内取消或观察流结束触发宿主收尾。不是宿主共享的 `OperatorPeer`。
3. **待命名（Naming pending）**：凭据已成功写入，账号保留，仅名称写入或确认未完成；允许重试或接受已有名称。
4. **取消补偿（Cancellation compensation）**：等待已发出的存储任务结束，再移除临时账号并清理凭据；页面无需等待即可导航。
5. **恢复日志（Recovery journal）**：`accountEnrollmentTasks` 中的引用、阶段与建议名称；不含密钥、连接身份或上游错误正文。与既有 `credentialCleanupRefs` 配合支持人工重试。

## 三、验证边界

1. **宿主检测断开（Host-detected disconnection）**：网关向持续观察流提供取消信号后的收尾，不保证浏览器关闭瞬间已检测。
2. **未完成记录（Incomplete record）**：只能证明已登记但未确认收尾；凭据存在不能单独证明登录或配置提交成功。

## 四、流响应

1. **单次响应过程（Response lifecycle）**：成功连接后一次读取到成功、失败、取消或消费结束的过程；独立持有装配、用量与终止状态。
2. **生成结束原因（Finish reason）**：模型停止生成的原因；OpenAI 的 `finish_reason` 后仍可能收到独立用量，不能立即报告成功。
3. **协议最终标记（Protocol terminal marker）**：CLI 的 `finish`、OpenAI 的 `[DONE]`、Messages 的 `message_stop`；同包后续事件不再解析。
4. **已解析用量（Parsed usage）**：取消发生前已完整解析事件中的最后一份累计用量；不继续读取补齐，也不叠加累计读数。
5. **消费结束（Consumer closure）**：消费方调用适配器迭代器的 `return()` 或提前离开循环；先唤醒读取并清理，不能向已经离开的消费方强行交付用量。
6. **读取唤醒闸门（Read gate）**：读循环每次读取持有的内部承诺；空闲期限与取消信号解开它来结束这次等待，因此三条收束路径都不依赖底层 `reader.cancel()` 是否结算挂起的读取。闸门先到时被放弃的读取结果丢弃，迟到拒绝就地吞掉。


## 五、设置写入

1. **设置写入过程（Settings write lifecycle）**：一个共享客户端控制器内按发起顺序执行的保存及即时账号意图；持有冻结输入、目标、配置基线、确认结果和销毁门控。
2. **配置确认（Configuration acknowledgement）**：宿主接受本次带版本检查的整批变更；重读得到相同值不能证明本次被接受。
3. **凭据确认（Credential acknowledgement）**：指定原引用的存储或清除返回成功；事实描述只提供存在性，不验证密钥内容。
4. **部分完成（Partial completion）**：配置已确认，凭据尚未发出或未确认；已生效配置保留，未确认部分及等待期间的新草稿保留。
5. **目标变化（Target change）**：默认凭据引用与发起时不同；未发调用停止，已发调用记录原引用实际结果并提示核对，密钥草稿保留。
6. **事实刷新失败（Facts refresh failure）**：未取得完整且有效的新凭据状态；保留最后确认事实，人工重试只读状态，不重放写入。

## 六、网关事实与请求快照

1. **网关事实（Gateway facts）**：指定 `apiBase` 的有效目录公布能力与明确拒绝学习到的上限；不同网关不能互相约束。
2. **目录来源（Catalog source）**：网关地址与缓存文件路径的组合；持有独立目录状态，文件必须符合版本与网关来源。
3. **单次请求快照（Request snapshot）**：一次适配器调用固定的连接、账号定义及目录能力；覆盖内部轮换、协议回退与唯一降档，后续连接只采纳更低学习值。
4. **账号作用域（Account scope）**：固定账号列表、选择规则及原连接探测的调用视图；健康状态与探测节流按网关及密钥共享，引用秘密仍实时解析。
5. **共享发布权（Publication ownership）**：同网关最新发起刷新拥有的共享事实提交资格；失败不交还旧刷新，旧响应仍可供原等待者使用。

## 七、OpenDesign 接入

1. **Open Design API Key**：控制台签发、消耗 OpenDesign 额度的模型面凭据；与 BYOK 相对（BYOK 用自己的厂商密钥，费用归厂商）。
2. **模型面（Model plane）**：承载推理的网关（`/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/v1/messages` 三协议并列）。
3. **控制面（Control plane）**：账号、套餐、额度、钱包与登录态的 API；不承载推理，需控制密钥。
4. **CLI 登录态**：`vela login` 落盘的登录凭据（运行时密钥、控制密钥、模型面地址、控制面地址、用户），与 API Key 是两条独立凭据路径。
5. **凭据链（Credential chain）**：显式密钥 → 凭据引用 → CLI 登录态的解析顺序；控制密钥单独取自 CLI 登录态。
6. **Design Plan 额度**：Design Plan 模型共享的额度池，按 5 小时（仅 Go）与 7 天窗口计量，先于套餐模型额度扣减。
7. **套餐模型额度（Plan model credits）**：仅 Plus/Pro/Max 有，按账单周期发放与重置，不受 5 小时/7 天窗口约束。
8. **额度窗口（Quota window）**：控制面按模型返回的计量窗口，含已用、上限、剩余与重置时间；5 小时与 7 天是两个固定时长档。
9. **额度预检（Billing preflight）**：按模型查询「当前会扣哪份额度、两个窗口剩多少」的控制面接口。
10. **钱包余额（Wallet balance）**：未覆盖 Design Plan 时使用的美元余额口径。
11. **目录快照（Catalog snapshot）**：网关不可达时使用的内置模型目录；网关可达时以网关公布为准。
12. **成本档位（Cost tier）**：模型元数据里的 `low/medium/high`，只表达相对计费档位，不是美元单价。
13. **能力档（Capability tier）**：模型元数据里的 `standard/advanced`，只表达客观能力分档。
14. **思考等级（Reasoning effort）**：模型接受的思考强度枚举；各模型合法档位不同，`off` 以字面量 `none` 表达。
15. **客户端硬截断（Client-side output cap）**：上游不遵守输出上限时，由适配器在累计输出达到上限时主动结束生成。
16. **额度面板（Quota panel）**：展示套餐档位、额度窗口、钱包余额与计费口径的侧栏卡与中间栏仪表盘；默认关闭，可一键开启。
17. **计费口径（Funding mode）**：当前请求先扣哪份额度——Design Plan 额度还是钱包余额；控制面 `funding` 字段如实转述。
18. **额度当量（Quota equivalent）**：把控制面报出的 credits 按其 `creditsPerUsd` 换算出的展示用美元数，只用于额度窗口与余额，
不得用于重建模型价格（见 ADR-0002 范围澄清）。

## 八、界面与设计令牌

1. **设计令牌层（Design token layer）**：插件自有的 `--od-*` 度量变量集合（间距、圆角、控件高、字阶、动效、
   焦点偏移），定义在 `src/client/tokens.ts`，锚在插件自有界面根类上而非 `:root`。只承载度量，不承载颜色。
2. **宿主别名（Host alias）**：宿主运行时注入的 `--dsw-alias-*` 语义颜色变量（101 个，亮暗各一套，由
   `body[data-ds-dark-theme]` 整体切换）。是本插件**唯一**的颜色真源。
3. **强调色（Accent）**：需要颜色识别的强调位置所用的蓝，取宿主 `--dsw-alias-state-business-primary`
   （`#4176e6` / `#7aaaff`）。**不是** `--dsw-alias-brand-primary` —— 后者在本宿主里是单色（近黑/近白）。
4. **密度档（Density）**：控件高度的取用档位。插件取设计体系的 compact 档并与宿主原生对齐：
   输入 32px、主操作 36px、次级 28px；保存条容器高 44px 属浮层高度，不是控件档。
5. **死规则 / 死令牌（Dead rule / dead token）**：规则里所有 `od-`/`odp-` 类都没有任何组件渲染，或令牌从未被
   任何规则引用。两者由 `tests/css-hygiene.test.ts` 双向拦截。

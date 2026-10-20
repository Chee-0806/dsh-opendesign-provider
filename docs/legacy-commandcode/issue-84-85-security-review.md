# 问题 #84、#85 与八条安全质量告警

## 一、范围与结论

1. 基线为 `0.13.1`，核查日期为 2026-10-14。本轮修复已确认的诊断、测试判断和价格采集缺陷，并就 #84 补上传输层回退与诊断；真实账号只用于只读探测和极小额度生成验证，未提交、推送或发布。
2. [#84](https://github.com/Mars-Sea/dsh-commandcode-provider/issues/84) 的 Haiku 权限拒绝在本机 GOAT（`individual-goat`）账号上无法复现：反代与 CLI 两条路径都正常返回。本轮按已确认的传输层缺口补上回退，不宣称反馈者的账号侧根因已定位。[#85](https://github.com/Mars-Sea/dsh-commandcode-provider/issues/85) 的频繁 HTTP 400（网络响应状态）仍缺足够材料。
3. 八条 CodeQL（代码安全分析）告警都在测试或维护脚本，核查未发现产品运行时利用链。对应代码已修复；远程告警是否关闭需要推送后重新扫描，本轮未运行本地 CodeQL 分析。

## 二、已修复行为

1. `src/provider-errors.ts` 的通用 HTTP 错误分别保留 `code`（错误码）与 `type`（错误类型），每个字段限 1 至 80 个 ASCII 字母、数字及 `_.:-`。非法字段独立丢弃，不回显完整上游正文；分类与重试不受展示过滤影响，请求关联号继续进入 `failure.requestId`。
2. [#7](https://github.com/Mars-Sea/dsh-commandcode-provider/security/code-scanning/7)、[#11](https://github.com/Mars-Sea/dsh-commandcode-provider/security/code-scanning/11)、[#12](https://github.com/Mars-Sea/dsh-commandcode-provider/security/code-scanning/12) 位于适配器与网关测试；[#8](https://github.com/Mars-Sea/dsh-commandcode-provider/security/code-scanning/8)、[#9](https://github.com/Mars-Sea/dsh-commandcode-provider/security/code-scanning/9)、[#10](https://github.com/Mars-Sea/dsh-commandcode-provider/security/code-scanning/10) 位于真实引擎验证脚本。六处均改为解析 URL（网址）后精确比较 `origin`（含协议、主机与端口的来源），适配器与目录分支同时核对路径。
3. [#5](https://github.com/Mars-Sea/dsh-commandcode-provider/security/code-scanning/5)、[#6](https://github.com/Mars-Sea/dsh-commandcode-provider/security/code-scanning/6) 对应 `scripts/sync-model-prices.mjs` 的文本提取。开发依赖 `parse5@8.0.1` 负责 HTML（网页标记）解析，按文本节点提取模型名和价格；处理嵌套标签、注释、字符实体与属性中的大于号，不执行脚本，也不把提取文本视为可安全渲染的 HTML。
4. 价格交叉校验逐模型执行：缺行、名称重复、不可解析或未公开数值时拒绝生成候选；免费行明确核对嵌入价格为零。按列位置读取上下文后的三个价格格，不允许用缓存写或后续列补齐。撤销总行数达到一半即视为足够覆盖的判断，失败时不覆盖既有价格表。
5. Messages（消息接口）端点以 403 加结构化 `permission_error`（权限错误）拒绝时，改用 CLI（命令行协议）直连 `/alpha/generate` 重试同一账号；触发面只认该标识（不扫正文），其余权限失败原样上报，且该回退不写入协议缓存。回退后仍失败时，错误文案以 CLI 结果为主并附先前的反代拒绝标识。未改动请求头、公开设置或价格数值。该约束已写入[《决策记录》](决策记录.md)第一章第 8 条。

## 三、验证

1. 完整测试 940 项通过；类型检查与构建通过，`lib/` 服务端产物已更新。第一轮沙箱内登录测试无法监听本机端口，允许回环监听后完整重跑通过。
2. 两个已声明兼容的真实引擎均通过 `npm run test:engine`，包含网关事实验证及每个引擎的 22 个流终态场景；网络、账号与凭据为合成依赖。
3. 发布入口检查通过；npm 依赖漏洞检查为零项漏洞，解析器仅是开发依赖。
4. 三个协议覆盖嵌套／根级错误、仅类型、代码与类型并存、非法与超长标识、正文隐藏、失败请求号保留。新增用例覆盖 Messages 权限拒绝后回退成功、回退后 CLI 也失败时的文案、其它 403 不回退、Chat Completions 不回退、回退不写缓存且不影响同账号的 GPT 路由，以及换账号后不继承上一账号的拒绝注记。
5. 价格回归覆盖实体与嵌套文本、畸形标签及注释、删除线与普通标签区分、重复名称、60 条记录缺一行、免费零价、未公开或缺失价格列。使用核查时采集的官方页面快照运行实际脚本的 `--check`：现有 87 条数值价格全部通过交叉校验，无价格表漂移；该检查不等于持续监测线上页面。
6. 2026-10-14 用本机 GOAT 账号实测：`/provider/v1/models` 返回 89 个模型，`claude-haiku-5-5` 标注 `supported_endpoints: ["/messages"]`；`/provider/v1/messages` 与 `/alpha/generate` 对 `claude-haiku-5-5` 在流式、非流式、带 `x-cmd-zdr` 及三种 `User-Agent` 组合下均返回 200；只有缺少 `x-command-code-version` 头时才出现报告者表格里的 403 `upgrade_required`（`minVersion 0.18.10`）。这是单账号、单时点观测，不等于服务端对全部账号的承诺。
7. 用构建产物做端到端回退验证：正常路径只请求 `/provider/v1/messages` 并成功；把 messages 调用替换为合成的 403 `permission_error` 后，适配器改打 `/alpha/generate`，真实服务端返回 200 并正常收流。该验证证明回退出口真实可用，不证明线上服务端会对某个账号返回 `permission_error`。

## 四、仍需补充的证据

1. 反馈者账号侧的根因仍需材料：插件版本、时间、模型、实际路由、HTTP 状态、经过筛选的错误码／类型及请求关联号。不要索取密钥、整段聊天或包含对话的完整原始跟踪文件。
2. 官方 [GOAT 套餐](https://commandcode.ai/docs/plans/goat) 与 [Provider API（模型服务接口）](https://commandcode.ai/docs/provider) 支持 Haiku；公开目录不是特定密钥的权限证明。本机 GOAT 账号实测未能复现反代拒绝，反馈者账号的具体差异（组织归属、密钥来源、请求时点、请求头组合）仍未知。
3. 官方 CLI 显式设置 `User-Agent: cli`，插件 CLI 请求发送的是宿主归属头（`deepseek-harness/<版本>`，由 `attributionHeaders()` 提供）。本轮实测该头、`cli` 与 `command-code/1.82.1` 三种取值都能穿过 Cloudflare，未观察到 1010 拦截；该差异保留为低风险待验证项。

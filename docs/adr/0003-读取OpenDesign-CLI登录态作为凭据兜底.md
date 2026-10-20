# 读取 OpenDesign CLI 登录态作为凭据兜底与控制密钥来源

OpenDesign 的 API Key 只能调模型面，模型面没有任何用量端点（`/v1/usage`、`/v1/balance` 全 404），额度只能从控制面查，而控制面需要 `vela_ctrl_…` 控制密钥。桌面端/官方 CLI 的 `vela login` 会把 `runtimeKey`、`controlKey`、`linkUrl`、`apiUrl` 落到 `~/.amr/config.json`。我们决定：插件**只读**这个文件——在用户没有显式配置密钥时用它作为模型面凭据兜底，并且只从它取控制密钥来查询额度；插件绝不写这个文件，也不复用它的登录态做别的请求。

**Considered Options**：只支持控制台 API Key（最简，但额度面板彻底没数据）；实现完整设备码登录（页面内授权，成本高且要落盘新凭据）。**Consequences**：额度功能依赖用户曾在桌面端/CLI 登录过；文件格式变化时额度降级但推理不受影响；凭据面扩大到「读另一个应用的密钥文件」，这是刻意的取舍，写在与密钥相关的诊断与 README 里。

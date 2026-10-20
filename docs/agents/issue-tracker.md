# Issue tracker: 本地 Markdown

本仓库的 issue 与 spec 以 markdown 文件形式存放在 `.scratch/`。
（remote 虽指向 GitHub，但 GitHub Issues 处于关闭状态，因此不使用 `gh issue create`。）

## 约定

- 一个特性一个目录：`.scratch/<feature-slug>/`（例：`.scratch/opendesign-provider/`）
- spec 放在 `.scratch/<feature-slug>/spec.md`
- 实现票一票一文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 编号；**不要**把所有票合并进单个文件
- triage 状态写成文件顶部的 `Status:` 行（角色串见 `triage-labels.md`）
- 评论与对话历史追加在文末 `## Comments` 下

## 技能说「发布到 issue tracker」时

在 `.scratch/<feature-slug>/` 下新建文件（必要时创建目录）；spec 写 `spec.md`，票写 `issues/<NN>-<slug>.md`。

## 技能说「读取相关票」时

直接读取给定路径的文件；用户通常会直接给出路径或票号（如 `03`）。

## 与设计件的关系

本仓库的长期设计件仍放在 `docs/opendesign/`、`docs/adr/`、`docs/grill/`（事实基线）；`.scratch/` 只承载可执行票与它们的 spec 副本，票开工时从设计件拆出。

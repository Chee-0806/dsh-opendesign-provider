# 领域文档

## 探索代码前先读

- 仓库根的 `GLOSSARY.md`（若存在 `GLOSSARY-MAP.md`，则读它指向的各上下文 `GLOSSARY.md`）。
- `docs/adr/`：读与本次改动区域相关的 ADR。
- 这些文件不存在就静默跳过，不要提示补建，也不要建议先创建——术语与决策由 `/domain-modeling`（经 `/grill-with-docs`、`/improve-codebase-architecture`）在真正定下来时懒创建。

## 文件结构

单上下文仓库（本仓库）：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-只做Chat-Completions单传输.md
│   ├── 0002-不显示金额只留成本档位.md
│   └── 0003-读取OpenDesign-CLI登录态作为凭据兜底.md
└── src/
```

本仓库另有长期设计件：`docs/opendesign/`（改造设计、任务票、spec）与 `docs/grill/`（事实基线报告），探索相关区域时应一并读取。

## 使用术语表词汇

输出里命名领域概念（票标题、重构提案、假设、测试名）时，使用 `GLOSSARY.md` 的定义，不要漂到它刻意回避的同义词。

需要但缺词是信号：要么你在发明项目不用的语言（回头考虑），要么是真缺口（记下来交给 `/domain-modeling`）。

## 标记 ADR 冲突

输出与既有 ADR 矛盾时显式指出，不要静默覆盖：

> 与 ADR-0001（只做 Chat Completions 单传输）冲突，但值得重开，因为……

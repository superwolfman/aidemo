# Git Hooks

本目录包含项目级 Git Hooks，用于在提交前拦截语法错误与构建失败。

## 启用方式

在项目根目录执行一次：

```bash
git config core.hooksPath .githooks
```

之后每次 `git commit` 会自动运行：

1. 对所有变更的 `.js/.mjs/.cjs` 文件执行 `node --check`
2. 运行 `node scripts/verify-ai-workflow.mjs`（Client lint / typecheck / build + Server 核心文件语法检查）

任意一步失败都会阻止提交。

## 跳过（仅限紧急情况）

```bash
git commit --no-verify -m "..."
```

> 警告：`--no-verify` 会绕过所有检查，请仅在明确知道风险时使用。

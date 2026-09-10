# AnchorRead Git 提交规范门禁

本仓库使用 Husky 和 commitlint 校验提交信息，确保提交历史可以按产品能力和功能分组阅读。

## 必须满足

1. 标题符合 `type(scope): 中文摘要`。
2. `type` 为小写英文，并属于允许列表：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`、`i18n`。
3. subject 必须包含中文摘要。
4. body 非空，且至少包含一项有序编号列表（`N. 说明`）。
5. 编号项下可使用 `-` 或 `*` 表达子项。
6. 正文分区标题按实际改动选择：`新功能`、`优化`、`修复`、`测试`、`构建`；没有发生的类别不写。

## 推荐格式

```text
feat(reader): 增加文档阅读能力

新功能
  1. 新增阅读入口
     - 保留现有文档状态
     - 增加失败提示

测试
  1. 更新阅读器和文档测试
```

上述示例只包含本次实际发生的“新功能”和“测试”。修复、优化或构建类提交应换用对应的短标签，不需补齐其他分区。

编号前的两个空格是排版建议，不是单独的强制规则。

## 本地验证

```powershell
pnpm exec commitlint --edit .tmp\commit-message.txt
git diff --check
```

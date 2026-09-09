# AnchorRead Git 提交规范门禁系统

## ✅ 已安装的工具

- **Husky** (v9.1.7) - Git hooks 管理工具
- **Commitlint** (v21.2.2) - 提交信息格式验证器
- **@commitlint/config-conventional** - Conventional Commits 标准配置

## 📋 强制提交的中文分组格式要求

### 格式模板

```text
type(scope): 简短的中文描述 (X/N)

1. 文件更新/新增
   - 改动点 1
   - 改动点 2
   
2. 新功能特性
   * 特性要点 A
   * 特性要点 B
   
3. ... (直到完成全部变更)
```

### 示例

**✅ 正确格式:**

```bash
feat(api): 完善文档库图谱工作区 API 路由集合 (1/6)

1. 更新 app/api/ask/route.js Ask 图谱生成接口
   - 整合多类型图谱请求处理 (Mermaid/Excalidraw/知识图谱)
   - 统一错误码注入与实验性功能控制逻辑
2. 新增 app/api/concepts/route.js 概念图提取 API
   - 从文档内容自动抽取核心概念关系图
   - 支持自定义概念层级与关联强度配置
3. ...
4. ...
5. ...
6. ...
```

**❌ 错误格式会被拒绝:**

```bash
feat(api): 错误格式测试  # 缺少编号列表

没有编号的正文内容
```

### 允许的 type 前缀

| Type   | 说明               |
|--------|-------------------|
| feat   | 新功能            |
| fix    | Bug 修复          |
| docs   | 文档更新          |
| style  | 代码风格 (不影响运行) |
| refactor | 重构           |
| test   | 测试相关          |
| chore  | 构建/工具链       |
| i18n   | 国际化            |
| perf   | 性能优化          |
| ci     | CI 配置           |
| deploy | 部署相关          |
| revert | 回退提交          |

### 核心验证规则

✅ **必须满足以下条件:**

1. Conventional Commits 格式：`type(scope): subject`
2. type 必须是允许的小写英文单词
3. subject 必须是中文且以冒号分隔
4. **body 必须有至少一行有序编号列表**：`N. `开头 (数字 + 点 + 空格)
5. 每个编号项下可用 `-` 或 `*` 缩进展示子项

❌ **任何不符合上述要求的提交将被钩子自动拦截!**

## 🔒 如何生效

每次执行 `git commit` 时会自动触发以下验证流程:

```bash
.git/hooks/commit-msg -> pnpm exec commitlint --edit
                            ↓
                    检查提交消息格式
                            ↓
              ✓ 符合格式 → 允许提交
              ✗ 不符合 → 失败退出
```

### 当提交被拒绝时会看到:

```
✖ Invalid subject line...
✖ Body missing ordered list numbering...

Error: Commit message format invalid!

Example of valid format:

  feat(api): 完善文档库 API 路由集合

  1. 更新 app/api/xxx/route.js 功能说明
     - 子项说明 A
     - 子项说明 B

  2. 新增 xxx.js 文件
     * 特性要点 C
     * 特性要点 D
```

## 🛠️ 调试命令

### 手动验证提交信息

如果你想在提交前自己先检查一下格式:

```powershell
# 1. 准备一个测试的提交信息文件
echo "你的提交信息" > .tmp\test-commit.txt

# 2. 查看 commitlint 会怎么判断它
Get-Content .tmp\test-commit.txt | node node_modules/@commitlint/cli/bin/cli.js
```

### 临时跳过钩子

紧急情况下可以暂时跳过验证 (不推荐):

```bash
git commit --no-verify -m "feat: 紧急修复"
```

## 📚 更多资源

- [Conventional Commits 规范](https://www.conventionalcommits.org/)
- [Commitlint 官方文档](https://github.com/conventional-changelog/commitlint)
- [Husky GitHub](https://github.com/typicode/husky)

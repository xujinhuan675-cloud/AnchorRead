/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],

  // 本地内联插件：强制 body 采用「分组 + 有序编号」结构
  plugins: [
    {
      rules: {
        // 每个功能分组一行 "N. 说明"，其下用 "- " 或 "* " 列子项
        'body-grouped-ordered-list': ({ body }) => {
          const text = body || '';
          const ok = /^\s*\d+\.\s+\S/m.test(text);
          return [
            ok,
            'body 必须包含有序编号分组（每个功能一行 "N. 说明"，其下用 "- " 或 "* " 列子项）。示例：\n' +
              '  1. 更新 app/api/xxx/route.js 说明\n' +
              '     - 子项 A\n' +
              '     - 子项 B\n' +
              '  2. 新增 yyy.js 说明\n' +
              '     * 子项 C',
          ];
        },
      },
    },
  ],

  rules: {
    // 允许的提交类型（在 conventional 基础上补充 i18n）
    'type-enum': [
      2,
      'always',
      [
        'feat', // 新功能
        'fix', // Bug 修复
        'docs', // 文档更新
        'style', // 代码风格（不影响运行）
        'refactor', // 重构
        'perf', // 性能优化
        'test', // 测试相关
        'build', // 构建系统或外部依赖
        'ci', // CI 配置
        'chore', // 其他杂项
        'revert', // 回退提交
        'i18n', // 国际化
      ],
    ],
    'type-empty': [2, 'never'],
    'type-case': [2, 'always', 'lower-case'],
    'subject-empty': [2, 'never'],
    // 中文 subject 不以英文句点结尾，关闭该限制
    'subject-full-stop': [0, 'never'],
    'header-max-length': [2, 'always', 120],
    // body 必须非空且包含有序编号分组
    'body-empty': [2, 'never'],
    'body-grouped-ordered-list': [2, 'always'],
  },
};

module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'subject-chinese': ({ subject }) => [
          /[\u4e00-\u9fff]/.test(subject || ''),
          'subject 必须包含中文摘要',
        ],
        'body-grouped-ordered-list': ({ body }) => {
          const sections = ['新功能', '优化', '修复', '测试', '构建', '其他'];
          const text = String(body || '').replace(/\r\n?/g, '\n').trim();
          if (!text) {
            return [false, 'body 必须包含提交正文'];
          }

          const lines = text.split('\n');
          const sectionIndexes = [];
          for (let index = 0; index < lines.length; index += 1) {
            const heading = lines[index]
              .trim()
              .replace(/^#+\s*/, '')
              .replace(/[：:]\s*$/, '');
            const sectionIndex = sections.indexOf(heading);
            if (sectionIndex !== -1) {
              sectionIndexes.push({ index, sectionIndex, heading });
            }
          }

          if (sectionIndexes.length === 0) {
            const nonEmptyLines = lines.filter((line) => line.trim());
            const isNumberedList = nonEmptyLines.length > 0
              && nonEmptyLines.some((line) => /^\s*\d+\.\s+\S/.test(line))
              && nonEmptyLines.every((line) => (
                /^\s*\d+\.\s+\S/.test(line)
                || /^\s*[-*]\s+\S/.test(line)
              ));
            return [
              isNumberedList,
              'body 无合适分区时必须直接使用编号列表（N. 说明）',
            ];
          }

          if (sectionIndexes.length === 1 && sectionIndexes[0].sectionIndex === sections.length - 1) {
            return [false, 'body 的“其他”分区不能单独存在'];
          }

          let previousSectionIndex = -1;
          for (let position = 0; position < sectionIndexes.length; position += 1) {
            const current = sectionIndexes[position];
            if (current.sectionIndex <= previousSectionIndex) {
              return [false, 'body 分区必须按新功能、优化、修复、测试、构建、其他顺序且不可重复'];
            }
            if (current.heading === '其他' && position !== sectionIndexes.length - 1) {
              return [false, 'body 的“其他”分区只能放在最后'];
            }

            const nextLine = sectionIndexes[position + 1]?.index ?? lines.length;
            const hasNumberedItem = lines
              .slice(current.index + 1, nextLine)
              .some((line) => /^\s*\d+\.\s+\S/.test(line));
            if (!hasNumberedItem) {
              return [false, `body 分区“${current.heading}”至少包含一个编号项`];
            }
            previousSectionIndex = current.sectionIndex;
          }

          return [true, ''];
        },
      },
    },
  ],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert', 'i18n'],
    ],
    'type-empty': [2, 'never'],
    'type-case': [2, 'always', 'lower-case'],
    'subject-empty': [2, 'never'],
    'subject-case': [0],
    'subject-chinese': [2, 'always'],
    'subject-full-stop': [0, 'never'],
    'header-max-length': [2, 'always', 120],
    'body-empty': [2, 'never'],
    'body-grouped-ordered-list': [2, 'always'],
  },
};

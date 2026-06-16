// Conventional Commits, relaxed for AURORA's bilingual, scoped style.
// Enforced on the commit-msg hook (.husky/commit-msg) and pairs with release-please.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Types AURORA actually uses (config-conventional defaults + project customs).
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'perf',
        'refactor',
        'chore',
        'docs',
        'test',
        'build',
        'ci',
        'style',
        'revert',
        'hardening',
        'ux',
        'ui',
        'diag',
      ],
    ],
    // Subjects are often Portuguese with § references — don't fight casing/length.
    'header-max-length': [2, 'always', 120],
    'subject-case': [0],
    'body-max-line-length': [0],
  },
};

/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: [require.resolve('@contivo/config/eslint/base')],
  env: { node: true },
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    // Nest DI relies on emitDecoratorMetadata, which needs runtime (non-type) imports
    // for constructor-injected classes. Forcing `import type` silently breaks injection.
    '@typescript-eslint/consistent-type-imports': 'off',
  },
};

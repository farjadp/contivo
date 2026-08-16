/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: [require.resolve('@contivo/config/eslint/base')],
  env: { node: true },
  ignorePatterns: ['dist', 'node_modules'],
};

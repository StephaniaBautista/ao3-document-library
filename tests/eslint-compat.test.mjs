import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

// Protect both ESLint's file selection and the import rule's glob behavior
// when upgrading its transitive minimatch dependency.
test('ESLint includes application files and ignores generated assets', async () => {
  const eslint = new ESLint();
  assert.equal(await eslint.isPathIgnored('app/library.tsx'), false);
  assert.equal(await eslint.isPathIgnored('db/schema.ts'), false);
  assert.equal(await eslint.isPathIgnored('dist/example.js'), true);
  assert.equal(await eslint.isPathIgnored('public/pdf.worker.min.mjs'), true);
  assert.equal(await eslint.isPathIgnored('public/offline-export.js'), true);
});

test('ESLint still applies TypeScript rules', async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText('const unused = 1;\n', {
    filePath: 'app/__eslint_compat_fixture__.ts',
  });
  assert.ok(result.messages.some(message =>
    message.ruleId === '@typescript-eslint/no-unused-vars'));
});

test('import restrictions reject matching paths and allow other paths', async () => {
  const eslint = new ESLint({
    overrideConfig: {
      rules: { 'import/no-internal-modules': ['error', { forbid: ['library/**'] }] },
    },
  });
  const options = { filePath: 'app/__eslint_compat_fixture__.ts' };
  const [blocked] = await eslint.lintText("import 'library/internal';\n", options);
  const [allowed] = await eslint.lintText("import 'other/internal';\n", options);
  assert.ok(blocked.messages.some(message =>
    message.ruleId === 'import/no-internal-modules' && message.severity === 2));
  assert.equal(allowed.messages.some(message =>
    message.ruleId === 'import/no-internal-modules'), false);
});

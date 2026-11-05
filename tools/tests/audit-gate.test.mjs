import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

// Exercise the command chain without depending on registry availability.
test.each([0, 1])('audit exit %i controls whether unit tests run', (status) => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const command = scripts.test
    .replace('pnpm audit --prod --audit-level=high', `(exit ${status})`)
    .replace('vitest run', 'echo unit-tests-ran');
  const result = spawnSync('sh', ['-c', command], { encoding: 'utf8' });
  expect(result.status).toBe(status);
  expect(result.stdout.includes('unit-tests-ran')).toBe(status === 0);
});

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Tripwire: the `owner_match` scope idiom is the authorization boundary
 * (queries run on the service-role client — RLS is bypassed), and it used to
 * be copy-pasted across at least six services with drift between the copies.
 * It must exist ONLY inside src/v1/common/authz/. This test fails the build
 * if it leaks back out.
 */
const SRC_ROOT = join(__dirname, '..', '..', '..');
const ALLOWED_DIR = join('v1', 'common', 'authz');
const FORBIDDEN = /owner_match/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === '__snapshots__') continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|js)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('raw scope filters stay inside common/authz', () => {
  it('no file outside src/v1/common/authz mentions owner_match', () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((file) => !relative(SRC_ROOT, file).startsWith(ALLOWED_DIR + sep))
      .filter((file) => FORBIDDEN.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC_ROOT, file));

    expect(offenders).toEqual([]);
  });
});

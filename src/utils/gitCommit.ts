import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export function getCommit(): string {
  if (process.env.COMMIT_SHA && process.env.COMMIT_SHA.length > 0) {
    return process.env.COMMIT_SHA;
  }

  try {
    const out = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const sha = out.toString().trim();
    if (sha) return sha;
  } catch (_) {}

  try {
    const gitDir = join(process.cwd(), '.git');
    const headPath = join(gitDir, 'HEAD');
    if (!existsSync(headPath)) return 'unknown';
    const head = readFileSync(headPath, 'utf8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.split(' ')[1].trim();
      const refPath = join(gitDir, ref);
      if (existsSync(refPath)) {
        const refSha = readFileSync(refPath, 'utf8').trim();
        if (refSha) return refSha.substring(0, 7);
      }
      const packed = join(gitDir, 'packed-refs');
      if (existsSync(packed)) {
        const lines = readFileSync(packed, 'utf8').split('\n');
        for (const line of lines) {
          if (!line || line.startsWith('#')) continue;
          const parts = line.split(' ');
          if (parts.length >= 2) {
            const [sha, refname] = parts;
            if (refname === ref) return sha.substring(0, 7);
          }
        }
      }
    } else if (/^[0-9a-f]{40}$/.test(head)) {
      return head.substring(0, 7);
    }
  } catch (_) {}

  return 'unknown';
}

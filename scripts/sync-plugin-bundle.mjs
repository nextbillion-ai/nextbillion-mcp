// Copies the built single-file server and the documentation index into the Claude Code
// plugin directory, so the plugin starts with `node ${CLAUDE_PLUGIN_ROOT}/dist/index.mjs` —
// no npx, no network, no dependency install at launch. Run after `npm run build`; CI
// verifies the copies are byte-identical to the build output (`--check`).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

// The server resolves its documentation index at ../data/docs-index relative to itself: a
// directory of JSON parts (packages/server/scripts/docs/build-index.ts) kept small so the
// plugin passes the directory's per-file limits.
const INDEX_SRC = 'packages/server/data/docs-index';
const INDEX_DST = 'distributions/claude-code/data/docs-index';
const files = [
  ['packages/server/dist/index.js', 'distributions/claude-code/dist/index.mjs'],
  ...readdirSync(INDEX_SRC)
    .sort()
    .map((name) => [join(INDEX_SRC, name), join(INDEX_DST, name)]),
];
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const check = process.argv.includes('--check');

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (check) {
  for (const [built, shipped] of files) {
    if (!existsSync(shipped) || sha(built) !== sha(shipped)) {
      fail(`${shipped} is out of date — run: npm run build && node scripts/sync-plugin-bundle.mjs`);
    }
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', shipped], { stdio: 'ignore' });
    } catch {
      fail(
        `${shipped} is not tracked by git — the plugin fetched from GitHub would be incomplete.`,
      );
    }
  }
  const expected = new Set(readdirSync(INDEX_SRC));
  for (const name of readdirSync(INDEX_DST)) {
    if (!expected.has(name)) fail(`${join(INDEX_DST, name)} is stale — remove it (git rm).`);
  }
  console.log(
    'Plugin bundle and documentation index match the build output and are tracked by git.',
  );
} else {
  rmSync(INDEX_DST, { recursive: true, force: true });
  rmSync('distributions/claude-code/data/docs-index.json', { force: true }); // pre-0.3.3 layout
  for (const [built, shipped] of files) {
    mkdirSync(dirname(shipped), { recursive: true });
    copyFileSync(built, shipped);
    console.log(`Copied ${built} -> ${shipped}`);
  }
}

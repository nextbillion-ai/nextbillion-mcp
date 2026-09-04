// Copies the built single-file server into the Claude Code plugin directory, so the
// plugin starts with `node ${CLAUDE_PLUGIN_ROOT}/dist/index.js` — no npx, no network,
// no dependency install at launch. Run after `npm run build`; CI verifies the copy is
// byte-identical to the build output (`--check`).
import { copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const built = 'packages/server/dist/index.js';
const shipped = 'distributions/claude-code/dist/index.mjs';
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

if (process.argv.includes('--check')) {
  if (sha(built) !== sha(shipped)) {
    console.error(
      `${shipped} is out of date — run: npm run build && node scripts/sync-plugin-bundle.mjs`,
    );
    process.exit(1);
  }
  console.log('Plugin bundle matches the build output.');
} else {
  copyFileSync(built, shipped);
  console.log(`Copied ${built} -> ${shipped}`);
}

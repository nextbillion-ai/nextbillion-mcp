// Verifies distribution manifests reference the same version as the npm package.
// Codex uses the plugin version as a cache key, so drift silently breaks installs.
import { readFileSync } from 'node:fs';

const serverVersion = JSON.parse(readFileSync('packages/server/package.json', 'utf8')).version;
const manifests = [
  'distributions/claude-code/.claude-plugin/plugin.json',
  'distributions/codex/.codex-plugin/plugin.json',
];
const mcpConfigs = ['distributions/claude-code/.mcp.json', 'distributions/codex/.mcp.json'];

let failed = false;
for (const path of manifests) {
  const manifestVersion = JSON.parse(readFileSync(path, 'utf8')).version;
  if (manifestVersion !== serverVersion) {
    console.error(`${path}: version ${manifestVersion} != package version ${serverVersion}`);
    failed = true;
  }
}
for (const path of mcpConfigs) {
  const config = readFileSync(path, 'utf8');
  if (!config.includes(`nextbillion-mcp@${serverVersion}`)) {
    console.error(`${path}: does not pin nextbillion-mcp@${serverVersion}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`All distribution manifests match version ${serverVersion}.`);

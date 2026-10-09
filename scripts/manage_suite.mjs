import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PlatformApiClient, deleteEvalSuiteOperation, listEvalSuitesOperation } from '@mcpjam/sdk/platform';

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim().replace(/^export\s+/, '');
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(resolve(process.cwd(), '.env.evals'));

const apiKey = process.env.MCPJAM_API_KEY;
const projectId = process.env.MCPJAM_PROJECT_ID;

console.log('Project ID:', projectId);
console.log('API Key present:', Boolean(apiKey));

if (!apiKey) {
  console.error('Missing MCPJAM_API_KEY');
  process.exit(1);
}

const client = new PlatformApiClient({
  getAuth: async () => apiKey,
});

async function main() {
  console.log('\nListing current eval suites...');
  const suitesResult = await listEvalSuitesOperation.execute(
    { project: projectId },
    { client }
  );

  for (const s of suitesResult.items) {
    const d = await client.getEvalSuite({ projectId, suiteId: s.id });
    console.log(`\nSuite [${s.name}] (${s.id}): managedBy = ${d.managedBy}, declaredId = ${d.declaredId}`);
  }

  const targetSuiteName = 'nextbillion-mcp-eval-suite';
  const targetSuite = suitesResult.items.find(
    (s) => s.name === targetSuiteName || s.id === targetSuiteName
  );

  if (!targetSuite) {
    console.log(`\nNo suite found matching "${targetSuiteName}".`);
    return;
  }

  console.log(`\nFetching details for suite "${targetSuite.name}" (${targetSuite.id})...`);
  const suiteDetail = await client.getEvalSuite({
    projectId,
    suiteId: targetSuite.id,
  });
  console.log('Suite Detail:', JSON.stringify(suiteDetail, null, 2));

  console.log(`\nAttempting delete with declaredSuiteId: "${targetSuite.id}"...`);
  try {
    const res1 = await deleteEvalSuiteOperation.execute(
      {
        project: projectId,
        suite: targetSuite.id,
        declaredSuiteId: targetSuite.id,
      },
      { client }
    );
    console.log('Success with targetSuite.id:', res1);
    return;
  } catch (err) {
    console.log('Failed with targetSuite.id:', err.message, err.details);
  }

  console.log(`\nAttempting delete with declaredSuiteId: "${targetSuite.name}"...`);
  try {
    const res2 = await deleteEvalSuiteOperation.execute(
      {
        project: projectId,
        suite: targetSuite.id,
        declaredSuiteId: targetSuite.name,
      },
      { client }
    );
    console.log('Success with targetSuite.name:', res2);
    return;
  } catch (err) {
    console.log('Failed with targetSuite.name:', err.message, err.details);
  }

  console.log('\nVerifying remaining eval suites...');
  const afterResult = await listEvalSuitesOperation.execute(
    { project: projectId },
    { client }
  );
  console.log(`Remaining suites (${afterResult.items.length}):`);
  for (const suite of afterResult.items) {
    console.log(`- ID: ${suite.id} | Name: "${suite.name}"`);
  }
}

main().catch((err) => {
  console.error('Error running operation:', err);
  process.exit(1);
});

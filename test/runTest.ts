import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, 'integration', 'index');
  await runTests({ extensionDevelopmentPath, extensionTestsPath });
}
main().catch((e) => { console.error(e); process.exit(1); });

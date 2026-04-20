import * as path from 'node:path';
import { glob } from 'glob';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true });
  const files = await glob('**/*.test.js', { cwd: __dirname });
  files.forEach((f) => mocha.addFile(path.resolve(__dirname, f)));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} failures`)) : resolve()));
  });
}

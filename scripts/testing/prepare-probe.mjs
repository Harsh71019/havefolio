import { copyFile, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// pnpm deploy moves the API away from the monorepo's shared tsconfig.
const directory = process.argv[2];
if (!directory) throw new Error('Provide the disposable API deployment directory.');
const target = await realpath(directory);
const workspace = resolve(import.meta.dirname, '../..');
if (target === workspace || target.startsWith(`${workspace}/`)) {
  throw new Error('Use a disposable deployment outside the repository.');
}
const configPath = join(target, 'tsconfig.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
config.extends = './tsconfig.base.json';
await copyFile(join(workspace, 'tsconfig.base.json'), join(target, 'tsconfig.base.json'));
await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('PASS: standalone integration probe prepared without environment files.');

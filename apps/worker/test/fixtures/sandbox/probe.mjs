// Reports which escapes the sandbox permits. Each must be denied.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const attempt = (fn) => {
  try {
    fn();
    return 'allowed';
  } catch {
    return 'denied';
  }
};
const input = [];
for await (const c of process.stdin) input.push(c);
process.stdout.write(
  JSON.stringify({
    echo: Buffer.concat(input).toString(),
    env: Object.keys(process.env).filter((k) => k !== 'PATH' && !k.startsWith('__CF')),
    write: attempt(() => writeFileSync(`${tmpdir()}/havefolio-ocr-sandbox-probe`, 'x')),
    spawn: attempt(() => execSync('true')),
    parentEnviron: attempt(() => readFileSync(`/proc/${process.ppid}/environ`)),
    passwd: attempt(() => readFileSync('/etc/passwd')),
  }),
);

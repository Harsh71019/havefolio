#!/usr/bin/env python3
"""Run the integration suite on existing shared services with protected test credentials."""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, required=True)
    parser.add_argument('--api-dir', type=Path, required=True)
    parser.add_argument('--image', required=True)
    args = parser.parse_args()
    if not args.state_dir.is_absolute() or args.state_dir.is_symlink() or args.state_dir.stat().st_mode & 0o077:
        raise ValueError('Protected state directory required')
    if not args.api_dir.is_absolute() or '@sha256:' not in args.image:
        raise ValueError('Absolute deployment and pinned existing Node image required')
    def read_environment(filename):
        source = args.state_dir / filename
        if source.is_symlink() or source.stat().st_mode & 0o077:
            raise ValueError('Protected environment required')
        return dict(line.split('=', 1) for line in source.read_text().splitlines()
                    if line and not line.startswith('#'))

    runtime = read_environment('.env.test.api')
    migration = read_environment('.env.test.migration')
    environment = {
        'TEST_MIGRATION_DATABASE_URL': migration['MIGRATION_DATABASE_URL'],
        'TEST_DATABASE_URL': runtime['DATABASE_URL'],
        **{'TEST_' + key: runtime[key] for key in (
            'VALKEY_HOST', 'VALKEY_PORT', 'VALKEY_USERNAME', 'VALKEY_PASSWORD')},
        'TEST_VALKEY_ACL_ENFORCED': 'true', 'NODE_ENV': 'test',
    }
    # Secret JSON goes over captured stdin, never command arguments or environment dumps.
    wrapper = """
const {readFileSync} = require('node:fs');
const {spawnSync} = require('node:child_process');
const env = {...process.env, ...JSON.parse(readFileSync(0, 'utf8'))};
const result = spawnSync(process.execPath, ['--experimental-vm-modules',
  'node_modules/jest/bin/jest.js', '--config', 'test/jest-e2e.json', '--runInBand'],
  {env, encoding: 'utf8', timeout: 120000});
process.exit(result.status === 0 ? 0 : 1);
"""
    result = subprocess.run([
        'docker', 'run', '--rm', '-i', '--network', 'shared-services',
        '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--user', '65534:65534', '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--pull', 'never',
        '-v', str(args.api_dir) + ':/probe:ro', '-w', '/probe',
        args.image, 'node', '-e', wrapper,
    ], input=json.dumps(environment), capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError('Integration verification failed; details withheld')
    print('PASS: NestJS integration, empty migrations, runtime DDL denial, concurrent namespaces and bounded teardown on shared test services.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError):
        print('FAIL: shared test verification stopped; details withheld.', file=sys.stderr)
        sys.exit(1)

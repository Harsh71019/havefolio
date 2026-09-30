#!/usr/bin/env python3
"""Run a disposable Node verifier using deployed, lockfile-pinned worker dependencies."""
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import sys

from provision import Failure, credentials, redis, require, run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--worker-dir", type=Path, required=True)
    parser.add_argument("--image", required=True, help="Already-pulled node image pinned by digest")
    args = parser.parse_args()
    require("@sha256:" in args.image, "Pin the disposable verifier image by digest.")
    require(args.state_dir.is_absolute() and args.state_dir.stat().st_mode & 0o077 == 0,
            "Use the protected operator state directory.")
    require((args.state_dir / "credentials.json").exists(), "Provision credentials first.")
    require(args.worker_dir.is_absolute(), "Use the absolute disposable worker deployment directory.")
    creds = credentials(args.state_dir)["test"]
    queue_name = "per3-" + secrets.token_hex(8)
    prefix = "havefolio:test"
    payload = {"api": {"username": "havefolio_test_api", "password": creds["api"]},
               "worker": {"username": "havefolio_test_worker", "password": creds["worker"]},
               "queueName": queue_name, "prefix": prefix}
    try:
        result = run(["docker", "run", "--rm", "-i", "--network", "shared-services",
                      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                      "--user", "65534:65534", "--memory", "128m", "--cpus", "0.5",
                      "--pids-limit", "64", "--pull", "never",
                      "-v", str(args.worker_dir) + ":/probe:ro", "-w", "/probe",
                      args.image, "node", "test/shared-services.smoke.mjs"], json.dumps(payload), check=False)
        require(result.returncode == 0, "Pinned BullMQ smoke failed (output withheld).")
        print("PASS: pinned BullMQ producer/worker completed a job with separate test ACL identities.")
    finally:
        # Global key discovery is unavailable to the application identities. Only the
        # operator discovers/cleans the exact random probe queue, never an app namespace.
        pattern = prefix + ":" + queue_name + ":*"
        cursor = "0"
        while True:
            cursor, keys = redis([["SCAN", cursor, "MATCH", pattern, "COUNT", "100"]])[0]
            require(all(key.startswith(prefix + ":" + queue_name + ":") for key in keys),
                    "Probe cleanup escaped its generated queue prefix.")
            if keys:
                redis([["DEL", *keys]])
            if str(cursor) == "0":
                break


if __name__ == "__main__":
    try:
        main()
    except (Failure, OSError, ValueError, subprocess.SubprocessError):
        print("FAIL: BullMQ verification stopped; details withheld.", file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Controlled shared Valkey restart; run only with human-approved maintenance."""
import argparse
import fcntl
import json
import os
import subprocess
from pathlib import Path
import sys
import time

from provision import (Failure, VK, check_health, inspect, protected_write,
                       redis, require, run, topology, volume_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--approved-restart", action="store_true", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    state = args.state_dir
    require(state.is_absolute() and state.is_dir() and state.stat().st_mode & 0o077 == 0,
            "Use the existing protected operator directory.")
    lock = (state / "operator.lock").open("w")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    topology()
    require(volume_path(VK, "/data/havefolio-users.acl").exists(),
            "Provision and verify ACLs before configuring persistence.")
    container = inspect(VK)
    labels = container["Config"]["Labels"]
    files = labels["com.docker.compose.project.config_files"].split(",")
    compose = Path(files[0])
    require(not compose.is_symlink(), "Refusing Compose symlink.")
    original = compose.read_text()
    for override in files[1:]:
        require("  redis:\n" not in Path(override).read_text(),
                "Redis override requires operator review before persistence changes.")
    service = labels["com.docker.compose.service"]
    project = labels["com.docker.compose.project"]
    require(service == "redis", "Unexpected existing service name.")
    command = '    command: ["valkey-server", "--aclfile", "/data/havefolio-users.acl"]\n'
    if command in original and container["Config"]["Cmd"] == ["valkey-server", "--aclfile", "/data/havefolio-users.acl"]:
        print("PASS: durable ACL startup already configured; no restart needed.")
        return
    require(container["Config"]["Cmd"] == ["valkey-server"], "Non-default startup requires manual review.")
    require(original.count("  redis:\n") == 1, "Unexpected Compose layout.")
    block = original.split("  redis:\n", 1)[1].split("\n  ", 1)[0]
    require("command:" not in block, "Existing service command requires manual review.")
    if not (state / "compose.before").exists():
        protected_write(state / "compose.before", original)
    # Keep the complete existing ACL snapshot and data snapshot private for recovery.
    require(redis([["BGSAVE"]])[0] in ("Background saving started", "Background saving already in progress"),
            "Pre-restart snapshot could not start.")
    for _ in range(60):
        info = redis([["INFO", "persistence"]])[0]
        if "rdb_bgsave_in_progress:0" in info:
            require("rdb_last_bgsave_status:ok" in info, "Pre-restart snapshot failed.")
            break
        time.sleep(1)
    else:
        raise Failure("Snapshot timed out; restart cancelled.")
    snapshot = volume_path(VK, "/data/dump.rdb")
    if snapshot.exists() and not (state / "dump.rdb.before").exists():
        # binary protected copy without loading the dataset into memory
        import shutil
        shutil.copyfile(snapshot, state / "dump.rdb.before")
        os.chmod(state / "dump.rdb.before", 0o600)
    updated = original.replace("  redis:\n", "  redis:\n" + command)
    attributes = compose.stat()
    protected_write(compose, updated)
    os.chown(compose, attributes.st_uid, attributes.st_gid)
    os.chmod(compose, attributes.st_mode & 0o777)
    compose_args = ["docker", "compose", "-p", project]
    for file in files:
        compose_args += ["-f", file]
    try:
        run([*compose_args, "config", "--quiet"])
        run([*compose_args, "up", "-d", "--no-deps", "--no-build", "--pull", "never", service])
        for _ in range(60):
            try:
                topology()
                check_health(json.loads((state / "health.before.json").read_text()))
                break
            except Failure:
                time.sleep(1)
        else:
            raise Failure("Existing services did not recover within the maintenance window.")
        require(inspect(VK)["Config"]["Cmd"] == ["valkey-server", "--aclfile", "/data/havefolio-users.acl"], "ACL startup command was not applied.")
        require(redis([["CONFIG", "GET", "aclfile"]])[0]["aclfile"] == "/data/havefolio-users.acl", "ACL startup persistence failed.")
    except (Failure, OSError):
        protected_write(compose, original)
        os.chown(compose, attributes.st_uid, attributes.st_gid)
        os.chmod(compose, attributes.st_mode & 0o777)
        run([*compose_args, "up", "-d", "--no-deps", "--no-build", "--pull", "never", service])
        raise Failure("Persistence/recovery check failed; original Compose restored. Re-run provisioning before using Havefolio.") from None
    print("PASS: approved Valkey restart completed, ACLs loaded from persistent volume, existing consumers recovered.")


if __name__ == "__main__":
    try:
        main()
    except Failure as error:
        print("FAIL: " + str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        print("FAIL: operator configuration unsupported; output withheld.", file=sys.stderr)
        sys.exit(1)

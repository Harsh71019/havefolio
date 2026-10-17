#!/usr/bin/env python3
"""CT102-only bounded resource checks. Read-only by default; --notify sends fixed ntfy codes."""
import argparse
import datetime
import fcntl
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit

SERVICES = ("api", "worker", "web")


def number(value):
    value = float(str(value).removesuffix("%"))
    if not math.isfinite(value) or value < 0:
        raise ValueError("Invalid resource measurement")
    return value


def docker(*args):
    return subprocess.check_output(
        ["docker", *args], timeout=10, stderr=subprocess.DEVNULL
    )


def collect(glitchtip_probe=None):
    names = [f"havefolio-{s}-1" for s in SERVICES]
    containers = json.loads(docker("inspect", *names))
    stats = [json.loads(line) for line in docker(
        "stats", "--no-stream", "--format", "{{json .}}", *names
    ).splitlines()]
    usage = {x["Name"]: x for x in stats}
    result = {}
    for c in containers:
        service = c["Config"]["Labels"]["com.docker.compose.service"]
        if service not in SERVICES or c["Config"]["Labels"]["com.docker.compose.project"] != "havefolio":
            raise ValueError("Unexpected service")
        stat = usage.get(c["Name"].lstrip("/"))
        cpus = c["HostConfig"]["NanoCpus"] / 1e9
        limit = c["HostConfig"]["Memory"]
        if cpus <= 0 or limit <= 0:
            raise ValueError("Resource limits missing")
        result[service] = {
            "id": c["Id"], "restarts": c["RestartCount"],
            "healthy": c["State"]["Running"] and not c["State"]["Restarting"]
            and c["State"].get("Health", {}).get("Status", "healthy") != "unhealthy",
            "cpuPercentOfLimit": number(stat["CPUPerc"]) / cpus if stat else None,
            "memoryPercentOfLimit": number(stat["MemPerc"]) if stat else None,
            "cpuLimit": cpus, "memoryLimitBytes": limit,
        }
    if set(result) != set(SERVICES):
        raise ValueError("Missing service")
    disk = os.statvfs("/")
    # Match df: reserved blocks are unavailable to application processes.
    used = disk.f_blocks - disk.f_bfree
    disk_percent = 100 * used / (used + disk.f_bavail)
    snapshot = {"diskPercent": disk_percent, "containers": result}
    if glitchtip_probe:
        try:
            raw = subprocess.check_output(
                ["docker", "exec", "-i", "glitchtip-web-1", "python", "-"],
                input=glitchtip_probe.read_bytes(), timeout=5, stderr=subprocess.DEVNULL,
            )
            count = json.loads(raw)["errorThresholdReached"]
            if not isinstance(count, bool):
                raise ValueError("Invalid threshold")
            snapshot["glitchtipErrorThresholdReached"] = count
        except Exception:
            snapshot["glitchtipErrorThresholdReached"] = None
    return snapshot


def evaluate(snapshot, state, policy, now):
    """Only fixed codes and counters enter state; measurements never become ntfy text."""
    config = policy["alerts"]["resources"]
    if now - state.get("lastPoll", now) > 120:
        for entry in state.get("alerts", {}).values():
            entry["failures"] = entry["successes"] = 0
    conditions = {"HOST_DISK_PRESSURE": (snapshot["diskPercent"] >= config["diskPercent"], config["diskFailureThreshold"])}
    if "glitchtipErrorThresholdReached" in snapshot:
        result = snapshot["glitchtipErrorThresholdReached"]
        conditions["GLITCHTIP_ERRORS"] = (result, 1)
        conditions["GLITCHTIP_PROBE_UNAVAILABLE"] = (result is None, 3)
    history = state.setdefault("containers", {})
    for service in SERVICES:
        current = snapshot["containers"][service]
        old = history.get(service, {})
        samples = old.get("samples", []) if old.get("id") == current["id"] else []
        samples = [s for s in samples if 0 <= now - s[0] <= config["restartWindowMinutes"] * 60]
        samples.append([now, current["restarts"]])
        # First observation establishes the baseline; known unhealthy containers still alert.
        restarts = current["restarts"] - samples[0][1]
        history[service] = {"id": current["id"], "samples": samples[-6:]}
        prefix = service.upper()
        conditions[prefix + "_RESTART_LOOP"] = (restarts >= config["restartCount"] or not current["healthy"], 1 if restarts >= config["restartCount"] else 3)
        for field, suffix, threshold in [
            ("cpuPercentOfLimit", "CPU_PRESSURE", "cpuPercentOfLimit"),
            ("memoryPercentOfLimit", "MEMORY_PRESSURE", "memoryPercentOfLimit"),
        ]:
            value = current[field]
            conditions[prefix + "_" + suffix] = (None if value is None else value >= config[threshold], config["resourceFailureThreshold"])
    events = []
    alerts = state.setdefault("alerts", {})
    for code, (bad, threshold) in conditions.items():
        entry = alerts.setdefault(code, {"failures": 0, "successes": 0, "active": False})
        if bad is None:
            continue  # Missing measurement cannot resolve an active incident.
        entry["failures"] = min(threshold, entry["failures"] + 1) if bad else 0
        entry["successes"] = min(config["successThreshold"], entry["successes"] + 1) if not bad else 0
        active = entry["active"]
        if not active and entry["failures"] >= threshold:
            events.append({"code": code, "status": "firing"})
        elif active and entry["successes"] >= config["successThreshold"]:
            events.append({"code": code, "status": "resolved"})
    return events


def notify(event, endpoint, token=None):
    url = urlsplit(endpoint)
    if url.scheme not in ("http", "https") or url.username or url.password or url.query or url.fragment or not re.fullmatch(r"/[A-Za-z0-9_-]+", url.path):
        raise ValueError("Invalid ntfy destination")
    valid_code = re.fullmatch(r"(?:HOST|API|WEB|WORKER)_(?:DISK_PRESSURE|CPU_PRESSURE|MEMORY_PRESSURE|RESTART_LOOP)", event["code"]) or event["code"] in ("GLITCHTIP_ERRORS", "GLITCHTIP_PROBE_UNAVAILABLE")
    if not valid_code or event["status"] not in ("firing", "resolved"):
        raise ValueError("Invalid notification")
    body = f"Havefolio {event['code']} {event['status']}. Inspect the resource dashboard and deployment health."
    headers = {"Title": "Havefolio resource alert", "Priority": "3", "Content-Type": "text/plain"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(endpoint, body.encode(), headers, method="POST")
    with urllib.request.urlopen(request, timeout=3) as response:
        if response.status != 200:
            raise ValueError("ntfy rejected notification")
        response.read(4096)


def atomic_state(path, state):
    fd, name = tempfile.mkstemp(prefix=".state-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(state, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", required=True, type=Path)
    parser.add_argument("--state", default=Path("/var/lib/havefolio-telemetry/resources.json"), type=Path)
    parser.add_argument("--notify", action="store_true")
    parser.add_argument("--glitchtip-probe", type=Path)
    args = parser.parse_args()
    policy = json.loads(args.policy.read_text())
    snapshot = collect(args.glitchtip_probe)
    if not args.notify:
        # No state writes, no notifications, no environment values in the report.
        print(json.dumps({"checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), **snapshot}))
        return
    endpoint = os.environ["HAVEFOLIO_NTFY_URL"]
    args.state.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (args.state.parent / "resources.lock").open("a") as lock:
        os.chmod(lock.name, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        state = json.loads(args.state.read_text()) if args.state.exists() else {}
        now = time.time()
        # A retry or manually repeated invocation cannot accelerate sustained thresholds.
        if now - state.get("lastPoll", 0) < 55:
            return
        events = evaluate(snapshot, state, policy, now)
        state["lastPoll"] = now
        failed = False
        for event in events:
            try:
                notify(event, endpoint, os.environ.get("HAVEFOLIO_NTFY_TOKEN"))
                state["alerts"][event["code"]]["active"] = event["status"] == "firing"
            except Exception:
                failed = True  # Retry next poll; never persist unconfirmed delivery.
        atomic_state(args.state, state)
        print(json.dumps({"event": "telemetry_resource_check", "notificationAttempts": len(events), "deliveryFailed": failed}))
        if failed:
            sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"event": "telemetry_resource_check_failed"}))
        sys.exit(1)

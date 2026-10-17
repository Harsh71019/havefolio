import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("resources", HERE / "check-resources.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
POLICY = json.loads((HERE.parent.parent / "deployment/telemetry/policy.json").read_text())


def snapshot():
    return {"diskPercent": 50, "containers": {
        s: {"id": s, "restarts": 0, "healthy": True, "cpuPercentOfLimit": 1,
            "memoryPercentOfLimit": 10, "cpuLimit": 1, "memoryLimitBytes": 1024}
        for s in module.SERVICES
    }}


def commit(state, events):
    for e in events:
        state["alerts"][e["code"]]["active"] = e["status"] == "firing"


class ResourceTests(unittest.TestCase):
    def test_disk_sustained_failure_sends_once_and_resolves_after_two_successes(self):
        s = snapshot()
        state = {}
        s["diskPercent"] = 86
        for minute in range(2):
            self.assertEqual(module.evaluate(s, state, POLICY, minute * 60), [])
        events = module.evaluate(s, state, POLICY, 120)
        self.assertEqual(events, [{"code": "HOST_DISK_PRESSURE", "status": "firing"}])
        commit(state, events)
        for minute in range(3, 30):
            self.assertEqual(module.evaluate(s, state, POLICY, minute * 60), [])
        s["diskPercent"] = 60
        self.assertEqual(module.evaluate(s, state, POLICY, 1800), [])
        events = module.evaluate(s, state, POLICY, 1860)
        self.assertEqual(events, [{"code": "HOST_DISK_PRESSURE", "status": "resolved"}])
        commit(state, events)
        self.assertEqual(module.evaluate(s, state, POLICY, 1920), [])

    def test_restart_window_is_per_container_and_rollouts_reset_the_baseline(self):
        s = snapshot()
        state = {}
        module.evaluate(s, state, POLICY, 0)
        s["containers"]["worker"]["restarts"] = 3
        events = module.evaluate(s, state, POLICY, 60)
        self.assertEqual(events, [{"code": "WORKER_RESTART_LOOP", "status": "firing"}])
        commit(state, events)
        s["containers"]["worker"]["id"] = "replacement"
        s["containers"]["worker"]["restarts"] = 0
        self.assertEqual(module.evaluate(s, state, POLICY, 120), [])
        self.assertEqual(module.evaluate(s, state, POLICY, 180), [{"code": "WORKER_RESTART_LOOP", "status": "resolved"}])
        self.assertNotIn("replacement", json.dumps(events))

    def test_cpu_and_memory_need_five_polls_and_missing_data_cannot_resolve(self):
        s = snapshot()
        state = {}
        s["containers"]["api"]["cpuPercentOfLimit"] = 90
        s["containers"]["api"]["memoryPercentOfLimit"] = 95
        for minute in range(4):
            self.assertEqual(module.evaluate(s, state, POLICY, minute * 60), [])
        events = module.evaluate(s, state, POLICY, 240)
        self.assertEqual(len(events), 2)
        commit(state, events)
        s["containers"]["api"]["cpuPercentOfLimit"] = None
        s["containers"]["api"]["memoryPercentOfLimit"] = None
        for minute in range(5, 10):
            self.assertEqual(module.evaluate(s, state, POLICY, minute * 60), [])

    def test_failed_delivery_is_retried_instead_of_marked_active(self):
        s = snapshot()
        state = {}
        s["containers"]["worker"]["healthy"] = False
        module.evaluate(s, state, POLICY, 0)
        module.evaluate(s, state, POLICY, 60)
        e = module.evaluate(s, state, POLICY, 120)
        self.assertEqual(e, module.evaluate(s, state, POLICY, 180))
        commit(state, e)
        self.assertEqual(module.evaluate(s, state, POLICY, 240), [])

    def test_notification_contains_only_fixed_codes_and_never_source_content(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, n): return b"{}"
        with patch.object(module.urllib.request, "urlopen", return_value=Response()) as send:
            module.notify({"code": "WORKER_RESTART_LOOP", "status": "firing", "private": "canary-secret"}, "http://localhost/telemetry", "test-only-token")
            request = send.call_args.args[0]
            self.assertNotIn(b"canary-secret", request.data)
            self.assertNotIn(b"test-only-token", request.data)
            self.assertEqual(send.call_args.kwargs["timeout"], 3)
            for code in ["private note", "HOST_DISK_PRESSURE\nforged", "password"]:
                with self.assertRaises(ValueError):
                    module.notify({"code": code, "status": "firing"}, "http://localhost/telemetry")
            self.assertEqual(send.call_count, 1)

    def test_state_is_private_atomic_and_contains_no_snapshot_payload(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "state.json"
            state = {}
            s = snapshot()
            s["privateNote"] = "private-canary"
            module.evaluate(s, state, POLICY, 0)
            module.atomic_state(p, state)
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("private-canary", p.read_text())
            self.assertEqual(json.loads(p.read_text()), state)

    def test_long_idle_gap_cannot_accumulate_restart_events(self):
        s = snapshot()
        state = {}
        module.evaluate(s, state, POLICY, 0)
        s["containers"]["worker"]["restarts"] = 4
        self.assertEqual(module.evaluate(s, state, POLICY, 3600), [])

    def test_gap_resets_sustained_pressure_counters_without_false_recovery(self):
        s = snapshot()
        s["diskPercent"] = 90
        state = {}
        module.evaluate(s, state, POLICY, 0)
        module.evaluate(s, state, POLICY, 60)
        state["lastPoll"] = 60
        self.assertEqual(module.evaluate(s, state, POLICY, 3600), [])

    def test_glitchtip_threshold_and_probe_outage_are_distinct_and_deduplicated(self):
        s = snapshot()
        state = {}
        s["glitchtipErrorThresholdReached"] = True
        events = module.evaluate(s, state, POLICY, 0)
        self.assertEqual(events, [{"code": "GLITCHTIP_ERRORS", "status": "firing"}])
        commit(state, events)
        self.assertEqual(module.evaluate(s, state, POLICY, 60), [])
        s["glitchtipErrorThresholdReached"] = None
        for minute in [2, 3]:
            self.assertEqual(module.evaluate(s, state, POLICY, minute * 60), [])
        events = module.evaluate(s, state, POLICY, 240)
        self.assertEqual(events, [{"code": "GLITCHTIP_PROBE_UNAVAILABLE", "status": "firing"}])
        commit(state, events)
        s["glitchtipErrorThresholdReached"] = False
        self.assertEqual(module.evaluate(s, state, POLICY, 300), [])
        events = module.evaluate(s, state, POLICY, 360)
        self.assertEqual({e["code"] for e in events}, {"GLITCHTIP_ERRORS", "GLITCHTIP_PROBE_UNAVAILABLE"})
        self.assertTrue(all(e["status"] == "resolved" for e in events))


if __name__ == "__main__":
    unittest.main()

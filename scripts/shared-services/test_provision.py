"""Pure safety-policy tests; no Docker access or service mutations."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from provision import DATABASES, COMMANDS, BEGIN, END, Failure, acl_rules, hba_block, protected_write, redis


class PolicyTests(unittest.TestCase):
    def test_hba_first_match_scopes_every_role_to_one_database(self):
        lines = hba_block().splitlines()
        self.assertEqual(lines[0] + "\n", BEGIN)
        self.assertEqual(lines[-1] + "\n", END)
        for db in DATABASES.values():
            for suffix in ("_migrate", "_runtime"):
                role = db + suffix
                rules = [line.split() for line in lines if role in line.split()]
                for connection in ("local", "host"):
                    relevant = [rule for rule in rules if rule[0] == connection]
                    self.assertEqual(relevant[0][1], db)
                    self.assertEqual(relevant[0][-1], "scram-sha-256")
                    self.assertTrue(all(rule[-1] == "reject" for rule in relevant if rule[1] == "all"))
        self.assertNotIn("treasury_ops", hba_block())
        self.assertNotIn(" all all ", hba_block())

    def test_acl_denies_global_discovery_admin_and_unbounded_keys(self):
        for env in DATABASES:
            rules = acl_rules(env, "test-password")
            self.assertIn("-@all", rules)
            self.assertIn("~havefolio:" + env + ":*", rules)
            self.assertIn("&havefolio:" + env + ":*", rules)
            self.assertIn("#" + hashlib.sha256(b"test-password").hexdigest(), rules)
            self.assertNotIn("test-password", rules)
            self.assertEqual([r for r in rules if r.startswith("~")], ["~havefolio:" + env + ":*"])
        for denied in ("acl", "config", "flushall", "flushdb", "keys", "scan", "randomkey", "monitor", "script|flush"):
            self.assertNotIn(denied, COMMANDS)
        for required in ("eval", "evalsha", "bzpopmin", "xadd", "lpos", "rename", "type"):
            self.assertIn(required, COMMANDS)

    def test_cli_errors_and_verbatim_info_are_parsed_without_echoing_credentials(self):
        with patch("provision.run", return_value=SimpleNamespace(stdout='"OK"\nerror:"NOPERM denied"\n')) as command:
            reply = redis([["GET", "outside:probe"]], "probe-user", "probe-password")
            self.assertEqual(reply, [{"error": "NOPERM denied"}])
            self.assertNotIn("probe-password", " ".join(command.call_args.args[0]))
        with patch("provision.run", return_value=SimpleNamespace(stdout="# Persistence\r\nrdb_bgsave_in_progress:0\r\n")):
            self.assertIn("rdb_bgsave_in_progress:0", redis([["INFO", "persistence"]])[0])

    def test_protected_write_is_atomic_private_and_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "secret"
            protected_write(path, "first")
            protected_write(path, "second")
            self.assertEqual(path.read_text(), "second")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            link = Path(directory) / "link"
            link.symlink_to(path)
            with self.assertRaises(Failure):
                protected_write(link, "third")
            self.assertEqual(path.read_text(), "second")


if __name__ == "__main__":
    unittest.main()

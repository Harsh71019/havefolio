#!/usr/bin/env python3
"""CT102 operator tool. Captures all service output; never prints credentials."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time

DATABASES = {"dev": "havefolio_dev", "test": "havefolio_test", "production": "havefolio"}
PG = "shared-postgres"
VK = "shared-redis"
BEGIN = "# BEGIN HAVEFOLIO PER-3\n"
END = "# END HAVEFOLIO PER-3\n"
# Explicit commands, rather than categories which can grow on service upgrades.
COMMANDS = """ping echo quit select info multi exec discard watch unwatch
get set setnx mget mset del unlink exists expire pexpire expireat pexpireat ttl pttl persist
incr incrby decr decrby hget hset hsetnx hdel hexists hgetall hincrby hkeys hlen hmget hmset hvals
lpush rpush lpop rpop rpoplpush brpoplpush lrange llen lrem ltrim lset lindex lpos rename type
sadd srem smembers scard sismember spop
zadd zrem zscore zcard zcount zrange zrangebyscore zrevrange zrank zrevrank
zremrangebyrank zremrangebyscore zpopmin zpopmax bzpopmin zmscore zrevrangebyscore
xadd xdel xlen xrange xrevrange xread xtrim xinfo
publish subscribe psubscribe unsubscribe punsubscribe eval evalsha
script|load script|exists client|setname client|id client|setinfo""".split()


class Failure(Exception):
    pass


def run(args, data=None, check=True):
    result = subprocess.run(args, input=data, capture_output=True, text=True, timeout=90)
    if check and result.returncode:
        raise Failure("Service command failed (output withheld).")
    return result


def inspect(name):
    return json.loads(run(["docker", "inspect", name]).stdout)[0]


def admin_sql(sql, db="postgres"):
    # Existing administrator is obtained inside the container, never copied to files.
    return run(["docker", "exec", "-i", PG, "sh", "-c",
                'exec psql -U "$POSTGRES_USER" -d "$1" -XAtq -v ON_ERROR_STOP=1',
                "sh", db], "SET log_statement=none; SET log_min_error_statement=panic;\n" + sql).stdout.strip()


def role_sql(db, role, password, sql):
    return run(["docker", "exec", "-i", PG, "sh", "-c",
                'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -h shared-postgres '
                '-U "$1" -d "$2" -XAtq -v ON_ERROR_STOP=1', "sh", role, db],
               password + "\n" + sql, check=False)


def redis(commands, user=None, password=None):
    # Interactive CLI input is captured; neither secrets nor server errors are echoed.
    commands = ([['AUTH', user, password]] if user else []) + commands
    data = "\n".join(" ".join(json.dumps(str(v)) for v in cmd) for cmd in commands) + "\n"
    result = run(["docker", "exec", "-i", VK, "valkey-cli", "-h", VK, "--json"], data)
    if not user and len(commands) == 1 and commands[0][0] == "INFO" and result.stdout.startswith("#"):
        return [result.stdout]
    try:
        replies = [{"error": json.loads(line[6:])} if line.startswith("error:") else json.loads(line)
                   for line in result.stdout.splitlines()]
    except ValueError:
        raise Failure("Unexpected Valkey response (output withheld).") from None
    if user:
        if replies.pop(0) != "OK":
            raise Failure("Dedicated Valkey authentication failed.")
    return replies


def require(condition, message):
    if not condition:
        raise Failure(message)


def protected_write(path, text):
    require(not path.is_symlink(), "Refusing a symlink in operator state.")
    temporary = path.with_name(path.name + ".new")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def volume_path(container, destination):
    mounts = [m for m in inspect(container)["Mounts"]
              if destination == m["Destination"] or destination.startswith(m["Destination"] + "/")]
    require(bool(mounts), "Configuration must reside on an existing persistent volume.")
    mount = max(mounts, key=lambda m: len(m["Destination"]))
    return Path(mount["Source"]) / destination[len(mount["Destination"]):].lstrip("/")


def hba_block():
    lines = [BEGIN]
    for db in DATABASES.values():
        for role in (db + "_migrate", db + "_runtime"):
            lines += [f"local {db} {role} scram-sha-256\n",
                      f"host {db} {role} 0.0.0.0/0 scram-sha-256\n",
                      f"host {db} {role} ::/0 scram-sha-256\n",
                      f"local all {role} reject\n",
                      f"host all {role} 0.0.0.0/0 reject\n",
                      f"host all {role} ::/0 reject\n"]
    return "".join(lines) + END


def topology():
    for name in (PG, VK):
        require("shared-services" in inspect(name)["NetworkSettings"]["Networks"],
                "Existing services must be attached to shared-services.")
    require(redis([["PING"]])[0] == "PONG", "Existing Valkey administrator unavailable.")
    require(admin_sql("SELECT 1;") == "1", "Existing PostgreSQL administrator unavailable.")


def health():
    containers = json.loads(run(["docker", "inspect", *run(
        ["docker", "ps", "-aq"]).stdout.split()]).stdout)
    return {c["Name"].lstrip("/"): {"status": c["State"]["Status"],
            "health": c["State"].get("Health", {}).get("Status"),
            "restarts": c["RestartCount"]} for c in containers}


def check_health(before):
    after = health()
    for name, previous in before.items():
        if previous["status"] == "running":
            require(name in after and after[name]["status"] == "running",
                    "An existing running container did not recover.")
            if previous["health"] == "healthy":
                require(after[name]["health"] == "healthy", "An existing healthy consumer regressed.")
            require(after[name]["restarts"] == previous["restarts"],
                    "An existing running consumer restarted unexpectedly.")
    topology()


def credentials(state):
    path = state / "credentials.json"
    if path.exists():
        require(path.stat().st_mode & 0o077 == 0, "Credential file permissions are unsafe.")
        value = json.loads(path.read_text())
    else:
        value = {env: {kind: secrets.token_hex(32) for kind in
                      ("migrate", "runtime", "api", "worker")} for env in DATABASES}
        protected_write(path, json.dumps(value))
    require(set(value) == set(DATABASES) and all(
        re.fullmatch("[0-9a-f]{64}", value[e][k]) for e in DATABASES
        for k in ("migrate", "runtime", "api", "worker")), "Unexpected credentials format.")
    return value


def provision_pg(state, creds):
    existing_roles = admin_sql("SELECT rolname FROM pg_roles WHERE rolname LIKE 'havefolio%';").splitlines()
    expected = {db + suffix for db in DATABASES.values() for suffix in ("_migrate", "_runtime")}
    require(set(existing_roles) <= expected, "Unexpected Havefolio roles; manual review required.")
    # On the first attempt, do not take ownership of pre-existing data/roles.
    marker = state / "pg-managed"
    if not marker.exists():
        require(not existing_roles and not admin_sql(
            "SELECT datname FROM pg_database WHERE datname IN ('havefolio','havefolio_dev','havefolio_test');"),
            "Pre-existing Havefolio databases or roles require operator review.")
        protected_write(marker, "PER-3\n")
    for env, db in DATABASES.items():
        for kind in ("migrate", "runtime"):
            role = db + "_" + kind
            if role not in existing_roles:
                admin_sql(f"CREATE ROLE {role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;")
    # Install only matching Havefolio records. Other identities fall through unchanged.
    hba = volume_path(PG, admin_sql("SHOW hba_file;"))
    original = hba.read_text()
    if not (state / "pg_hba.before").exists():
        protected_write(state / "pg_hba.before", original)
    remainder = re.sub(re.escape(BEGIN) + ".*?" + re.escape(END), "", original, flags=re.S)
    if BEGIN in remainder or END in remainder:
        raise Failure("Malformed managed authentication block.")
    attributes = hba.stat()
    protected_write(hba, hba_block() + remainder)
    os.chown(hba, attributes.st_uid, attributes.st_gid)
    os.chmod(hba, attributes.st_mode & 0o777)
    if admin_sql("SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;") != "0":
        protected_write(hba, original)
        os.chown(hba, attributes.st_uid, attributes.st_gid)
        os.chmod(hba, attributes.st_mode & 0o777)
        raise Failure("Authentication validation failed; original file restored.")
    require(admin_sql("SELECT pg_reload_conf();") == "t", "Authentication reload failed.")
    time.sleep(1)
    for env, db in DATABASES.items():
        mig, app = db + "_migrate", db + "_runtime"
        for kind, role in (("migrate", mig), ("runtime", app)):
            admin_sql(f"ALTER ROLE {role} LOGIN PASSWORD '{creds[env][kind]}';")
        owner = admin_sql(f"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='{db}';")
        if not owner:
            admin_sql(f"CREATE DATABASE {db} OWNER {mig};")
        else:
            require(owner == mig, "Database owner drift requires operator review.")
        admin_sql(f"REVOKE ALL ON DATABASE {db} FROM PUBLIC; GRANT CONNECT ON DATABASE {db} TO {app};")
        admin_sql(f"""BEGIN;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO {app};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {app};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {app};
ALTER DEFAULT PRIVILEGES FOR ROLE {mig} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {app};
ALTER DEFAULT PRIVILEGES FOR ROLE {mig} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {app};
ALTER DEFAULT PRIVILEGES FOR ROLE {mig} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;""", db)
    print("PASS: isolated databases, six roles and targeted persistent authentication rules provisioned.")


def acl_rules(env, password):
    return ["reset", "on", "#" + hashlib.sha256(password.encode()).hexdigest(),
            "~havefolio:" + env + ":*", "&havefolio:" + env + ":*", "-@all"] + ["+" + c for c in COMMANDS]


def provision_vk(state, creds):
    if not (state / "valkey-acl.before").exists():
        protected_write(state / "valkey-acl.before", "\n".join(redis([["ACL", "LIST"]])[0]) + "\n")
    for env in DATABASES:
        for kind in ("api", "worker"):
            reply = redis([["ACL", "SETUSER", f"havefolio_{env}_{kind}", *acl_rules(env, creds[env][kind])]])[0]
            require(reply == "OK", "Valkey ACL provisioning failed.")
    current = redis([["CONFIG", "GET", "aclfile"]])[0]["aclfile"]
    require(current in ("", "/data/havefolio-users.acl"), "Existing ACL persistence requires operator review.")
    acl = volume_path(VK, "/data/havefolio-users.acl")
    if current:
        require(redis([["ACL", "SAVE"]])[0] == "OK", "Valkey ACL persistence save failed.")
    else:
        protected_write(acl, "\n".join(redis([["ACL", "LIST"]])[0]) + "\n")
        attributes = acl.parent.stat()
        os.chown(acl, attributes.st_uid, attributes.st_gid)
    os.chmod(acl, 0o600)
    # Existing default identity and every other identity remain unchanged.
    before = (state / "valkey-acl.before").read_text().splitlines()
    after = redis([["ACL", "LIST"]])[0]
    for line in before:
        if not line.startswith("user havefolio_"):
            require(line in after, "An existing Valkey ACL changed unexpectedly.")
    print("PASS: six dedicated Valkey identities restricted by environment and havefolio:* namespace.")


def env_files(state, creds):
    for env, db in DATABASES.items():
        for kind in ("api", "worker"):
            protected_write(state / f".env.{env}.{kind}",
                f"DATABASE_URL=postgresql://{db}_runtime:{creds[env]['runtime']}@{PG}:5432/{db}\n"
                f"VALKEY_HOST={VK}\nVALKEY_PORT=6379\nVALKEY_DATABASE=0\n"
                f"VALKEY_USERNAME=havefolio_{env}_{kind}\nVALKEY_PASSWORD={creds[env][kind]}\n"
                f"VALKEY_PREFIX=havefolio:{env}\n")
        protected_write(state / f".env.{env}.migration",
            f"MIGRATION_DATABASE_URL=postgresql://{db}_migrate:{creds[env]['migrate']}@{PG}:5432/{db}\n")


def verify(state, creds, require_persistence=True):
    for env, db in DATABASES.items():
        mig, app = db + "_migrate", db + "_runtime"
        flags = admin_sql(f"SELECT rolname FROM pg_roles WHERE rolname IN ('{mig}','{app}') AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit);")
        require(not flags, "Havefolio role has excessive cluster privileges.")
        require(not admin_sql(f"SELECT 1 FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('{mig}','{app}'));"), "Havefolio role has unexpected membership.")
        def query(kind, sql):
            return role_sql(db, db + "_" + kind, creds[env][kind], sql)
        probe = "per3_" + secrets.token_hex(8)
        require(query("migrate", f"CREATE TABLE public.{probe}(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);").returncode == 0, "Migration DDL failed.")
        try:
            require(query("runtime", f"INSERT INTO public.{probe}(value) VALUES ('probe'); UPDATE public.{probe} SET value='verified'; SELECT value FROM public.{probe}; DELETE FROM public.{probe};").returncode == 0, "Runtime DML/default grants failed.")
            for sql in [f"CREATE TABLE public.{probe}_denied(id int);", "SELECT rolpassword FROM pg_authid;", f"SET ROLE {mig};", "CREATE TEMP TABLE per3_temp(id int);"]:
                result = query("runtime", "BEGIN;\n" + sql + "\nROLLBACK;")
                require(result.returncode != 0, "Runtime negative privilege check unexpectedly succeeded.")
            require(query("runtime", "CREATE DATABASE per3_forbidden;").returncode != 0, "Runtime created a database unexpectedly.")
            require(query("runtime", f"SELECT has_schema_privilege(current_user,'public','CREATE'), has_database_privilege(current_user,current_database(),'CREATE'), has_database_privilege(current_user,current_database(),'TEMP');").stdout.strip() == "f|f|f", "Runtime schema/database privileges are excessive.")
            targets = admin_sql(f"SELECT datname FROM pg_database WHERE datallowconn AND datname <> '{db}';").splitlines()
            for target in targets:
                for kind in ("runtime", "migrate"):
                    denied = role_sql(target, db + "_" + kind, creds[env][kind], "SELECT 1;")
                    require(denied.returncode != 0 and "pg_hba.conf rejects connection" in denied.stderr,
                            "Cross-database authentication was not explicitly rejected.")
        finally:
            require(query("migrate", f"DROP TABLE IF EXISTS public.{probe};").returncode == 0,
                    "Probe cleanup failed; operator review required.")
        for kind in ("api", "worker"):
            user, password = f"havefolio_{env}_{kind}", creds[env][kind]
            key = f"havefolio:{env}:per3:{secrets.token_hex(8)}"
            require(redis([["SET", key, "probe", "PX", "60000"], ["GET", key], ["DEL", key]], user, password) == ["OK", "probe", 1], "Valkey own-prefix probe failed.")
            for cmd in [["GET", "treasury_ops:per3"], ["SET", "outside:per3", "x"],
                        ["MGET", key, "outside:per3"], ["EVAL", "return redis.call('GET', 'outside:per3')", "0"],
                        ["PUBLISH", "outside:per3", "x"], ["KEYS", "*"], ["SCAN", "0"],
                        ["CONFIG", "GET", "*"], ["ACL", "USERS"], ["FLUSHALL"], ["SCRIPT", "FLUSH"]]:
                reply = redis([cmd], user, password)[0]
                require(isinstance(reply, dict) and "error" in reply and
                        ("NOPERM" in reply["error"] or "ACL" in reply["error"]),
                        "Valkey namespace/admin denial did not hold.")
            other = "test" if env != "test" else "production"
            reply = redis([["GET", f"havefolio:{other}:per3"]], user, password)[0]
            require(isinstance(reply, dict) and "error" in reply, "Cross-environment Valkey isolation failed.")
    if require_persistence:
        require(redis([["CONFIG", "GET", "aclfile"]])[0]["aclfile"] == "/data/havefolio-users.acl", "ACL file is not configured at startup; complete the approved persistence step.")
    print("PASS: migration DDL/runtime DML, denied DDL/admin/cross-database connections, API/worker prefix and command isolation.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["inspect", "provision", "verify"])
    parser.add_argument("--state-dir", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    state = args.state_dir
    require(state.is_absolute() and not state.is_symlink(), "Use an absolute protected operator directory.")
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(state.stat().st_mode & 0o077 == 0, "Operator directory must have mode 0700.")
    with (state / "operator.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        topology()
        if args.action == "inspect":
            protected_write(state / "health.before.json", json.dumps(health()))
            print("PASS: existing services reachable on shared-services; health baseline saved privately.")
            return
        require((state / "health.before.json").exists(), "Run read-only inspect before provisioning.")
        if args.action == "verify":
            require((state / "credentials.json").exists(), "Missing protected credentials; do not regenerate during verification.")
        creds = credentials(state)
        if args.action == "provision":
            provision_pg(state, creds)
            provision_vk(state, creds)
            env_files(state, creds)
        verify(state, creds, require_persistence=args.action == "verify")
        check_health(json.loads((state / "health.before.json").read_text()))
        print("PASS: existing running/healthy consumers and shared services remain healthy.")


if __name__ == "__main__":
    try:
        main()
    except Failure as error:
        print("FAIL: " + str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, subprocess.SubprocessError):
        print("FAIL: provisioning/verification stopped; service output withheld. Review the operator procedure.", file=sys.stderr)
        sys.exit(1)

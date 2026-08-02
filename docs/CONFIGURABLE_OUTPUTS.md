# Configurable outputs and RESULT nodes

Decision variables remain tenant-wide, versioned catalog entries. An artifact selects catalog
versions through its graph dependencies:

- `INPUT` with `dependencyPath: input.<code>` is resolved before execution.
- `OUTPUT` with `dependencyPath: output.<code>` is produced by the graph.
- `OUTPUT_PRIMARY` is the single scalar business result. A graph with outputs must declare
  exactly one primary output.

Example graph dependency:

```json
{
  "variableVersionId": "42",
  "usageType": "OUTPUT_PRIMARY",
  "isRequired": true,
  "fallbackPolicy": "FAIL_CLOSED",
  "dependencyPath": "output.scoring"
}
```

## Visual RESULT node

The visual editor serializes no-code assignments into the same canonical graph AST used by
validation, compilation and runtime:

```json
{
  "key": "RESULT_1",
  "type": "RESULT",
  "terminal": true,
  "config": {
    "mode": "MAPPING",
    "assignments": [
      {
        "outputCode": "scoring",
        "source": "EXPRESSION",
        "expression": {
          "op": "add",
          "args": [{ "var": "bureau_score" }, { "value": 20 }]
        }
      }
    ]
  }
}
```

Assignment sources are `LITERAL`, `VARIABLE`, `EXPRESSION` and `TEMPLATE`. A RESULT node is
always terminal. Undeclared keys, missing required outputs, wrong types, invalid output paths and
multiple primary outputs fail closed.

The runtime response preserves the primary value's type:

```json
{
  "status": "SUCCEEDED",
  "primaryResult": { "code": "scoring", "value": 700 },
  "output": { "scoring": 700, "risk_band": "LOW" },
  "outcome": "700"
}
```

`outcome` remains a string compatibility alias. `primaryResult` and `output` are canonical.

## JavaScript and Python

Set `mode: SCRIPT` and provide `config.script.language` plus `config.script.source`. JavaScript
must return an object; Python must assign an object to `result`. Returned keys are checked against
the declared output contract.

Script execution is disabled by default (`SCRIPT_NODES_ENABLED=false`). `ScriptNodeRunnerService`
supports two modes, controlled by `SCRIPT_RUNNER_MODE`:

- `IN_PROCESS` (default): spawns python/node as a sibling process of the API itself. This is a
  short-lived subprocess with source/output size caps, a timeout, restricted Python builtins and
  deterministic JavaScript globals — good enough for local development and unit tests, but it
  shares the API container's filesystem and network, so it is **not an OS security boundary**.
  The env schema refuses `SCRIPT_NODES_ENABLED=true` in production unless `SCRIPT_RUNNER_MODE` is
  `SIDECAR`.
- `SIDECAR`: delegates execution to the `script-runner` service (source in `runner/`, built from
  the `script-runner` stage in the `Dockerfile`) over a Unix socket shared via a Docker volume
  (`atlas_runner_socket`, see `docker-compose.yml`). That container:
  - has **no network** (`network_mode: none`) — a compromised script cannot reach Postgres, Redis
    or the internet, only the API can reach it, over the filesystem socket;
  - runs as an unprivileged, non-root user with `cap_drop: ALL` and `read_only: true`;
  - is capped on CPU, memory and process count (`cpus`, `mem_limit`, `pids_limit`);
  - runs under the **gVisor** (`runsc`) container runtime instead of the default `runc`, which
    intercepts syscalls in userspace and is the actual OS security boundary the in-process mode
    lacks — the same approach Google Cloud Run/GKE Sandbox use for untrusted code execution.

  The runner executes scripts asynchronously and admits at most `RUNNER_MAX_CONCURRENCY` (4)
  at a time with `RUNNER_MAX_QUEUE` (64) waiting — kept well under the container's `pids_limit`,
  since each interpreter costs several pids. Beyond that it answers **503
  `SCRIPT_RUNNER_BUSY`**, which the API treats as a transient failure: the reservation is
  released so the caller can retry the same idempotency key, because the script never ran and
  no decision was made. Every infrastructure-level runner failure behaves the same way
  (`SCRIPT_RUNNER_UNAVAILABLE`, script nodes disabled); only a genuinely deterministic outcome
  — invalid script, non-serializable output — is a cached 4xx.

  Enabling this in production requires gVisor installed on the Docker host and registered as a
  runtime (once per host):

  ```bash
  # https://gvisor.dev/docs/user_guide/install/
  curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list
  sudo apt-get update && sudo apt-get install -y runsc
  sudo runsc install   # registers the `runsc` runtime in /etc/docker/daemon.json
  sudo systemctl restart docker
  ```

  Then set `SCRIPT_NODES_ENABLED=true` with `SCRIPT_RUNNER_MODE=SIDECAR` (already the default in
  `docker-compose.yml`). On a host without gVisor, remove the `runtime: runsc` line for local
  testing only — never in production, since the other hardening flags (`cap_drop`, `read_only`,
  `network_mode: none`, resource limits) reduce blast radius but do not replace a real kernel
  isolation boundary.

Why not a bigger/managed sandbox instead? Firecracker microVMs give stronger isolation but need a
KVM-capable host and a warm-pool VMM to hit the ~250ms budget — more operational cost than this
low-volume, experimental feature justifies today. Self-hosted multi-language judges (Piston,
Judge0) solve the same problem but isolate with plain namespaces/cgroups/chroot, which is roughly
the same trust boundary as a well-configured container — adopting one would add a third-party
project's attack surface without raising the security bar past what gVisor already gives us here.
Third-party SaaS sandboxes (E2B, Modal, ...) are not an option: they would send a tenant's
proprietary decision-scoring source code to external infrastructure, unacceptable for this
platform (see `SECURITY.md`). `vm2` is unmaintained with known sandbox escapes and must never be
used; `isolated-vm` only isolates JavaScript (no Python) and is a V8-level, not OS-level, boundary.

Legacy `END`, `SET_OUTCOME`, `SET_SCORE`, `SET_LIMIT` and `SET_RISK_BAND` graphs remain supported.

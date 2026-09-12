# M0: reproducible Codex naming baseline

Status: tooling and acceptance procedure implemented; naming-candidate
qualification and native-client UAT are pending. This milestone does not certify
the concurrent name-sync implementation or authorize M1 to start.

## Ownership and scope

The name-sync workstream owns the plugin/runtime change and its release revision.
This workstream owns evidence collection and the acceptance gate. Do not stage,
commit, deploy, or overwrite another workstream's working-tree changes to make a
candidate appear clean. Use a committed candidate or report it as provisional.

All new tooling lives in wmux. Collection reads existing supported native APIs;
it does not install/configure Codex, start another App Server, resume a task,
write native names, or change hook trust. Native-client UAT changes only the
disposable tasks' names through their ordinary client controls. Existing native
installation/trust/endpoint gaps are recorded, not repaired by this milestone.

## Candidate and evidence collection

The collector can run from the M0 checkout against the naming workstream's
checkout, so neither workstream needs to borrow the other's index or branch.
Replace paths and the exact task ID with explicitly selected local values.

```sh
mkdir -p test-results
npm run codex:baseline -- --out test-results/codex-m0-capture-01 \
  --source-root /path/to/committed/wmux-candidate \
  --installed-plugin /path/to/installed/wmux-plugin \
  --deployed-root /path/to/wmux-release \
  --thread-id EXACT_DISPOSABLE_ROOT_THREAD_ID
```

Omit `--thread-id` to omit native task reads. Use `--socket
/absolute/private/socket` only with an exact task ID when the already configured
native endpoint differs from the default. Environment-selected sockets are
respected. A default daemon version probe describes only that daemon: it does
not establish the version or runtime ownership of another selected endpoint.
Record that other endpoint's version separately using its supported interface.

The new output directory must have an existing parent and must not already exist.
It contains an owner-only `baseline.json` and the locally generated experimental
schema. Failures leave a partial bundle; use a new directory for the next attempt.
The tool emits only bounded summary metadata, never a native task title, ID,
transcript, socket address, daemon path, credential, or binding receipt.
Keep bundles under ignored `test-results/`; review before publishing even when
their contents are sanitized. Do not commit raw schema exports or test logs.

`baseline.json` records:

- Collector commit and candidate commit/tree, clean/dirty flag and tracked patch
  hash. A dirty candidate is diagnostic evidence, not reproducible release proof.
- Source plugin version, complete file hashes and aggregate content hash. The
  presence of a name observer is recorded as a source fact, not certification.
- Optional installed plugin version/hash and differing files. A cachebuster
  version can explain a manifest-only difference; review it explicitly. Any
  executable, hook, or MCP difference requires a matching artifact or revalidation.
- Optional deployed source hashes. Source matches do not establish that a built
  server process is running that code; record build identity separately.
- Installed CLI and default daemon versions, generated-schema capability flags,
  and optional exact-root metadata visibility. A name notification does not prove
  observation subscription; `notLoaded` does not prove current runtime ownership.
- `nativeUat: pending`. The collector never signs off native-client behavior.

Re-run collection after choosing the final candidate and before UAT. If source
changes during capture the collector fails rather than combining revisions.
If code changes after engineering/UAT evidence, identify which checks are
invalidated and rerun them for the replacement candidate.

## Automated qualification

```sh
npm run test:codex:m0
```

This runs the Codex tests present in the checkout plus binding-store, plugin MCP,
and hook-installer tests. It intentionally works before and after the naming
workstream lands; a green suite on the older profile is not native-name proof.
Check the report's profile/artifact identity and the actual test names/skips.

Run required full checks using [VERIFICATION.md](VERIFICATION.md) on a clean,
committed candidate. Focused browser checks for this baseline are:

```sh
npx playwright test e2e/codex-sidebar-lifecycle.spec.ts \
  e2e/codex-durable-reconnect.spec.ts --project=chromium --project=mobile-chromium
```

Run on the external POSIX runner using isolated fixtures. These specs inject
native lifecycle data; they are wmux browser tests, not native Codex acceptance.
Require real tmux for the durable test and record skips as missing evidence.
Keep screenshots limited to sanitized chrome; traces and terminal output may
contain fixture tokens or binding markers and must remain private.

| Engineering case | Existing fixture / expected evidence |
| --- | --- |
| Exact native read, no control or approval responses | `test/codex-rpc.test.ts` |
| Missing/unsafe name, delayed read, outage, unpin recovery | `test/codex-name-observer.test.ts` when supplied by the naming candidate |
| Private receipt, concurrent pane conflict, expiry, replacement | `test/codex-terminal-binding.test.ts`, `test/wmux-binding-store.test.ts` |
| Bound turn status and loss of confidence | `test/codex-lifecycle*.test.ts`, `test/codex-observer.test.ts` |
| Real HTTP, PTY/tmux, observer and SessionEnd wiring | `test/codex-observer-integration.test.ts`, `test/codex-plugin-terminal-integration.test.ts` |
| MCP compatibility and source-of-truth policy | `test/wmux-plugin-mcp.test.ts` |
| Baseline hashes, sanitization, exact-root read-only collection | `test/codex-baseline.test.ts` |

Native-data fixtures may simulate outage, expiry, mismatched roots, and late
responses. Do not stop a shared native service to produce those failures.
Do not print raw hook markers into an observer terminal: a second live pane
observing a marker can invalidate its binding.

## Native-client UAT setup

The UAT owner selects one POSIX execution host with an existing compatible
private socket and already installed/trusted candidate plugin. Confirm the
wmux candidate server includes the binding/title/revoke routes. A missing or
mismatched component is a preflight failure; record it before proceeding.
No shared service restart or plugin reinstall is performed by the collector.

1. Prepare a fresh disposable wmux workspace with a normal durable shell, one
   task tab A, and a separate control tab B. Record the exact returned workspace,
   tab and pane IDs, backend, shell, and cleanup policy in private evidence.
   Do not infer the target from browser focus or inherited variables.
2. Launch the ordinary installed `codex` in A. Use a harmless prompt such as
   “Suggest three labels for a fictional seed library; do not run tools or edit
   files.” Record its exact native task ID from the client. B is the unchanged
   control surface. No model-generated wmux name is requested.
3. For a desktop-only negative case, create a separate disposable task through
   the ordinary desktop UI. Do not open it concurrently in another CLI to force
   a binding. Record supported host/endpoint visibility separately.
4. Desktop rename of an already bound task is tested only through an existing
   supported client path that does not create an independent concurrent native
   executor. If no such path is established, mark that row unverified and report
   the limitation; do not invent a handoff.

Allow up to 10 seconds after a native name becomes visible at the selected
metadata endpoint for a healthy two-second poller to converge. Record latency
from native metadata visibility separately from client-to-metadata propagation.
Do not label latency above that observation window as a permanent failure
without recording the actual eventual outcome and endpoint health.

## UAT cases and observations

| ID | User action | Expected result |
| --- | --- | --- |
| N01 | Submit the harmless prompt in A; wait for native automatic naming | Eligible wmux workspace/tab equal the native name; B unchanged. If native naming never occurs, record that fact without inventing a name. |
| N02 | Rename A through the native CLI's ordinary rename control | wmux mirrors the accepted native name; no new model prompt is required. |
| N03 | Finish the turn, then rename while idle | Native metadata and wmux titles converge without another turn; idle is not fabricated completion evidence. |
| N04 | Rename the same task through the supported desktop path | Mirrors once the configured endpoint exposes the name; record client/endpoint support or mark unverified. |
| N05 | Pin only the wmux workspace, then rename natively | Workspace pin stays; eligible task tab updates. Unpin workspace without another native rename; it converges to the current name. |
| N06 | Pin only the task tab, then rename natively | Tab pin stays; eligible workspace updates. Unpin the tab and verify convergence without another rename. |
| N07 | Pin both surfaces, rename natively, then unpin one at a time | Each surface obeys its own pin, and B remains unchanged throughout. |
| N08 | Disconnect every browser viewer, then reopen the same durable pane | Same live backend and receipt remain valid; native name/pins are preserved and later idle rename still mirrors. |
| N09 | Exit Codex normally while keeping its shell alive | SessionEnd revokes its receipt. A later native metadata rename, if possible through an existing client, must not retitle that shell. If unavailable, record revocation proof separately from fixture-only late-rename evidence. |
| N10 | Use the desktop-only disposable task without terminal proof | It remains unbound; no existing wmux title is selected by cwd, focus, or recency. |
| N11 | Inspect the control tab/task throughout the run | No naming, lifecycle, or completion event is attributed to the wrong task/pane. |

For every row record: candidate/plugin identity, native client and version,
endpoint type/version evidence, exact privately recorded task/pane mapping,
action, native metadata outcome, visible workspace/tab values and ownership,
timings, evidence path, and pass/fail/unverified decision. Add a sanitized
failure reproduction for any mismatch; do not turn an unverified row into pass.

## Known limits and exit gate

The baseline retains the current 24-hour lease and fresh-prompt requirement after
wmux restart/backend replacement. Missing hook turn IDs can allow naming while
activity remains unavailable. Overlong/unrepresentable names remain skipped
until M1. Windows native Unix-socket observation is unsupported; macOS and other
endpoint/client combinations need their own evidence. These limits must be
visible in the acceptance record rather than silently waived.

M0 can be presented for acceptance only when there is a committed naming
candidate, matched/reviewed plugin and server artifact identity, passing required
engineering checks, and completed UAT observations or explicit deferred scope.
The user/UAT owner records **accept**, **rework**, or **defer**. No automatic
collection command grants acceptance. Wrong-task writes, overwritten manual
pins, unintended input, or false completion block the affected scope.

On completion, close only the recorded disposable panes, archive disposable
native tasks through normal client controls if requested, and retain private
evidence. Any retained UAT workspace must have a documented purpose and cleanup
owner. No normal task/pane is reused as a fault target.

The active status belongs in [CODEX_CONFORMANCE.md](CODEX_CONFORMANCE.md);
the milestone dependency is in [CODEX_INTEGRATION_ROADMAP.md](CODEX_INTEGRATION_ROADMAP.md).

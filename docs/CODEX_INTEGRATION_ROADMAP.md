# Codex integration roadmap

Status: M0 acceptance tooling/procedure implemented; naming-candidate
qualification and native-client UAT pending. M1–M6 remain proposed.
Updated: 2026-09-12.

## Objective and boundary

Make Codex tasks discoverable, understandable, and accessible from wmux across
desktop, CLI, and existing App Server use. Every implementation change belongs
in this repository, including its plugin, helpers, protocol, UI, and deployment
scripts. No Codex/App Server source patches, replacement binaries, native
database edits, or changes to their service/configuration are prerequisites.
Use existing supported interfaces and endpoints. Installing a wmux-owned
component is part of a separately authorized wmux rollout.

Native names remain canonical. Preserve independent manual workspace/tab pins.
Keep three concepts separate throughout the implementation:

- A native task, identified by configured host/endpoint and exact thread ID.
- A persistent wmux display association between that task and a pane.
- A short-lived, live-proven terminal binding that permits automatic pane/title
  reporting. A saved display association does not restore this authority.

Task activity does not prove which client submitted a turn. Stored metadata
does not prove that the endpoint owns active execution. Missing or unavailable
capabilities must produce an explicit unavailable/unknown state.

## Milestones and release order

| Milestone | User-visible result | Dependency | UAT checkpoint |
| --- | --- | --- | --- |
| M0 — Establish baseline | Current naming behavior has a reproducible acceptance record | None | Native names, pins, reconnect, and known limitations |
| M1 — Explain integration state | Doctor/inspector explains naming and activity health; long names display correctly | M0 | Understand and recover from common configuration/observation failures |
| M2 — Recover observation | wmux observation survives its own worker failures and uses bounded resources | M1 | Fault injection and an overnight soak |
| M3 — Discover native tasks | Task inventory includes native tasks without terminal panes | M2 | Desktop, CLI, stored, and background task visibility |
| M4 — Associate and inspect | Explicit display associations and useful native task details | M3 | Move associations, reconnect, and inspect related tasks without affecting execution |
| M5 — Open supported CLI views | Explicit opening/resuming through existing endpoints and exact task IDs | M4 | Supported launch/resume paths, ambiguous ownership, and delivery failure |
| M6 — Release acceptance | Accepted features work together on the declared host/client matrix | M1–M5 | Integrated daily workflow and rollback rehearsal |

Each milestone must be useful independently. M1–M4 can ship without M5.
UAT occurs against a concrete, versioned wmux candidate after engineering checks;
it is not deferred until the final milestone. Record accept/rework/defer before
promoting the milestone or building dependent behavior on an unresolved result.
Do not estimate dates until the candidate baseline and target UAT hosts are set.

## M0 — Establish the naming baseline

Execution procedure: [CODEX_M0_UAT.md](CODEX_M0_UAT.md). Candidate qualification
waits for the separate name-sync workstream's committed revision. M0 tooling
must not stage or overwrite that workstream's in-progress source changes.

Deliverables:

- Record the exact wmux commit, plugin artifact, CLI/server versions, and
  supported endpoint capabilities. Reconcile the existing naming working-tree
  changes before preparing a reproducible candidate; preserve unrelated work.
- Update the current sections of the plugin guide and conformance ledger from
  fresh evidence. Preserve historical results as historical.
- Prepare disposable tasks/panes and documented fault fixtures. Start with one
  supported POSIX host and existing private socket; do not require another
  native service or configuration change.

UAT: create a native name, rename from each available native client, finish a
turn, rename while idle, independently pin/unpin workspace and tab, reconnect
the browser, and exit the CLI while leaving its shell alive. Verify the exact
intended surfaces change and unrelated tasks remain unaffected. Demonstrate
that a desktop-only task without terminal proof remains unbound.

Exit: native-client tests are distinguished from socket fixtures, supported
client paths are explicit, and any failure has a reproducible case. Existing
restart/lease limitations are documented rather than counted as new regressions.

## M1 — Explain integration state and display full native names

Deliverables:

- Extend doctor and the session inspector with separate naming, activity,
  transport, and binding health; last success/sample age; expiry; and sanitized
  reason codes. Surface CLI/server/plugin compatibility where verifiable.
- Differentiate manual pin, missing native name, missing turn ID, pending or
  expired binding, unsupported endpoint, unavailable socket, and failed delivery.
- Store a bounded full native name separately from presentation. Ellipsize in
  narrow chrome and expose the full name through accessible inspection. Define
  an explicit maximum and visible handling for larger names; retain control
  character validation and never split a Unicode grapheme in display text.
- Specify persistence/wire migrations and preserve existing manual title values.

UAT: long and Unicode names on desktop/mobile; pinned surfaces; an unnamed task;
and controlled unavailable/missing-capability fixtures. A user should be able to
identify the problem and the appropriate existing recovery action without logs.
No restart of a live shared native service is required to simulate an outage.

Exit: diagnosis is specific, title rendering is usable, and no error state
overwrites a manual title or exposes credentials/receipts.

## M2 — Make wmux observation recoverable and bounded

Deliverables:

- Add wmux-owned supervision and connection reuse per configured endpoint.
  Consolidate sampling while preserving independent task identity, title
  authority, and prompt-bound lifecycle checks. Choose the hosting location
  within existing wmux service/session-agent boundaries during implementation.
- Recover abandoned locks using verifiable owner liveness or an equivalent
  crash-safe mechanism. Never reclaim a lock solely because a valid read is slow.
- Add bounded backoff, jitter, shutdown, worker limits, and diagnostic counters.
  Preserve the existing freshness/stale contract for healthy active observation;
  document any idle cadence separately.
- Recover read-only observation after worker/socket failure. A wmux restart
  still requires fresh terminal proof before automatic title writes resume.
  Do not persist or renew title authority merely because polling succeeds.

Engineering gate: test worker termination, stale locks, delayed reads, outdated
responses, title pins, newer prompt receipts, and repeated reconnects. Use a
synthetic 20-task load fixture to check process/socket/request bounds.

UAT: terminate only a disposable wmux observer, simulate endpoint failure,
restore it, reconnect browsers, and restart an isolated wmux candidate. Confirm
native work continues, unknown state is visible, observation recovers, and
expired title authority stays expired. Follow with a 24-hour soak.

Exit: no orphan worker accumulation, stuck locks, duplicate terminal
notifications, stale-title replay, or unexplained growth in resource counters.

## M3 — Discover native tasks independently of panes

Deliverables:

- Add a native task catalog keyed by host/endpoint identity and exact thread ID,
  with session-tree identity, metadata provenance, sample age, and runtime
  confidence. Do not merge tasks by title, cwd, or apparent recency.
- Use bounded existing list/read methods with pagination and capability checks.
  Keep inventory permission separate from the current narrowly bound MCP tools;
  do not broaden those tools into global discovery implicitly.
- Add explicit wmux endpoint configuration. A remote host uses a bounded,
  authenticated wmux-owned bridge to its existing supported local endpoint,
  not a general native RPC proxy. Land single-host discovery first.
- Include tasks without panes. Label active, idle, stored/not-loaded,
  unavailable, and unknown distinctly. Preserve useful last-known metadata
  without presenting it as fresh runtime state.

UAT: find disposable desktop, standalone CLI, existing-server, and stored tasks;
verify exact identities against the native clients. Exercise pagination,
same-title tasks, endpoint loss, and tasks on two configured hosts when existing
supported endpoints are available. Record inaccessible tasks as unsupported
visibility, not successful discovery. Browsing must not resume any task.

Exit: task identity and provenance remain clear across refresh/reconnect, and
inventory operations produce no native turns, subscriptions through resume,
or unsolicited native state changes.

## M4 — Associate panes and inspect native task context

Deliverables:

- Provide explicit associate/remove/move actions for wmux display associations.
  Persist them with schema versioning; revalidate endpoint and pane identity
  after reload. Missing/replaced panes leave an unresolved association.
- Show association separately from live terminal binding. An association grants
  neither automatic title ownership nor permission to send terminal input.
- Show available project/cwd/model, parent/child relationships, latest native
  outcomes, and bounded on-demand history. Label configuration metadata as such;
  do not claim it is the model used for every turn.
- Show task-level successor activity independently of prompt-bound pane
  activity. Deduplicate native task notifications across display associations;
  child activity must not overwrite a parent's name or borrow its title binding.

UAT: associate a desktop task without starting it, move its display association,
associate duplicate titles correctly, inspect parent/child tasks, reconnect two
browsers, and restart wmux. Close/recreate a pane and verify the old association
cannot silently target its replacement. Trigger a later turn through a native
client and verify task-level activity without asserting terminal origin.

Exit: associations survive as display metadata, stale title authority does not,
and inspection never sends input or changes native task state.

## M5 — Open supported CLI views through existing interfaces

Deliverables:

- Extend wmux launch contracts with explicit existing endpoint and native task
  ID; use the installed CLI's supported remote/resume commands. Keep launch
  controls separate from the read-only observation transport.
- Support a fresh task on a configured existing server and an explicit resume
  for eligible tasks. Preserve native sandbox/approval behavior; pass prompts
  through supported structured input or protected files, not shell interpolation.
- Before resume, inspect available runtime/queue state and wmux's own launch
  records. These checks cannot prove ownership across arbitrary standalone
  processes: ambiguous or foreign-active cases must remain unavailable for
  automatic launch. Show the reason and retain inspection access.
- Track one wmux launch attempt and its resulting native identity. A successful
  process spawn or queued input is not successful execution. After uncertain
  submission, reconcile and show unknown rather than automatically resubmitting.
- Where existing interfaces cannot prove a safe resume path, ship a disabled
  action with a specific reason. Do not make an upstream fix a dependency.

UAT: start a disposable task, reopen an eligible idle task by exact ID, inspect
queued input before an explicit resume, attempt a foreign-active/unknown task,
double-click launch, disconnect after submission, and exercise native trust or
approval prompts. Confirm one intended submission, the correct host/cwd, no
automatic retry after uncertain delivery, and no silent permission changes.

Exit: the supported eligibility matrix is precise. Seamless desktop/CLI takeover
is not claimed. A capability may be deferred without blocking M1–M4 release.

## M6 — Integrated UAT and release

Run the accepted workflow end to end: discover a task, inspect it, associate a
pane, observe a native rename, preserve a pin, follow a later native turn, recover
from a wmux observer interruption, and use an eligible explicit CLI launch.
Exercise wmux desktop and mobile browser layouts against each supported native
client/host combination. Mobile browser support is distinct from a native host
transport claim. macOS/remote rows require existing compatible endpoints;
Windows native observation remains explicitly unsupported unless a wmux-only
adapter can use an already available, verified interface.

Repeat an overnight soak with mixed tasks and verify notification deduplication,
bounded resource usage, diagnostics, persistence, and supported rollback.
For schema changes, demonstrate a wmux-owned migration/backup restore procedure;
do not run an older binary against a newer state schema blindly. Reverting wmux
must not require modifications to native task stores or services.

Exit: accepted scenarios, unsupported combinations, release/plugin identities,
and recovery instructions are recorded in the maintained conformance ledger.

## Gate procedure and evidence

Before each UAT handoff, run proportionate focused tests, relevant browser tests,
and the repository's required runtime checks. Prefer the documented remote
verification workflow for full checks. Use isolated candidate services and
fixtures for destructive/failure tests; do not interrupt active shared work.

Every checkpoint records:

| Field | Required evidence |
| --- | --- |
| Candidate | Committed wmux revision and matching plugin/build identity |
| Environment | Native CLI/server versions, supported endpoint type, browser, and host platform |
| Scenario | Reproduction steps, expected result, actual result, and evidence location |
| Isolation | Which disposable tasks/panes/workers may be affected |
| Decision | User/UAT owner: accept, rework, or defer; unresolved issues and release impact |
| Recovery | Tested rollback or component-disable path; persistence implications |

Keep live inventories, personal task content, private URLs, receipts, and
credentials out of committed evidence. Store sanitized scenarios and outcomes
in [CODEX_CONFORMANCE.md](CODEX_CONFORMANCE.md). Automated fixture success is not
native-client UAT acceptance. Wrong-task writes, unintended input, false
completion, and overwritten manual pins block release of the affected milestone.

## Explicit exclusions

No native naming writes, guaranteed cross-client execution takeover, inferred
terminal attachment generations, observation-by-resume, dependency on a new
subscription API, or browser approval answering without an existing verified
request contract. No native recurring scheduler is introduced. API limitations
reduce wmux's advertised capabilities rather than expanding the project boundary.

Reference implementation and constraints:
[plugin guide](CODEX_PLUGIN.md), [native API checkpoint](CODEX_NATIVE_API_GAPS.md),
[harness contract](HARNESS_INTEGRATION_SPEC.md), and
[verification workflow](VERIFICATION.md).

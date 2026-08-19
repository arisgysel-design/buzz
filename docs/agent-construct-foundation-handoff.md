# Agent Construct on Buzz: Foundation Handoff

Status: lifecycle foundation verified; Golden Path not yet implemented

Date: 2026-08-19

Branch: `agent-construct-lifecycle-gate`

Pinned Buzz base: `93114c9c65138397de39729fde0a816eb9f314ab`

## Goal

Evaluate Buzz as the agent fabric beneath Agent Construct while preserving Agent Construct's consumer product contract:

`Plus -> describe the job in ordinary language -> approve required access -> work with the finished bot`

This branch closes the first hard prerequisite: Buzz must start, stop, drop, and restart an OpenClaw ACP adapter without leaving processes behind. It does not yet build the user-visible Agent Construct flow.

## Architecture boundary

The current working boundary is:

- **Buzz:** agent identity/configuration, channels, messages/event log, ACP process and session lifecycle, replay/reconnect, personas, teams, workflows, and remote providers.
- **OpenClaw:** execution runtime for the agent.
- **GBrain:** knowledge, memory, retrieval, and learning. It is not replaced by Buzz and must not become a second authority for messages or runtime state.
- **Agent Construct:** consumer UX, capability/plugin/action grants, secret handoff, protected per-agent computer, artifacts, understandable status/error semantics, and human control.

One state must have one writer. Do not introduce a second authoritative store for agents, messages, or runtime state.

## Root cause closed by this branch

The ACP protocol path worked, but `AcpClient::shutdown()` immediately killed the adapter process group with `SIGKILL`.

OpenClaw's process shape is nested:

```text
Buzz ACP harness (owns adapter PGID)
└── openclaw adapter
    └── openclaw-acp bridge (separate PGID)
```

The immediate kill bypassed OpenClaw's cleanup handler. Its bridge survived with `PPID 1`, producing duplicate/unreliable bots and accumulating resources across restarts.

The minimal fix in `crates/buzz-acp/src/acp.rs`:

1. sends `SIGTERM` to the adapter process group;
2. waits at most two seconds for cooperative cleanup;
3. falls back to the existing process-group `SIGKILL` and a bounded five-second wait;
4. disables Tokio's immediate `kill_on_drop` path;
5. makes `Drop` send a best-effort `SIGTERM`, so cooperative adapters can clean nested groups.

The desktop ownership sweeper remains the abort backstop. A real macOS regression test in `desktop/src-tauri/src/managed_agents/runtime/tests.rs` proves that a marked same-instance orphan is detected on the first sweep and reaped on the confirming second sweep.

## Verification evidence

Run from the repository root after activating the pinned toolchain:

```bash
. ./bin/activate-hermit
cargo test -p buzz-acp
cargo clippy -p buzz-acp --all-targets -- -D warnings
cargo test --manifest-path desktop/src-tauri/Cargo.toml \
  periodic_sweep_reaps_confirmed_same_instance_orphan -- --exact
git diff --check
```

Verified results on macOS:

- 828 `buzz-acp` unit/lifecycle test results passed.
- Clippy passed with warnings denied.
- The real macOS two-sweep abort regression passed.
- Ten real `buzz-acp -> openclaw acp` initialize/stop cycles passed.
- Zero `buzz-acp` or `openclaw-acp` processes remained afterward.

The repository-wide `just ci` gate was not run for this focused foundation spike; run it before proposing an upstream merge.

## Next product gate

Build one isolated, polished vertical slice:

`Plus -> conversation -> OpenClaw writing bot -> message -> Stop/Resume -> restart/replay`

Acceptance requires all of the following:

- the flow is understandable to a nontechnical user without exposing a builder or workspace internals;
- every durable state has one authoritative owner;
- Stop/Resume and restart/replay preserve the conversation and leave zero orphan processes;
- failure states are visible and recoverable;
- the slice does not require a broad, permanently hard-to-rebase rewrite of Buzz core;
- the later GBrain integration boundary remains open.

Do not broaden the slice into marketplace, full desktop takeover, GBrain integration, or autonomy before this vertical passes.

## Working rules for the next coder

- Work from this branch or a branch based on it; do not modify or deploy the existing Agent Construct production system.
- Read `AGENTS.md`, `VISION.md`, `VISION_AGENT.md`, `VISION_REMOTE_AGENTS.md`, and relevant `TESTING.md` files before nontrivial changes.
- Activate Hermit before Rust, Git hooks, or repository commands.
- Preserve the DCO requirement with `git commit -s`.
- Keep lifecycle cleanup ownership-based; never use broad process-name kills.
- Add runtime evidence for the real user workflow in addition to unit/CI evidence.
- Stop and reconsider Buzz adoption if the vertical needs a second agent/message/runtime authority or substantial core divergence.

## Deliberately untouched

- No production deployment or restart.
- No mutation of the existing Agent Construct repository.
- No upstream `block/buzz` issue or pull request.
- No Golden Path implementation yet.

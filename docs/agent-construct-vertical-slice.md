# Agent Construct vertical slice

Status: user-visible writing-bot slice on top of the ACP lifecycle foundation

Date: 2026-08-19

Branch: `cursor/agent-construct-vertical-slice-8390` (based on `agent-construct-lifecycle-gate`)

Pinned Buzz base: `93114c9c65138397de39729fde0a816eb9f314ab`

## Product gate

`Plus → conversation → OpenClaw writing bot → message → Stop/Resume → restart/replay`

This is a consumer flow. The screen asks what the person wants help writing. It does not expose builder, workspace, ACP, harness, persona, or adapter internals.

## Before / after

**Before (lifecycle-gate branch):** Buzz can start, stop, drop, and restart an OpenClaw ACP adapter without leaving nested processes behind. There was no user-visible Agent Construct path.

**After (this slice):**

1. **Plus** on the Agents sidebar row (and **New writing bot** on the Agents page) opens `/agents/new`.
2. The person describes a writing job in ordinary language and presses **Send**.
3. Buzz creates an OpenClaw writing bot using existing writers only:
   - persona = config (system prompt + OpenClaw runtime)
   - managed agent = identity + ACP lifecycle (`spawnAfterCreate`)
   - DM + first message = the conversation on the relay event log
4. The app opens that DM. **Stop / Resume / Restart** sit in the conversation header.
5. Stop/Resume and Restart keep the same DM history. Restart is a new ACP session on the same agent identity; replay is the relay transcript, not a second memory store.

## One state, one writer

| State | Authoritative owner |
| --- | --- |
| Who the bot is / how it is configured | Buzz persona + managed agent |
| The conversation | Buzz DM + relay events |
| Process / session | buzz-acp start/stop (SIGTERM → wait → SIGKILL; no `kill_on_drop`) |
| Knowledge / memory / retrieval | GBrain — **left open**, unused here |

No parallel agent, message, or runtime store was added.

## Failures

- Empty job: the Send button stays disabled; the create path also refuses without writing state.
- OpenClaw missing: visible copy (“needs OpenClaw on this computer”), no persona/agent/DM writes.
- Create failure: stays on the construct screen with recoverable copy.
- Start failure: the DM still opens; header copy + toast tell the person to press **Resume**.
- First-message send failure: the DM still opens so the person can send again.

## Tests / evidence

Automated (this Linux environment):

```bash
. ./bin/activate-hermit
cd desktop
pnpm test -- src/features/agents/construct src/app/AppShell.helpers.test.mjs
pnpm test:e2e:smoke -- tests/e2e/agent-construct-writing-bot.spec.ts
```

Lifecycle code in `crates/buzz-acp/src/acp.rs` was not changed. Prior macOS OpenClaw initialize/stop evidence from the lifecycle-gate branch still applies to process reaping, but was **not re-run** here.

## Still open

- **GBrain** stays the knowledge/memory/retrieval boundary. This slice does not persist a second memory and does not call GBrain.
- **Mac + live OpenClaw** initialize/stop/restart of a writing bot created through this UI was not run on this Linux VM. Re-check before treating the slice as merge-ready for a machine that actually launches OpenClaw.
- Out of scope: marketplace, full desktop takeover, autonomy, grants/secret handoff, per-agent computer, artifacts beyond the DM, Golden Path access-approval.
- No production deploy. No mutation of a separate Agent Construct repository. No upstream `block/buzz` PR.

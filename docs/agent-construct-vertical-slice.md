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

### Create compensation (orchestrator, existing writers)

There is no transactional backend create that spans persona + managed agent + DM (three existing authorities). A new combined Tauri command would still not be a real DB transaction and would duplicate those writers, so this slice does **not** add a second store.

**Before:** `createWritingBot` ran `listRuntimes → createPersona → createAgent → openDm → send` with no cleanup. `createAgent` failure left a persona; `openDm` failure left a persona + managed agent, and `spawnAfterCreate` could leave a running OpenClaw process with no conversation. Retry accumulated orphans.

**After:** mid-path failures before a successful DM compensate through the existing writers, then return `create_failed` with the original error (compensation errors are swallowed so they cannot hide it):

| Failure | Cleanup |
| --- | --- |
| `createAgent` throws after persona | `deletePersona` |
| `openDm` throws after persona + agent | `stopManagedAgent` → `deleteManagedAgent` → `deletePersona` |
| first send throws after DM | none — keep the conversation |

`delete_managed_agent` already stops a local process; the explicit stop still runs first so a spawn cannot survive a failed delete. `delete_persona` cascades linked agents, which covers a `createAgent` throw after the agent record was written but before the orchestrator received the pubkey.

Retry after those failures does not accumulate leftover personas or managed agents.

Stop/Resume/Restart in the DM header match the writing-bot prompt marker (`You are a writing bot.`), not every local OpenClaw 1:1 DM. Builder-created OpenClaw agents keep the profile Start/Stop path.

## Tests / evidence

Automated (this Linux environment):

```bash
. ./bin/activate-hermit
cd desktop
pnpm exec biome check src/features/agents/construct src/app/routes/agents.new.tsx
pnpm typecheck
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/agents/construct/*.test.mjs src/app/AppShell.helpers.test.mjs
pnpm build:e2e && pnpm exec playwright test --project=smoke \
  tests/e2e/agent-construct-writing-bot.spec.ts
```

Results:

- 25 construct / shell-route unit tests passed (including createAgent/openDm compensation, retry-without-orphans, construct-bot isolation, word-boundary name truncation)
- desktop `tsc --noEmit` passed
- Playwright smoke spec `agent-construct-writing-bot.spec.ts`: 3 passed (Plus → Stop/Resume/Restart keeps the DM; missing OpenClaw refuses create; Agents page button opens the same screen)

Lifecycle code in `crates/buzz-acp/src/acp.rs` was not changed. Prior macOS OpenClaw initialize/stop evidence from the lifecycle-gate branch still applies to process reaping, but was **not re-run** here. `just ci` was not run (too heavy for this slice).

## Still open

- **GBrain** stays the knowledge/memory/retrieval boundary. This slice does not persist a second memory and does not call GBrain.
- **Mac + live OpenClaw** initialize/stop/restart of a writing bot created through this UI was not run on this Linux VM. Re-check before treating the slice as merge-ready for a machine that actually launches OpenClaw.
- Out of scope: marketplace, full desktop takeover, autonomy, grants/secret handoff, per-agent computer, artifacts beyond the DM, Golden Path access-approval.
- No production deploy. No mutation of a separate Agent Construct repository. No upstream `block/buzz` PR.

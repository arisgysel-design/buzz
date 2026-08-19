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
3. Buzz explains the bot's restricted access and requires explicit approval.
4. Buzz idempotently provisions a dedicated OpenClaw identity, `buzz-writing`, with
   `tools.profile = "minimal"` and elevated access disabled. An existing identity
   with broader rights is refused rather than silently reused.
5. Buzz creates the writing bot using existing writers only:
   - persona = config (system prompt + OpenClaw runtime)
   - managed agent = identity + ACP lifecycle (`spawnAfterCreate`)
   - DM + first message = the conversation on the relay event log
6. The app opens that DM. **Stop / Resume / Restart** sit in the conversation header.
7. Stop/Resume and Restart keep the same DM and the same stable OpenClaw Gateway
   session (`agent:buzz-writing:buzz-construct:<persona-id>`). Restart replaces the
   ACP process, while OpenClaw reloads the prior model transcript from that session.

## One state, one writer

| State | Authoritative owner |
| --- | --- |
| Who the bot is / how it is configured | Buzz persona + managed agent |
| The conversation | Buzz DM + relay events |
| Process / session | buzz-acp start/stop (SIGTERM → wait → SIGKILL) + stable OpenClaw Gateway session |
| Runtime authority | dedicated `buzz-writing` OpenClaw identity; minimal tool profile; elevated disabled |
| Knowledge / memory / retrieval | GBrain — **left open**, unused here |

No parallel agent, message, or runtime store was added.

## Failures

- Empty job: the Send button stays disabled; the create path also refuses without writing state.
- OpenClaw missing: visible copy (“needs OpenClaw on this computer”), no persona/agent/DM writes.
- Restricted-access setup refused or invalid: visible recoverable failure, no persona/agent/DM writes.
- Partial access provisioning failure: the newly added OpenClaw identity is rolled back.
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

Stop/Resume/Restart in the DM header match the explicit stable session scope in
`agentArgs` (`:buzz-construct:`), not prompt text and not every local OpenClaw 1:1
DM. Builder-created OpenClaw agents keep the profile Start/Stop path.

## Tests / evidence

Automated (macOS):

```bash
. ./bin/activate-hermit
cd desktop
pnpm exec biome check src/features/agents/construct src/app/routes/agents.new.tsx
pnpm typecheck
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/agents/construct/*.test.mjs src/app/AppShell.helpers.test.mjs
pnpm build:e2e && BUZZ_E2E_PORT=4174 pnpm exec playwright test --project=smoke \
  tests/e2e/agent-construct-writing-bot.spec.ts
```

Results:

- 21 focused construct tests passed (including access refusal, compensation,
  retry-without-orphans, stable session args, and explicit construct-bot isolation)
- full desktop suite: 5,059 tests passed; desktop typecheck and Tauri Rust compile passed
- three Rust policy tests passed (restricted accepted; broader/elevated and duplicate identities refused)
- file-size ratchet, text-pixel check, public-key truncation check, and canonical route generation passed
- Playwright smoke spec: 3 passed (approval + create + Stop/Resume/Restart;
  missing OpenClaw refusal; Agents-page entry point)
- isolated OpenClaw provisioning exercised add → minimal/elevated-off → config validate
  without touching the live OpenClaw configuration
- real OpenClaw ACP replay gate passed: process 1 stored a random token, exited via
  SIGTERM, process 2 used the same stable Gateway session and returned that token;
  ACP process baseline before/after was empty (zero orphans)

Lifecycle code in `crates/buzz-acp/src/acp.rs` was not changed. The live replay gate
used a disposable `othello` session because the PR must not mutate the machine's
live OpenClaw agent configuration; the provisioning command path was verified
against an isolated temporary OpenClaw state directory.

## Still open

- **GBrain** stays the knowledge/memory/retrieval boundary. This slice does not persist a second memory and does not call GBrain.
- Out of scope: marketplace, full desktop takeover, autonomy, grants/secret handoff,
  per-agent computer, and artifacts beyond the DM.
- No production deploy. No mutation of a separate Agent Construct repository. No upstream `block/buzz` PR.

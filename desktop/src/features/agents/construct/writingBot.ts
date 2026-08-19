import type {
  AcpRuntime,
  AcpRuntimeCatalogEntry,
  ManagedAgent,
} from "@/shared/api/types";
import { friendlyAgentLastError } from "@/features/agents/lib/friendlyAgentLastError";

/**
 * Agent Construct writing-bot slice.
 *
 * Durable state owners (do not add a second writer):
 * - Buzz persona + managed agent: identity and config
 * - Buzz DM + relay events: the conversation
 * - buzz-acp start/stop: process and session lifecycle
 *
 * GBrain remains the knowledge/memory/retrieval boundary. This slice does
 * not persist a parallel memory store or treat the job description as
 * anything other than a Buzz system prompt plus relay messages.
 */

export const WRITING_BOT_RUNTIME_ID = "openclaw";
export const WRITING_BOT_FALLBACK_NAME = "Writing bot";
export const WRITING_BOT_PROMPT_MARKER = "You are a writing bot.";
export const WRITING_BOT_SESSION_SCOPE = "buzz-construct";

export type ConstructFailureCode =
  | "empty_job"
  | "openclaw_unavailable"
  | "access_setup_failed"
  | "create_failed"
  | "start_failed";

export type ConstructFailure = {
  code: ConstructFailureCode;
  copy: string;
};

export type OpenClawRuntimeResult =
  | { ok: true; runtime: AcpRuntime }
  | { ok: false; failure: ConstructFailure };

const EMPTY_JOB_COPY = "Tell this writing bot what you want help writing.";
const OPENCLAW_UNAVAILABLE_COPY =
  "This writing bot needs OpenClaw on this computer. Install OpenClaw, then try again.";
const ACCESS_SETUP_FAILED_COPY =
  "Couldn't prepare this writing bot's restricted OpenClaw access. No bot was created.";
const CREATE_FAILED_COPY = "Couldn't create this writing bot. Try again.";
const START_FAILED_COPY =
  "Your writing bot is ready, but it didn't start. Press Resume to try again.";

export function constructFailureCopy(code: ConstructFailureCode): string {
  switch (code) {
    case "empty_job":
      return EMPTY_JOB_COPY;
    case "openclaw_unavailable":
      return OPENCLAW_UNAVAILABLE_COPY;
    case "access_setup_failed":
      return ACCESS_SETUP_FAILED_COPY;
    case "create_failed":
      return CREATE_FAILED_COPY;
    case "start_failed":
      return START_FAILED_COPY;
  }
}

export function constructFailure(
  code: ConstructFailureCode,
  detail?: string,
): ConstructFailure {
  const base = constructFailureCopy(code);
  const trimmed = detail?.trim();
  if (!trimmed || code === "empty_job" || code === "openclaw_unavailable") {
    return { code, copy: base };
  }
  return { code, copy: `${base} ${trimmed}` };
}

export function buildWritingBotSessionKey(
  openClawAgentId: string,
  personaId: string,
): string {
  return `agent:${openClawAgentId}:${WRITING_BOT_SESSION_SCOPE}:${personaId}`;
}

export function buildWritingBotAgentArgs(
  openClawAgentId: string,
  personaId: string,
): string[] {
  return [
    "acp",
    "--session",
    buildWritingBotSessionKey(openClawAgentId, personaId),
  ];
}

export function resolveOpenClawRuntime(
  runtimes: readonly AcpRuntimeCatalogEntry[] | null | undefined,
): OpenClawRuntimeResult {
  const openclaw = (runtimes ?? []).find(
    (runtime) => runtime.id === WRITING_BOT_RUNTIME_ID,
  );
  if (openclaw?.availability === "available" && openclaw.command) {
    return { ok: true, runtime: openclaw as AcpRuntime };
  }
  return {
    ok: false,
    failure: constructFailure("openclaw_unavailable"),
  };
}

export function nameWritingBot(job: string): string {
  const cleaned = job
    .trim()
    .replace(/\s+/g, " ")
    .replace(
      /^(please\s+)?(help me|i want|i need|create|make|write me)\s+/i,
      "",
    )
    .replace(/^(a |an |to |that |with )/i, "");
  if (!cleaned) {
    return WRITING_BOT_FALLBACK_NAME;
  }
  const sentence = (cleaned.split(/[.!?]/)[0] ?? cleaned).trim();
  const words = sentence.split(" ").filter(Boolean).slice(0, 5);
  let name = words.join(" ");
  if (name.length > 32) {
    const clipped = name.slice(0, 32).trimEnd();
    const lastSpace = clipped.lastIndexOf(" ");
    name = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  }
  if (!name) {
    return WRITING_BOT_FALLBACK_NAME;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function buildWritingBotSystemPrompt(job: string): string {
  const trimmed = job.trim();
  return [
    `${WRITING_BOT_PROMPT_MARKER} Help the person in this conversation write clearly.`,
    "",
    "Your job:",
    trimmed,
    "",
    "Draft, edit, and improve writing when asked. Stay in this conversation.",
    "If you cannot complete a request, say so plainly and suggest a next step.",
  ].join("\n");
}

/**
 * Agent Construct header controls match the dedicated stable OpenClaw session,
 * not prompt text. Builder-created OpenClaw agents therefore cannot be
 * misclassified when they happen to use the same prose.
 */
export function isConstructWritingBotAgent(
  agent: Pick<
    ManagedAgent,
    "backend" | "agentCommand" | "runtime" | "agentArgs"
  >,
): boolean {
  if (agent.backend.type !== "local") {
    return false;
  }
  const isOpenClaw =
    agent.runtime === WRITING_BOT_RUNTIME_ID ||
    agent.agentCommand === WRITING_BOT_RUNTIME_ID;
  if (!isOpenClaw) {
    return false;
  }
  const sessionIndex = (agent.agentArgs ?? []).indexOf("--session");
  return (
    sessionIndex >= 0 &&
    ((agent.agentArgs ?? [])[sessionIndex + 1] ?? "").includes(
      `:${WRITING_BOT_SESSION_SCOPE}:`,
    )
  );
}

export function constructPrimaryActionLabel(
  isActive: boolean,
): "Stop" | "Resume" {
  return isActive ? "Stop" : "Resume";
}

export function writingBotStartErrorCopy(
  spawnError: string | null | undefined,
  lastError?: string | null,
  lastErrorCode?: number | null,
): string | null {
  const raw = spawnError?.trim() || lastError?.trim() || "";
  if (!raw) {
    return null;
  }
  const friendly = friendlyAgentLastError(raw, lastErrorCode);
  return friendly?.copy
    ? `${constructFailureCopy("start_failed")} ${friendly.copy}`
    : constructFailureCopy("start_failed");
}

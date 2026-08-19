import { buildInstanceInputForDefinition } from "@/features/agents/lib/instanceInputForDefinition";
import type {
  AcpRuntimeCatalogEntry,
  AgentPersona,
  Channel,
  CreateManagedAgentInput,
  CreateManagedAgentResponse,
  CreatePersonaInput,
  ManagedAgent,
} from "@/shared/api/types";

import {
  buildWritingBotSystemPrompt,
  constructFailure,
  nameWritingBot,
  resolveOpenClawRuntime,
  type ConstructFailure,
  WRITING_BOT_RUNTIME_ID,
} from "./writingBot";

export type CreateWritingBotDeps = {
  listRuntimes: () => Promise<readonly AcpRuntimeCatalogEntry[]>;
  createPersona: (input: CreatePersonaInput) => Promise<AgentPersona>;
  createAgent: (
    input: CreateManagedAgentInput,
  ) => Promise<CreateManagedAgentResponse>;
  openDm: (input: { pubkeys: string[] }) => Promise<Channel>;
  sendMessage: (input: {
    channelId: string;
    content: string;
    mentionPubkeys: string[];
    targetChannel: Channel;
  }) => Promise<unknown>;
  /** Existing ACP stop writer — required so a spawned bot cannot outlive a failed DM. */
  stopAgent: (pubkey: string) => Promise<unknown>;
  /** Existing managed-agent delete; also stops a still-running local process. */
  deleteAgent: (pubkey: string) => Promise<unknown>;
  /** Existing persona delete; cascades any leftover agents linked to the persona. */
  deletePersona: (id: string) => Promise<unknown>;
};

export type CreateWritingBotSuccess = {
  ok: true;
  agent: ManagedAgent;
  channel: Channel;
  spawnError: string | null;
  profileSyncError: string | null;
  sendError: string | null;
};

export type CreateWritingBotResult =
  | CreateWritingBotSuccess
  | { ok: false; failure: ConstructFailure };

/**
 * Plus → conversation → OpenClaw writing bot, using existing Buzz writers:
 * persona (config), managed agent (identity + ACP lifecycle), DM + message
 * (conversation). Callers must not persist a parallel agent or message store.
 *
 * There is no transactional backend create that spans persona + agent + DM
 * (three existing authorities). Mid-path failures compensate through those
 * same writers so retry cannot accumulate orphans or a running process
 * without a conversation. A failed first send keeps the DM.
 */
export async function createWritingBot(
  job: string,
  deps: CreateWritingBotDeps,
): Promise<CreateWritingBotResult> {
  const trimmedJob = job.trim();
  if (!trimmedJob) {
    return { ok: false, failure: constructFailure("empty_job") };
  }

  let runtimes: readonly AcpRuntimeCatalogEntry[];
  try {
    runtimes = await deps.listRuntimes();
  } catch (error) {
    return {
      ok: false,
      failure: constructFailure(
        "openclaw_unavailable",
        error instanceof Error ? error.message : undefined,
      ),
    };
  }

  const runtimeResult = resolveOpenClawRuntime(runtimes);
  if (!runtimeResult.ok) {
    return runtimeResult;
  }

  const displayName = nameWritingBot(trimmedJob);
  const systemPrompt = buildWritingBotSystemPrompt(trimmedJob);

  let persona: AgentPersona | null = null;
  let created: CreateManagedAgentResponse | null = null;

  try {
    persona = await deps.createPersona({
      displayName,
      systemPrompt,
      runtime: WRITING_BOT_RUNTIME_ID,
    });

    const agentInput = await buildInstanceInputForDefinition(
      persona,
      runtimeResult.runtime,
    );
    created = await deps.createAgent(agentInput);

    const channel = await deps.openDm({ pubkeys: [created.agent.pubkey] });

    let sendError: string | null = null;
    try {
      await deps.sendMessage({
        channelId: channel.id,
        content: trimmedJob,
        mentionPubkeys: [created.agent.pubkey],
        targetChannel: channel,
      });
    } catch (error) {
      sendError =
        error instanceof Error
          ? error.message
          : "Couldn't send your first message. Try again in this conversation.";
    }

    return {
      ok: true,
      agent: created.agent,
      channel,
      spawnError: created.spawnError,
      profileSyncError: created.profileSyncError,
      sendError,
    };
  } catch (error) {
    await compensatePartialCreate(deps, {
      personaId: persona?.id,
      agentPubkey: created?.agent.pubkey,
    });
    return {
      ok: false,
      failure: constructFailure(
        "create_failed",
        error instanceof Error ? error.message : undefined,
      ),
    };
  }
}

async function compensatePartialCreate(
  deps: Pick<
    CreateWritingBotDeps,
    "stopAgent" | "deleteAgent" | "deletePersona"
  >,
  leftover: { personaId?: string; agentPubkey?: string },
): Promise<void> {
  const { personaId, agentPubkey } = leftover;
  if (agentPubkey) {
    // Stop first so a spawnAfterCreate process cannot survive a failed DM
    // even if the subsequent delete writer errors.
    await bestEffort(() => deps.stopAgent(agentPubkey));
    await bestEffort(() => deps.deleteAgent(agentPubkey));
  }
  if (personaId) {
    await bestEffort(() => deps.deletePersona(personaId));
  }
}

async function bestEffort(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch {
    // Compensation must not hide the original create failure.
  }
}

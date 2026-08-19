import type { Channel, ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { WRITING_BOT_RUNTIME_ID } from "./writingBot";

/**
 * The owned local agent in a 1:1 DM, if this conversation is that agent's
 * home. Group DMs and human-only DMs return null.
 *
 * Conversation authority stays the relay DM. This helper only matches the
 * existing managed-agent record so Stop/Resume/Restart can use start/stop
 * without a second runtime store.
 */
export function ownedLocalAgentFromDm(
  channel: Pick<Channel, "channelType" | "participantPubkeys"> | null,
  agents: readonly ManagedAgent[] | null | undefined,
  currentPubkey: string | null | undefined,
): ManagedAgent | null {
  if (channel?.channelType !== "dm") {
    return null;
  }
  const self = currentPubkey ? normalizePubkey(currentPubkey) : "";
  if (!self) {
    return null;
  }
  const others = channel.participantPubkeys
    .map((pubkey) => normalizePubkey(pubkey))
    .filter((pubkey) => pubkey.length > 0 && pubkey !== self);
  if (others.length !== 1) {
    return null;
  }
  const agentPubkey = others[0];
  return (
    (agents ?? []).find(
      (agent) =>
        normalizePubkey(agent.pubkey) === agentPubkey &&
        agent.backend.type === "local" &&
        isOpenClawWritingBot(agent),
    ) ?? null
  );
}

function isOpenClawWritingBot(
  agent: Pick<ManagedAgent, "agentCommand" | "runtime">,
) {
  return (
    agent.runtime === WRITING_BOT_RUNTIME_ID ||
    agent.agentCommand === WRITING_BOT_RUNTIME_ID
  );
}

import type { Channel, ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { isConstructWritingBotAgent } from "./writingBot";

/**
 * True for a 1:1 DM with a known self pubkey. Used to skip Agent Construct
 * queries on streams, group DMs, and unsigned sessions.
 */
export function isOneToOneDm(
  channel: Pick<Channel, "channelType" | "participantPubkeys"> | null,
  currentPubkey: string | null | undefined,
): boolean {
  return peerPubkeyFromDm(channel, currentPubkey) !== null;
}

/**
 * The owned Agent Construct writing bot in a 1:1 DM, if this conversation is
 * that bot's home. Group DMs, human-only DMs, and builder-created OpenClaw
 * agents return null so those keep the profile Start/Stop path.
 *
 * Conversation authority stays the relay DM. Matching uses the existing
 * managed-agent record plus the dedicated stable-session scope.
 */
export function ownedLocalAgentFromDm(
  channel: Pick<Channel, "channelType" | "participantPubkeys"> | null,
  agents: readonly ManagedAgent[] | null | undefined,
  currentPubkey: string | null | undefined,
): ManagedAgent | null {
  const agentPubkey = peerPubkeyFromDm(channel, currentPubkey);
  if (!agentPubkey) {
    return null;
  }
  return (
    (agents ?? []).find(
      (agent) =>
        normalizePubkey(agent.pubkey) === agentPubkey &&
        isConstructWritingBotAgent(agent),
    ) ?? null
  );
}

function peerPubkeyFromDm(
  channel: Pick<Channel, "channelType" | "participantPubkeys"> | null,
  currentPubkey: string | null | undefined,
): string | null {
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
  return others.length === 1 ? others[0] : null;
}

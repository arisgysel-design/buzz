import * as React from "react";
import { Play, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";

import {
  isOneToOneDm,
  ownedLocalAgentFromDm,
} from "@/features/agents/construct/ownedDmAgent";
import {
  constructPrimaryActionLabel,
  writingBotStartErrorCopy,
} from "@/features/agents/construct/writingBot";
import {
  useManagedAgentsQuery,
  useStartManagedAgentMutation,
  useStopManagedAgentMutation,
} from "@/features/agents/hooks";
import {
  isManagedAgentActive,
  respawnManagedAgentWithRules,
  startManagedAgentWithRules,
  stopManagedAgentWithRules,
} from "@/features/agents/lib/managedAgentControlActions";
import { clearActiveTurnsForAgentOnStop } from "@/features/agents/managedAgentRuntimeHooks";
import { Button } from "@/shared/ui/button";
import type { Channel } from "@/shared/api/types";

type AgentConstructControlsProps = {
  channel: Channel | null;
  currentPubkey?: string;
};

export function AgentConstructControls({
  channel,
  currentPubkey,
}: AgentConstructControlsProps) {
  // Skip the managed-agent query on streams and group DMs. 1:1 human DMs still
  // need the list to confirm the peer is not a construct writing bot; channels
  // / relay-agent queries are unused because local stop does not need them.
  const isCandidateDm = isOneToOneDm(channel, currentPubkey);
  const agentsQuery = useManagedAgentsQuery({
    enabled: isCandidateDm,
  });
  const startMutation = useStartManagedAgentMutation();
  const stopMutation = useStopManagedAgentMutation();
  const agent = ownedLocalAgentFromDm(channel, agentsQuery.data, currentPubkey);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const isPending = startMutation.isPending || stopMutation.isPending;
  const isActive = agent ? isManagedAgentActive(agent) : false;
  const primaryLabel = constructPrimaryActionLabel(isActive);
  const startError = agent
    ? writingBotStartErrorCopy(null, agent.lastError, agent.lastErrorCode)
    : null;

  const handlePrimary = React.useCallback(async () => {
    if (!agent) return;
    setActionError(null);
    try {
      if (isManagedAgentActive(agent)) {
        const result = await stopManagedAgentWithRules({
          agent,
          channels: [],
          relayAgents: [],
          stopManagedAgent: stopMutation.mutateAsync,
        });
        clearActiveTurnsForAgentOnStop(agent.pubkey);
        toast.success(result.noticeMessage ?? `Stopped ${agent.name}.`);
        return;
      }
      await startManagedAgentWithRules({
        agent,
        startManagedAgent: startMutation.mutateAsync,
      });
      toast.success(`Resumed ${agent.name}.`);
    } catch (error) {
      const copy =
        error instanceof Error
          ? error.message
          : "Couldn't update this writing bot. Try again.";
      setActionError(copy);
      toast.error(copy);
    }
  }, [agent, startMutation.mutateAsync, stopMutation.mutateAsync]);

  const handleRestart = React.useCallback(async () => {
    if (!agent) return;
    setActionError(null);
    try {
      await respawnManagedAgentWithRules({
        agent,
        startManagedAgent: startMutation.mutateAsync,
        stopManagedAgent: stopMutation.mutateAsync,
        onStopped: () => clearActiveTurnsForAgentOnStop(agent.pubkey),
      });
      toast.success(`Restarted ${agent.name}. Conversation kept.`);
    } catch (error) {
      const copy =
        error instanceof Error
          ? error.message
          : "Couldn't restart this writing bot. Try again.";
      setActionError(copy);
      toast.error(copy);
    }
  }, [agent, startMutation.mutateAsync, stopMutation.mutateAsync]);

  if (!agent) {
    return null;
  }

  const banner = actionError || startError;

  return (
    <div className="flex min-w-0 items-center gap-1">
      {banner ? (
        <p
          className="mr-2 hidden max-w-56 truncate text-2xs text-destructive sm:block"
          data-testid="agent-construct-error"
          title={banner}
        >
          {banner}
        </p>
      ) : null}
      <Button
        aria-label={primaryLabel}
        data-testid="agent-construct-stop-resume"
        disabled={isPending}
        onClick={() => void handlePrimary()}
        size="sm"
        type="button"
        variant="outline"
      >
        {isActive ? (
          <Square className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {primaryLabel}
      </Button>
      <Button
        aria-label="Restart"
        data-testid="agent-construct-restart"
        disabled={isPending}
        onClick={() => void handleRestart()}
        size="sm"
        type="button"
        variant="outline"
      >
        <RefreshCw className="h-4 w-4" />
        Restart
      </Button>
    </div>
  );
}

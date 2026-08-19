import * as React from "react";

import { createWritingBot } from "@/features/agents/construct/createWritingBot";
import {
  useAcpRuntimesQuery,
  useCreateManagedAgentMutation,
  useCreatePersonaMutation,
  useDeleteManagedAgentMutation,
  useDeletePersonaMutation,
  useStopManagedAgentMutation,
} from "@/features/agents/hooks";
import { useOpenDmMutation } from "@/features/channels/hooks";
import { useSendMessageMutation } from "@/features/messages/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { discoverAcpRuntimes } from "@/shared/api/tauri";

export function useCreateWritingBot() {
  const identityQuery = useIdentityQuery();
  const runtimesQuery = useAcpRuntimesQuery();
  const createPersonaMutation = useCreatePersonaMutation();
  const createAgentMutation = useCreateManagedAgentMutation();
  const deletePersonaMutation = useDeletePersonaMutation();
  const deleteAgentMutation = useDeleteManagedAgentMutation();
  const stopAgentMutation = useStopManagedAgentMutation();
  const openDmMutation = useOpenDmMutation();
  const sendMessageMutation = useSendMessageMutation(null, identityQuery.data);
  const [isCreating, setIsCreating] = React.useState(false);

  const create = React.useCallback(
    async (job: string) => {
      setIsCreating(true);
      try {
        return await createWritingBot(job, {
          listRuntimes: async () =>
            runtimesQuery.data ?? (await discoverAcpRuntimes()),
          createPersona: (input) => createPersonaMutation.mutateAsync(input),
          createAgent: (input) => createAgentMutation.mutateAsync(input),
          openDm: (input) => openDmMutation.mutateAsync(input),
          sendMessage: (input) =>
            sendMessageMutation.mutateAsync({
              channelId: input.channelId,
              content: input.content,
              mentionPubkeys: input.mentionPubkeys,
              targetChannel: input.targetChannel,
              transport: "http",
            }),
          stopAgent: (pubkey) => stopAgentMutation.mutateAsync(pubkey),
          deleteAgent: (pubkey) => deleteAgentMutation.mutateAsync({ pubkey }),
          deletePersona: (id) => deletePersonaMutation.mutateAsync(id),
        });
      } finally {
        setIsCreating(false);
      }
    },
    [
      createAgentMutation.mutateAsync,
      createPersonaMutation.mutateAsync,
      deleteAgentMutation.mutateAsync,
      deletePersonaMutation.mutateAsync,
      openDmMutation.mutateAsync,
      runtimesQuery.data,
      sendMessageMutation.mutateAsync,
      stopAgentMutation.mutateAsync,
    ],
  );

  return {
    create,
    isCreating,
    runtimesQuery,
  };
}

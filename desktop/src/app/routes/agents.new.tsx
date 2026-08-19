import { createFileRoute } from "@tanstack/react-router";

import { AgentConstructScreen } from "@/features/agents/construct/ui/AgentConstructScreen";

export const Route = createFileRoute("/agents/new")({
  component: AgentConstructScreen,
});

import * as React from "react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCreateWritingBot } from "@/features/agents/construct/useCreateWritingBot";
import { writingBotStartErrorCopy } from "@/features/agents/construct/writingBot";
import { showAgentProfileSyncWarning } from "@/features/agents/ui/agentProfileSyncWarning";
import { ChatHeader } from "@/features/chat/ui/ChatHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Spinner } from "@/shared/ui/spinner";

export function AgentConstructScreen() {
  const { goChannel } = useAppNavigation();
  const { create, isCreating } = useCreateWritingBot();
  const [job, setJob] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [confirmAccess, setConfirmAccess] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  const createApprovedBot = React.useCallback(async () => {
    setError(null);
    setStatus("Starting your writing bot…");
    const result = await create(job);
    if (!result.ok) {
      setStatus(null);
      setError(result.failure.copy);
      return;
    }
    const startCopy = writingBotStartErrorCopy(result.spawnError);
    if (startCopy) {
      toast.error(startCopy);
    }
    showAgentProfileSyncWarning(result.agent.name, result.profileSyncError);
    if (result.sendError) {
      toast.error(
        result.sendError.startsWith("Couldn't")
          ? result.sendError
          : `Couldn't send your first message. Try again in this conversation. ${result.sendError}`,
      );
    }
    await goChannel(result.channel.id);
  }, [create, goChannel, job]);

  const handleSubmit = React.useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      if (!job.trim() || isCreating) return;
      setError(null);
      setConfirmAccess(true);
    },
    [isCreating, job],
  );

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="agent-construct-screen"
    >
      <ChatHeader
        belowSystemChrome
        description="Describe the writing you want help with. Your conversation stays here if you stop, resume, or restart."
        mode="agents"
        title="New writing bot"
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
          <div className="w-full max-w-xl space-y-3 text-center">
            <p className="text-base text-foreground">
              Tell me what this writing bot should help with.
            </p>
            <p className="text-sm text-muted-foreground">
              For example: draft friendly blog posts, or tighten emails before
              you send them.
            </p>
            {status ? (
              <p
                className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
                data-testid="agent-construct-status"
              >
                <Spinner className="h-4 w-4" />
                {status}
              </p>
            ) : null}
            {error ? (
              <p
                className="text-sm text-destructive"
                data-testid="agent-construct-error"
              >
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <form
          className="shrink-0 border-t border-border/60 px-4 py-3 sm:px-6"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label className="sr-only" htmlFor="agent-construct-job">
            What should this writing bot help with?
          </label>
          <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
            <textarea
              className="min-h-16 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-message text-foreground outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="agent-construct-job"
              disabled={isCreating}
              id="agent-construct-job"
              onChange={(event) => setJob(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!isCreating && job.trim()) {
                    void handleSubmit();
                  }
                }
              }}
              placeholder="What should this writing bot help you write?"
              ref={textareaRef}
              rows={2}
              value={job}
            />
            <Button
              data-testid="agent-construct-send"
              disabled={isCreating || job.trim().length === 0}
              type="submit"
            >
              {isCreating ? "Starting…" : "Send"}
            </Button>
          </div>
        </form>
      </div>
      <AlertDialog onOpenChange={setConfirmAccess} open={confirmAccess}>
        <AlertDialogContent data-testid="agent-construct-access-confirmation">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Give this bot restricted access?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Buzz will create a separate OpenClaw writing identity. It can
              answer in this conversation and check its session status, but it
              cannot read files, run commands, browse, or send messages
              elsewhere.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCreating}>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                data-testid="agent-construct-access-approve"
                disabled={isCreating}
                onClick={() => void createApprovedBot()}
                type="button"
              >
                {isCreating ? "Preparing…" : "Allow and create"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

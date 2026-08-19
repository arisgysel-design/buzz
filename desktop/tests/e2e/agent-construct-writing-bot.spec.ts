/**
 * Agent Construct vertical slice:
 * Plus → conversation → OpenClaw writing bot → message → Stop/Resume → restart.
 *
 * Seeding `acpRuntimesCatalog` replaces the whole mock catalog. The default
 * catalog has no OpenClaw entry, so the happy path must seed an available one.
 */
import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const JOB = "Help me write weekly blog posts in a friendly tone";

const OPENCLAW_AVAILABLE = {
  id: "openclaw",
  label: "OpenClaw",
  avatar_url: "",
  availability: "available",
  command: "openclaw",
  binary_path: "/usr/local/bin/openclaw",
  default_args: ["acp"],
  mcp_command: null,
  install_hint: "Buzz talks to OpenClaw through its ACP mode.",
  install_instructions_url: "https://docs.openclaw.ai/start/getting-started",
  can_auto_install: false,
  requires_external_cli: true,
  underlying_cli_path: null,
  node_required: false,
  auth_status: { status: "not_applicable" },
  source: "preset",
} as const;

const OPENCLAW_NOT_INSTALLED = {
  ...OPENCLAW_AVAILABLE,
  availability: "not_installed",
  command: "openclaw",
  binary_path: null,
} as const;

type CommandLogEntry = {
  command: string;
  payload: unknown;
};

async function readCommandLog(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const log = (
      window as Window & {
        __BUZZ_E2E_COMMAND_LOG__?: CommandLogEntry[];
      }
    ).__BUZZ_E2E_COMMAND_LOG__;
    if (!log) {
      throw new Error("E2E bridge command log is not installed");
    }
    return log;
  });
}

function commandCount(log: CommandLogEntry[], command: string) {
  return log.filter((entry) => entry.command === command).length;
}

async function openWritingBotScreen(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("app-sidebar").waitFor({ state: "visible" });
  await page.getByTestId("agent-construct-plus").click();
  await expect(page.getByTestId("agent-construct-screen")).toBeVisible();
  await expect(page).toHaveURL(/#\/agents\/new$/);
}

test.describe("Agent Construct writing bot", () => {
  test("Plus starts an OpenClaw writing bot and keeps the conversation across Stop, Resume, and Restart", async ({
    page,
  }) => {
    await installMockBridge(page, {
      acpRuntimesCatalog: [OPENCLAW_AVAILABLE],
    });
    await openWritingBotScreen(page);

    await expect(page.getByTestId("agent-construct-screen")).not.toContainText(
      /ACP|harness|persona|adapter|workspace/i,
    );

    await page.getByTestId("agent-construct-job").fill(JOB);
    await page.getByTestId("agent-construct-send").click();

    await expect(page.getByTestId("agent-construct-screen")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("message-timeline")).toContainText(JOB, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("agent-construct-stop-resume")).toHaveText(
      "Stop",
    );
    await expect(page.getByTestId("agent-construct-restart")).toBeVisible();

    const afterCreate = await readCommandLog(page);
    expect(commandCount(afterCreate, "create_persona")).toBe(1);
    expect(commandCount(afterCreate, "create_managed_agent")).toBe(1);
    expect(commandCount(afterCreate, "open_dm")).toBe(1);
    expect(commandCount(afterCreate, "send_channel_message")).toBe(1);
    expect(commandCount(afterCreate, "stop_managed_agent")).toBe(0);
    expect(commandCount(afterCreate, "start_managed_agent")).toBe(0);

    const persona = afterCreate.find(
      (entry) => entry.command === "create_persona",
    );
    const personaInput = (persona?.payload as { input?: { runtime?: string } })
      ?.input;
    expect(personaInput?.runtime).toBe("openclaw");

    const created = afterCreate.find(
      (entry) => entry.command === "create_managed_agent",
    );
    const agentInput = (
      created?.payload as {
        input?: { agentCommand?: string; spawnAfterCreate?: boolean };
      }
    )?.input;
    expect(agentInput?.agentCommand).toBe("openclaw");
    expect(agentInput?.spawnAfterCreate).toBe(true);

    await page.getByTestId("agent-construct-stop-resume").click();
    await expect(page.getByTestId("agent-construct-stop-resume")).toHaveText(
      "Resume",
      { timeout: 5_000 },
    );
    await expect(page.getByTestId("message-timeline")).toContainText(JOB);
    expect(commandCount(await readCommandLog(page), "stop_managed_agent")).toBe(
      1,
    );

    await page.getByTestId("agent-construct-stop-resume").click();
    await expect(page.getByTestId("agent-construct-stop-resume")).toHaveText(
      "Stop",
      { timeout: 5_000 },
    );
    await expect(page.getByTestId("message-timeline")).toContainText(JOB);
    expect(
      commandCount(await readCommandLog(page), "start_managed_agent"),
    ).toBe(1);

    await page.getByTestId("agent-construct-restart").click();
    await expect(page.getByTestId("agent-construct-stop-resume")).toHaveText(
      "Stop",
      { timeout: 5_000 },
    );
    await expect(page.getByTestId("message-timeline")).toContainText(JOB);
    await waitForAnimations(page);

    const afterLifecycle = await readCommandLog(page);
    expect(commandCount(afterLifecycle, "stop_managed_agent")).toBe(2);
    expect(commandCount(afterLifecycle, "start_managed_agent")).toBe(2);
    expect(commandCount(afterLifecycle, "create_persona")).toBe(1);
    expect(commandCount(afterLifecycle, "open_dm")).toBe(1);
    expect(commandCount(afterLifecycle, "send_channel_message")).toBe(1);
  });

  test("missing OpenClaw is visible and recoverable without creating a bot", async ({
    page,
  }) => {
    await installMockBridge(page, {
      acpRuntimesCatalog: [OPENCLAW_NOT_INSTALLED],
    });
    await openWritingBotScreen(page);

    await page.getByTestId("agent-construct-job").fill(JOB);
    await page.getByTestId("agent-construct-send").click();

    await expect(page.getByTestId("agent-construct-error")).toContainText(
      "OpenClaw",
    );
    await expect(page.getByTestId("agent-construct-error")).not.toContainText(
      /ACP|harness|adapter/i,
    );
    await expect(page.getByTestId("agent-construct-screen")).toBeVisible();

    const log = await readCommandLog(page);
    expect(commandCount(log, "create_persona")).toBe(0);
    expect(commandCount(log, "create_managed_agent")).toBe(0);
    expect(commandCount(log, "open_dm")).toBe(0);
    expect(commandCount(log, "send_channel_message")).toBe(0);
  });

  test("Agents page New writing bot opens the same conversation screen", async ({
    page,
  }) => {
    await installMockBridge(page, {
      acpRuntimesCatalog: [OPENCLAW_AVAILABLE],
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("open-agents-view").click();
    await expect(page.getByTestId("agents-page-content")).toBeVisible();
    await page.getByTestId("agent-construct-plus-page").click();
    await expect(page.getByTestId("agent-construct-screen")).toBeVisible();
    await expect(page.getByTestId("chat-title")).toHaveText("New writing bot");
  });
});

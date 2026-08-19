import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWritingBotSystemPrompt,
  constructFailure,
  constructFailureCopy,
  constructPrimaryActionLabel,
  nameWritingBot,
  resolveOpenClawRuntime,
  writingBotStartErrorCopy,
  WRITING_BOT_FALLBACK_NAME,
  WRITING_BOT_RUNTIME_ID,
} from "./writingBot.ts";

function catalogEntry(overrides = {}) {
  return {
    id: WRITING_BOT_RUNTIME_ID,
    label: "OpenClaw",
    avatarUrl: "",
    availability: "available",
    command: "openclaw",
    binaryPath: "/usr/local/bin/openclaw",
    defaultArgs: ["acp"],
    mcpCommand: null,
    modelEnvVar: null,
    providerEnvVar: null,
    thinkingEnvVar: null,
    maxTokensEnvVar: null,
    contextLimitEnvVar: null,
    maxRoundsEnvVar: null,
    installHint: "",
    installInstructionsUrl: "",
    canAutoInstall: false,
    requiresExternalCli: true,
    underlyingCliPath: null,
    nodeRequired: false,
    authStatus: { status: "not_applicable" },
    loginHint: null,
    source: "preset",
    ...overrides,
  };
}

test("nameWritingBot strips leading filler and keeps a short title", () => {
  assert.equal(
    nameWritingBot("Help me write weekly blog posts in a friendly tone"),
    "Write weekly blog posts in",
  );
  assert.equal(nameWritingBot("   "), WRITING_BOT_FALLBACK_NAME);
});

test("nameWritingBot capitalizes the first letter", () => {
  assert.equal(
    nameWritingBot("draft customer emails"),
    "Draft customer emails",
  );
});

test("buildWritingBotSystemPrompt puts the job in the prompt and stays conversation-owned", () => {
  const prompt = buildWritingBotSystemPrompt("tighten my emails");
  assert.match(prompt, /writing bot/i);
  assert.match(prompt, /tighten my emails/);
  assert.match(prompt, /Stay in this conversation/);
  assert.doesNotMatch(prompt, /GBrain|workspace|ACP|persona|harness/i);
});

test("resolveOpenClawRuntime requires an available OpenClaw catalog entry", () => {
  const available = resolveOpenClawRuntime([catalogEntry()]);
  assert.equal(available.ok, true);

  const missing = resolveOpenClawRuntime([
    catalogEntry({
      availability: "not_installed",
      command: null,
      binaryPath: null,
    }),
  ]);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.failure.code, "openclaw_unavailable");
    assert.doesNotMatch(missing.failure.copy, /ACP|harness|adapter/i);
  }

  const empty = resolveOpenClawRuntime([]);
  assert.equal(empty.ok, false);
});

test("construct copy is recoverable and hides builder internals", () => {
  assert.equal(
    constructFailureCopy("empty_job"),
    "Tell this writing bot what you want help writing.",
  );
  assert.match(
    constructFailure("create_failed", "disk full").copy,
    /disk full/,
  );
  assert.equal(constructPrimaryActionLabel(true), "Stop");
  assert.equal(constructPrimaryActionLabel(false), "Resume");
});

test("writingBotStartErrorCopy surfaces spawn failures as Resume", () => {
  assert.equal(writingBotStartErrorCopy(null), null);
  assert.match(
    writingBotStartErrorCopy("openclaw gateway is not running") ?? "",
    /Resume/,
  );
});

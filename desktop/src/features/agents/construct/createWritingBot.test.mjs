import assert from "node:assert/strict";
import test from "node:test";

import { createWritingBot } from "./createWritingBot.ts";
import { WRITING_BOT_RUNTIME_ID } from "./writingBot.ts";

const BOT_PUBKEY = "bb".repeat(32);

function availableOpenClaw() {
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
  };
}

function persona() {
  return {
    id: "persona-1",
    displayName: "Weekly blog posts",
    avatarUrl: null,
    systemPrompt: "You are a writing bot.",
    runtime: WRITING_BOT_RUNTIME_ID,
    model: null,
    provider: null,
    namePool: [],
    isBuiltIn: false,
    isActive: true,
    shared: false,
    sourceTeam: null,
    catalogSource: null,
    envVars: {},
    respondTo: null,
    respondToAllowlist: [],
    parallelism: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function agentRecord() {
  return {
    pubkey: BOT_PUBKEY,
    name: "Weekly blog posts",
    personaId: "persona-1",
    backend: { type: "local" },
    status: "running",
    spawnError: null,
  };
}

test("createWritingBot refuses an empty job without writing state", async () => {
  const calls = [];
  const result = await createWritingBot("   ", {
    listRuntimes: async () => {
      calls.push("runtimes");
      return [availableOpenClaw()];
    },
    createPersona: async () => {
      calls.push("persona");
      return persona();
    },
    createAgent: async () => {
      calls.push("agent");
      return {
        agent: agentRecord(),
        privateKeyNsec: "nsec1mock",
        profileSyncError: null,
        spawnError: null,
      };
    },
    openDm: async () => {
      calls.push("dm");
      return { id: "dm-1", channelType: "dm", participantPubkeys: [] };
    },
    sendMessage: async () => {
      calls.push("send");
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "empty_job");
  }
  assert.deepEqual(calls, []);
});

test("createWritingBot stops before create when OpenClaw is missing", async () => {
  const calls = [];
  const result = await createWritingBot("write weekly blog posts", {
    listRuntimes: async () => [],
    createPersona: async () => {
      calls.push("persona");
      return persona();
    },
    createAgent: async () => {
      calls.push("agent");
      throw new Error("should not create");
    },
    openDm: async () => {
      throw new Error("should not open");
    },
    sendMessage: async () => {
      throw new Error("should not send");
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "openclaw_unavailable");
  }
  assert.deepEqual(calls, []);
});

test("createWritingBot uses Buzz persona, agent, DM, and message writers", async () => {
  const calls = [];
  const result = await createWritingBot("Help me write weekly blog posts", {
    listRuntimes: async () => [availableOpenClaw()],
    createPersona: async (input) => {
      calls.push(["persona", input.runtime, input.displayName]);
      assert.equal(input.runtime, WRITING_BOT_RUNTIME_ID);
      assert.match(input.systemPrompt, /weekly blog posts/i);
      return { ...persona(), displayName: input.displayName };
    },
    createAgent: async (input) => {
      calls.push(["agent", input.agentCommand, input.personaId]);
      assert.equal(input.agentCommand, "openclaw");
      assert.equal(input.spawnAfterCreate, true);
      assert.equal(input.backend.type, "local");
      return {
        agent: agentRecord(),
        privateKeyNsec: "nsec1mock",
        profileSyncError: null,
        spawnError: null,
      };
    },
    openDm: async (input) => {
      calls.push(["dm", input.pubkeys]);
      return {
        id: "dm-1",
        channelType: "dm",
        participantPubkeys: ["self", BOT_PUBKEY],
      };
    },
    sendMessage: async (input) => {
      calls.push(["send", input.channelId, input.content]);
      assert.equal(input.channelId, "dm-1");
      assert.equal(input.content, "Help me write weekly blog posts");
      assert.deepEqual(input.mentionPubkeys, [BOT_PUBKEY]);
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.channel.id, "dm-1");
    assert.equal(result.agent.pubkey, BOT_PUBKEY);
    assert.equal(result.sendError, null);
  }
  assert.equal(calls[0][0], "persona");
  assert.equal(calls[1][0], "agent");
  assert.equal(calls[2][0], "dm");
  assert.equal(calls[3][0], "send");
});

test("createWritingBot keeps the conversation when the first send fails", async () => {
  const result = await createWritingBot("draft launch notes", {
    listRuntimes: async () => [availableOpenClaw()],
    createPersona: async () => persona(),
    createAgent: async () => ({
      agent: agentRecord(),
      privateKeyNsec: "nsec1mock",
      profileSyncError: null,
      spawnError: "gateway down",
    }),
    openDm: async () => ({
      id: "dm-2",
      channelType: "dm",
      participantPubkeys: [BOT_PUBKEY],
    }),
    sendMessage: async () => {
      throw new Error("relay timeout");
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.channel.id, "dm-2");
    assert.equal(result.spawnError, "gateway down");
    assert.equal(result.sendError, "relay timeout");
  }
});

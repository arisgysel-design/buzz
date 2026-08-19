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

function persona(id = "persona-1") {
  return {
    id,
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

function agentRecord(pubkey = BOT_PUBKEY, personaId = "persona-1") {
  return {
    pubkey,
    name: "Weekly blog posts",
    personaId,
    backend: { type: "local" },
    status: "running",
    spawnError: null,
  };
}

function recordingCleanup() {
  const calls = [];
  return {
    calls,
    deps: {
      stopAgent: async (pubkey) => {
        calls.push(["stop", pubkey]);
      },
      deleteAgent: async (pubkey) => {
        calls.push(["deleteAgent", pubkey]);
      },
      deletePersona: async (id) => {
        calls.push(["deletePersona", id]);
      },
    },
  };
}

test("createWritingBot refuses an empty job without writing state", async () => {
  const calls = [];
  const cleanup = recordingCleanup();
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
    ...cleanup.deps,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "empty_job");
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(cleanup.calls, []);
});

test("createWritingBot stops before create when OpenClaw is missing", async () => {
  const calls = [];
  const cleanup = recordingCleanup();
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
    ...cleanup.deps,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "openclaw_unavailable");
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(cleanup.calls, []);
});

test("createWritingBot uses Buzz persona, agent, DM, and message writers", async () => {
  const calls = [];
  const cleanup = recordingCleanup();
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
    ...cleanup.deps,
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
  assert.deepEqual(cleanup.calls, []);
});

test("createWritingBot keeps the conversation when the first send fails", async () => {
  const cleanup = recordingCleanup();
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
    ...cleanup.deps,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.channel.id, "dm-2");
    assert.equal(result.spawnError, "gateway down");
    assert.equal(result.sendError, "relay timeout");
  }
  assert.deepEqual(cleanup.calls, []);
});

test("createWritingBot deletes the persona when createAgent fails", async () => {
  const cleanup = recordingCleanup();
  const result = await createWritingBot("write weekly blog posts", {
    listRuntimes: async () => [availableOpenClaw()],
    createPersona: async () => persona("persona-leftover"),
    createAgent: async () => {
      throw new Error("agent store write failed");
    },
    openDm: async () => {
      throw new Error("should not open");
    },
    sendMessage: async () => {
      throw new Error("should not send");
    },
    ...cleanup.deps,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "create_failed");
    assert.match(result.failure.copy, /agent store write failed/);
  }
  assert.deepEqual(cleanup.calls, [["deletePersona", "persona-leftover"]]);
});

test("createWritingBot stops and drops a spawned agent when openDm fails", async () => {
  const cleanup = recordingCleanup();
  const result = await createWritingBot("write weekly blog posts", {
    listRuntimes: async () => [availableOpenClaw()],
    createPersona: async () => persona("persona-dm-fail"),
    createAgent: async () => ({
      agent: agentRecord(BOT_PUBKEY, "persona-dm-fail"),
      privateKeyNsec: "nsec1mock",
      profileSyncError: null,
      spawnError: null,
    }),
    openDm: async () => {
      throw new Error("relay rejected dm");
    },
    sendMessage: async () => {
      throw new Error("should not send");
    },
    ...cleanup.deps,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "create_failed");
  }
  assert.deepEqual(cleanup.calls, [
    ["stop", BOT_PUBKEY],
    ["deleteAgent", BOT_PUBKEY],
    ["deletePersona", "persona-dm-fail"],
  ]);
});

test("createWritingBot retry after mid-path failures does not accumulate orphans", async () => {
  const livePersonas = new Set();
  const liveAgents = new Set();
  const cleanup = recordingCleanup();
  let attempt = 0;

  const deps = {
    listRuntimes: async () => [availableOpenClaw()],
    createPersona: async () => {
      attempt += 1;
      const id = `persona-${attempt}`;
      livePersonas.add(id);
      return persona(id);
    },
    createAgent: async (input) => {
      const pubkey = `${String(attempt).padStart(2, "0")}`.repeat(32);
      liveAgents.add(pubkey);
      return {
        agent: agentRecord(pubkey, input.personaId),
        privateKeyNsec: "nsec1mock",
        profileSyncError: null,
        spawnError: null,
      };
    },
    openDm: async () => {
      throw new Error("open dm failed");
    },
    sendMessage: async () => {
      throw new Error("should not send");
    },
    stopAgent: async (pubkey) => {
      cleanup.calls.push(["stop", pubkey]);
    },
    deleteAgent: async (pubkey) => {
      cleanup.calls.push(["deleteAgent", pubkey]);
      liveAgents.delete(pubkey);
    },
    deletePersona: async (id) => {
      cleanup.calls.push(["deletePersona", id]);
      livePersonas.delete(id);
    },
  };

  const first = await createWritingBot("write weekly blog posts", deps);
  const second = await createWritingBot("write weekly blog posts", deps);

  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(livePersonas.size, 0);
  assert.equal(liveAgents.size, 0);
  assert.equal(attempt, 2);
  assert.deepEqual(cleanup.calls, [
    ["stop", "01".repeat(32)],
    ["deleteAgent", "01".repeat(32)],
    ["deletePersona", "persona-1"],
    ["stop", "02".repeat(32)],
    ["deleteAgent", "02".repeat(32)],
    ["deletePersona", "persona-2"],
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { isOneToOneDm, ownedLocalAgentFromDm } from "./ownedDmAgent.ts";
import { WRITING_BOT_PROMPT_MARKER } from "./writingBot.ts";

const SELF = "aa".repeat(32);
const BOT = "bb".repeat(32);
const OTHER = "cc".repeat(32);

function agent(pubkey, backend = { type: "local" }, extras = {}) {
  return {
    pubkey,
    name: "Writer",
    backend,
    status: "running",
    agentCommand: "openclaw",
    runtime: null,
    systemPrompt: WRITING_BOT_PROMPT_MARKER,
    ...extras,
  };
}

test("ownedLocalAgentFromDm matches a 1:1 DM with an owned construct writing bot", () => {
  const found = ownedLocalAgentFromDm(
    {
      channelType: "dm",
      participantPubkeys: [SELF, BOT],
    },
    [agent(BOT)],
    SELF,
  );
  assert.equal(found?.pubkey, BOT);
});

test("ownedLocalAgentFromDm ignores builder-created OpenClaw agents", () => {
  assert.equal(
    ownedLocalAgentFromDm(
      { channelType: "dm", participantPubkeys: [SELF, BOT] },
      [
        agent(
          BOT,
          { type: "local" },
          {
            systemPrompt: "You are a helpful coding assistant.",
          },
        ),
      ],
      SELF,
    ),
    null,
  );
  assert.equal(
    ownedLocalAgentFromDm(
      { channelType: "dm", participantPubkeys: [SELF, BOT] },
      [agent(BOT, { type: "local" }, { systemPrompt: null })],
      SELF,
    ),
    null,
  );
});

test("isOneToOneDm is true only for a 1:1 DM with a known self pubkey", () => {
  assert.equal(
    isOneToOneDm({ channelType: "dm", participantPubkeys: [SELF, BOT] }, SELF),
    true,
  );
  assert.equal(
    isOneToOneDm(
      { channelType: "stream", participantPubkeys: [SELF, BOT] },
      SELF,
    ),
    false,
  );
  assert.equal(
    isOneToOneDm(
      { channelType: "dm", participantPubkeys: [SELF, BOT, OTHER] },
      SELF,
    ),
    false,
  );
  assert.equal(
    isOneToOneDm({ channelType: "dm", participantPubkeys: [SELF, BOT] }, null),
    false,
  );
});

test("ownedLocalAgentFromDm ignores group DMs, streams, and remote agents", () => {
  assert.equal(
    ownedLocalAgentFromDm(
      { channelType: "stream", participantPubkeys: [SELF, BOT] },
      [agent(BOT)],
      SELF,
    ),
    null,
  );
  assert.equal(
    ownedLocalAgentFromDm(
      { channelType: "dm", participantPubkeys: [SELF, BOT, OTHER] },
      [agent(BOT)],
      SELF,
    ),
    null,
  );
  assert.equal(
    ownedLocalAgentFromDm(
      { channelType: "dm", participantPubkeys: [SELF, BOT] },
      [agent(BOT, { type: "provider", id: "k8s", config: {} })],
      SELF,
    ),
    null,
  );
  assert.equal(
    ownedLocalAgentFromDm(
      { channelType: "dm", participantPubkeys: [SELF, BOT] },
      [
        agent(
          BOT,
          { type: "local" },
          { agentCommand: "goose", runtime: "goose" },
        ),
      ],
      SELF,
    ),
    null,
  );
});

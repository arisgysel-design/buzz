import assert from "node:assert/strict";
import test from "node:test";

import { ownedLocalAgentFromDm } from "./ownedDmAgent.ts";

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
    ...extras,
  };
}

test("ownedLocalAgentFromDm matches a 1:1 DM with an owned local agent", () => {
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

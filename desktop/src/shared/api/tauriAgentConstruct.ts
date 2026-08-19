import { invoke } from "@tauri-apps/api/core";

export type OpenClawConstructAccess = {
  agentId: string;
  toolProfile: "minimal";
};

export function ensureOpenClawConstructAccess(): Promise<OpenClawConstructAccess> {
  return invoke<OpenClawConstructAccess>("ensure_openclaw_construct_access");
}

import { getServerConfig } from "@/server/config";
import { createOpaqueToken, sha256 } from "@/server/crypto";
import { getRuntimeIntegration } from "@/server/runtime-settings";

export type FakeSmsMessage = {
  id: string;
  mobile: string;
  template: "pilot-access-link";
  accessToken: string;
  accessUrl: string;
  tokenHash: string;
  createdAt: string;
};

const messages: FakeSmsMessage[] = [];

export function enqueuePilotAccessSms(mobile: string, rawToken: string) {
  const message: FakeSmsMessage = {
    id: createOpaqueToken(12),
    mobile,
    template: "pilot-access-link",
    accessToken: rawToken,
    accessUrl: `${getServerConfig().APP_ORIGIN}/pilot/access/${rawToken}`,
    tokenHash: sha256(rawToken),
    createdAt: new Date().toISOString(),
  };
  messages.push(message);
  if (messages.length > 1000) messages.shift();
  return message;
}

export function getFakeSmsOutbox() {
  return [...messages];
}

export async function shouldSendPilotAccessSms() {
  const integration = await getRuntimeIntegration("sms");
  return integration.enabled && integration.adapter !== "disabled";
}

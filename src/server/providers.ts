import { getRuntimeIntegration } from "@/server/runtime-settings";
import { getServerConfig } from "@/server/config";

export interface SmsAdapter {
  send(input: {
    mobile: string;
    message: string;
    idempotencyKey?: string;
  }): Promise<{ accepted: boolean; providerId?: string }>;
}

export interface FeishuAdapter {
  send(input: {
    target: string;
    message: string;
    idempotencyKey?: string;
  }): Promise<{ accepted: boolean; providerId?: string }>;
}

export interface VlmAdapter {
  recognize(objectKey: string): Promise<unknown>;
}

export const disabledSmsAdapter: SmsAdapter = {
  async send() {
    return { accepted: false };
  },
};
const fakeSmsAdapter: SmsAdapter = {
  async send() {
    return { accepted: true, providerId: "fake-sms" };
  },
};
export const disabledFeishuAdapter: FeishuAdapter = {
  async send() {
    return { accepted: false };
  },
};

function webhookHeaders(token: string, idempotencyKey?: string) {
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
  };
}

function webhookSmsAdapter(url: string, token: string, timeoutSeconds = 10): SmsAdapter {
  return {
    async send(input) {
      const response = await fetch(url, {
        method: "POST",
        headers: webhookHeaders(token, input.idempotencyKey),
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
      });
      if (!response.ok) throw new Error(`SMS webhook HTTP ${response.status}`);
      const body = (await response.json().catch(() => ({}))) as {
        accepted?: boolean;
        providerId?: string;
      };
      return { accepted: body.accepted !== false, providerId: body.providerId };
    },
  };
}

function webhookFeishuAdapter(url: string, token: string, timeoutSeconds = 10): FeishuAdapter {
  return {
    async send(input) {
      const response = await fetch(url, {
        method: "POST",
        headers: webhookHeaders(token, input.idempotencyKey),
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
      });
      if (!response.ok) throw new Error(`Feishu webhook HTTP ${response.status}`);
      const body = (await response.json().catch(() => ({}))) as {
        accepted?: boolean;
        providerId?: string;
      };
      return { accepted: body.accepted !== false, providerId: body.providerId };
    },
  };
}

export function getSmsAdapter(): SmsAdapter {
  return {
    async send(input) {
      if (process.env.CREWQUAL_TEST_NO_EXTERNAL === "1") return disabledSmsAdapter.send(input);
      if (getServerConfig().SERVICE_MODE === "mock") return disabledSmsAdapter.send(input);
      const config = await getRuntimeIntegration("sms");
      if (!config.enabled || config.adapter === "disabled") return disabledSmsAdapter.send(input);
      if (config.adapter === "fake") return fakeSmsAdapter.send(input);
      return webhookSmsAdapter(config.endpoint, config.secret, config.timeoutSeconds).send(input);
    },
  };
}

export function getFeishuAdapter(): FeishuAdapter {
  return {
    async send(input) {
      if (process.env.CREWQUAL_TEST_NO_EXTERNAL === "1") return disabledFeishuAdapter.send(input);
      if (getServerConfig().SERVICE_MODE === "mock") return disabledFeishuAdapter.send(input);
      const config = await getRuntimeIntegration("feishu");
      if (!config.enabled || config.adapter === "disabled")
        return disabledFeishuAdapter.send(input);
      return webhookFeishuAdapter(config.endpoint, config.secret, config.timeoutSeconds).send(
        input,
      );
    },
  };
}

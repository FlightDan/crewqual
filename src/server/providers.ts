import { getRuntimeIntegration } from "@/server/runtime-settings";
import { getServerConfig } from "@/server/config";
import { fetchExternalEndpoint } from "@/server/external-endpoint-safety";
import { z } from "zod";

const strictProviderResponseSchema = z
  .object({
    accepted: z.boolean(),
    providerId: z.string().trim().min(1).optional(),
  })
  .strict();

function parseProviderResponse(value: unknown) {
  const parsed = strictProviderResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("PROVIDER_PROTOCOL_ERROR");
  return parsed.data;
}

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
      const config = getServerConfig();
      const response = await fetchExternalEndpoint(
        url,
        {
          method: "POST",
          headers: webhookHeaders(token, input.idempotencyKey),
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(timeoutSeconds * 1000),
        },
        config.NODE_ENV === "production",
        {
          allowedHosts: config.OUTBOUND_ALLOWED_HOSTS,
          allowedCidrs: config.OUTBOUND_ALLOWED_CIDRS,
        },
      );
      if (!response.ok) throw new Error(`SMS webhook HTTP ${response.status}`);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error("PROVIDER_PROTOCOL_ERROR");
      }
      return parseProviderResponse(body);
    },
  };
}

function webhookFeishuAdapter(url: string, token: string, timeoutSeconds = 10): FeishuAdapter {
  return {
    async send(input) {
      const config = getServerConfig();
      const response = await fetchExternalEndpoint(
        url,
        {
          method: "POST",
          headers: webhookHeaders(token, input.idempotencyKey),
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(timeoutSeconds * 1000),
        },
        config.NODE_ENV === "production",
        {
          allowedHosts: config.OUTBOUND_ALLOWED_HOSTS,
          allowedCidrs: config.OUTBOUND_ALLOWED_CIDRS,
        },
      );
      if (!response.ok) throw new Error(`Feishu webhook HTTP ${response.status}`);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error("PROVIDER_PROTOCOL_ERROR");
      }
      return parseProviderResponse(body);
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

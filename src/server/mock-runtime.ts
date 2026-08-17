import { randomUUID } from "node:crypto";

type MockRuntimeGlobal = typeof globalThis & {
  __crewqualMockInstanceId?: string;
};

// Next can evaluate the root layout and API route in different server bundles.
// Keep the value on process-shared state instead of module scope so both
// bundles still identify the same running instance.
const runtimeGlobal = globalThis as MockRuntimeGlobal;
const mockInstanceId =
  runtimeGlobal.__crewqualMockInstanceId ?? process.env.CREWQUAL_MOCK_INSTANCE_ID ?? randomUUID();
runtimeGlobal.__crewqualMockInstanceId = mockInstanceId;
process.env.CREWQUAL_MOCK_INSTANCE_ID = mockInstanceId;

export function getMockInstanceId() {
  return mockInstanceId;
}

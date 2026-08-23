export type KeyStatus = "active" | "next" | "retired";

export type KeyringEntry = {
  id: string;
  publicKey: string;
  status: KeyStatus;
};

export type KeyringDocument = {
  schemaVersion: 1;
  keys: KeyringEntry[];
};

const keyIdPattern = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const publicKeyPattern = /^[A-Za-z0-9+/]{43}=$/;

function assertPlainObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertAllowedFields(value: Record<string, unknown>, fields: string[], label: string) {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} contains unknown field: ${field}`);
  }
}

export function parseKeyring(
  value: unknown,
  options: { requireActive?: boolean } = {},
): KeyringDocument {
  assertPlainObject(value, "keyring");
  assertAllowedFields(value, ["schemaVersion", "keys"], "keyring");
  if (value.schemaVersion !== 1 || !Array.isArray(value.keys)) {
    throw new Error("keyring must use schemaVersion 1 and contain keys");
  }

  const ids = new Set<string>();
  let activeCount = 0;
  let nextCount = 0;
  const keys: KeyringEntry[] = [];
  for (const [index, candidate] of value.keys.entries()) {
    assertPlainObject(candidate, `keyring.keys[${index}]`);
    assertAllowedFields(candidate, ["id", "publicKey", "status"], `keyring.keys[${index}]`);
    const id = candidate.id;
    const publicKey = candidate.publicKey;
    const status = candidate.status;
    if (typeof id !== "string" || !keyIdPattern.test(id) || ids.has(id)) {
      throw new Error(`keyring.keys[${index}] has an invalid or duplicate id`);
    }
    if (typeof publicKey !== "string" || !publicKeyPattern.test(publicKey)) {
      throw new Error(`keyring key ${id} must contain a Base64 public key`);
    }
    if (Buffer.from(publicKey, "base64").length !== 32) {
      throw new Error(`keyring key ${id} must contain a 32-byte Ed25519 public key`);
    }
    if (status !== "active" && status !== "next" && status !== "retired") {
      throw new Error(`keyring key ${id} has an invalid status`);
    }
    ids.add(id);
    if (status === "active") activeCount += 1;
    if (status === "next") nextCount += 1;
    keys.push({ id, publicKey, status });
  }
  if (activeCount > 1) throw new Error("keyring must contain at most one active key");
  if (nextCount > 1) throw new Error("keyring must contain at most one next key");
  if (options.requireActive && activeCount !== 1) {
    throw new Error("keyring must contain exactly one active key");
  }
  return { schemaVersion: 1, keys };
}

export function parseKeyringJSON(raw: string, options: { requireActive?: boolean } = {}) {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `invalid keyring JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseKeyring(value, options);
}

export function keyringJSON(keyring: KeyringDocument) {
  return `${JSON.stringify(keyring, null, 2)}\n`;
}

export function activeKey(keyring: KeyringDocument): KeyringEntry {
  const active = keyring.keys.filter((key) => key.status === "active");
  if (active.length !== 1) throw new Error("keyring must contain exactly one active key");
  return active[0];
}

export function nextKey(keyring: KeyringDocument): KeyringEntry {
  const next = keyring.keys.filter((key) => key.status === "next");
  if (next.length !== 1) throw new Error("keyring must contain exactly one next key");
  return next[0];
}

export function sameKeyring(left: KeyringDocument, right: KeyringDocument) {
  return JSON.stringify(left) === JSON.stringify(right);
}

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateKeyMaterial } from "../scripts/release/manage-manifest-key";
import { parseKeyring, parseKeyringJSON } from "../scripts/release/keyring-utils";

describe("manifest Ed25519 key manager", () => {
  it("generates signing-compatible PKCS#8 and raw public key material", () => {
    const material = generateKeyMaterial();
    const privateKey = createPrivateKey({
      key: Buffer.from(material.privateDerB64, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const publicKey = createPublicKey(privateKey);
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    const message = Buffer.from("manifest test");
    const signature = sign(null, message, privateKey);

    expect(privateKey.asymmetricKeyType).toBe("ed25519");
    expect(Buffer.from(material.publicRawB64, "base64")).toEqual(publicDer.subarray(-32));
    expect(material.id).toMatch(/^manifest-[a-f0-9]{16}$/);
    expect(verify(null, message, publicKey, signature)).toBe(true);
    message[0] ^= 1;
    expect(verify(null, message, publicKey, signature)).toBe(false);
  });

  it("rejects unknown fields, duplicate IDs, and multiple next keys", () => {
    const key = generateKeyMaterial();
    const entry = { id: key.id, publicKey: key.publicRawB64, status: "active" as const };
    expect(() => parseKeyring({ schemaVersion: 1, keys: [entry], extra: true })).toThrow(
      "unknown field",
    );
    expect(() => parseKeyring({ schemaVersion: 1, keys: [entry, { ...entry }] })).toThrow(
      "duplicate",
    );
    expect(() =>
      parseKeyring({
        schemaVersion: 1,
        keys: [
          entry,
          { ...entry, id: `${key.id}-next-1`, status: "next" },
          { ...entry, id: `${key.id}-next-2`, status: "next" },
        ],
      }),
    ).toThrow("at most one next");
  });

  it("requires one active key when requested", () => {
    const key = generateKeyMaterial();
    const raw = JSON.stringify({
      schemaVersion: 1,
      keys: [{ id: key.id, publicKey: key.publicRawB64, status: "next" }],
    });
    expect(() => parseKeyringJSON(raw, { requireActive: true })).toThrow("exactly one active");
  });
});

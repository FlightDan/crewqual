import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MAX_EVIDENCE_BYTES, validateProcessedJpeg } from "@/server/storage";

async function jpeg(width = 40, height = 20) {
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: { r: 240, g: 246, b: 255 } },
    })
      .jpeg()
      .toBuffer(),
  );
}

describe("processed private evidence validation", () => {
  it("returns dimensions, byte size and a content hash for a valid JPEG", async () => {
    const bytes = await jpeg();
    const result = await validateProcessedJpeg(bytes);

    expect(result).toMatchObject({ width: 40, height: 20, byteSize: bytes.byteLength });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects bytes that are not a JPEG", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await expect(validateProcessedJpeg(bytes)).rejects.toMatchObject({
      code: "INVALID_IMAGE",
      status: 422,
    });
  });

  it("rejects a truncated JPEG", async () => {
    const bytes = (await jpeg()).slice(0, -2);
    await expect(validateProcessedJpeg(bytes)).rejects.toMatchObject({
      code: "INVALID_IMAGE",
      status: 422,
    });
  });

  it("rejects bytes over the private evidence limit before decoding", async () => {
    await expect(
      validateProcessedJpeg(new Uint8Array(MAX_EVIDENCE_BYTES + 1)),
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE", status: 422 });
  });

  it("rejects an image whose dimension exceeds the server limit", async () => {
    const bytes = await jpeg(2561, 2);
    await expect(validateProcessedJpeg(bytes)).rejects.toMatchObject({
      code: "IMAGE_DIMENSIONS_TOO_LARGE",
      status: 422,
    });
  });
});

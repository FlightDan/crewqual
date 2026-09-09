import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  convertJpegToLosslessAvif,
  MAX_EVIDENCE_BYTES,
  rebuildEvidenceImage,
  validateProcessedJpeg,
} from "@/server/storage";

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

  it("stores decoded pixels without JPEG comments, EXIF or trailing payload", async () => {
    const original = await sharp(await jpeg())
      .withMetadata({
        exif: { IFD0: { ImageDescription: "PRIVATE-EXIF-MARKER" } },
      })
      .jpeg()
      .toBuffer();
    const comment = Buffer.from("PRIVATE-COMMENT-MARKER");
    const bytes = Buffer.concat([
      original.subarray(0, 2),
      Buffer.from([0xff, 0xfe, 0, comment.length + 2]),
      comment,
      original.subarray(2),
      Buffer.from("PRIVATE-TRAILING-MARKER"),
      Buffer.from([0xff, 0xd9]),
    ]);
    const result = await validateProcessedJpeg(bytes);
    const stored = Buffer.from(result.storageBytes);
    expect(stored.includes(Buffer.from("PRIVATE-"))).toBe(false);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(result.storageSha256).not.toBe(result.sha256);
    expect(result.storageByteSize).toBe(stored.length);
  });

  it("reconstructs a historical AVIF as JPEG but rejects mislabeled source content", async () => {
    const avif = await sharp(await jpeg())
      .avif()
      .toBuffer();
    const rebuilt = await rebuildEvidenceImage(avif, "image/avif");
    expect((await sharp(rebuilt.storageBytes).metadata()).format).toBe("jpeg");
    await expect(rebuildEvidenceImage(await jpeg(), "image/avif")).rejects.toThrow();
    await expect(rebuildEvidenceImage(avif, "image/png")).rejects.toThrow();
  });

  it("does not let a lossless optimization exceed the already-accounted storage size", async () => {
    const pixels = Buffer.alloc(128 * 128 * 3);
    let state = 1234;
    for (let index = 0; index < pixels.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      pixels[index] = state >>> 24;
    }
    const source = await sharp(pixels, { raw: { width: 128, height: 128, channels: 3 } })
      .jpeg({ quality: 30 })
      .toBuffer();
    await expect(convertJpegToLosslessAvif(source)).rejects.toMatchObject({
      code: "IMAGE_CONVERSION_FAILED",
    });
  });
});

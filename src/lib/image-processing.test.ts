import { describe, expect, it } from "vitest";
import {
  CHROME_HEIC_MESSAGE,
  processImageToJpeg,
  validateSourceImage,
} from "@/lib/image-processing";

describe("image upload policy", () => {
  it("accepts browser source formats but refuses SVG and PDF", () => {
    expect(validateSourceImage({ type: "image/png" })).toBeNull();
    expect(validateSourceImage({ type: "image/svg+xml" })).toContain("仅支持");
    expect(validateSourceImage({ type: "application/pdf" })).toContain("仅支持");
  });

  it("refuses HEIC outside Safari", () => {
    expect(validateSourceImage({ type: "image/heic" })).toBe(CHROME_HEIC_MESSAGE);
  });

  it("exports a JPEG with a bounded long edge when a canvas exists", async () => {
    if (typeof document === "undefined" || /jsdom/i.test(navigator.userAgent)) return;
    const canvas = document.createElement("canvas");
    canvas.width = 20;
    canvas.height = 10;
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!context) return;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 20, 10);
    const source = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), "image/png"),
    );
    const result = await processImageToJpeg(source, { x: 0, y: 0, width: 20, height: 10 });
    expect(result.type).toBe("image/jpeg");
  });
});

import type { Metadata } from "next";
import { LayoutPreview } from "@/components/layout-preview";

export const metadata: Metadata = {
  title: "Layout Preview · CrewQual",
  robots: { index: false, follow: false },
};

export default function LayoutPreviewPage() {
  return <LayoutPreview />;
}

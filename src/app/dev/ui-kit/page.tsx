import type { Metadata } from "next";
import { UIKitDemo } from "@/components/ui-kit-demo";

export const metadata: Metadata = {
  title: "UI Kit · CrewQual",
  robots: { index: false, follow: false },
};

export default function UIKitPage() {
  return <UIKitDemo />;
}

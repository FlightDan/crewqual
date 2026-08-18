import { redirect } from "next/navigation";
import { isSetupRequired } from "@/server/setup";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (process.env.NODE_ENV === "production" && (await isSetupRequired().catch(() => true))) {
    redirect("/setup");
  }
  redirect(process.env.NODE_ENV === "production" ? "/pilot/identity" : "/admin/dashboard");
}

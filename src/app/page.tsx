import { redirect } from "next/navigation";

export default function HomePage() {
  redirect(process.env.NODE_ENV === "production" ? "/pilot/identity" : "/admin/dashboard");
}

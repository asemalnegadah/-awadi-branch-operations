import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth/current-session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getCurrentSession();
  redirect(session ? "/dashboard" : "/login");
}

import { redirect } from "next/navigation";
import { getIngressPath } from "@/server/lib/ingress";

export default async function Home() {
  redirect(`${await getIngressPath()}/summary`);
}

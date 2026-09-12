import { notFound } from "next/navigation";
import EventClient from "@/components/EventClient";
import { getLayout } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: PageProps<"/event/[id]">) {
  const { id } = await params;
  const layout = await getLayout(id);
  if (!layout) notFound();
  return <EventClient layout={layout} />;
}

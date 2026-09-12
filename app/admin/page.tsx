import AdminList from "@/components/AdminList";
import { buildGeometry } from "@/lib/geometry";
import { listLayouts, storageStatus } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const layouts = await listLayouts();
  const summaries = layouts.map((l) => {
    const geo = buildGeometry(l);
    return {
      id: l.id,
      name: l.name,
      eventName: l.eventName,
      eventDate: l.eventDate,
      updatedAt: l.updatedAt,
      sections: l.sections.length,
      seats: geo.seats.length,
      available: geo.seats.filter((s) => s.status === "available").length,
    };
  });
  return <AdminList layouts={summaries} storage={storageStatus()} />;
}

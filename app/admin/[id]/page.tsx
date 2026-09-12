import { notFound } from "next/navigation";
import Editor from "@/components/Editor";
import { getLayout } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: PageProps<"/admin/[id]">) {
  const { id } = await params;
  const layout = await getLayout(id);
  if (!layout) notFound();
  return <Editor layout={layout} />;
}

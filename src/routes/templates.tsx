import { createFileRoute } from "@tanstack/react-router";
import { FolderView } from "@/components/FolderView";

export const Route = createFileRoute("/templates")({
  head: () => ({ meta: [{ title: "Templates · DocuEdit" }, { name: "description", content: "Manage and edit template PDFs." }] }),
  component: () => <FolderView folder="template" />,
});
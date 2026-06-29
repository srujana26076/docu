import { createFileRoute } from "@tanstack/react-router";
import { FolderView } from "@/components/FolderView";

export const Route = createFileRoute("/quotations")({
  head: () => ({ meta: [{ title: "Quotations · DocuEdit" }, { name: "description", content: "Manage and edit quotation PDFs." }] }),
  component: () => <FolderView folder="quotation" />,
});
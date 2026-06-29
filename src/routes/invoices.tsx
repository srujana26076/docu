import { createFileRoute } from "@tanstack/react-router";
import { FolderView } from "@/components/FolderView";

export const Route = createFileRoute("/invoices")({
  head: () => ({ meta: [{ title: "Invoices · DocuEdit" }, { name: "description", content: "Manage and edit invoice PDFs." }] }),
  component: () => <FolderView folder="invoice" />,
});
import { createFileRoute } from "@tanstack/react-router";
import { FolderView } from "@/components/FolderView";

export const Route = createFileRoute("/offer-letters")({
  head: () => ({ meta: [{ title: "Offer Letters · DocuEdit" }, { name: "description", content: "Manage and edit offer letter PDFs." }] }),
  component: () => <FolderView folder="offer_letter" />,
});
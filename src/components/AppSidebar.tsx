import { Link, useRouterState } from "@tanstack/react-router";
import { FileText, Home, FileSpreadsheet, Briefcase, Clock, LayoutTemplate, FilePlus2, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Home", icon: Home },
  { to: "/upload", label: "Upload", icon: FilePlus2 },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/quotations", label: "Quotations", icon: FileSpreadsheet },
  { to: "/offer-letters", label: "Offer Letters", icon: Briefcase },
  { to: "/templates", label: "Templates", icon: LayoutTemplate },
  { to: "/recent", label: "Recent Documents", icon: Clock },
  { to: "/accounting", label: "Accounting", icon: BookOpen },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <div className="text-lg font-semibold tracking-tight">Docu<span className="text-sidebar-primary">Edit</span></div>
        <div className="text-xs text-sidebar-foreground/60 mt-0.5">PDF workspace</div>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {nav.map((item) => {
          const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 text-[10px] uppercase tracking-wider text-sidebar-foreground/40 border-t border-sidebar-border">
        v1.0 · Lovable Cloud
      </div>
    </aside>
  );
}
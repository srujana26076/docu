import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/accounting")({
  head: () => ({ meta: [{ title: "Accounting · DocuEdit" }, { name: "description", content: "Ledgers, P&L and Balance Sheet." }] }),
  component: AccountingPage,
});

interface LedgerEntry {
  id: string;
  entry_date: string;
  account: string;
  entry_type: "debit" | "credit";
  amount: number;
  description: string | null;
  document_id: string | null;
  created_at: string;
}

// Chart of accounts classification
const REVENUE = ["Sales Revenue", "Service Revenue", "Other Income"];
const EXPENSES = ["Office Expense", "Salaries", "Rent", "Utilities", "Misc Expense"];
const ASSETS = ["Cash", "Bank", "Accounts Receivable", "Inventory"];
const LIABILITIES = ["Accounts Payable", "GST Payable", "Loans Payable"];

function classify(account: string): "revenue" | "expense" | "asset" | "liability" | "equity" {
  if (REVENUE.includes(account)) return "revenue";
  if (EXPENSES.includes(account) || /expense|salary|rent|utilit/i.test(account)) return "expense";
  if (ASSETS.includes(account) || /receivable|cash|bank|inventory/i.test(account)) return "asset";
  if (LIABILITIES.includes(account) || /payable|loan|liabilit/i.test(account)) return "liability";
  return "equity";
}

function money(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function useLedger() {
  return useQuery({
    queryKey: ["ledger-entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ledger_entries" as any)
        .select("*")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LedgerEntry[];
    },
  });
}

function AccountingPage() {
  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Accounting</h1>
        <p className="text-sm text-muted-foreground mt-1">Ledger entries, profit &amp; loss, and balance sheet.</p>
      </div>
      <Tabs defaultValue="ledger">
        <TabsList>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="pl">P&amp;L</TabsTrigger>
          <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
        </TabsList>
        <TabsContent value="ledger"><LedgerTab /></TabsContent>
        <TabsContent value="pl"><PLTab /></TabsContent>
        <TabsContent value="bs"><BalanceSheetTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function LedgerTab() {
  const { data, isLoading } = useLedger();
  return (
    <Card className="mt-4 p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
          ) : (data?.length ?? 0) === 0 ? (
            <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No entries yet. Save an invoice to auto-record entries.</TableCell></TableRow>
          ) : data!.map((e) => (
            <TableRow key={e.id}>
              <TableCell>{e.entry_date}</TableCell>
              <TableCell>{e.account}</TableCell>
              <TableCell>
                <span className={`inline-flex px-2 py-0.5 rounded text-xs ${e.entry_type === "debit" ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"}`}>
                  {e.entry_type}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(Number(e.amount))}</TableCell>
              <TableCell className="text-muted-foreground">{e.description}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function PLTab() {
  const { data } = useLedger();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const [start, setStart] = useState(monthStart);
  const [end, setEnd] = useState(today);

  const { revenue, expense, byAccount } = useMemo(() => {
    const rows = (data ?? []).filter((e) => e.entry_date >= start && e.entry_date <= end);
    let revenue = 0, expense = 0;
    const byAccount: Record<string, { type: string; amount: number }> = {};
    for (const e of rows) {
      const cls = classify(e.account);
      const amt = Number(e.amount);
      if (cls === "revenue") {
        const v = e.entry_type === "credit" ? amt : -amt;
        revenue += v;
        byAccount[e.account] = { type: "Revenue", amount: (byAccount[e.account]?.amount ?? 0) + v };
      } else if (cls === "expense") {
        const v = e.entry_type === "debit" ? amt : -amt;
        expense += v;
        byAccount[e.account] = { type: "Expense", amount: (byAccount[e.account]?.amount ?? 0) + v };
      }
    }
    return { revenue, expense, byAccount };
  }, [data, start, end]);

  const net = revenue - expense;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="text-xs text-muted-foreground">Start</label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div><label className="text-xs text-muted-foreground">End</label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label="Revenue" value={revenue} />
        <SummaryCard label="Expenses" value={expense} />
        <SummaryCard label="Net Profit" value={net} accent={net >= 0 ? "positive" : "negative"} />
      </div>
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Account</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {Object.keys(byAccount).length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No activity in this range.</TableCell></TableRow>
            ) : Object.entries(byAccount).map(([acct, v]) => (
              <TableRow key={acct}>
                <TableCell>{acct}</TableCell>
                <TableCell>{v.type}</TableCell>
                <TableCell className="text-right tabular-nums">{money(v.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function BalanceSheetTab() {
  const { data } = useLedger();
  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState(today);

  const { assets, liabilities, equity, byAccount } = useMemo(() => {
    const rows = (data ?? []).filter((e) => e.entry_date <= asOf);
    let assets = 0, liabilities = 0, revenue = 0, expense = 0;
    const byAccount: Record<string, { type: string; amount: number }> = {};
    for (const e of rows) {
      const cls = classify(e.account);
      const amt = Number(e.amount);
      if (cls === "asset") {
        const v = e.entry_type === "debit" ? amt : -amt;
        assets += v;
        byAccount[e.account] = { type: "Asset", amount: (byAccount[e.account]?.amount ?? 0) + v };
      } else if (cls === "liability") {
        const v = e.entry_type === "credit" ? amt : -amt;
        liabilities += v;
        byAccount[e.account] = { type: "Liability", amount: (byAccount[e.account]?.amount ?? 0) + v };
      } else if (cls === "revenue") {
        revenue += e.entry_type === "credit" ? amt : -amt;
      } else if (cls === "expense") {
        expense += e.entry_type === "debit" ? amt : -amt;
      }
    }
    const equity = revenue - expense;
    if (equity !== 0) byAccount["Retained Earnings"] = { type: "Equity", amount: equity };
    return { assets, liabilities, equity, byAccount };
  }, [data, asOf]);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="text-xs text-muted-foreground">As of</label><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label="Assets" value={assets} />
        <SummaryCard label="Liabilities" value={liabilities} />
        <SummaryCard label="Equity" value={equity} />
      </div>
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Account</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {Object.keys(byAccount).length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No balances as of this date.</TableCell></TableRow>
            ) : Object.entries(byAccount).map(([acct, v]) => (
              <TableRow key={acct}>
                <TableCell>{acct}</TableCell>
                <TableCell>{v.type}</TableCell>
                <TableCell className="text-right tabular-nums">{money(v.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent?: "positive" | "negative" }) {
  const color = accent === "positive" ? "text-emerald-600" : accent === "negative" ? "text-red-600" : "text-foreground";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{money(value)}</div>
    </Card>
  );
}
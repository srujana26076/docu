import { supabase } from "@/integrations/supabase/client";

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  gstin: string | null;
  created_at: string;
  updated_at: string;
}

export type ClientInput = Omit<Client, "id" | "created_at" | "updated_at">;

export async function listClients(): Promise<Client[]> {
  const { data, error } = await supabase.from("clients").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Client[];
}

export async function getClient(id: string): Promise<Client> {
  const { data, error } = await supabase.from("clients").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Client;
}

export async function createClient(input: ClientInput): Promise<Client> {
  const { data, error } = await supabase.from("clients").insert(input as any).select().single();
  if (error) throw error;
  return data as Client;
}

export async function updateClient(id: string, input: Partial<ClientInput>): Promise<void> {
  const { error } = await supabase.from("clients").update(input as any).eq("id", id);
  if (error) throw error;
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw error;
}

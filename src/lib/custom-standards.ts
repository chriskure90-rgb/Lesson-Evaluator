import { supabase } from "./supabase";

export type StandardUpload = {
  id: string;
  user_id: string;
  filename: string | null;
  row_count: number;
  deleted_at: string | null;
  created_at: string;
};

// Returns the current user's non-deleted custom standards uploads, newest first.
// Uses the browser Supabase client — RLS policy "Users select own standard uploads"
// ensures only the authenticated user's rows are returned.
export async function fetchCustomStandardsUploads(userId: string): Promise<StandardUpload[]> {
  const { data, error } = await supabase
    .from("standard_uploads")
    .select("id, user_id, filename, row_count, deleted_at, created_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as StandardUpload[]) ?? [];
}

// Soft-deletes an upload (sets deleted_at). The actual standards chunks remain
// in the DB (and continue to be searched during generation) until a future
// hard-delete pass. RLS "Users update own standard uploads" prevents touching
// another user's row.
export async function softDeleteCustomStandardsUpload(uploadId: string): Promise<void> {
  const { error } = await supabase
    .from("standard_uploads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", uploadId);

  if (error) throw new Error(error.message);
}

// Returns Authorization header using the active Supabase session token.
// Used when calling upload API routes that require authentication.
export async function standardsAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

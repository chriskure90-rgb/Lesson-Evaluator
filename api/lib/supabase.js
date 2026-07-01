import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client.
// Prefers SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (server-only vars).
// Falls back to the VITE_ vars that are already in .env so no extra setup
// is needed unless you want to use the service role key.
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_ANON_KEY         ??
  process.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key) : null;

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

// Log which env vars resolved at cold-start so Vercel function logs show the
// initialization state without exposing key values.
console.log("[supabase:init] SUPABASE_URL present:", !!process.env.SUPABASE_URL);
console.log("[supabase:init] VITE_SUPABASE_URL present:", !!process.env.VITE_SUPABASE_URL);
console.log("[supabase:init] SUPABASE_SERVICE_ROLE_KEY present:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("[supabase:init] SUPABASE_ANON_KEY present:", !!process.env.SUPABASE_ANON_KEY);
console.log("[supabase:init] VITE_SUPABASE_ANON_KEY present:", !!process.env.VITE_SUPABASE_ANON_KEY);
console.log("[supabase:init] resolved url present:", !!url);
console.log("[supabase:init] resolved key present:", !!key);
console.log("[supabase:init] client will be:", url && key ? "INITIALISED" : "NULL — all lookups will fall back to mock");

export const supabase = url && key ? createClient(url, key) : null;

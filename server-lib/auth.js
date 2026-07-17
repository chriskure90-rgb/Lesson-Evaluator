import { supabase } from "./supabase.js";

// Extracts and validates the Supabase session JWT from the Authorization header.
// Returns the authenticated user's UUID, or null if the header is missing/invalid.
// Never trusts a client-supplied userId in a request body — always validate via JWT.
export async function getAuthenticatedUserId(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

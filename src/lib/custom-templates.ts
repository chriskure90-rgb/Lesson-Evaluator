import { supabase } from "./supabase";
import type { Template1Lesson } from "../App";

export type CustomTemplateStatus = "processing" | "ready" | "error";

export type CustomTemplate = {
  id: string;
  user_id: string;
  name: string;
  original_filename: string;
  storage_path: string;
  placeholders: string[];
  recognized_placeholders: string[];
  unrecognized_placeholders: string[];
  status: CustomTemplateStatus;
  error_message: string | null;
  created_at: string;
};

const BUCKET = "custom-templates";

// A server-side crash (e.g. a serverless function invocation failure) can
// return a plain-text/HTML error page instead of JSON — calling
// response.json() unconditionally on that throws a confusing
// "Unexpected token ... is not valid JSON" error instead of a useful
// message. This checks the content-type first: parses JSON when the server
// actually sent JSON (including error responses shaped like { error }),
// and otherwise logs the raw body (for debugging) while surfacing
// `fallbackErrorMessage` to the caller instead of the raw server output.
async function parseCustomTemplatesResponse<T>(res: Response, fallbackErrorMessage: string): Promise<T> {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || fallbackErrorMessage);
    return data as T;
  }

  const rawText = await res.text().catch(() => "");
  console.error("[custom-templates] non-JSON response:", res.status, rawText.slice(0, 500));
  throw new Error(fallbackErrorMessage);
}

/* ── Custom DOCX template upload ───────────────────────────────────────────────
   Same two-step signed-upload-URL pattern as the standards upload (see
   uploadFileToStorage in App.tsx): the browser PUTs the file straight into
   Supabase Storage, never routing the raw bytes through a Vercel serverless
   function (which caps request bodies at ~4.5MB). Unlike that pipeline,
   the uploaded file here is never deleted afterward — it's the permanent
   export template, not a processing relay.

   All three actions (upload-init/register/export) are served by the single
   /api/custom-templates route (dispatched via `action` in the body) rather
   than one file each — Vercel's Hobby plan caps a project at 12 Serverless
   Functions and every file under /api counts toward that.
────────────────────────────────────────────────────────────────────────────── */
export async function uploadCustomTemplateFile(file: File, userId: string): Promise<{ path: string }> {
  const initRes = await fetch("/api/custom-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "upload-init", filename: file.name, mimeType: file.type, userId }),
  });
  const initData = await parseCustomTemplatesResponse<{ path: string; token: string }>(
    initRes,
    "Could not prepare the upload. Please try again."
  );

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(initData.path, initData.token, file);
  if (storageError) throw new Error(storageError.message);

  return { path: initData.path };
}

export async function registerCustomTemplate(params: {
  path: string;
  filename: string;
  name: string;
  userId: string;
}): Promise<CustomTemplate> {
  const res = await fetch("/api/custom-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "register", ...params }),
  });
  const isPdf = params.filename.toLowerCase().endsWith(".pdf");
  return parseCustomTemplatesResponse<CustomTemplate>(
    res,
    isPdf
      ? "PDF processing failed. Please try another PDF or upload a DOCX file."
      : "Could not register this template. Please try again."
  );
}

export async function fetchCustomTemplates(userId: string): Promise<CustomTemplate[]> {
  const { data, error } = await supabase
    .from("custom_templates")
    .select("id, user_id, name, original_filename, storage_path, placeholders, recognized_placeholders, unrecognized_placeholders, status, error_message, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CustomTemplate[];
}

// Renaming is just a metadata update (no Storage/service-role work needed),
// so it goes straight through the browser's Supabase client, same as other
// direct row updates in this app (e.g. lesson_json edits).
export async function renameCustomTemplate(id: string, name: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("custom_templates")
    .update({ name })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

// Deletion removes the Storage object too, which requires the service-role
// key (the bucket is private) — routed through /api/custom-templates
// (action: "delete") rather than done directly from the browser.
export async function deleteCustomTemplate(id: string, userId: string): Promise<void> {
  const res = await fetch("/api/custom-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", customTemplateId: id, userId }),
  });
  if (res.ok) return;
  await parseCustomTemplatesResponse(res, "Could not delete template. Please try again.");
}

// Server-side merge (docxtemplater) of the teacher's uploaded .docx with the
// generated Template1Lesson content — see api/custom-templates.js (action: "export").
// The built-in Template1 DOCX builder is never used for custom templates.
export async function exportCustomTemplateLessonDocx(
  customTemplateId: string,
  userId: string,
  lessonData: Template1Lesson
): Promise<Blob> {
  const res = await fetch("/api/custom-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "export", customTemplateId, userId, lessonData }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `Server error ${res.status}`);
  }
  return res.blob();
}

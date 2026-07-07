import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { jsPDF } from "jspdf";

/* ── Generic export document shape ───────────────────────────────────────────
   Both the lesson plan and the evaluation results are converted into this
   shape before being rendered to .txt / .docx / .pdf, so the three format
   converters below only need to be written once and are shared by both
   the Generator and Evaluator pages.
────────────────────────────────────────────────────────────────────────────── */
export type ExportSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type ExportDocument = {
  title: string;
  meta?: string;
  sections: ExportSection[];
};

/* ── .txt ─────────────────────────────────────────────────────────────────── */
export function documentToText(doc: ExportDocument): string {
  const lines: string[] = [doc.title];
  if (doc.meta) lines.push(doc.meta);
  lines.push("", "");

  doc.sections.forEach((section) => {
    lines.push(section.heading.toUpperCase());
    lines.push("-".repeat(section.heading.length));
    (section.paragraphs ?? []).forEach((p) => { lines.push(p, ""); });
    (section.bullets ?? []).forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  });

  return lines.join("\n").trim() + "\n";
}

/* ── .docx ────────────────────────────────────────────────────────────────── */
export async function documentToDocxBlob(doc: ExportDocument): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({
      text: doc.title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }),
  ];

  if (doc.meta) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: doc.meta, italics: true, color: "6B6B6B" })],
        spacing: { after: 280 },
      })
    );
  }

  doc.sections.forEach((section) => {
    children.push(
      new Paragraph({
        text: section.heading,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 140 },
      })
    );

    (section.paragraphs ?? []).forEach((para) => {
      children.push(
        new Paragraph({
          children: [new TextRun(para)],
          spacing: { after: 180 },
        })
      );
    });

    (section.bullets ?? []).forEach((bullet) => {
      children.push(
        new Paragraph({
          text: bullet,
          bullet: { level: 0 },
          spacing: { after: 90 },
        })
      );
    });
  });

  const document = new Document({ sections: [{ children }] });
  return Packer.toBlob(document);
}

/* ── .pdf ─────────────────────────────────────────────────────────────────── */
export function documentToPdfBlob(doc: ExportDocument): Blob {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 56;
  const marginTop = 56;
  const marginBottom = 56;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - marginX * 2;
  let y = marginTop;

  function ensureSpace(lineHeight: number) {
    if (y + lineHeight > pageHeight - marginBottom) {
      pdf.addPage();
      y = marginTop;
    }
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  (pdf.splitTextToSize(doc.title, maxWidth) as string[]).forEach((line) => {
    ensureSpace(22);
    pdf.text(line, marginX, y);
    y += 22;
  });

  if (doc.meta) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(110);
    (pdf.splitTextToSize(doc.meta, maxWidth) as string[]).forEach((line) => {
      ensureSpace(14);
      pdf.text(line, marginX, y);
      y += 14;
    });
    pdf.setTextColor(0);
  }
  y += 12;

  doc.sections.forEach((section) => {
    ensureSpace(24);
    y += 8;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    (pdf.splitTextToSize(section.heading, maxWidth) as string[]).forEach((line) => {
      ensureSpace(18);
      pdf.text(line, marginX, y);
      y += 18;
    });
    y += 4;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);

    (section.paragraphs ?? []).forEach((para) => {
      (pdf.splitTextToSize(para, maxWidth) as string[]).forEach((line) => {
        ensureSpace(15);
        pdf.text(line, marginX, y);
        y += 15;
      });
      y += 8;
    });

    (section.bullets ?? []).forEach((bullet) => {
      const bulletWidth = maxWidth - 14;
      (pdf.splitTextToSize(bullet, bulletWidth) as string[]).forEach((line, i) => {
        ensureSpace(15);
        pdf.text(i === 0 ? `•  ${line}` : line, marginX + (i === 0 ? 0 : 14), y);
        y += 15;
      });
      y += 5;
    });
  });

  return pdf.output("blob");
}

/* ── Shared download trigger ──────────────────────────────────────────────── */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export type ExportFormat = "docx" | "pdf" | "txt";

// Converts an ExportDocument to the requested format and triggers a browser
// download with the given base filename (extension appended automatically).
export async function exportAndDownload(
  doc: ExportDocument,
  format: ExportFormat,
  filenameBase: string
): Promise<void> {
  if (format === "txt") {
    downloadBlob(new Blob([documentToText(doc)], { type: "text/plain;charset=utf-8" }), `${filenameBase}.txt`);
    return;
  }
  if (format === "docx") {
    downloadBlob(await documentToDocxBlob(doc), `${filenameBase}.docx`);
    return;
  }
  downloadBlob(documentToPdfBlob(doc), `${filenameBase}.pdf`);
}

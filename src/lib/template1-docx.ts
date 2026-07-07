import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Header,
  Footer,
  PageNumber,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  TabStopType,
  convertInchesToTwip,
  type IBorderOptions,
} from "docx";
import type { Lesson, Activity } from "../App";

/* ── Template 1 DOCX renderer ─────────────────────────────────────────────────
   Recreates the section hierarchy/layout of the reference "Secondary GTEP /
   PSU Graduate School of Education" lesson-plan template: a right-aligned
   running header, a left-aligned page-number footer, a bordered "Lesson
   Goals" box, numbered objectives, a dash-listed materials section, a
   bordered instructions box, and a bordered two-column (Teacher/Student)
   table per lesson phase (Introduction, Main Learning Activities, Closure),
   with differentiation ("Student Support") folded into the first two rows
   and assessment folded into the Closure row — matching how the reference
   template actually lays these out.

   This is structural replication only: no person name or actual submitted
   lesson content from the reference material is reused, only the section
   layout/headings.
────────────────────────────────────────────────────────────────────────────── */

const BORDER: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const BOX_BORDER = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const MUTED_GRAY = "808080";

const PAGE_WIDTH_TWIPS = convertInchesToTwip(8.5) - convertInchesToTwip(1) * 2; // 8.5in page, 1in margins
const COLUMN_WIDTH = Math.floor(PAGE_WIDTH_TWIPS / 2);

const CELL_MARGINS = { top: 100, bottom: 100, left: 120, right: 120 };

function splitSentences(text: string): string[] {
  return (text ?? "")
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// The generation prompt instructs the model to format each Template 1
// activity's detail as "Teacher: ... Students: ... [Support: ...]", possibly
// with the Teacher:/Students: pair repeated more than once. This walks the
// string and buckets every segment under whichever label most recently
// preceded it, so repeated pairs are concatenated correctly instead of only
// the last one winning.
function parseTeacherStudentSupport(detail: string): { teacher: string; students: string; support: string | null } {
  const parts = (detail ?? "").split(/(Teacher:|Students:|Support:)/);
  let currentLabel: "teacher" | "students" | "support" | null = null;
  const teacher: string[] = [];
  const students: string[] = [];
  const support: string[] = [];

  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (part === "Teacher:") { currentLabel = "teacher"; continue; }
    if (part === "Students:") { currentLabel = "students"; continue; }
    if (part === "Support:") { currentLabel = "support"; continue; }
    if (currentLabel === "teacher") teacher.push(part);
    else if (currentLabel === "students") students.push(part);
    else if (currentLabel === "support") support.push(part);
  }

  // Fallback: if the model didn't follow the Teacher:/Students: format at
  // all, don't silently drop the content — show it as-is on the teacher side.
  if (!teacher.length && !students.length) {
    return { teacher: (detail ?? "").trim(), students: "", support: null };
  }

  return {
    teacher: teacher.join(" ").trim(),
    students: students.join(" ").trim(),
    support: support.join(" ").trim() || null,
  };
}

function findActivity(activities: Activity[], nameIncludes: string, fallbackIndex: number): Activity | undefined {
  return activities.find((a) => a.name?.toLowerCase().includes(nameIncludes)) ?? activities[fallbackIndex];
}

// Applying identical border settings to every paragraph in a group makes
// Word merge them into one continuous bordered box rather than a separate
// box per paragraph — so `border` must be passed at construction time for
// each paragraph in the box, not retrofitted afterward.
function labeledLine(label: string, value: string, opts?: { italicLabel?: boolean; boxed?: boolean }): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    border: opts?.boxed ? BOX_BORDER : undefined,
    children: [
      new TextRun({ text: label, bold: true, italics: opts?.italicLabel }),
      new TextRun({ text: value ? ` ${value}` : "" }),
    ],
  });
}

function buildPhaseRow(
  phaseName: string,
  teacherHeading: string,
  activity: Activity | undefined,
  extra?: { label: string; text: string }
): TableRow {
  const { teacher, students, support } = parseTeacherStudentSupport(activity?.detail ?? "");

  const leftChildren: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: teacherHeading, bold: true })], spacing: { after: 80 } }),
    ...splitSentences(teacher).map(
      (s, i) => new Paragraph({ text: `${i + 1}. ${s}`, spacing: { after: 40 } })
    ),
  ];

  if (support) {
    leftChildren.push(
      new Paragraph({ children: [new TextRun({ text: "Student Support:", bold: true })], spacing: { before: 120, after: 40 } })
    );
    leftChildren.push(...splitSentences(support).map((s) => new Paragraph({ text: `- ${s}`, spacing: { after: 40 } })));
  }

  if (extra) {
    leftChildren.push(
      new Paragraph({ children: [new TextRun({ text: extra.label, bold: true })], spacing: { before: 120, after: 40 } })
    );
    leftChildren.push(...splitSentences(extra.text).map((s) => new Paragraph({ text: `- ${s}`, spacing: { after: 40 } })));
  }

  const rightChildren: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: `${phaseName}: What Students will do`, bold: true })], spacing: { after: 80 } }),
    ...splitSentences(students).map((s) => new Paragraph({ text: `- ${s}`, spacing: { after: 40 } })),
  ];

  return new TableRow({
    children: [
      new TableCell({ width: { size: COLUMN_WIDTH, type: WidthType.DXA }, margins: CELL_MARGINS, children: leftChildren }),
      new TableCell({ width: { size: COLUMN_WIDTH, type: WidthType.DXA }, margins: CELL_MARGINS, children: rightChildren }),
    ],
  });
}

export async function buildTemplate1LessonDocx({
  lesson,
  subject,
  gradeLabel,
  duration,
  standardsAddressed,
}: {
  lesson: Lesson;
  subject: string;
  gradeLabel: string;
  duration: number;
  standardsAddressed: string;
}): Promise<Blob> {
  const introActivity  = findActivity(lesson.activities ?? [], "introduction", 0);
  const mainActivity   = findActivity(lesson.activities ?? [], "main learning", 1);
  const closureActivity = findActivity(lesson.activities ?? [], "closure", 2);

  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: "Secondary GTEP Lesson Planning Template", size: 20, color: MUTED_GRAY })],
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new TextRun({ text: "Page ", size: 20, color: MUTED_GRAY }),
          new TextRun({ children: [PageNumber.CURRENT], size: 20, color: MUTED_GRAY }),
          new TextRun({ text: " of ", size: 20, color: MUTED_GRAY }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 20, color: MUTED_GRAY }),
          new TextRun({ text: " (FOUR PAGES MAXIMUM)", size: 20, color: MUTED_GRAY }),
        ],
      }),
    ],
  });

  const lessonGoalsBox: Paragraph[] = [
    labeledLine("Central Focus of Lesson:", lesson.standards_alignment || "Not specified.", { boxed: true }),
    new Paragraph({ text: "", spacing: { after: 80 }, border: BOX_BORDER }),
    labeledLine("Standard(s) Addressed:", standardsAddressed || "Not specified.", { italicLabel: true, boxed: true }),
  ];

  const lessonPlanDetailsBox: Paragraph[] = [
    new Paragraph({
      border: BOX_BORDER,
      children: [
        new TextRun({ text: "Lesson Plan Details: ", bold: true }),
        new TextRun({
          text:
            "Each section describes what the teacher will do and what students will do, including how it differentiates instruction to accommodate a variety of learners.",
        }),
      ],
    }),
  ];

  const table = new Table({
    width: { size: PAGE_WIDTH_TWIPS, type: WidthType.DXA },
    columnWidths: [COLUMN_WIDTH, COLUMN_WIDTH],
    borders: {
      top: BORDER, bottom: BORDER, left: BORDER, right: BORDER,
      insideHorizontal: BORDER, insideVertical: BORDER,
    },
    rows: [
      buildPhaseRow("Introduction", "Introduction: What Teacher Will Do to Engage Students.", introActivity),
      buildPhaseRow("Main Learning Activities", "Main Learning Activities: What Teacher Will Do", mainActivity),
      buildPhaseRow("Closure", "Closure: What Teacher Will Do", closureActivity, {
        label: "How will you assess the objectives?",
        text: lesson.assessment || "Not specified.",
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        headers: { default: header },
        footers: { default: footer },
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: lesson.title || "Lesson Plan", bold: true, size: 28 })],
            spacing: { after: 200 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "PSU Graduate School of Education Lesson Plan Template", bold: true, size: 24 })],
            spacing: { after: 200 },
          }),
          new Paragraph({
            tabStops: [
              { type: TabStopType.LEFT, position: 3200 },
              { type: TabStopType.LEFT, position: 6800 },
            ],
            spacing: { after: 200 },
            children: [
              new TextRun({ text: "TC Name: ", bold: true }),
              new TextRun({ text: "\t" }),
              new TextRun({ text: "Subject/Grade level: ", bold: true }),
              new TextRun({ text: `${subject} — Grade ${gradeLabel}` }),
              new TextRun({ text: "\t" }),
              new TextRun({ text: "Time Duration of Lesson: ", bold: true }),
              new TextRun({ text: `${duration} minutes` }),
            ],
          }),

          new Paragraph({ children: [new TextRun({ text: "Lesson Goals", bold: true })], spacing: { before: 120, after: 80 } }),
          ...lessonGoalsBox,

          new Paragraph({
            pageBreakBefore: true,
            children: [new TextRun({ text: "Lesson Objectives:", bold: true })],
            spacing: { after: 100 },
          }),
          ...(lesson.objectives ?? []).map(
            (o, i) => new Paragraph({ text: `${i + 1}. ${o}`, spacing: { after: 60 } })
          ),

          new Paragraph({ children: [new TextRun({ text: "Materials:", bold: true })], spacing: { before: 200, after: 100 } }),
          ...(lesson.materials ?? []).map((m) => new Paragraph({ text: `- ${m}`, spacing: { after: 40 } })),

          new Paragraph({ text: "", spacing: { after: 200 } }),
          ...lessonPlanDetailsBox,

          new Paragraph({ pageBreakBefore: true, text: "", spacing: { after: 0 } }),
          table,
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}

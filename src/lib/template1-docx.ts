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
   Recreates the "Secondary GTEP / PSU Graduate School of Education" lesson
   plan template as ONE continuous bordered table — Lesson Goals, Lesson
   Objectives/Materials, Lesson Plan Details, and the three Introduction/Main
   Learning Activities/Closure rows are all rows of the SAME table (some
   spanning both columns), because in the reference template every one of
   these sections shares borders with no gap between them — building them as
   separate boxed elements would not reproduce that.

   This is structural + boilerplate-label replication: the instructional
   placeholder text that is a permanent part of the template's own design
   ("Describe what you are teaching...", "List all standards addressed...",
   the Lesson Plan Details instructions) is reproduced verbatim since it is
   part of the template itself, not the reference lesson's submitted content.
   No person name or the reference lesson's own submitted content is reused.
────────────────────────────────────────────────────────────────────────────── */

const BORDER: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const RED   = "C00000";
const BLUE  = "1F4E96";
const BODY_SIZE    = 18; // 9pt
const LABEL_SIZE   = 19; // 9.5pt
const TITLE_SIZE   = 26; // 13pt

const PAGE_MARGIN_TWIPS = convertInchesToTwip(0.6);
const PAGE_WIDTH_TWIPS  = convertInchesToTwip(8.5) - PAGE_MARGIN_TWIPS * 2;
const COLUMN_WIDTH       = Math.floor(PAGE_WIDTH_TWIPS / 2);
const CELL_MARGINS       = { top: 80, bottom: 80, left: 120, right: 120 };

function splitSentences(text: string): string[] {
  return (text ?? "")
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function p(text: string, opts?: { bold?: boolean; italics?: boolean; size?: number }): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text, bold: opts?.bold, italics: opts?.italics, size: opts?.size ?? BODY_SIZE })],
  });
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

function fullWidthCell(children: Paragraph[]): TableCell {
  return new TableCell({
    columnSpan: 2,
    width: { size: PAGE_WIDTH_TWIPS, type: WidthType.DXA },
    margins: CELL_MARGINS,
    children,
  });
}

function halfWidthCell(children: Paragraph[]): TableCell {
  return new TableCell({
    width: { size: COLUMN_WIDTH, type: WidthType.DXA },
    margins: CELL_MARGINS,
    children,
  });
}

function buildLessonGoalsRow(lesson: Lesson, standardsAddressed: string): TableRow {
  return new TableRow({
    children: [
      fullWidthCell([
        p("Lesson Goals", { bold: true, size: LABEL_SIZE }),
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: "Central Focus of Lesson: ", bold: true, color: RED, size: BODY_SIZE }),
            new TextRun({
              text: "Describe what you are teaching. Describe the purpose for teaching this content. Describe how the standards apply to the learning strategy and skills learned.",
              size: BODY_SIZE,
            }),
          ],
        }),
        p(""),
        p(lesson.standards_alignment || "Not specified."),
        p(""),
        p("Standard(s) Addressed:", { bold: true }),
        p("List all standards addressed during the lesson. (List number and text)", { italics: true }),
        p(""),
        p(standardsAddressed || "Not specified."),
      ]),
    ],
  });
}

function buildObjectivesMaterialsRow(lesson: Lesson): TableRow {
  return new TableRow({
    children: [
      halfWidthCell([
        p("Lesson Objectives:", { bold: true }),
        ...(lesson.objectives ?? []).map((o, i) => p(`${i + 1}. ${o}`)),
      ]),
      halfWidthCell([
        p("Materials:", { bold: true }),
        ...(lesson.materials ?? []).map((m) => p(`- ${m}`)),
      ]),
    ],
  });
}

function buildLessonPlanDetailsRow(): TableRow {
  return new TableRow({
    children: [
      fullWidthCell([
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: "Lesson Plan Details: ", bold: true, size: BODY_SIZE }),
            new TextRun({ text: "Write a ", size: BODY_SIZE }),
            new TextRun({ text: "detailed outline", underline: {}, size: BODY_SIZE }),
            new TextRun({
              text: " of your lesson. Your outline should be detailed enough that another teacher could understand them well enough to use them. ",
              size: BODY_SIZE,
            }),
            new TextRun({ text: "Each section MUST include how you will differentiate", bold: true, color: BLUE, size: BODY_SIZE }),
            new TextRun({ text: " your lesson to accommodate a ", size: BODY_SIZE }),
            new TextRun({ text: "variety of learners.", italics: true, color: RED, size: BODY_SIZE }),
          ],
        }),
      ]),
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
    p(teacherHeading, { bold: true }),
    ...splitSentences(teacher).map((s, i) => p(`${i + 1}. ${s}`)),
  ];

  if (support) {
    leftChildren.push(p("Student Support:", { bold: true }));
    leftChildren.push(...splitSentences(support).map((s) => p(`- ${s}`)));
  }

  if (extra) {
    leftChildren.push(p(extra.label, { bold: true }));
    leftChildren.push(...splitSentences(extra.text).map((s) => p(`- ${s}`)));
  }

  const rightChildren: Paragraph[] = [
    p(`${phaseName}: What Students will do`, { bold: true }),
    ...splitSentences(students).map((s) => p(`- ${s}`)),
  ];

  return new TableRow({
    children: [halfWidthCell(leftChildren), halfWidthCell(rightChildren)],
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
  const introActivity   = findActivity(lesson.activities ?? [], "introduction", 0);
  const mainActivity    = findActivity(lesson.activities ?? [], "main learning", 1);
  const closureActivity = findActivity(lesson.activities ?? [], "closure", 2);

  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: "Secondary GTEP Lesson Planning Template", size: 18, color: "808080" })],
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new TextRun({ text: "Page ", size: 18, color: "808080" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080" }),
          new TextRun({ text: " of ", size: 18, color: "808080" }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "808080" }),
          new TextRun({ text: " (FOUR PAGES MAXIMUM)", size: 18, color: "808080" }),
        ],
      }),
    ],
  });

  const mainTable = new Table({
    width: { size: PAGE_WIDTH_TWIPS, type: WidthType.DXA },
    columnWidths: [COLUMN_WIDTH, COLUMN_WIDTH],
    borders: {
      top: BORDER, bottom: BORDER, left: BORDER, right: BORDER,
      insideHorizontal: BORDER, insideVertical: BORDER,
    },
    rows: [
      buildLessonGoalsRow(lesson, standardsAddressed),
      buildObjectivesMaterialsRow(lesson),
      buildLessonPlanDetailsRow(),
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
              top: PAGE_MARGIN_TWIPS,
              bottom: PAGE_MARGIN_TWIPS,
              left: PAGE_MARGIN_TWIPS,
              right: PAGE_MARGIN_TWIPS,
            },
          },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "PSU Graduate School of Education Lesson Plan Template", bold: true, size: TITLE_SIZE })],
            spacing: { after: 160 },
          }),
          new Paragraph({
            tabStops: [
              { type: TabStopType.LEFT, position: 3200 },
              { type: TabStopType.LEFT, position: 6800 },
            ],
            spacing: { after: 120 },
            children: [
              new TextRun({ text: "TC Name: ", bold: true, size: BODY_SIZE }),
              new TextRun({ text: "\t" }),
              new TextRun({ text: "Subject/Grade level: ", bold: true, size: BODY_SIZE }),
              new TextRun({ text: `${subject} — Grade ${gradeLabel}`, size: BODY_SIZE }),
              new TextRun({ text: "\t" }),
              new TextRun({ text: "Time Duration of Lesson: ", bold: true, size: BODY_SIZE }),
              new TextRun({ text: `${duration} minutes`, size: BODY_SIZE }),
            ],
          }),
          mainTable,
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}

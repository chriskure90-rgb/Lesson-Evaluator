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
import type { Template1Lesson } from "../App";

/* ── Template 1 DOCX renderer ─────────────────────────────────────────────────
   Recreates the "Secondary GTEP / PSU Graduate School of Education" lesson
   plan template as ONE continuous bordered table — Lesson Goals, Lesson
   Objectives/Materials, Lesson Plan Details, and the three Introduction/Main
   Learning Activities/Closure rows are all rows of the SAME table (some
   spanning both columns), matching the reference template where every
   section shares borders with no gap between them.

   Reads Template1Lesson's structured fields directly — no string parsing of
   a combined "Teacher: ... Students: ..." field is needed since the lesson
   data itself is already split into teacherActions/studentActions/
   studentSupport per phase.

   This is structural + boilerplate-label replication: the instructional
   placeholder text that is a permanent part of the template's own design
   ("Describe what you are teaching...", "List all standards addressed...",
   the Lesson Plan Details instructions) is reproduced verbatim since it is
   part of the template itself. No person name or the reference lesson's own
   submitted content is reused.
────────────────────────────────────────────────────────────────────────────── */

const BORDER: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const RED   = "C00000";
const BLUE  = "1F4E96";
const BODY_SIZE  = 18; // 9pt
const LABEL_SIZE = 19; // 9.5pt
const TITLE_SIZE = 26; // 13pt

const PAGE_MARGIN_TWIPS = convertInchesToTwip(0.6);
const PAGE_WIDTH_TWIPS  = convertInchesToTwip(8.5) - PAGE_MARGIN_TWIPS * 2;
const COLUMN_WIDTH      = Math.floor(PAGE_WIDTH_TWIPS / 2);
const CELL_MARGINS      = { top: 80, bottom: 80, left: 120, right: 120 };

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

function buildLessonGoalsRow(lesson: Template1Lesson): TableRow {
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
        p(lesson.centralFocus || "Not specified."),
        p(""),
        p("Standard(s) Addressed:", { bold: true }),
        p("List all standards addressed during the lesson. (List number and text)", { italics: true }),
        p(""),
        p(lesson.standardsAddressed || "Not specified."),
      ]),
    ],
  });
}

function buildObjectivesMaterialsRow(lesson: Template1Lesson): TableRow {
  return new TableRow({
    children: [
      halfWidthCell([
        p("Lesson Objectives:", { bold: true }),
        ...(lesson.lessonObjectives ?? []).map((o, i) => p(`${i + 1}. ${o}`)),
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
  teacherActions: string,
  studentActions: string,
  studentSupport?: string,
  extra?: { label: string; text: string }
): TableRow {
  const leftChildren: Paragraph[] = [
    p(teacherHeading, { bold: true }),
    ...splitSentences(teacherActions).map((s, i) => p(`${i + 1}. ${s}`)),
  ];

  if (studentSupport) {
    leftChildren.push(p("Student Support:", { bold: true }));
    leftChildren.push(...splitSentences(studentSupport).map((s) => p(`- ${s}`)));
  }

  if (extra) {
    leftChildren.push(p(extra.label, { bold: true }));
    leftChildren.push(...splitSentences(extra.text).map((s) => p(`- ${s}`)));
  }

  const rightChildren: Paragraph[] = [
    p(`${phaseName}: What Students will do`, { bold: true }),
    ...splitSentences(studentActions).map((s) => p(`- ${s}`)),
  ];

  return new TableRow({
    children: [halfWidthCell(leftChildren), halfWidthCell(rightChildren)],
  });
}

export async function buildTemplate1LessonDocx(lesson: Template1Lesson): Promise<Blob> {
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
      buildLessonGoalsRow(lesson),
      buildObjectivesMaterialsRow(lesson),
      buildLessonPlanDetailsRow(),
      buildPhaseRow(
        "Introduction",
        "Introduction: What Teacher Will Do to Engage Students.",
        lesson.introduction.teacherActions,
        lesson.introduction.studentActions,
        lesson.introduction.studentSupport
      ),
      buildPhaseRow(
        "Main Learning Activities",
        "Main Learning Activities: What Teacher Will Do",
        lesson.mainLearningActivities.teacherActions,
        lesson.mainLearningActivities.studentActions,
        lesson.mainLearningActivities.studentSupport
      ),
      buildPhaseRow(
        "Closure",
        "Closure: What Teacher Will Do",
        lesson.closure.teacherActions,
        lesson.closure.studentActions,
        undefined,
        { label: "How will you assess the objectives?", text: lesson.assessment.howObjectivesAssessed || "Not specified." }
      ),
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
              new TextRun({ text: lesson.teacherName, size: BODY_SIZE }),
              new TextRun({ text: "\t" }),
              new TextRun({ text: "Subject/Grade level: ", bold: true, size: BODY_SIZE }),
              new TextRun({ text: lesson.subjectGradeLevel, size: BODY_SIZE }),
              new TextRun({ text: "\t" }),
              new TextRun({ text: "Time Duration of Lesson: ", bold: true, size: BODY_SIZE }),
              new TextRun({ text: lesson.lessonDuration, size: BODY_SIZE }),
            ],
          }),
          mainTable,
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}

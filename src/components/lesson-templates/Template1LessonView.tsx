import type { Template1Lesson } from "../../App";
import { Icon } from "../Icon";

/* ── Template 1 (PSU/GTEP-style) lesson plan — shared read-only view ─────────
   Mirrors src/lib/template1-docx.ts section-for-section: one continuous
   bordered table (Lesson Goals -> Objectives/Materials -> Lesson Plan
   Details -> Introduction -> Main Learning Activities -> Closure).

   This is the ONE place Template 1's layout is defined — used identically
   by GeneratePage, EvaluatePage, and LibraryPage's lesson detail view via
   TemplateRenderer, so none of them re-implement this table.
────────────────────────────────────────────────────────────────────────────── */

function splitSentences(text: string): string[] {
  return (text ?? "")
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function Template1PhaseRow({
  phaseName,
  teacherHeading,
  teacherActions,
  studentActions,
  studentSupport,
  extra,
}: {
  phaseName: string;
  teacherHeading: string;
  teacherActions: string;
  studentActions: string;
  studentSupport?: string;
  extra?: { label: string; text: string };
}) {
  return (
    <tr>
      <td className="t1-cell">
        <p className="t1-label" style={{ marginTop: 0 }}>{teacherHeading}</p>
        <ol className="t1-list">
          {splitSentences(teacherActions).map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        {studentSupport && (
          <>
            <p className="t1-label">Student Support:</p>
            <ul className="t1-list-dash">
              {splitSentences(studentSupport).map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </>
        )}
        {extra && (
          <>
            <p className="t1-label">{extra.label}</p>
            <ul className="t1-list-dash">
              {splitSentences(extra.text).map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </>
        )}
      </td>
      <td className="t1-cell">
        <p className="t1-label" style={{ marginTop: 0 }}>{phaseName}: What Students will do</p>
        <ul className="t1-list-dash">
          {splitSentences(studentActions).map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </td>
    </tr>
  );
}

export function Template1LessonView({
  lessonData,
  breadcrumb,
  onEdit,
}: {
  lessonData: Template1Lesson;
  // Optional chrome — only the Generator page's preview supplies these
  // (breadcrumb + Edit button rendered inside the same bordered box).
  // EvaluatePage and LibraryPage omit them and just get the content.
  breadcrumb?: string;
  onEdit?: () => void;
}) {
  return (
    <div className="t1-page">
      {(breadcrumb || onEdit) && (
        <div className="t1-header-row">
          <p className="preview-breadcrumb">{breadcrumb}</p>
          {onEdit && (
            <button type="button" className="btn-outline-sm" onClick={onEdit} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Icon.Edit /> Edit
            </button>
          )}
        </div>
      )}

      <h2 className="t1-title">PSU Graduate School of Education Lesson Plan Template</h2>
      <div className="t1-meta-row">
        <span><strong>TC Name:</strong> {lessonData.teacherName}</span>
        <span><strong>Subject/Grade level:</strong> {lessonData.subjectGradeLevel}</span>
        <span><strong>Time Duration of Lesson:</strong> {lessonData.lessonDuration}</span>
      </div>

      <table className="t1-table">
        <tbody>
          <tr>
            <td className="t1-cell" colSpan={2}>
              <p className="t1-section-label">Lesson Goals</p>
              <p style={{ margin: 0 }}>
                <span className="t1-label-red">Central Focus of Lesson: </span>
                <span className="t1-instructions">
                  Describe what you are teaching. Describe the purpose for teaching this content. Describe how the standards apply to the learning strategy and skills learned.
                </span>
              </p>
              <p className="t1-body">{lessonData.centralFocus || "Not specified."}</p>
              <p className="t1-label">Standard(s) Addressed:</p>
              <p className="t1-instructions-italic" style={{ margin: 0 }}>List all standards addressed during the lesson. (List number and text)</p>
              <p className="t1-body">{lessonData.standardsAddressed || "Not specified."}</p>
            </td>
          </tr>

          <tr>
            <td className="t1-cell">
              <p className="t1-label" style={{ marginTop: 0 }}>Lesson Objectives:</p>
              <ol className="t1-list">
                {lessonData.lessonObjectives.map((o, i) => <li key={i}>{o}</li>)}
              </ol>
            </td>
            <td className="t1-cell">
              <p className="t1-label" style={{ marginTop: 0 }}>Materials:</p>
              <ul className="t1-list-dash">
                {lessonData.materials.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </td>
          </tr>

          <tr>
            <td className="t1-cell" colSpan={2}>
              <p style={{ margin: 0 }}>
                <span className="t1-label" style={{ margin: 0 }}>Lesson Plan Details: </span>
                Write a <span className="t1-underline">detailed outline</span> of your lesson. Your outline
                should be detailed enough that another teacher could understand them well enough to use them.{" "}
                <span className="t1-label-blue">Each section MUST include how you will differentiate</span> your
                lesson to accommodate a <span className="t1-italic-red">variety of learners.</span>
              </p>
            </td>
          </tr>

          <Template1PhaseRow
            phaseName="Introduction"
            teacherHeading="Introduction: What Teacher Will Do to Engage Students."
            teacherActions={lessonData.introduction.teacherActions}
            studentActions={lessonData.introduction.studentActions}
            studentSupport={lessonData.introduction.studentSupport}
          />
          <Template1PhaseRow
            phaseName="Main Learning Activities"
            teacherHeading="Main Learning Activities: What Teacher Will Do"
            teacherActions={lessonData.mainLearningActivities.teacherActions}
            studentActions={lessonData.mainLearningActivities.studentActions}
            studentSupport={lessonData.mainLearningActivities.studentSupport}
          />
          <Template1PhaseRow
            phaseName="Closure"
            teacherHeading="Closure: What Teacher Will Do"
            teacherActions={lessonData.closure.teacherActions}
            studentActions={lessonData.closure.studentActions}
            extra={{ label: "How will you assess the objectives?", text: lessonData.assessment.howObjectivesAssessed }}
          />
        </tbody>
      </table>
    </div>
  );
}

import { PlaceholderBar, PlaceholderParagraph } from "./PreviewPlaceholders";

/* ── Template 1 (PSU/GTEP-style) — structure-only preview ─────────────────────
   Mirrors Template1LessonView's real table layout and section order exactly
   (Lesson Goals -> Objectives/Materials -> Lesson Plan Details ->
   Introduction -> Main Learning Activities -> Closure). The static
   boilerplate/instructional text (e.g. "Describe what you are teaching...")
   is a fixed part of the template's own design, not generated content, so
   it's reproduced verbatim — only the fields a generated lesson would
   actually fill in are replaced with gray placeholder bars.
────────────────────────────────────────────────────────────────────────────── */

function PhasePlaceholderRow({
  phaseName,
  teacherHeading,
  includeStudentSupport,
  extraLabel,
}: {
  phaseName: string;
  teacherHeading: string;
  includeStudentSupport?: boolean;
  extraLabel?: string;
}) {
  return (
    <tr>
      <td className="t1-cell">
        <p className="t1-label" style={{ marginTop: 0 }}>{teacherHeading}</p>
        <ol className="t1-list">
          <li><PlaceholderBar width="90%" /></li>
          <li><PlaceholderBar width="76%" /></li>
        </ol>
        {includeStudentSupport && (
          <>
            <p className="t1-label">Student Support:</p>
            <ul className="t1-list-dash">
              <li><PlaceholderBar width="68%" /></li>
            </ul>
          </>
        )}
        {extraLabel && (
          <>
            <p className="t1-label">{extraLabel}</p>
            <ul className="t1-list-dash">
              <li><PlaceholderBar width="62%" /></li>
            </ul>
          </>
        )}
      </td>
      <td className="t1-cell">
        <p className="t1-label" style={{ marginTop: 0 }}>{phaseName}: What Students will do</p>
        <ul className="t1-list-dash">
          <li><PlaceholderBar width="82%" /></li>
          <li><PlaceholderBar width="64%" /></li>
        </ul>
      </td>
    </tr>
  );
}

export function Template1Preview() {
  return (
    <div className="t1-page">
      <h2 className="t1-title">PSU Graduate School of Education Lesson Plan Template</h2>
      <div className="t1-meta-row">
        <span><strong>TC Name:</strong> <PlaceholderBar width={70} height={11} style={{ display: "inline-block", verticalAlign: "middle" }} /></span>
        <span><strong>Subject/Grade level:</strong> <PlaceholderBar width={90} height={11} style={{ display: "inline-block", verticalAlign: "middle" }} /></span>
        <span><strong>Time Duration of Lesson:</strong> <PlaceholderBar width={50} height={11} style={{ display: "inline-block", verticalAlign: "middle" }} /></span>
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
              <div style={{ margin: "6px 0" }}><PlaceholderParagraph lines={2} /></div>
              <p className="t1-label">Standard(s) Addressed:</p>
              <p className="t1-instructions-italic" style={{ margin: 0 }}>List all standards addressed during the lesson. (List number and text)</p>
              <div style={{ margin: "6px 0" }}><PlaceholderBar width="55%" /></div>
            </td>
          </tr>

          <tr>
            <td className="t1-cell">
              <p className="t1-label" style={{ marginTop: 0 }}>Lesson Objectives:</p>
              <ol className="t1-list">
                <li><PlaceholderBar width="88%" /></li>
                <li><PlaceholderBar width="76%" /></li>
              </ol>
            </td>
            <td className="t1-cell">
              <p className="t1-label" style={{ marginTop: 0 }}>Materials:</p>
              <ul className="t1-list-dash">
                <li><PlaceholderBar width="70%" /></li>
                <li><PlaceholderBar width="55%" /></li>
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

          <PhasePlaceholderRow
            phaseName="Introduction"
            teacherHeading="Introduction: What Teacher Will Do to Engage Students."
            includeStudentSupport
          />
          <PhasePlaceholderRow
            phaseName="Main Learning Activities"
            teacherHeading="Main Learning Activities: What Teacher Will Do"
            includeStudentSupport
          />
          <PhasePlaceholderRow
            phaseName="Closure"
            teacherHeading="Closure: What Teacher Will Do"
            extraLabel="How will you assess the objectives?"
          />
        </tbody>
      </table>
    </div>
  );
}

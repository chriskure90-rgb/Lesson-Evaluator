/* ── Template 1 (PSU/GTEP-style) — structure preview with sample content ──────
   Mirrors Template1LessonView's real table layout and section order exactly
   (Lesson Goals -> Objectives/Materials -> Lesson Plan Details ->
   Introduction -> Main Learning Activities -> Closure). The static
   boilerplate/instructional text (e.g. "Describe what you are teaching...")
   is a fixed part of the template's own design, so it's reproduced verbatim.

   The rest is a fixed, illustrative sample lesson (never real generated
   data, never connected to actual lesson generation) — it exists so the
   preview reads like a completed document rather than a loading skeleton.
────────────────────────────────────────────────────────────────────────────── */

function PhasePreviewRow({
  phaseName,
  teacherHeading,
  teacherActions,
  studentActions,
  studentSupport,
  extra,
}: {
  phaseName: string;
  teacherHeading: string;
  teacherActions: string[];
  studentActions: string[];
  studentSupport?: string;
  extra?: { label: string; text: string };
}) {
  return (
    <tr>
      <td className="t1-cell">
        <p className="t1-label" style={{ marginTop: 0 }}>{teacherHeading}</p>
        <ol className="t1-list">
          {teacherActions.map((a, i) => <li key={i}>{a}</li>)}
        </ol>
        {studentSupport && (
          <>
            <p className="t1-label">Student Support:</p>
            <ul className="t1-list-dash">
              <li>{studentSupport}</li>
            </ul>
          </>
        )}
        {extra && (
          <>
            <p className="t1-label">{extra.label}</p>
            <ul className="t1-list-dash">
              <li>{extra.text}</li>
            </ul>
          </>
        )}
      </td>
      <td className="t1-cell">
        <p className="t1-label" style={{ marginTop: 0 }}>{phaseName}: What Students will do</p>
        <ul className="t1-list-dash">
          {studentActions.map((a, i) => <li key={i}>{a}</li>)}
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
        <span><strong>TC Name:</strong> Jane Smith</span>
        <span><strong>Subject/Grade level:</strong> 5th Grade Science</span>
        <span><strong>Time Duration of Lesson:</strong> 45 minutes</span>
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
              <p className="t1-body">
                Students will investigate how different forces affect the motion of objects through hands-on activities and collaborative discussion.
              </p>
              <p className="t1-label">Standard(s) Addressed:</p>
              <p className="t1-instructions-italic" style={{ margin: 0 }}>List all standards addressed during the lesson. (List number and text)</p>
              <p className="t1-body">
                NGSS 5-PS2-1: Support an argument that the gravitational force exerted by Earth on objects is directed toward the planet's center.
              </p>
            </td>
          </tr>

          <tr>
            <td className="t1-cell">
              <p className="t1-label" style={{ marginTop: 0 }}>Lesson Objectives:</p>
              <ol className="t1-list">
                <li>Explain how force affects motion.</li>
                <li>Collect and interpret observations from a simple investigation.</li>
              </ol>
            </td>
            <td className="t1-cell">
              <p className="t1-label" style={{ marginTop: 0 }}>Materials:</p>
              <ul className="t1-list-dash">
                <li>Chromebook</li>
                <li>Toy cars</li>
                <li>Ramp</li>
                <li>Measuring tape</li>
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

          <PhasePreviewRow
            phaseName="Introduction"
            teacherHeading="Introduction: What Teacher Will Do to Engage Students."
            teacherActions={["Introduce the concept of force through a short demonstration using a ball and a ramp.", "Ask students to predict what will happen before each demonstration."]}
            studentActions={["Observe the demonstration and share initial predictions about how force affects motion."]}
            studentSupport="Provide visual aids and sentence starters to help students articulate their predictions."
          />
          <PhasePreviewRow
            phaseName="Main Learning Activities"
            teacherHeading="Main Learning Activities: What Teacher Will Do"
            teacherActions={["Guide small groups through a hands-on investigation, rolling toy cars down ramps of varying heights.", "Circulate to support data collection and ask probing questions."]}
            studentActions={["Work in small groups to conduct the investigation, measure results, and record data in a science journal."]}
            studentSupport="Pair students strategically and provide simplified data tables for recording observations."
          />
          <PhasePreviewRow
            phaseName="Closure"
            teacherHeading="Closure: What Teacher Will Do"
            teacherActions={["Facilitate a class discussion where groups share their findings and connect results to the concept of force."]}
            studentActions={["Discuss findings and compare results across groups."]}
            extra={{ label: "How will you assess the objectives?", text: "Students complete an exit ticket explaining how force influenced the motion of their object using evidence from the investigation." }}
          />
        </tbody>
      </table>
    </div>
  );
}

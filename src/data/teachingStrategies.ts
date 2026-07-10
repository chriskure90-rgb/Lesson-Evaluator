/* ── Teaching strategies catalog ───────────────────────────────────────────────
   Source of truth (for now): "Teaching Strategy.pdf" in the project root for
   Literacy/Numeracy; Marzano's nine high-yield instructional strategies for
   the "marzano" category. Strategy names are preserved verbatim from their
   source; descriptions are short paraphrases (Literacy/Numeracy) or the
   canonical instructional guidance (Marzano).

   Concept Mapping and Graphic Organizers appear under both the Literacy and
   Numeracy sections of the PDF — each is listed here ONCE (category:
   "literacy", their first appearance) rather than as two entries, since this
   shape only allows a strategy to belong to a single category. That's what
   keeps the picker UI from ever showing the same strategy as two chips.

   promptDescription is optional and only populated for categories that need
   to inject real instructional guidance into the generation prompt (Marzano
   today) rather than just a bare name — see resolveMarzanoStrategies() and
   buildMarzanoStrategiesBlock() in api/generate.js. Literacy/Numeracy strategies
   are untouched: they have no promptDescription and continue to be sent to
   the prompt as plain names via resolveTeachingStrategyNames(), exactly as
   before.

   This is a plain local constant today. It's intentionally shaped like a
   table row (id/name/category/description/promptDescription) so a future
   swap to a Supabase `teaching_strategies` table only touches
   fetchTeachingStrategies() below — nothing that reads TeachingStrategy[]
   elsewhere needs to change.
────────────────────────────────────────────────────────────────────────────── */

export type TeachingStrategyCategory = "marzano" | "literacy" | "numeracy";

export type TeachingStrategy = {
  id: string;
  name: string;
  category: TeachingStrategyCategory;
  description: string;
  /** LLM-facing instructional guidance. Only present for categories (like
   *  Marzano) whose selections should inject real guidance into the
   *  generation prompt instead of just a name. */
  promptDescription?: string;
};

export const TEACHING_STRATEGY_CATEGORY_LABELS: Record<TeachingStrategyCategory, string> = {
  marzano:  "Marzano Strategies",
  literacy: "Literacy",
  numeracy: "Numeracy",
};

/** Explicit display order for the picker's categories — Marzano first, then
 *  Literacy, then Numeracy — independent of insertion order in
 *  TEACHING_STRATEGIES below. */
export const TEACHING_STRATEGY_CATEGORY_ORDER: TeachingStrategyCategory[] = ["marzano", "literacy", "numeracy"];

export const TEACHING_STRATEGIES: TeachingStrategy[] = [
  // ── Marzano Strategies ───────────────────────────────────────────────────
  {
    id: "identifying-similarities-differences",
    name: "Identifying Similarities & Differences",
    category: "marzano",
    description: "Help students compare, classify, create analogies, or identify patterns.",
    promptDescription: "Help students compare, classify, create analogies, or identify patterns.",
  },
  {
    id: "summarizing-note-taking",
    name: "Summarizing & Note Taking",
    category: "marzano",
    description: "Include opportunities for students to summarize key ideas and organize information in their own words.",
    promptDescription: "Include opportunities for students to summarize key ideas and organize information in their own words.",
  },
  {
    id: "reinforcing-effort-recognition",
    name: "Reinforcing Effort & Providing Recognition",
    category: "marzano",
    description: "Encourage student effort through meaningful recognition and reflection on progress.",
    promptDescription: "Encourage student effort through meaningful recognition and reflection on progress.",
  },
  {
    id: "homework-practice",
    name: "Homework & Practice",
    category: "marzano",
    description: "Include intentional practice activities that reinforce the lesson objectives.",
    promptDescription: "Include intentional practice activities that reinforce the lesson objectives.",
  },
  {
    id: "non-linguistic-representations",
    name: "Non-Linguistic Representations",
    category: "marzano",
    description: "Include diagrams, graphic organizers, models, visuals, gestures, or other non-text representations.",
    promptDescription: "Include diagrams, graphic organizers, models, visuals, gestures, or other non-text representations.",
  },
  {
    id: "cooperative-learning",
    name: "Cooperative Learning",
    category: "marzano",
    description: "Include structured collaborative learning activities where students work toward a shared learning goal.",
    promptDescription: "Include structured collaborative learning activities where students work toward a shared learning goal.",
  },
  {
    id: "setting-objectives-feedback",
    name: "Setting Objectives & Providing Feedback",
    category: "marzano",
    description: "Clearly communicate learning objectives and include opportunities for teacher or peer feedback throughout the lesson.",
    promptDescription: "Clearly communicate learning objectives and include opportunities for teacher or peer feedback throughout the lesson.",
  },
  {
    id: "generating-testing-hypotheses",
    name: "Generating & Testing Hypotheses",
    category: "marzano",
    description: "Include prediction, investigation, experimentation, or problem-solving activities followed by reflection.",
    promptDescription: "Include prediction, investigation, experimentation, or problem-solving activities followed by reflection.",
  },
  {
    id: "questions-cues-advance-organizers",
    name: "Questions, Cues & Advance Organizers",
    category: "marzano",
    description: "Activate prior knowledge using purposeful questioning, cues, or graphic organizers before introducing new concepts.",
    promptDescription: "Activate prior knowledge using purposeful questioning, cues, or graphic organizers before introducing new concepts.",
  },

  // ── Literacy ──────────────────────────────────────────────────────────────
  {
    id: "concept-mapping",
    name: "Concept Mapping",
    category: "literacy",
    description: "A graphical diagram that visually organizes and illustrates relationships between concepts or ideas, helping students structure information and see connections within a topic.",
  },
  {
    id: "descriptive-writing",
    name: "Descriptive Writing",
    category: "literacy",
    description: "Writing that documents a specific element, observation, or phenomenon in rich detail so readers can visualize it.",
  },
  {
    id: "dialogical-writing",
    name: "Dialogical Writing",
    category: "literacy",
    description: "Writing a conversation between two or more characters, using dialogue tags and punctuation to identify speakers and convey authentic voice.",
  },
  {
    id: "graphic-organizers",
    name: "Graphic Organizers",
    category: "literacy",
    description: "Visual scaffolds combining short text and sketched images that help students think through and organize their ideas before producing a final product.",
  },
  {
    id: "infographics",
    name: "Infographics",
    category: "literacy",
    description: "Digital posters combining images and text to present key information about a topic as a finished, shareable product.",
  },
  {
    id: "performance",
    name: "Performance",
    category: "literacy",
    description: "Students act out a piece of writing, scene, or event, emphasizing voice and using props to bring the content to life.",
  },
  {
    id: "persuasive-writing",
    name: "Persuasive Writing",
    category: "literacy",
    description: "Writing intended to shift a reader's perspective on an idea, topic, or argument by arguing for or against a clearly defined position.",
  },
  {
    id: "procedural-writing",
    name: "Procedural Writing",
    category: "literacy",
    description: "Writing that explains a process step by step, using signal words like first, next, and finally to structure the sequence.",
  },
  {
    id: "text-based-open-ended-writing-prompt",
    name: "Text-Based, Open-Ended Writing Prompt",
    category: "literacy",
    description: "A \"what\" or \"how\" writing prompt that draws out students' own perspective on an aspect of a text that has no single clear answer.",
  },
  {
    id: "text-based-oral-comprehension-questions",
    name: "Text-Based, Oral Comprehension Questions",
    category: "literacy",
    description: "Strategically timed questions asked while students read a text, used to check comprehension and clarify confusion without breaking their reading flow.",
  },
  {
    id: "think-pair-share",
    name: "Think-Pair-Share",
    category: "literacy",
    description: "A three-step strategy where students first work independently, then discuss and give feedback in pairs, then share with the whole class.",
  },
  {
    id: "vocabulary-instruction",
    name: "Vocabulary Instruction",
    category: "literacy",
    description: "Repeated, contextualized engagement with vocabulary words through writing, definitions, and multiple exposures to build retention.",
  },

  // ── Numeracy ──────────────────────────────────────────────────────────────
  {
    id: "manipulatives",
    name: "Manipulatives",
    category: "numeracy",
    description: "Physical or digital objects — blocks, counters, coins, geometric shapes — that help students visualize and work through math concepts hands-on.",
  },
  {
    id: "math-journals",
    name: "Math Journals",
    category: "numeracy",
    description: "A notebook where students record strategies, observations, and reflections on math problems and lessons over time.",
  },
  {
    id: "number-talks",
    name: "Number Talks",
    category: "numeracy",
    description: "A mental-math routine where students solve a problem in their heads, signal their thinking with hand gestures, then discuss the different strategies they used.",
  },
  {
    id: "reciprocal-peer-tutoring",
    name: "Reciprocal Peer Tutoring",
    category: "numeracy",
    description: "Students alternate between tutor and tutee roles, teaching a concept to a partner and then being taught in return.",
  },
  {
    id: "science-talks",
    name: "Science Talks",
    category: "numeracy",
    description: "A number-talks-style routine adapted for science, where students reason through a problem independently and then discuss their thinking as a class.",
  },
  {
    id: "socratic-seminar",
    name: "Socratic Seminar",
    category: "numeracy",
    description: "A structured, open-ended discussion around a text, image, or data source that builds critical thinking through student-led questioning and dialogue.",
  },
];

/** Local, synchronous stand-in for a future Supabase-backed fetch. Kept
 *  async so call sites don't need to change when this starts hitting a
 *  `teaching_strategies` table instead of a local constant. */
export async function fetchTeachingStrategies(): Promise<TeachingStrategy[]> {
  return TEACHING_STRATEGIES;
}

/** Resolves selected strategy ids back to their (LLM-facing) display names —
 *  Literacy/Numeracy only. Marzano selections are resolved separately via
 *  resolveMarzanoStrategies() since they carry a promptDescription instead
 *  of being sent as bare names, so a strategy is never represented twice
 *  in the generation payload. */
export function resolveTeachingStrategyNames(ids: string[]): string[] {
  const idSet = new Set(ids);
  return TEACHING_STRATEGIES
    .filter((s) => s.category !== "marzano" && idSet.has(s.id))
    .map((s) => s.name);
}

/** Resolves selected Marzano strategy ids to their name + LLM-facing
 *  instructional description, for the dedicated Marzano prompt block. */
export function resolveMarzanoStrategies(ids: string[]): { name: string; promptDescription: string }[] {
  const idSet = new Set(ids);
  return TEACHING_STRATEGIES
    .filter((s) => s.category === "marzano" && idSet.has(s.id))
    .map((s) => ({ name: s.name, promptDescription: s.promptDescription ?? "" }));
}

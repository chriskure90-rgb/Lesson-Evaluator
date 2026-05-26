import { generateLessonWithMistral } from "./providers/mistral.js";

export default async function handler(req, res) {
  try {
    const { model } = req.body;

    if (model === "mistral" || model === "Mistral") {
      const lesson = await generateLessonWithMistral(req.body);
      return res.status(200).json(lesson);
    }

return res.status(200).json({
  title: `${model} Provider Not Implemented Yet`,
  grade: req.body.grade || "Grade 7",
  duration: `${req.body.duration || 60} min`,
  objectives: [
    "Only the Mistral provider is currently connected.",
    "This provider is prepared for future integration."
  ],
  materials: [],
  activities: [],
  assessment: "Provider not implemented yet.",
  differentiation: "Provider not implemented yet.",
});
  } catch (error) {
    console.error("Generate error:", error);
    return res.status(200).json({
      title: "Fallback Lesson",
      grade: "Grade 7",
      duration: "60 min",
      objectives: [],
      materials: [],
      activities: [],
      assessment: [],
      differentiation: [],
    });
  }
}
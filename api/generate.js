import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export default async function handler(req, res) {
  try {
    const prompt = `
Create a middle school science lesson plan.

Return JSON only. Do not use markdown.

Format:
{
  "title": "...",
  "grade": "Grade 7",
  "duration": "60 min",
  "objectives": ["...", "..."],
  "materials": ["...", "..."],
  "activities": [
    {
      "time": "10m",
      "title": "...",
      "description": "..."
    }
  ],
  "assessment": ["...", "..."],
  "differentiation": ["...", "..."]
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    let text = response.text.trim();
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");

    const lesson = JSON.parse(text);

    res.status(200).json(lesson);
  } catch (error) {
    console.error("Gemini generate error:", error);

    res.status(200).json({
      title: "Fallback Lesson",
      error: String(error?.message || error),
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

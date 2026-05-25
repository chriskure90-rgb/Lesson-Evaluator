import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export default async function handler(req, res) {
  try {
    const prompt = `
Create a middle school science lesson plan.

Return JSON only.

Format:
{
  "title": "...",
  "grade": "...",
  "duration": "...",
  "objective": "...",
  "activities": ["...", "...", "..."]
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    const text = response.text;

    const lesson = JSON.parse(text);

    res.status(200).json(lesson);
  } catch (error) {
    console.error(error);

    res.status(200).json({
      title: "Fallback Lesson",
      grade: "Grade 7",
      duration: "60 min",
      objective: "Fallback objective",
      activities: ["Activity 1", "Activity 2"],
    });
  }
}

import { Mistral } from "@mistralai/mistralai";

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

export default async function handler(req, res) {
  try {
    const result = await mistral.chat.complete({
      model: "mistral-small-latest",
      messages: [
        {
          role: "user",
          content: `
Create a Grade 7 NGSS lesson plan about photosynthesis.

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
`,
        },
      ],
    });

    let text = result.choices[0].message.content.trim();
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");

    const lesson = JSON.parse(text);
    res.status(200).json(lesson);
  } catch (error) {
    console.error("Mistral generate error:", error);

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
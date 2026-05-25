export default async function handler(req, res) {
  res.status(200).json({
    title: "Modeling Photosynthesis with Everyday Materials",
    grade: "Grade 7",
    duration: "60 min",
    objective:
      "Students explain how plants convert sunlight into energy through photosynthesis.",
    activities: [
      "Observe elodea sprigs in water",
      "Discuss evidence of oxygen production",
      "Create a labeled photosynthesis diagram",
    ],
  });
}
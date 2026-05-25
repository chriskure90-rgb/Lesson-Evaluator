export default async function handler(req, res) {
  const mockEvaluation = {
    overall: 88,
    summary:
      "Clear objectives, well-paced activities, and strong classroom usability.",
    categories: [
      {
        name: "Standards Alignment",
        score: 90,
      },
      {
        name: "Learning Objectives",
        score: 92,
      },
      {
        name: "Instructional Design",
        score: 72,
      },
      {
        name: "Assessment Strategy",
        score: 55,
      },
    ],
  };

  res.status(200).json(mockEvaluation);
}
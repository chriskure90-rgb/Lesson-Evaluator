import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/evaluator")({
  head: () => ({
    meta: [
      { title: "Lesson Evaluator — LessonAI" },
      { name: "description", content: "AI assessment with teacher review." },
    ],
  }),
  component: EvaluatorPage,
});

const lesson = {
  title: "Modeling Photosynthesis with Everyday Materials",
  grade: "7",
  duration: 60,
  model: "GPT-4",
  overview:
    "A 60-minute investigation where students model photosynthesis using elodea sprigs, then translate their observations into a labeled diagram that ties evidence to the photosynthesis equation.",
};

const overall = {
  score: 88,
  band: "Classroom-ready",
  summary:
    "Clear objectives, well-paced activities, and a defensible assessment. Minor refinements to standards citation and differentiation would strengthen the plan further.",
};

const sections: { id: string; title: string; score: number; feedback: string }[] = [
  {
    id: "standards",
    title: "Standards Alignment",
    score: 90,
    feedback:
      "MS-LS1-6 is well represented across the modeling task and assessment. Consider explicitly tagging the science and engineering practice (developing and using models) in the rubric.",
  },
  {
    id: "objectives",
    title: "Learning Objectives",
    score: 92,
    feedback:
      "Objectives are observable and tied directly to the assessment. Phrasing is student-facing and action-oriented. No changes needed.",
  },
  {
    id: "instruction",
    title: "Instructional Design",
    score: 84,
    feedback:
      "Pacing is appropriate and the lab anchors the conceptual content. Add a 2-minute checkpoint after the direct instruction segment to surface misconceptions earlier.",
  },
  {
    id: "assessment",
    title: "Assessment Strategy",
    score: 86,
    feedback:
      "Exit ticket aligns with the objectives and produces evidence of learning. Consider providing a sentence stem for students who need a writing scaffold.",
  },
];

function scoreColor(score: number) {
  if (score >= 90) return "text-primary";
  if (score >= 75) return "text-foreground";
  return "text-destructive";
}

function EvaluatorPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 md:px-10 py-10 md:py-14">
      <PageHeader title="Lesson Evaluator" subtitle="AI assessment with teacher review." />

      {/* SUMMARY */}
      <Card className="p-6 md:p-7 border-border shadow-soft bg-card">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              Reviewing
            </div>
            <h2 className="mt-1 font-display text-xl tracking-tight text-balance">{lesson.title}</h2>
            <div className="mt-2 flex items-center gap-4 text-[13px] text-muted-foreground">
              <span>Grade {lesson.grade}</span>
              <span className="text-border">·</span>
              <span>{lesson.duration} min</span>
              <span className="text-border">·</span>
              <span>{lesson.model}</span>
            </div>
            <p className="mt-4 text-[14px] text-foreground/85 text-pretty leading-relaxed max-w-2xl">
              {lesson.overview}
            </p>
          </div>
        </div>
      </Card>

      {/* OVERALL EVAL */}
      <Card className="mt-6 p-6 md:p-7 border-border shadow-soft bg-card">
        <div className="flex items-start gap-6 flex-wrap">
          <div className="shrink-0">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              Overall
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-display text-4xl text-primary tabular-nums">{overall.score}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
            </div>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent text-accent-foreground px-2.5 py-0.5 text-[11px] font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {overall.band}
            </div>
          </div>
          <div className="flex-1 min-w-[260px] border-l border-border pl-6">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              AI Feedback Summary
            </div>
            <p className="mt-2 text-[14px] text-foreground/90 text-pretty leading-relaxed">
              {overall.summary}
            </p>
          </div>
        </div>
      </Card>

      {/* DETAILED SECTIONS */}
      <div className="mt-8">
        <h3 className="font-display text-sm uppercase tracking-widest text-muted-foreground mb-3 px-1">
          Detailed Evaluation
        </h3>
        <Card className="border-border shadow-soft bg-card overflow-hidden">
          <Accordion type="multiple" className="px-6">
            {sections.map((s, i) => (
              <EvaluationSection key={s.id} section={s} isLast={i === sections.length - 1} />
            ))}
          </Accordion>
        </Card>
      </div>
    </div>
  );
}

function EvaluationSection({
  section,
  isLast,
}: {
  section: { id: string; title: string; score: number; feedback: string };
  isLast: boolean;
}) {
  const [override, setOverride] = useState("");

  return (
    <AccordionItem value={section.id} className={cn(isLast && "border-b-0")}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center justify-between w-full pr-3">
          <span className="font-display text-[15px] text-foreground">{section.title}</span>
          <span className={cn("font-display text-[15px] tabular-nums", scoreColor(section.score))}>
            {section.score}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <p className="text-[14px] text-foreground/85 text-pretty leading-relaxed">
          {section.feedback}
        </p>
        <div className="mt-4">
          <div className="mb-2 text-[12px] font-medium text-muted-foreground">
            Teacher notes / override
          </div>
          <Textarea
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            rows={2}
            placeholder="Add your own context, adjust the score, or refine the feedback…"
            className="bg-background"
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

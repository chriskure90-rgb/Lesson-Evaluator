import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PageHeader, FieldLabel } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { FileText, Sparkles, Loader2 } from "lucide-react";

export const Route = createFileRoute("/generator")({
  head: () => ({
    meta: [
      { title: "Lesson Generator — LessonAI" },
      { name: "description", content: "Generate standards-aligned lesson plans in seconds." },
    ],
  }),
  component: GeneratorPage,
});

const grades = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const durations = [30, 45, 60, 90];

type Lesson = {
  title: string;
  objectives: string[];
  materials: string[];
  activities: { name: string; minutes: number; detail: string }[];
  assessment: string;
};

const MOCK_LESSON: Lesson = {
  title: "Modeling Photosynthesis with Everyday Materials",
  objectives: [
    "Explain how plants convert light energy into chemical energy.",
    "Identify the inputs and outputs of photosynthesis.",
    "Model the process using a simple visual diagram.",
  ],
  materials: [
    "Chart paper and markers",
    "Printed leaf cross-section diagrams",
    "Beakers, water, baking soda, elodea sprigs",
    "Lamp or sunny window",
  ],
  activities: [
    { name: "Warm-up discussion", minutes: 5, detail: "Show a wilted vs. healthy plant. Ask: what does a plant need to make food?" },
    { name: "Direct instruction", minutes: 15, detail: "Walk through the photosynthesis equation; label inputs (CO₂, H₂O, light) and outputs (glucose, O₂)." },
    { name: "Lab investigation", minutes: 25, detail: "Students observe oxygen bubbles released from elodea sprigs under light vs. dark conditions." },
    { name: "Synthesis", minutes: 15, detail: "Each pair creates a labeled model showing how their observations connect to the equation." },
  ],
  assessment: "Exit ticket: students draw and label a diagram of photosynthesis using their own observations as evidence. Scored against a 4-point rubric for accuracy, completeness, and use of evidence.",
};

function GeneratorPage() {
  const [model, setModel] = useState("gpt-4");
  const [grade, setGrade] = useState("7");
  const [framework, setFramework] = useState("ngss");
  const [code, setCode] = useState("MS-LS1-6");
  const [goal, setGoal] = useState("Help students understand how plants produce energy through photosynthesis.");
  const [duration, setDuration] = useState(60);
  const [generating, setGenerating] = useState(false);
  const [lesson, setLesson] = useState<Lesson | null>(null);

  function generate() {
    setGenerating(true);
    setTimeout(() => {
      setLesson(MOCK_LESSON);
      setGenerating(false);
    }, 900);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 md:px-10 py-10 md:py-14">
      <PageHeader
        title="Lesson Generator"
        subtitle="Generate standards-aligned lesson plans in seconds."
      />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-8">
        {/* FORM */}
        <Card className="p-6 md:p-7 shadow-soft border-border bg-card">
          <div className="space-y-5">
            <div>
              <FieldLabel hint="Used to draft your plan">AI Model</FieldLabel>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4">GPT-4 · Balanced</SelectItem>
                  <SelectItem value="claude">Claude 3.5 Sonnet</SelectItem>
                  <SelectItem value="gemini">Gemini 1.5 Pro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <FieldLabel>Grade Level</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {grades.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGrade(g)}
                    className={cn(
                      "h-8 min-w-[2.25rem] px-2.5 rounded-md text-[13px] border transition-colors",
                      grade === g
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted",
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-[1fr_1fr] gap-3">
              <div>
                <FieldLabel>Standards Framework</FieldLabel>
                <Select value={framework} onValueChange={setFramework}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ngss">NGSS</SelectItem>
                    <SelectItem value="ccss">Common Core</SelectItem>
                    <SelectItem value="teks">TEKS (Texas)</SelectItem>
                    <SelectItem value="state">State-specific</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel hint="Optional">Standard Code</FieldLabel>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. MS-LS1-6" />
              </div>
            </div>

            <div>
              <FieldLabel>Lesson Goal</FieldLabel>
              <Textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={4}
                placeholder="Describe what students should know or be able to do…"
              />
            </div>

            <div>
              <FieldLabel>Duration</FieldLabel>
              <div className="flex gap-1.5">
                {durations.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={cn(
                      "h-9 px-4 rounded-md text-[13px] border transition-colors flex-1",
                      duration === d
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted",
                    )}
                  >
                    {d} min
                  </button>
                ))}
              </div>
            </div>

            <Button onClick={generate} disabled={generating} className="w-full h-10 mt-2">
              {generating ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Generate Lesson Plan</>
              )}
            </Button>
          </div>
        </Card>

        {/* PREVIEW */}
        <div>
          {!lesson ? (
            <EmptyPreview />
          ) : (
            <LessonPreview lesson={lesson} meta={{ grade, duration, framework: framework.toUpperCase(), code }} />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyPreview() {
  return (
    <Card className="h-full min-h-[400px] border-dashed border-border bg-muted/30 shadow-none grid place-items-center p-10">
      <div className="text-center max-w-sm">
        <div className="mx-auto h-11 w-11 rounded-full bg-accent grid place-items-center mb-4">
          <FileText className="h-5 w-5 text-accent-foreground" />
        </div>
        <h3 className="font-display text-lg text-foreground">Your lesson will appear here</h3>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          Fill in the form on the left and generate a draft you can review, edit, and send to your evaluator.
        </p>
      </div>
    </Card>
  );
}

function LessonPreview({
  lesson,
  meta,
}: {
  lesson: Lesson;
  meta: { grade: string; duration: number; framework: string; code: string };
}) {
  return (
    <Card className="border-border shadow-soft bg-card overflow-hidden">
      <div className="p-6 md:p-7 border-b border-border bg-muted/30">
        <div className="text-[11px] uppercase tracking-widest text-primary font-medium">
          {meta.framework}{meta.code && ` · ${meta.code}`} · Grade {meta.grade} · {meta.duration} min
        </div>
        <h2 className="mt-2 font-display text-xl tracking-tight text-balance">{lesson.title}</h2>
      </div>

      <Accordion type="multiple" defaultValue={["objectives"]} className="px-6 md:px-7">
        <AccordionItem value="objectives">
          <AccordionTrigger className="font-display text-[15px]">Learning Objectives</AccordionTrigger>
          <AccordionContent>
            <ul className="space-y-2 text-[14px] text-foreground/90">
              {lesson.objectives.map((o, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-muted-foreground tabular-nums">0{i + 1}</span>
                  <span className="text-pretty">{o}</span>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="materials">
          <AccordionTrigger className="font-display text-[15px]">Materials</AccordionTrigger>
          <AccordionContent>
            <ul className="space-y-1.5 text-[14px] text-foreground/90">
              {lesson.materials.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted-foreground">—</span>{m}
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="activities">
          <AccordionTrigger className="font-display text-[15px]">Activities</AccordionTrigger>
          <AccordionContent>
            <ol className="space-y-3 text-[14px]">
              {lesson.activities.map((a, i) => (
                <li key={i} className="flex gap-4">
                  <span className="text-primary font-display tabular-nums shrink-0 w-12 text-[13px]">{a.minutes}m</span>
                  <div>
                    <div className="font-medium text-foreground">{a.name}</div>
                    <div className="text-muted-foreground text-pretty leading-relaxed mt-0.5">{a.detail}</div>
                  </div>
                </li>
              ))}
            </ol>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="assessment" className="border-b-0">
          <AccordionTrigger className="font-display text-[15px]">Assessment</AccordionTrigger>
          <AccordionContent>
            <p className="text-[14px] text-foreground/90 text-pretty leading-relaxed">{lesson.assessment}</p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8 pb-6 border-b border-border">
      <h1 className="font-display text-3xl text-foreground tracking-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <label className="text-[13px] font-medium text-foreground">{children}</label>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/* Primitivas de interface. Sem regra de negócio. Estados e acessibilidade por padrão. */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-10";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-strong",
  secondary: "bg-surface text-primary border border-border hover:bg-primary-soft",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "bg-transparent text-primary hover:bg-primary-soft",
};

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button {...props} className={cx(buttonBase, buttonVariants[variant], className)} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link {...props} className={cx(buttonBase, buttonVariants[variant], className)} />;
}

export function Field({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {description ? (
        <p id={`${id}-desc`} className="text-sm text-text-muted">
          {description}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-err`} className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-base min-h-10 placeholder:text-text-muted aria-[invalid=true]:border-danger";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputClass, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputClass, "min-h-24", props.className)} />;
}

type AlertKind = "info" | "success" | "danger" | "warning";
const alertStyles: Record<AlertKind, string> = {
  info: "bg-primary-soft text-primary-strong border-primary/30",
  success: "bg-success-soft text-success border-success/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  warning: "bg-warning-soft text-warning border-warning/30",
};
const alertIcon: Record<AlertKind, string> = { info: "i", success: "✓", danger: "!", warning: "!" };

/** Mensagem com ícone e texto: nunca só cor. `role` muda conforme a gravidade. */
export function Alert({ kind = "info", title, children }: { kind?: AlertKind; title?: string; children: ReactNode }) {
  return (
    <div role={kind === "danger" ? "alert" : "status"} className={cx("flex gap-3 rounded-md border px-4 py-3 text-sm", alertStyles[kind])}>
      <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold">
        {alertIcon[kind]}
      </span>
      <div>
        {title ? <p className="font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Card({ title, children, className, actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx("min-w-0 rounded-md border border-border bg-surface p-5 shadow-[var(--shadow-1)]", className)}>
      {title || actions ? (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({ title, lead, actions }: { title: string; lead?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {lead ? <p className="mt-1 max-w-2xl text-text-muted">{lead}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </header>
  );
}

const badgeStyles: Record<string, string> = {
  invited: "bg-accent-soft text-warning",
  active: "bg-success-soft text-success",
  suspended: "bg-warning-soft text-warning",
  deactivated: "bg-surface-muted text-text-muted",
  neutral: "bg-surface-muted text-text",
};
const statusLabel: Record<string, string> = {
  invited: "Convidado",
  active: "Ativo",
  suspended: "Suspenso",
  deactivated: "Desativado",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  expired: "Vencida",
  held: "Retida",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", badgeStyles[status] ?? badgeStyles.neutral)}>
      {statusLabel[status] ?? status}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-muted px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-2 text-sm text-text-muted">{children}</div> : null}
    </div>
  );
}

export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    // Região rolável no celular: precisa ser alcançável pelo teclado (WCAG 2.1.1) e ter nome.
    <div role="region" aria-label={caption} tabIndex={0} className="max-w-full overflow-x-auto rounded-md border border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const th = "bg-surface-muted px-3 py-2 text-left font-semibold";
export const td = "border-t border-border px-3 py-2 align-top";

export function DefinitionList({ items }: { items: Array<{ term: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.term}>
          <dt className="text-xs uppercase tracking-wide text-text-muted">{i.term}</dt>
          <dd className="mt-0.5">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

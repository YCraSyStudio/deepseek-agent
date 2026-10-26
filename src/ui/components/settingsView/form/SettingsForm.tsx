import type { ReactNode } from "react";
import "./SettingsForm.css";

type ContentProps = { children: ReactNode; className?: string };

export function SettingsSection({ title, children, className = "" }: ContentProps & { title: string }) {
  return (
    <section className={`settingsSection ${className}`}>
      <h3 className="sectionTitle">{title}</h3>
      {children}
    </section>
  );
}

type SettingsGroupProps = ContentProps & {
  title: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  variant?: "section" | "panel";
  count?: number;
  busy?: boolean;
  headerAction?: ReactNode;
  tooltip?: string;
};

export function SettingsGroup({ title, children, className = "", collapsible = false, defaultOpen = true, variant = "section", count, busy, headerAction, tooltip }: SettingsGroupProps) {
  const classes = `settingsGroup settingsGroup--${variant} ${className}`;
  if (collapsible) {
    return (
      <details className={`${classes} settingsDisclosure`} open={defaultOpen} aria-busy={busy}>
        <summary>
          <i className="codicon codicon-chevron-down" aria-hidden="true" />
          <h3 className="sectionTitle">{title}</h3>
          {count !== undefined && <span className="settingsDisclosureCount">{count}</span>}
        </summary>
        <div className="settingsGroupContent">{children}</div>
      </details>
    );
  }
  return (
    <div className={classes}>
      {headerAction ? (
        <div className="settingsGroupHeader" data-tooltip={tooltip} data-tooltip-position="bottom" data-tooltip-align="start">
          <h3 className="sectionTitle">{title}</h3>
          {headerAction}
        </div>
      ) : <h3 className="sectionTitle">{title}</h3>}
      {children}
    </div>
  );
}

type SettingsFieldProps = ContentProps & {
  label?: ReactNode;
  htmlFor?: string;
  layout?: "inline" | "wide" | "toggle";
  tooltip?: string;
  description?: ReactNode;
  busy?: boolean;
};

export function SettingsField({ label, htmlFor, children, layout = "inline", tooltip, description, busy, className = "" }: SettingsFieldProps) {
  return (
    <div className={`settingsField settingsField--${layout} ${className}`} aria-busy={busy}>
      {label && (
        <label htmlFor={htmlFor} tabIndex={tooltip ? 0 : undefined}
          data-tooltip={tooltip} data-tooltip-position="bottom" data-tooltip-align="start">{label}</label>
      )}
      <div className="settingsFieldControl">{children}</div>
      {description && <div className="settingsFieldDescription">{description}</div>}
    </div>
  );
}

export function SettingsInputAction({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="settingsInputAction">
      {children}
      <div className="settingsInputActionButton">{action}</div>
    </div>
  );
}

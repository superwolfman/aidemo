import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function Header({ title, desc, action }: { title: string; desc: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      {action}
    </header>
  );
}

export function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="metric-card">
      <Icon size={20} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function Card({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <article className="info-card">
      <strong>{title}</strong>
      {text ? <p>{text}</p> : null}
      {children}
    </article>
  );
}

export function Status({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function LoadingPanel() {
  return <div className="panel empty">正在加载子应用...</div>;
}

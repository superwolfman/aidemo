import { CheckCircle2, ClipboardCheck } from 'lucide-react';

export function FileBadge({ title }: { title: string }) {
  return (
    <span className="ops-file-badge">
      <ClipboardCheck size={14} />
      {title}
    </span>
  );
}

export function ShieldValue({ score }: { score?: number }) {
  return (
    <span className="ops-file-badge">
      <CheckCircle2 size={14} />
      {typeof score === 'number' ? `${score}%` : 'pending'}
    </span>
  );
}

export function MetricTrendCard({ label, value, desc, path, tone = 'teal' }: { label: string; value: string; desc: string; path: string; tone?: 'teal' | 'blue' | 'cyan' }) {
  return (
    <article className={`ops-metric-trend-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <svg viewBox="0 0 280 72" aria-hidden="true">
        <polyline points={path} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p>{desc}</p>
    </article>
  );
}

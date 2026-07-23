import { CheckCircle2 } from 'lucide-react';
import type { ArtifactSummaryItem } from '../types';

type ArtifactOverviewProps = {
  artifactSummary: ArtifactSummaryItem[];
  activeArtifactId?: string;
  onSelectArtifact: (artifact: NonNullable<ArtifactSummaryItem['artifact']>) => void;
};

export function ArtifactOverview({ artifactSummary, activeArtifactId, onSelectArtifact }: ArtifactOverviewProps) {
  return (
    <section className="delivery-artifact-overview panel">
      {artifactSummary.map((item) => (
        <button
          key={item.type}
          className={item.artifact?.id === activeArtifactId ? 'active' : ''}
          type="button"
          disabled={!item.artifact}
          onClick={() => item.artifact && onSelectArtifact(item.artifact)}
        >
          <CheckCircle2 size={15} />
          <strong>{item.title}</strong>
          <span>
            {item.confirmed ? 'confirmed' : item.done ? 'ready' : 'waiting'} ·{' '}
            {item.artifact ? `v${item.artifact.version || 1}` : 'no artifact'}
          </span>
        </button>
      ))}
    </section>
  );
}

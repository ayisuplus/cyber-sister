// Placeholder — full step-by-step panel lands in Task 7.
import type { MakeupStep } from '../../shared/types';

interface Props {
  steps: MakeupStep[];
  current: number;
  onSelect: (index: number) => void;
}

export default function TutorialPanel({ steps, current, onSelect }: Props) {
  if (steps.length === 0) {
    return <p className="text-sm text-ink/60">暂无教程步骤。</p>;
  }
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={step.id}>
          <button
            type="button"
            onClick={() => onSelect(i)}
            className={`w-full text-left px-4 py-2 rounded-2xl transition-colors ${
              i === current ? 'bg-primary text-white' : 'bg-white hover:bg-secondary'
            }`}
          >
            <span className="font-medium">{step.order}. {step.title}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

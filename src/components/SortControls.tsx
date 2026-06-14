import type { SortDirection } from '../lib/sort';

interface SortOption<K extends string> {
  value: K;
  label: string;
}

interface SortControlsProps<K extends string> {
  value: K;
  direction: SortDirection;
  options: SortOption<K>[];
  onValueChange: (value: K) => void;
  onDirectionChange: (direction: SortDirection) => void;
}

export default function SortControls<K extends string>({
  value,
  direction,
  options,
  onValueChange,
  onDirectionChange
}: SortControlsProps<K>) {
  return (
    <div className="sort-controls">
      <span className="sort-label">Trier</span>
      <select
        className="border rounded px-2 py-1 text-sm"
        value={value}
        onChange={(e) => onValueChange(e.target.value as K)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <button
        type="button"
        className={`sort-direction ${direction === 'asc' ? 'is-active' : ''}`}
        onClick={() => onDirectionChange('asc')}
        title="Ordre croissant"
      >
        ↑
      </button>
      <button
        type="button"
        className={`sort-direction ${direction === 'desc' ? 'is-active' : ''}`}
        onClick={() => onDirectionChange('desc')}
        title="Ordre décroissant"
      >
        ↓
      </button>
    </div>
  );
}

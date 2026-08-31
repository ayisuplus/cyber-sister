// 目录网格单选：使用 radiogroup / radio 语义
export default function ItemPicker({ items, selectedId, onSelect, groupLabel }) {
  return (
    <div role="radiogroup" aria-label={groupLabel} className="mt-4 grid grid-cols-2 gap-2">
      {items.map(item => {
        const selected = item.id === selectedId
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(item.id)}
            className={`rounded-2xl border p-3 text-left transition-colors ${selected ? 'border-action-primary bg-pastel-blush shadow-card' : 'border-border-subtle bg-surface-page'}`}
          >
            <span className="block text-sm font-semibold text-text-primary">{item.name}</span>
            {item.category && (
              <span className="mt-1 inline-block rounded-full bg-pastel-mist px-2 py-0.5 text-[10px] font-medium text-status-info">{item.category}</span>
            )}
            <span className="mt-1 block text-[11px] leading-relaxed text-text-secondary">{item.description}</span>
            {item.tags && (
              <span className="mt-2 flex flex-wrap gap-1">
                {item.tags.map(tag => (
                  <span key={tag} className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-text-muted">{tag}</span>
                ))}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function EmptyState({ icon: Icon = null, title, description = '', action = null }) {
  return (
    <div className="animate-reveal-up py-12 text-center">
      {Icon ? (
        <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-pastel-blush text-action-primary" aria-hidden="true">
          <Icon size={28} />
        </span>
      ) : null}
      <p className="text-sm leading-relaxed text-text-secondary">{title}</p>
      {description ? <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

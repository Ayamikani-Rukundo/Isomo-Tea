type BrandProps = {
  compact?: boolean
  onClick?: () => void
}

export function Brand({ compact = false, onClick }: BrandProps) {
  const className = `brand ${compact ? 'brand-compact' : ''}`
  const content = (
    <>
      <span className="brand-mark" aria-hidden="true">
        <img src="/icons/ifam-icon-512.png" alt="" />
      </span>
      {!compact && (
        <span className="brand-wordmark">
          <strong>i</strong>
          <span>Fam</span>
        </span>
      )}
    </>
  )
  return onClick
    ? <button className={className} onClick={onClick} type="button">{content}</button>
    : <div className={className} aria-label="i Fam">{content}</div>
}

type ConfirmDialogProps = {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      className="message-delete-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section className="message-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <h2 id="confirm-dialog-title">{title}</h2>
        <p>{message}</p>
        <button className="delete-everyone" onClick={onConfirm} type="button">{confirmLabel}</button>
        <button className="delete-cancel" onClick={onCancel} type="button" autoFocus>Cancel</button>
      </section>
    </div>
  )
}

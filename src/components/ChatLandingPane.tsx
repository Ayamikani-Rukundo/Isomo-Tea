import { MessageCircle, Plus } from 'lucide-react'

type ChatLandingPaneProps = {
  communityName: string
  onOpenSupportCircle: () => void
  onNewChat: () => void
}

export function ChatLandingPane({ communityName, onOpenSupportCircle, onNewChat }: ChatLandingPaneProps) {
  return (
    <main className="chat-main chat-unselected" aria-label="No conversation selected">
      <section className="chat-unselected-card">
        <span className="chat-unselected-icon"><MessageCircle size={25} /></span>
        <h1>You don’t have to carry it alone.</h1>
        <p>Share with {communityName}, or reach out one-to-one. Start with as much or as little as you like.</p>
        <div className="chat-unselected-actions">
          <button className="chat-unselected-secondary" onClick={onOpenSupportCircle} type="button">Open {communityName}</button>
          <button className="primary-button" onClick={onNewChat} type="button"><Plus size={15} /> Talk one-to-one</button>
        </div>
      </section>
    </main>
  )
}

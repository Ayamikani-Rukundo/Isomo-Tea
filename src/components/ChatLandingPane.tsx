import { MessageCircle, Plus } from 'lucide-react'

type ChatLandingPaneProps = {
  communityName: string
  onOpenDeltaTea: () => void
  onNewChat: () => void
}

export function ChatLandingPane({ communityName, onOpenDeltaTea, onNewChat }: ChatLandingPaneProps) {
  return (
    <main className="chat-main chat-unselected" aria-label="No conversation selected">
      <section className="chat-unselected-card">
        <span className="chat-unselected-icon"><MessageCircle size={25} /></span>
        <h1>Choose a conversation</h1>
        <p>Select {communityName} or a private chat from Messages, or start a new conversation.</p>
        <div className="chat-unselected-actions">
          <button className="chat-unselected-secondary" onClick={onOpenDeltaTea} type="button">Open {communityName}</button>
          <button className="primary-button" onClick={onNewChat} type="button"><Plus size={15} /> New conversation</button>
        </div>
      </section>
    </main>
  )
}

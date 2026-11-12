import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type SetStateAction, type TouchEvent } from 'react'
import {
  ArrowDown, ArrowLeft, BarChart3, Bell, Check, ChevronDown, Circle, Eye, MessageSquare,
  ImagePlus, Laugh, MessageCircle, Mic, Paperclip, Pause, Pencil, Play, Plus, Search, Send,
  Smile, Sparkles, Square, Sticker, Trash2, Users, X,
} from 'lucide-react'
import EmojiPicker from 'emoji-picker-react'
import { StickerArtwork } from './StickerArtwork'
import type { CommunityMember, DemoMessage, MentionNotification, MessagePoll } from '../types'
import type { MessageMedia } from '../types'
import { MAX_MEDIA_BYTES, MAX_OUTBOX_BYTES, MediaAccessError, normalizeMediaType } from '../lib/media'
import { getStickerOption, isIllustratedSticker, isImageSticker, stickerOptions } from '../lib/stickers'
import {
  usernameMentionPattern,
  usernameMentionQueryPattern,
  usernameMentionTokenPattern,
} from '../lib/usernames'

const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏']

function readChatDraft(key: string) {
  try {
    return localStorage.getItem(key) ?? ''
  } catch (error) {
    console.error('Could not restore the conversation draft.', error)
    return ''
  }
}

type DisplayMessage = {
  message: DemoMessage
  imageGroup?: Array<DemoMessage & { media: MessageMedia & { kind: 'image' } }>
  sourceIndex: number
}

function groupImageMessages(messages: DemoMessage[]): DisplayMessage[] {
  const groupedIds = new Set<string>()
  const displayMessages: DisplayMessage[] = []
  messages.forEach((message, sourceIndex) => {
    if (groupedIds.has(message.id)) return
    const imageGroup = message.mediaGroupId && message.media?.kind === 'image'
      ? messages.filter((candidate): candidate is DemoMessage & { media: MessageMedia & { kind: 'image' } } => (
        candidate.mediaGroupId === message.mediaGroupId
        && candidate.media?.kind === 'image'
        && candidate.authorId === message.authorId
        && candidate.replyToId === message.replyToId
      ))
      : []
    if (imageGroup.length > 1) {
      imageGroup.forEach((item) => groupedIds.add(item.id))
      displayMessages.push({ message, imageGroup, sourceIndex })
    } else {
      displayMessages.push({ message, sourceIndex })
    }
  })
  return displayMessages
}

function renderMessageBody(body: string, memberUsernames: Set<string>) {
  return body.split(usernameMentionPattern).map((part, index) => {
    const mention = part.match(usernameMentionTokenPattern)
    const username = mention?.[1] ?? mention?.[2]
    return username && memberUsernames.has(username.toLowerCase())
      ? <span className="message-mention" key={`${index}-${part}`}>{part}</span>
      : part
  })
}

function messageAuthorStyle(identity: string): CSSProperties {
  let hash = 2166136261
  for (const character of identity) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  const color = hash >>> 0
  return {
    '--message-author-hue': color % 360,
    '--message-author-saturation': `${62 + ((color >>> 9) % 24)}%`,
    '--message-author-dark-lightness': `${63 + ((color >>> 15) % 12)}%`,
    '--message-author-light-lightness': `${34 + ((color >>> 20) % 12)}%`,
  } as CSSProperties
}

type ChatViewProps = {
  kind: 'tea' | 'inbox'
  messages: DemoMessage[]
  onSend: (text: string, replyToId?: string) => void
  onReplyInbox: (author: string, authorId?: string) => void
  onOpenMembers: () => void
  onOpenChatList?: () => void
  onBack?: () => void
  privateName?: string
  communityName?: string
  communityAvatarUrl?: string
  liveMessages?: boolean
  loadingMessages?: boolean
  canSend?: boolean
  onToggleReaction?: (messageId: string, emoji: string) => void
  onEditMessage?: (messageId: string, text: string) => Promise<boolean>
  onDeleteMessageForMe?: (messageId: string) => Promise<boolean>
  onDeleteMessageForEveryone?: (messageId: string) => Promise<boolean>
  chatError?: string
  hasMoreMessages?: boolean
  loadingEarlier?: boolean
  onLoadEarlier?: () => Promise<void>
  onRetryMessage?: (messageId: string) => void
  onSendMedia?: (file: File, viewOnce: boolean, replyToId?: string, mediaGroupId?: string) => void
  onOpenMedia?: (messageId: string) => Promise<Blob>
  onDiscardMedia?: (messageId: string) => void
  onCreatePoll?: (question: string, options: string[], replyToId?: string) => Promise<boolean>
  onVotePoll?: (messageId: string, optionId: string) => Promise<boolean>
  onSendSticker?: (stickerCode: string, replyToId?: string) => Promise<boolean>
  mentionMembers?: CommunityMember[]
  currentUserId?: string
  mentions?: MentionNotification[]
  onMarkMentionsRead?: () => Promise<void>
  theme?: 'dark' | 'light'
  nativeMobileExperience?: boolean
}

function formatDuration(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`
}

function AudioMessage({
  src,
  avatarUrl,
  initials,
  autoPlay = false,
  viewOnce = false,
}: {
  src: string
  avatarUrl?: string | null
  initials?: string
  autoPlay?: boolean
  viewOnce?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [waveform, setWaveform] = useState<number[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [finished, setFinished] = useState(false)
  const [waveformUnavailable, setWaveformUnavailable] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!autoPlay || !audioRef.current) return
    void audioRef.current.play().catch((playError: unknown) => {
      console.error('Audio playback could not start.', playError)
      setError('Tap play to start this voice message.')
    })
  }, [autoPlay, src])

  useEffect(() => {
    let active = true
    let context: AudioContext | null = null
    async function decodeWaveform() {
      if (typeof window.AudioContext === 'undefined') {
        setWaveformUnavailable(true)
        return
      }
      try {
        context = new window.AudioContext()
        const response = await fetch(src, { cache: 'no-store' })
        if (!response.ok) throw new Error('Audio waveform could not be loaded.')
        const buffer = await context.decodeAudioData(await response.arrayBuffer())
        const channelData = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
        const bars = 48
        const peaks = Array.from({ length: bars }, (_, barIndex) => {
          const start = Math.floor((barIndex / bars) * buffer.length)
          const end = Math.max(start + 1, Math.floor(((barIndex + 1) / bars) * buffer.length))
          let peak = 0
          for (const channel of channelData) {
            for (let sample = start; sample < Math.min(end, channel.length); sample += 1) {
              peak = Math.max(peak, Math.abs(channel[sample]))
            }
          }
          return Math.max(.08, Math.min(1, peak))
        })
        if (active) {
          setWaveform(peaks)
          setWaveformUnavailable(false)
        }
      } catch (waveformError) {
        console.warn('Audio waveform decoding is unavailable; native playback remains enabled.', waveformError)
        if (active) setWaveformUnavailable(true)
      } finally {
        if (context && context.state !== 'closed') void context.close()
      }
    }
    void decodeWaveform()
    return () => { active = false }
  }, [src])

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio || (viewOnce && finished)) return
    setError('')
    if (audio.paused) {
      try {
        await audio.play()
      } catch (playError) {
        console.error('Audio playback could not start.', playError)
        setError('Audio playback could not start.')
      }
    } else {
      audio.pause()
    }
  }

  function seek(value: number) {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(value)) return
    audio.currentTime = value
    setCurrentTime(value)
  }

  return (
    <div className="audio-message">
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          if (viewOnce) setFinished(true)
        }}
        onError={() => setError('This audio could not be played on this device.')}
      />
      <span className="audio-message-avatar">{avatarUrl
        ? <img src={avatarUrl} alt="" />
        : initials?.slice(0, 2) || <Mic size={15} />}</span>
      <button className="audio-play-button" onClick={() => { void togglePlayback() }} type="button" aria-label={playing ? 'Pause voice message' : 'Play voice message'} disabled={viewOnce && finished}>
        {playing ? <Pause size={17} /> : <Play size={17} />}
      </button>
      <div className="audio-message-track">
        {!waveformUnavailable && waveform.length > 0
          ? <div className="audio-waveform" aria-hidden="true">
              {waveform.map((peak, index) => <i
                className={duration > 0 && index / waveform.length <= currentTime / duration ? 'played' : ''}
                key={index}
                style={{ height: `${Math.max(3, Math.round(peak * 24))}px` }}
              />)}
            </div>
          : <div className="audio-waveform-unavailable" aria-hidden="true" />}
        <input
          className="audio-seek"
          type="range"
          min={0}
          max={duration || 1}
          step={0.05}
          value={Math.min(currentTime, duration || currentTime)}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Seek voice message"
          disabled={viewOnce}
        />
        <small>{formatDuration(currentTime)} / {formatDuration(duration)}</small>
      </div>
      {error && <span className="audio-error" role="alert">{error}</span>}
    </div>
  )
}

function VideoMessage({ src, viewOnce }: { src: string; viewOnce: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [finished, setFinished] = useState(false)

  async function togglePlayback() {
    const video = videoRef.current
    if (!video || finished) return
    if (video.paused) {
      try {
        await video.play()
      } catch (playError) {
        console.error('Video playback could not start.', playError)
      }
    } else {
      video.pause()
    }
  }

  return (
    <div className={`video-message ${viewOnce ? 'video-message-once' : ''}`}>
      <video
        ref={videoRef}
        controls={!viewOnce}
        playsInline
        preload="none"
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          if (viewOnce) setFinished(true)
        }}
      >Video playback is not supported.</video>
      {viewOnce && <button
        className="video-once-toggle"
        onClick={() => { void togglePlayback() }}
        type="button"
        aria-label={finished ? 'View-once video finished' : playing ? 'Pause view-once video' : 'Play view-once video'}
        disabled={finished}
      >{finished ? <Eye size={16} /> : playing ? <Pause size={16} /> : <Play size={16} />}</button>}
    </div>
  )
}

function MessageFooter({
  message,
  liveMessages,
  onRetry,
}: {
  message: DemoMessage
  liveMessages: boolean
  onRetry?: (messageId: string) => void
}) {
  const deliveryStatus = message.deliveryStatus ?? 'sent'
  const statusLabel = !liveMessages
    ? 'Preview only; not delivered'
    : deliveryStatus === 'sending' ? 'Sending'
      : deliveryStatus === 'failed' ? 'Not sent'
        : deliveryStatus === 'read' ? 'Read'
          : 'Sent'
  const checkmark = !liveMessages
    ? '◌'
    : deliveryStatus === 'sending' ? '◷'
      : deliveryStatus === 'failed' ? '!'
        : deliveryStatus === 'read' ? '✓✓'
          : '✓'

  return (
    <span className="message-footer">
      {message.updatedAt && message.createdAt && message.updatedAt !== message.createdAt && <small className="message-edited">edited</small>}
      <time>{message.time}</time>
      {message.mine && <span
        className={`message-ticks ${liveMessages ? deliveryStatus : 'preview'}`}
        aria-label={statusLabel}
        title={statusLabel}
      >{checkmark}</span>}
      {message.mine && liveMessages && deliveryStatus === 'failed' && onRetry && <button
        className="message-retry"
        onClick={() => onRetry(message.id)}
        type="button"
      >Retry</button>}
    </span>
  )
}

function PollCard({
  poll,
  messageId,
  onVote,
}: {
  poll: MessagePoll
  messageId: string
  onVote?: (messageId: string, optionId: string) => Promise<boolean>
}) {
  const [now, setNow] = useState(0)
  const [votingOption, setVotingOption] = useState<string | null>(null)
  const [voteError, setVoteError] = useState('')
  const totalVotes = poll.options.reduce((total, option) => total + option.votes, 0)
  const closed = Boolean(poll.closesAt && now > 0 && Date.parse(poll.closesAt) <= now)

  async function vote(optionId: string) {
    if (!onVote || closed || votingOption) return
    setVotingOption(optionId)
    setVoteError('')
    try {
      if (!await onVote(messageId, optionId)) setVoteError('Your vote could not be saved. Try again.')
    } catch (error) {
      console.error('Could not save poll vote.', error)
      setVoteError('Your vote could not be saved. Try again.')
    } finally {
      setVotingOption(null)
    }
  }

  useEffect(() => {
    const firstUpdate = window.setTimeout(() => setNow(Date.now()), 0)
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      window.clearTimeout(firstUpdate)
      window.clearInterval(timer)
    }
  }, [])
  return (
    <div className="poll-card">
      <strong>{poll.question}</strong>
      {poll.options.map((option) => {
        const percentage = totalVotes ? Math.round((option.votes / totalVotes) * 100) : 0
        const selected = poll.myVote === option.id
        return (
          <button
            className={`poll-option ${selected ? 'selected' : ''}`}
            key={option.id}
            onClick={() => { void vote(option.id) }}
            type="button"
            disabled={closed || !onVote || Boolean(votingOption)}
            aria-pressed={selected}
          >
            <span className="poll-option-label">{option.label}</span>
            <span className="poll-option-results"><i style={{ width: `${percentage}%` }} /><small>{option.votes} · {percentage}%</small></span>
          </button>
        )
      })}
      <small>{totalVotes} vote{totalVotes === 1 ? '' : 's'}{closed ? ' · closed' : poll.myVote ? ' · your vote is recorded' : ' · choose one option'}</small>
      {voteError && <small className="poll-vote-error" role="alert">{voteError}</small>}
    </div>
  )
}

function MediaAttachment({
  messageId,
  media,
  mine,
  deliveryStatus,
  uploadProgress,
  onOpen,
  onDiscard,
  onRetry,
  groupedImage = false,
  avatarUrl,
  initials,
}: {
  messageId: string
  media: MessageMedia
  mine?: boolean
  deliveryStatus?: DemoMessage['deliveryStatus']
  uploadProgress?: number
  onOpen?: (messageId: string) => Promise<Blob>
  onDiscard?: (messageId: string) => void
  onRetry?: (messageId: string) => void
  groupedImage?: boolean
  avatarUrl?: string | null
  initials?: string
}) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [consumed, setConsumed] = useState(false)
  const [playWhenOpened, setPlayWhenOpened] = useState(false)

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])

  const open = useCallback(async () => {
    if (!onOpen || loading || (media.viewOnce && (mine || consumed))) return
    setLoading(true)
    setError('')
    try {
      const blob = await onOpen(messageId)
      setUrl(URL.createObjectURL(blob))
      if (media.viewOnce) setConsumed(true)
    } catch (mediaError) {
      if (media.viewOnce && mediaError instanceof MediaAccessError && mediaError.status === 410) {
        setConsumed(true)
        setError('Viewed or expired')
      } else {
        setError(mediaError instanceof Error ? mediaError.message : 'Media could not be opened.')
      }
    } finally {
      setLoading(false)
    }
  }, [consumed, loading, media.viewOnce, messageId, mine, onOpen])

  useEffect(() => {
    if (
      media.kind !== 'image'
      || media.viewOnce
      || !onOpen
      || url
      || loading
      || error
      || deliveryStatus === 'sending'
      || deliveryStatus === 'failed'
    ) return undefined
    const timer = window.setTimeout(() => { void open() }, 0)
    return () => window.clearTimeout(timer)
  }, [deliveryStatus, error, loading, media.kind, media.viewOnce, onOpen, open, url])

  return (
    <div className={`media-attachment ${media.kind === 'image' ? 'image-media' : ''} ${groupedImage ? 'grouped-image-tile' : ''} ${media.kind}-media`}>
      {url ? <>
        {media.viewOnce && <span className="media-once-badge">Once</span>}
        {media.kind === 'image' && <img className="attached-image" src={url} alt="Shared image" />}
        {media.kind === 'audio' && <AudioMessage src={url} avatarUrl={avatarUrl} initials={initials} autoPlay={playWhenOpened} viewOnce={media.viewOnce} />}
        {media.kind === 'video' && <VideoMessage src={url} viewOnce={media.viewOnce} />}
        {media.viewOnce && <button className="media-close" onClick={() => { setUrl(''); setPlayWhenOpened(false) }} type="button">Close</button>}
      </> : deliveryStatus === 'sending' ? (
        <div className="media-transfer" role="status">
          <span>{uploadProgress === undefined ? 'Uploading media…' : `Uploading ${uploadProgress}%`}</span>
          <progress max={100} value={uploadProgress ?? 0} />
        </div>
      ) : deliveryStatus === 'failed' ? (
        <>
          <span className="media-transfer-error">{media.viewOnce
            ? 'View-once upload failed. Retry before leaving; the file is not saved locally.'
            : 'Upload failed.'}</span>
          <button className="media-close" onClick={() => onRetry?.(messageId)} type="button">Retry</button>
          <button className="media-close" onClick={() => onDiscard?.(messageId)} type="button">Discard</button>
        </>
      ) : media.kind === 'image' && media.viewOnce ? (
        <button className="media-once-image" onClick={() => { void open() }} type="button" disabled={loading || mine || consumed}>
          <span className="media-once-badge">{consumed ? error || 'Viewed once' : 'Once'}</span>
          {!mine && !consumed && <span className="media-once-open-label">{loading ? 'Opening…' : 'Open image once'}</span>}
          {mine && <span className="media-once-open-label">Image sent · once</span>}
        </button>
      ) : media.kind === 'audio' ? (
        <div className="audio-message-preview">
          {media.viewOnce && <span className="media-once-badge">{consumed ? 'Viewed once' : 'Once'}</span>}
          <button
            className="audio-preview-play"
            onClick={() => {
              if (!media.viewOnce || (!mine && !consumed)) setPlayWhenOpened(true)
              void open()
            }}
            type="button"
            aria-label={media.viewOnce ? 'Play once audio message' : 'Play audio message'}
            disabled={loading || Boolean(media.viewOnce && (mine || consumed))}
          >{loading ? <Circle size={18} /> : consumed ? <Eye size={18} /> : <Play size={18} />}</button>
          <div className="audio-preview-waveform" aria-hidden="true">
            {Array.from({ length: 28 }, (_, index) => <i key={index} style={{ height: `${5 + ((index * 17) % 14)}px` }} />)}
          </div>
          <small>{consumed ? 'Viewed' : '0:00'}</small>
        </div>
      ) : media.kind === 'image' ? (
        error
          ? <button className="media-image-retry" onClick={() => { void open() }} type="button" disabled={loading}>Retry image</button>
          : <div className="media-image-loading" role="status"><ImagePlus size={20} /></div>
      ) : media.kind === 'video' ? (
        <button className="media-open" onClick={() => { void open() }} type="button" disabled={loading || Boolean(media.viewOnce && (mine || consumed))}>
          <Eye size={15} /> {loading ? 'Opening…' : media.viewOnce ? 'Open once' : 'Play video'}
        </button>
      ) : (
        <span className="media-once-badge">{error || 'Image unavailable'}</span>
      )}
      {error && !consumed && <span className="media-transfer-error" role="alert">{error}</span>}
    </div>
  )
}

export function ChatView({
  kind,
  messages,
  onSend,
  onReplyInbox,
  onOpenMembers,
  onOpenChatList,
  onBack,
  privateName = 'moonlit.mango',
  communityName = 'Delta Tea',
  communityAvatarUrl = '/delta-tea-avatar.png',
  liveMessages = false,
  loadingMessages = false,
  canSend = true,
  onToggleReaction,
  onEditMessage,
  onDeleteMessageForMe,
  onDeleteMessageForEveryone,
  chatError = '',
  hasMoreMessages = false,
  loadingEarlier = false,
  onLoadEarlier,
  onRetryMessage,
  onSendMedia,
  onOpenMedia,
  onDiscardMedia,
  onCreatePoll,
  onVotePoll,
  onSendSticker,
  mentionMembers = [],
  currentUserId,
  mentions = [],
  onMarkMentionsRead,
  theme = 'dark',
  nativeMobileExperience = false,
}: ChatViewProps) {
  const draftStorageKey = `isomo-chat-draft:${currentUserId ?? 'anonymous'}:${kind}:${kind === 'tea' ? 'general' : privateName}`
  const [storedDraft, setStoredDraft] = useState(() => ({
    key: draftStorageKey,
    value: readChatDraft(draftStorageKey),
  }))
  const draft = storedDraft.key === draftStorageKey ? storedDraft.value : readChatDraft(draftStorageKey)
  const setDraft = useCallback((next: SetStateAction<string>) => {
    setStoredDraft((current) => {
      const currentValue = current.key === draftStorageKey ? current.value : readChatDraft(draftStorageKey)
      const value = typeof next === 'function' ? next(currentValue) : next
      try {
        if (value) localStorage.setItem(draftStorageKey, value)
        else localStorage.removeItem(draftStorageKey)
      } catch (error) {
        console.error('Could not save the conversation draft.', error)
      }
      return { key: draftStorageKey, value }
    })
  }, [draftStorageKey])
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [menuOpensDown, setMenuOpensDown] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([])
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ messageIds: string[]; allowEveryone: boolean } | null>(null)
  const [replyingTo, setReplyingTo] = useState<DemoMessage | null>(null)
  const [editingMessage, setEditingMessage] = useState<DemoMessage | null>(null)
  const [notice, setNotice] = useState('')
  const [reactionOverrides, setReactionOverrides] = useState<Record<string, Record<string, boolean>>>({})
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
  const [reactionPickerOpensDown, setReactionPickerOpensDown] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showStickerPicker, setShowStickerPicker] = useState(false)
  const [stickerSearch, setStickerSearch] = useState('')
  const [showPollComposer, setShowPollComposer] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [creatingPoll, setCreatingPoll] = useState(false)
  const [showMentionNotifications, setShowMentionNotifications] = useState(false)
  const [attachments, setAttachments] = useState<Array<{ file: File; url: string }>>([])
  const [viewOnceDraft, setViewOnceDraft] = useState(false)
  const [expandedMediaGroupIds, setExpandedMediaGroupIds] = useState<Set<string>>(new Set())
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingWaveform, setRecordingWaveform] = useState<number[]>(Array.from({ length: 32 }, () => 0))
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerFormRef = useRef<HTMLFormElement>(null)
  const recorderRef = useRef<{
    recorder: MediaRecorder
    stream: MediaStream
    audioContext: AudioContext
    analyser: AnalyserNode
  } | null>(null)
  const recordingFrameRef = useRef<number | null>(null)
  const discardRecordingRef = useRef(false)
  const longPressTimerRef = useRef<number | null>(null)
  const touchStartRef = useRef<{
    x: number
    y: number
    message: DemoMessage
    content: HTMLDivElement | null
    replyTriggered: boolean
  } | null>(null)
  const suppressClickAtRef = useRef(0)
  const isNearBottomRef = useRef(true)
  const replyHighlightTimerRef = useRef<number | null>(null)
  const highlightedReplyRowRef = useRef<HTMLElement | null>(null)
  const replyJumpInProgressRef = useRef(false)
  const conversationKeyRef = useRef(`${kind}:${privateName}`)
  const endRef = useRef<HTMLDivElement>(null)
  const [nativePhoneLayout, setNativePhoneLayout] = useState(
    () => nativeMobileExperience && window.innerWidth <= 850,
  )
  const isTea = kind === 'tea'
  const selectionMode = selectedMessageIds.length > 0
  const newestMessageId = messages[messages.length - 1]?.id
  const todayLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()
  const mentionMatch = draft.match(usernameMentionQueryPattern)
  const mentionQuery = mentionMatch?.[1] ?? mentionMatch?.[2] ?? ''
  const mentionSuggestions = mentionMatch
    ? mentionMembers
      .filter((member) => member.id !== currentUserId && member.username.toLowerCase().startsWith(mentionQuery.toLowerCase()))
      .slice(0, 6)
    : []

  useEffect(() => {
    const updateNativePhoneLayout = () => {
      setNativePhoneLayout(nativeMobileExperience && window.innerWidth <= 850)
    }
    updateNativePhoneLayout()
    window.addEventListener('resize', updateNativePhoneLayout)
    return () => window.removeEventListener('resize', updateNativePhoneLayout)
  }, [nativeMobileExperience])
  const unreadMentions = mentions.filter((mention) => !mention.readAt).length
  const memberUsernames = new Set(mentionMembers.map((member) => member.username.toLowerCase()))
  const messagesRef = useRef(messages)
  const paginationRef = useRef({ hasMoreMessages, loadingEarlier, onLoadEarlier })
  const visibleStickerOptions = stickerOptions.filter((sticker) => (
    `${sticker.label} ${sticker.code}`.toLowerCase().includes(stickerSearch.trim().toLowerCase())
  ))
  const displayMessages = groupImageMessages(messages)

  useEffect(() => {
    messagesRef.current = messages
    paginationRef.current = { hasMoreMessages, loadingEarlier, onLoadEarlier }
  }, [hasMoreMessages, loadingEarlier, messages, onLoadEarlier])

  useEffect(() => {
    conversationKeyRef.current = `${kind}:${privateName}`
  }, [kind, privateName])

  useEffect(() => {
    if (isNearBottomRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      setShowScrollToBottom(false)
    } else {
      setShowScrollToBottom(true)
    }
  }, [newestMessageId])

  function jumpToLatest() {
    isNearBottomRef.current = true
    setShowScrollToBottom(false)
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  function findMessageRow(messageId: string) {
    return Array.from(document.querySelectorAll<HTMLElement>('.conversation-scroll .message-row[data-message-ids]'))
      .find((row) => row.dataset.messageIds?.split(' ').includes(messageId))
  }

  function highlightReplyTarget(messageId: string) {
    const target = findMessageRow(messageId)
    if (!target) return
    highlightedReplyRowRef.current?.classList.remove('message-jump-highlight')
    if (replyHighlightTimerRef.current !== null) window.clearTimeout(replyHighlightTimerRef.current)
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.add('message-jump-highlight')
    highlightedReplyRowRef.current = target
    replyHighlightTimerRef.current = window.setTimeout(() => {
      target.classList.remove('message-jump-highlight')
      if (highlightedReplyRowRef.current === target) highlightedReplyRowRef.current = null
      replyHighlightTimerRef.current = null
    }, 1000)
  }

  async function jumpToReply(messageId: string) {
    if (replyJumpInProgressRef.current) return
    replyJumpInProgressRef.current = true
    const conversationKey = conversationKeyRef.current
    setNotice('')
    try {
      let target = findMessageRow(messageId)
      while (!target && paginationRef.current.hasMoreMessages && paginationRef.current.onLoadEarlier) {
        if (paginationRef.current.loadingEarlier) {
          setNotice('Wait for earlier messages to finish loading, then tap the reply again.')
          return
        }
        const previousCount = messagesRef.current.length
        try {
          await paginationRef.current.onLoadEarlier()
          await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
          })
        } catch (error) {
          console.error('Could not load messages for a reply jump.', error)
          setNotice('Older messages could not be loaded.')
          return
        }
        if (conversationKeyRef.current !== conversationKey) return
        target = findMessageRow(messageId)
        if (!target && messagesRef.current.length === previousCount) break
      }
      if (!target) {
        setNotice('That original message is not available in this conversation.')
        return
      }
      highlightReplyTarget(messageId)
    } finally {
      replyJumpInProgressRef.current = false
    }
  }

  useEffect(() => {
    if (!recording) return undefined
    const timer = window.setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000)
    return () => window.clearInterval(timer)
  }, [recording])

  useEffect(() => {
    function closeTransientMenus(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.message-delete-overlay, .message-action-popover, .message-menu, .message-more, .message-quick-reactions, .reaction-picker, .emoji-picker, .sticker-picker, .mention-notifications, .mention-bell, .poll-composer, .composer-popover-trigger')) return
      setMenuFor(null)
      setReactionPickerFor(null)
      setShowEmojiPicker(false)
      setShowStickerPicker(false)
      setShowPollComposer(false)
      setShowMentionNotifications(false)
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setMenuFor(null)
      setReactionPickerFor(null)
      setShowEmojiPicker(false)
      setShowStickerPicker(false)
      setShowPollComposer(false)
      setShowMentionNotifications(false)
      setSelectedMessageIds([])
      setStickerSearch('')
      setDeleteConfirmation(null)
    }
    document.addEventListener('pointerdown', closeTransientMenus)
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', closeTransientMenus)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => () => {
    const active = recorderRef.current
    discardRecordingRef.current = true
    if (recordingFrameRef.current !== null) cancelAnimationFrame(recordingFrameRef.current)
    if (active) {
      if (active.recorder.state !== 'inactive') active.recorder.stop()
      active.stream.getTracks().forEach((track) => track.stop())
      void active.audioContext.close()
    }
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
    if (replyHighlightTimerRef.current !== null) window.clearTimeout(replyHighlightTimerRef.current)
    highlightedReplyRowRef.current?.classList.remove('message-jump-highlight')
  }, [])

  useEffect(() => () => {
    attachments.forEach((attachment) => URL.revokeObjectURL(attachment.url))
  }, [attachments])

  function chooseAttachments(files: File[]) {
    if (!files.length) return
    const mimeTypes = files.map((file) => normalizeMediaType(file))
    if (mimeTypes.some((mimeType) => !mimeType)) {
      setNotice('Choose a supported image, audio, or video file.')
      return
    }
    if (files.some((file) => file.size < 1 || file.size > MAX_MEDIA_BYTES)) {
      setNotice('Media must be smaller than 20 MB.')
      return
    }
    if (files.length > 1 && (files.length > 30 || mimeTypes.some((mimeType) => !mimeType?.startsWith('image/')))) {
      setNotice('Select up to 30 images together, or choose one audio or video file.')
      return
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_OUTBOX_BYTES) {
      setNotice('A media selection must be no larger than 50 MB in total.')
      return
    }
    setAttachments(files.map((file) => ({ file, url: URL.createObjectURL(file) })))
    setViewOnceDraft(false)
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof window.AudioContext === 'undefined') {
      setNotice('Voice recording and waveform support are not available in this browser or device.')
      return
    }
    let stream: MediaStream | null = null
    let audioContext: AudioContext | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioContext = new window.AudioContext()
      if (audioContext.state === 'suspended') await audioContext.resume()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      audioContext.createMediaStreamSource(stream).connect(analyser)
      const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = preferredType
        ? new MediaRecorder(stream, { mimeType: preferredType })
        : new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onstop = () => {
        stream?.getTracks().forEach((track) => track.stop())
        if (recordingFrameRef.current !== null) cancelAnimationFrame(recordingFrameRef.current)
        if (audioContext && audioContext.state !== 'closed') void audioContext.close()
        recorderRef.current = null
        setRecording(false)
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false
          return
        }
        const mimeType = recorder.mimeType || 'audio/webm'
        const file = new File(chunks, `voice-message.${mimeType.includes('mp4') ? 'm4a' : 'webm'}`, { type: mimeType })
        chooseAttachments([file])
      }
      recorderRef.current = { recorder, stream, audioContext, analyser }
      setRecordingSeconds(0)
      setRecordingWaveform(Array.from({ length: 32 }, () => 0))
      recorder.start()
      setRecording(true)
      const timeData = new Uint8Array(analyser.fftSize)
      let lastPaint = 0
      const sample = (now: number) => {
        const active = recorderRef.current
        if (!active || active.recorder.state === 'inactive') return
        if (now - lastPaint > 90) {
          active.analyser.getByteTimeDomainData(timeData)
          const bars = Array.from({ length: 32 }, (_, index) => {
            const start = Math.floor(index * timeData.length / 32)
            const end = Math.max(start + 1, Math.floor((index + 1) * timeData.length / 32))
            let peak = 0
            for (let point = start; point < end; point += 1) {
              peak = Math.max(peak, Math.abs(timeData[point] - 128) / 128)
            }
            return Math.max(.08, Math.min(1, peak))
          })
          setRecordingWaveform(bars)
          lastPaint = now
        }
        recordingFrameRef.current = requestAnimationFrame(sample)
      }
      recordingFrameRef.current = requestAnimationFrame(sample)
    } catch (recordingError) {
      stream?.getTracks().forEach((track) => track.stop())
      if (audioContext && audioContext.state !== 'closed') void audioContext.close()
      recorderRef.current = null
      console.error('Could not start voice recording.', recordingError)
      setNotice('Microphone access was denied or unavailable.')
    }
  }

  function stopRecording() {
    const active = recorderRef.current
    if (active && active.recorder.state !== 'inactive') active.recorder.stop()
  }

  function cancelRecording() {
    if (!recorderRef.current) {
      discardRecordingRef.current = false
      return
    }
    discardRecordingRef.current = true
    stopRecording()
  }

  function toggleSelectedMessages(messageIds: string[]) {
    setSelectedMessageIds((current) => {
      const allSelected = messageIds.every((id) => current.includes(id))
      return allSelected
        ? current.filter((id) => !messageIds.includes(id))
        : [...new Set([...current, ...messageIds])]
    })
  }

  function onMessageTouchStart(event: TouchEvent<HTMLElement>, message: DemoMessage, messageIds: string[]) {
    if (selectionMode || event.touches.length !== 1) return
    const target = event.target
    if (target instanceof Element && target.closest('button, input, audio, video, a')) return
    const touch = event.touches[0]
    const previous = touchStartRef.current
    if (previous?.content) {
      previous.content.classList.remove('reply-swiping')
      previous.content.style.removeProperty('transform')
    }
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      message,
      content: event.currentTarget.querySelector<HTMLDivElement>('.message-content'),
      replyTriggered: false,
    }
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = window.setTimeout(() => {
      setSelectedMessageIds(messageIds)
      setMenuFor(null)
      suppressClickAtRef.current = Date.now()
    }, 520)
  }

  function onMessageTouchMove(event: TouchEvent<HTMLElement>) {
    const start = touchStartRef.current
    if (!start || !event.touches.length) return
    const touch = event.touches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) > 12 || Math.abs(deltaY) > 12) {
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    if (Math.abs(deltaY) > 20 && Math.abs(deltaY) > Math.abs(deltaX)) {
      if (start.content) {
        start.content.classList.remove('reply-swiping')
        start.content.style.removeProperty('transform')
      }
      touchStartRef.current = null
      return
    }
    const swipeDirectionMatches = start.message.mine ? deltaX < 0 : deltaX > 0
    if (nativePhoneLayout && swipeDirectionMatches && Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1) {
      start.content?.classList.add('reply-swiping')
      start.content?.style.setProperty('transform', `translateX(${Math.max(-92, Math.min(92, deltaX))}px)`)
    }
    const replySwipe = start.message.mine ? deltaX < -72 : deltaX > 72
    if (replySwipe && !start.replyTriggered && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
      start.replyTriggered = true
      setReplyingTo(start.message)
      setEditingMessage(null)
      suppressClickAtRef.current = Date.now()
    }
  }

  function onMessageTouchEnd() {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
    const start = touchStartRef.current
    if (start?.content) {
      start.content.classList.remove('reply-swiping')
      start.content.style.removeProperty('transform')
    }
    touchStartRef.current = null
  }

  function requestDeleteMessages(messageIds: string[], allowEveryone: boolean) {
    setDeleteConfirmation({ messageIds, allowEveryone })
    setMenuFor(null)
  }

  async function confirmDeleteMessages(everyone: boolean) {
    if (!deleteConfirmation) return
    const { messageIds } = deleteConfirmation
    const deleteAction = everyone ? onDeleteMessageForEveryone : onDeleteMessageForMe
    setDeleteConfirmation(null)
    if (!deleteAction) return
    const results = await Promise.allSettled(messageIds.map((messageId) => deleteAction(messageId)))
    const removed = results.filter((result) => result.status === 'fulfilled' && result.value).length
    results.filter((result) => result.status === 'rejected').forEach((result) => {
      if (result.status === 'rejected') console.error('Could not delete selected message.', result.reason)
    })
    setSelectedMessageIds([])
    if (removed === messageIds.length) {
      setNotice(everyone
        ? `${removed} message${removed === 1 ? '' : 's'} deleted for everyone.`
        : `${removed} message${removed === 1 ? '' : 's'} hidden from your view.`)
    } else {
      setNotice(`${removed} of ${messageIds.length} messages were deleted. Some could not be changed; try again.`)
    }
  }

  const selectedMessages = messages.filter((message) => selectedMessageIds.includes(message.id))
  const everyoneCanDeleteSelection = selectedMessages.length > 0
    && selectedMessages.every((message) => message.mine && !message.deletedAt)

  function submitAttachment() {
    if (!attachments.length || !onSendMedia || !liveMessages || !canSend) return
    const mediaGroupId = attachments.length > 1 ? crypto.randomUUID() : undefined
    attachments.forEach(({ file }) => onSendMedia(file, viewOnceDraft, replyingTo?.id, mediaGroupId))
    setAttachments([])
    setReplyingTo(null)
    setViewOnceDraft(false)
  }

  function insertMention(username: string) {
    const atIndex = draft.lastIndexOf('@')
    if (atIndex < 0) return
    const formattedUsername = username.includes(' ') ? `"${username}"` : username
    setDraft(`${draft.slice(0, atIndex)}@${formattedUsername} `)
  }

  async function submitPoll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creatingPoll || !online || !onCreatePoll) return
    const options = pollOptions.map((option) => option.trim()).filter(Boolean)
    if (options.length < 2) {
      setNotice('A poll needs at least two options.')
      return
    }
    setCreatingPoll(true)
    try {
      const created = await onCreatePoll(pollQuestion, options, replyingTo?.id)
      if (!created) {
        setNotice('The poll could not be created. Please try again.')
        return
      }
      setShowPollComposer(false)
      setPollQuestion('')
      setPollOptions(['', ''])
      setReplyingTo(null)
    } catch (error) {
      console.error('Could not create poll', error)
      setNotice('The poll could not be created. Please try again.')
    } finally {
      setCreatingPoll(false)
    }
  }

  async function chooseSticker(stickerCode: string) {
    if (creatingPoll) return
    if (!online || !canSend || !liveMessages || !onSendSticker) {
      setNotice('Stickers need a signed-in conversation.')
      return
    }
    setCreatingPoll(true)
    try {
      const sent = await onSendSticker(stickerCode, replyingTo?.id)
      if (sent) {
        setShowStickerPicker(false)
        setStickerSearch('')
        setReplyingTo(null)
      } else setNotice('The sticker could not be sent. Please try again.')
    } catch (error) {
      console.error('Could not send sticker', error)
      setNotice('The sticker could not be sent. Please try again.')
    } finally {
      setCreatingPoll(false)
    }
  }

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 2600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  function toggleReaction(messageId: string, reaction: string) {
    const baseSelection = Boolean(messages
      .find((message) => message.id === messageId)
      ?.reactions?.find((item) => item.emoji === reaction)?.reactedByMe)
    setReactionOverrides((current) => {
      const currentSelection = current[messageId]?.[reaction] ?? baseSelection
      return {
        ...current,
        [messageId]: {
          ...current[messageId],
          [reaction]: !currentSelection,
        },
      }
    })
  }

  function openReactionPicker(messageId: string, source?: HTMLElement) {
    const messageRow = source?.closest<HTMLElement>('.message-row')
      ?? Array.from(document.querySelectorAll<HTMLElement>('.message-row[data-message-id]'))
        .find((row) => row.dataset.messageId === messageId)
    const scrollBounds = messageRow?.closest('.conversation-scroll')?.getBoundingClientRect()
    const rowBounds = messageRow?.getBoundingClientRect()
    const availableAbove = scrollBounds && rowBounds ? rowBounds.top - scrollBounds.top : 0
    const availableBelow = scrollBounds && rowBounds ? scrollBounds.bottom - rowBounds.bottom : 0
    setReactionPickerOpensDown(availableAbove < 380 && availableBelow > availableAbove)
    setReactionPickerFor(messageId)
    setMenuFor(null)
  }

  async function markMentionsRead() {
    if (!onMarkMentionsRead) return
    try {
      await onMarkMentionsRead()
    } catch (error) {
      console.error('Could not mark mentions as read.', error)
      setNotice('Mentions could not be marked as read. Please try again.')
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!online) return
    if (attachments.length) {
      submitAttachment()
      return
    }
    const text = draft.trim()
    if (!text) return
    if (editingMessage && onEditMessage) {
      try {
        const saved = await onEditMessage(editingMessage.id, text)
        if (!saved) return
        setEditingMessage(null)
      } catch (error) {
        console.error('Could not edit message', error)
        setNotice('The message could not be edited. Please try again.')
        return
      }
    } else {
      onSend(text, replyingTo?.id)
      setReplyingTo(null)
    }
    setDraft('')
  }

  return (
    <main className="chat-main">
      <header className="chat-header">
        {!isTea && <button className="icon-button mobile-back" onClick={onBack} type="button" aria-label="Back"><ArrowLeft size={19} /></button>}
        {isTea && onOpenChatList && <button className="icon-button mobile-chat-list" onClick={onOpenChatList} type="button" aria-label="Open chat list"><MessageSquare size={18} /></button>}
        {nativeMobileExperience && <button
          className="icon-button native-mobile-back"
          onClick={isTea ? onOpenChatList : onBack}
          type="button"
          aria-label="Back to chats"
        ><ArrowLeft size={19} /></button>}
        <button className="chat-heading" onClick={isTea ? onOpenMembers : undefined} type="button">
          <span className={`room-avatar ${isTea ? 'room-avatar-tea' : 'avatar-coral'}`}>
            {isTea ? <img src={communityAvatarUrl} alt="" /> : privateName === 'Private Inbox' ? 'PI' : privateName.slice(0, 2).toUpperCase()}
            {isTea && <i className="status-dot online" />}
          </span>
          <span className="heading-copy">
            <strong>{isTea ? communityName : privateName}</strong>
            <small>{isTea ? 'Community conversation' : 'Private conversation'}</small>
          </span>
          {isTea && <ChevronDown size={16} className="heading-chevron" />}
        </button>
        <span className="header-spacer" />
        <button
          className="icon-button mention-bell"
          onClick={() => setShowMentionNotifications((current) => !current)}
          type="button"
          aria-label={`Mention notifications${unreadMentions ? `, ${unreadMentions} unread` : ''}`}
          aria-expanded={showMentionNotifications}
        >
          <Bell size={17} />{unreadMentions > 0 && <span>{unreadMentions}</span>}
        </button>
        {showMentionNotifications && <div className="mention-notifications">
          <div className="mention-notifications-header">
            <strong>Mentions</strong>
            {unreadMentions > 0 && <button onClick={() => { void markMentionsRead() }} type="button">Mark read</button>}
          </div>
          {mentions.length
            ? mentions.map((mention) => <div className={`mention-item ${mention.readAt ? '' : 'unread'}`} key={mention.messageId}>
                <strong>@you · {mention.author}</strong>
                <span>{renderMessageBody(mention.body, memberUsernames)}</span>
              </div>)
            : <small className="mention-empty">No mentions yet.</small>}
        </div>}
        {isTea && (
          <button className="icon-button members-trigger" onClick={onOpenMembers} type="button" aria-label="Open community members">
            <Users size={18} />
          </button>
        )}
      </header>

      <div className="conversation-scroll" onScroll={(event) => {
        const element = event.currentTarget
        const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 96
        isNearBottomRef.current = nearBottom
        setShowScrollToBottom(!nearBottom)
      }}>
        <div className="date-divider"><span />TODAY, {todayLabel}<span /></div>
        {chatError && <p className="chat-error" role="status">{chatError}</p>}
        {hasMoreMessages && <button className="load-earlier-button" onClick={onLoadEarlier} type="button" disabled={loadingEarlier}>
          {loadingEarlier ? 'Loading earlier messages…' : 'Load earlier messages'}
        </button>}
        {loadingMessages && !messages.length && <p className="chat-loading">Loading conversation…</p>}
        <div className={`message-list ${selectionMode ? 'selection-mode' : ''}`} aria-live="polite">
          {displayMessages.map(({ message, imageGroup, sourceIndex }) => {
            if (message.systemEvent === 'username_changed') {
              return <article className="system-message-row" data-message-id={message.id} key={message.id}>
                <span>{renderMessageBody(message.body, memberUsernames)}</span>
                <time>{message.time}</time>
              </article>
            }
            const groupedMediaMessages = imageGroup ?? [message]
            const actionMessageIds = groupedMediaMessages.map((item) => item.id)
            const lastMediaMessage = imageGroup?.[imageGroup.length - 1]
            const mediaGroupCollapsed = Boolean(
              imageGroup
              && imageGroup.length > 4
              && !expandedMediaGroupIds.has(message.mediaGroupId ?? ''),
            )
            const visibleImageGroup = mediaGroupCollapsed ? imageGroup?.slice(0, 4) : imageGroup
            const previousMessage = messages[sourceIndex - 1]
            const sameAuthor = previousMessage
              && (previousMessage.authorId ?? previousMessage.author) === (message.authorId ?? message.author)
            const withinGroupWindow = !previousMessage?.createdAt || !message.createdAt
              || Date.parse(message.createdAt) - Date.parse(previousMessage.createdAt) <= 5 * 60_000
            const grouped = Boolean(previousMessage && sameAuthor && withinGroupWindow)
            const selected = actionMessageIds.some((id) => selectedMessageIds.includes(id))
            const replyTarget = message.replyToId
              ? messages.find((candidate) => candidate.id === message.replyToId)
              : undefined
            const baseReactions = message.reactions ?? []
            const overrides = reactionOverrides[message.id] ?? {}
            const displayReactions = baseReactions
              .map((reaction) => {
                const baseSelected = Boolean(reaction.reactedByMe)
                const reactedByMe = overrides[reaction.emoji] ?? baseSelected
                return {
                  ...reaction,
                  reactedByMe,
                  count: Math.max(0, reaction.count + Number(reactedByMe) - Number(baseSelected)),
                }
              })
              .filter((reaction) => reaction.count > 0)
            const extraReactions = Object.entries(overrides)
              .filter(([emoji, reactedByMe]) => reactedByMe && !baseReactions.some((reaction) => reaction.emoji === emoji))
              .map(([emoji]) => ({ emoji, count: 1, reactedByMe: true }))
            const reactions = [...displayReactions, ...extraReactions]
            const visibleSticker = message.deletedAt ? undefined : message.sticker
            const visiblePoll = message.deletedAt ? undefined : message.poll
            const hasTextBubble = Boolean(
              message.replyToId
              || message.deletedAt
              || (!message.media && !visiblePoll && !visibleSticker && message.body.trim()),
            )
            const sticker = visibleSticker ? getStickerOption(visibleSticker) : undefined
            const hasRichPayload = Boolean(message.media || visiblePoll || sticker)
            const footerOnBubble = hasTextBubble && !hasRichPayload
            return (
              <article
                className={`message-row ${message.mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} ${selected ? 'message-selected' : ''} ${reactions.length ? 'message-has-reactions' : ''} ${menuFor === message.id ? 'menu-open' : ''} ${reactionPickerFor === message.id ? 'reaction-picker-open' : ''}`}
                style={messageAuthorStyle(message.authorId ?? message.author)}
                data-message-id={message.id}
                data-message-ids={actionMessageIds.join(' ')}
                key={message.mediaGroupId && imageGroup ? `media-group-${message.mediaGroupId}` : message.id}
                onTouchStart={(event) => onMessageTouchStart(event, message, actionMessageIds)}
                onTouchMove={onMessageTouchMove}
                onTouchEnd={onMessageTouchEnd}
                onTouchCancel={onMessageTouchEnd}
                onClick={(event) => {
                  if (!selectionMode || Date.now() - suppressClickAtRef.current < 900) return
                  const target = event.target
                  if (target instanceof Element && target.closest('button, input, audio, video, a')) return
                  toggleSelectedMessages(actionMessageIds)
                }}
              >
                {!message.mine && !grouped
                  ? <span className={`avatar message-avatar avatar-${message.color}`}>{message.avatarUrl
                    ? <img className="avatar-image" src={message.avatarUrl} alt="" />
                    : message.initials}</span>
                  : !message.mine ? <span className="message-avatar-spacer" /> : null}
                {selectionMode && <button
                  className={`message-select-marker ${selected ? 'selected' : ''}`}
                  onClick={() => toggleSelectedMessages(actionMessageIds)}
                  type="button"
                  aria-label={`${selected ? 'Deselect' : 'Select'} message`}
                  aria-pressed={selected}
                >{selected ? <Check size={13} /> : <i aria-hidden="true" />}</button>}
                <div className="message-content">
                  <div className={`bubble-wrap ${reactions.length ? 'has-reactions' : ''} ${menuFor === message.id && menuOpensDown ? 'menu-opens-down' : ''} ${reactionPickerFor === message.id && reactionPickerOpensDown ? 'reaction-picker-opens-down' : ''}`}>
                    {hasTextBubble && <div className={`message-bubble ${message.mine ? 'bubble-mine' : ''} ${message.deletedAt ? 'message-deleted' : ''}`}>
                      {!message.mine && !grouped && <strong className="message-author">{message.author}</strong>}
                      {message.replyToId && <button className="message-reply-preview" onClick={() => { void jumpToReply(message.replyToId!) }} type="button" aria-label="Jump to the message this replies to">
                        <strong style={messageAuthorStyle(replyTarget?.authorId ?? replyTarget?.author ?? message.replyPreview?.author ?? 'former member')}>{message.replyPreview?.author ?? replyTarget?.author ?? 'Reply'}</strong>
                        <span>{renderMessageBody(message.replyPreview?.body ?? replyTarget?.body ?? 'Original message unavailable', memberUsernames)}</span>
                      </button>}
                      {!visiblePoll && !visibleSticker && <span className="message-body">{renderMessageBody(message.body, memberUsernames)}</span>}
                      {footerOnBubble && <MessageFooter message={message} liveMessages={liveMessages ?? false} onRetry={onRetryMessage} />}
                    </div>}
                    {message.media && <div className={`message-rich-content ${message.media.kind === 'image' ? 'message-image-content' : ''} ${message.media.kind === 'audio' ? 'message-audio-content' : ''}`}>
                      {!message.mine && !grouped && !hasTextBubble && <strong className="message-author">{message.author}</strong>}
                      {imageGroup
                        ? <div className={`message-image-group ${imageGroup.length === 3 ? 'three-image-grid' : ''}`}>
                            {visibleImageGroup?.map((item) => <MediaAttachment
                              key={item.id}
                              messageId={item.id}
                              media={item.media}
                              mine={item.mine}
                              deliveryStatus={item.deliveryStatus}
                              uploadProgress={item.uploadProgress}
                              onOpen={onOpenMedia}
                              onDiscard={onDiscardMedia}
                              onRetry={onRetryMessage}
                              groupedImage
                            />)}
                            {imageGroup.length > 4 && <button
                              className="image-group-expand"
                              onClick={() => setExpandedMediaGroupIds((current) => {
                                const next = new Set(current)
                                if (mediaGroupCollapsed) next.add(message.mediaGroupId ?? '')
                                else next.delete(message.mediaGroupId ?? '')
                                return next
                              })}
                              type="button"
                              aria-label={mediaGroupCollapsed ? `Show all ${imageGroup.length} images` : 'Show fewer images'}
                            >{mediaGroupCollapsed ? `+${imageGroup.length - 4}` : 'Show less'}</button>}
                          </div>
                        : <MediaAttachment
                            messageId={message.id}
                            media={message.media}
                            mine={message.mine}
                            deliveryStatus={message.deliveryStatus}
                            uploadProgress={message.uploadProgress}
                            onOpen={onOpenMedia}
                            onDiscard={onDiscardMedia}
                            onRetry={onRetryMessage}
                            avatarUrl={message.avatarUrl}
                            initials={message.initials}
                          />}
                      {!footerOnBubble && <MessageFooter
                        message={lastMediaMessage ?? message}
                        liveMessages={liveMessages ?? false}
                        onRetry={onRetryMessage}
                      />}
                    </div>}
                    {visibleSticker && sticker && <div className="sticker-message">
                      {!message.mine && !grouped && <strong className="message-author">{message.author}</strong>}
                      {isIllustratedSticker(message.sticker)
                        ? <StickerArtwork className="message-sticker character-sticker-art" code={message.sticker} />
                        : isImageSticker(message.sticker)
                        ? <img className="message-sticker" src={`/stickers/${message.sticker}.svg`} alt={`${sticker.label} sticker`} />
                        : <span className="message-sticker-emoji" role="img" aria-label={`${sticker.label} sticker`}>{sticker.emoji}</span>}
                      {!footerOnBubble && <MessageFooter message={message} liveMessages={liveMessages ?? false} onRetry={onRetryMessage} />}
                    </div>}
                    {visiblePoll && <div className="message-rich-content">
                      {!message.mine && !grouped && !hasTextBubble && <strong className="message-author">{message.author}</strong>}
                      <PollCard poll={visiblePoll} messageId={message.id} onVote={onVotePoll} />
                      {!footerOnBubble && <MessageFooter message={message} liveMessages={liveMessages ?? false} onRetry={onRetryMessage} />}
                    </div>}
                    {!message.deletedAt && <button
                      className="message-more"
                      onClick={(event) => {
                        const opening = menuFor !== message.id
                        const messageRow = event.currentTarget.closest('.message-row')
                        const scrollBounds = event.currentTarget.closest('.conversation-scroll')?.getBoundingClientRect()
                        const availableAbove = messageRow && scrollBounds
                          ? messageRow.getBoundingClientRect().top - scrollBounds.top
                          : 0
                        setMenuFor(opening ? message.id : null)
                        setMenuOpensDown(opening && availableAbove < 300)
                      }}
                      type="button"
                      aria-label="Message actions"
                      aria-haspopup="menu"
                      aria-expanded={menuFor === message.id}
                    ><ChevronDown size={16} /></button>}
                    {menuFor === message.id && (
                      <div className="message-action-popover">
                        {!message.deletedAt && <div className="message-quick-reactions" role="group" aria-label="Quick reactions">
                          {quickReactions.map((emoji) => <button
                            key={emoji}
                            onClick={() => {
                              if (liveMessages) onToggleReaction?.(message.id, emoji)
                              else toggleReaction(message.id, emoji)
                              setMenuFor(null)
                            }}
                            type="button"
                            aria-label={`React with ${emoji}`}
                          >{emoji}</button>)}
                          <button
                            className="quick-reaction-more"
                            onClick={(event) => openReactionPicker(message.id, event.currentTarget)}
                            type="button"
                            aria-label="Choose another reaction"
                          ><Plus size={15} /></button>
                        </div>}
                        <div className="message-menu" role="group" aria-label="Message actions">
                          <button onClick={() => { setReplyingTo(message); setEditingMessage(null); setMenuFor(null) }} type="button"><MessageCircle size={14} /> Reply</button>
                          {!message.deletedAt && <button onClick={(event) => openReactionPicker(message.id, event.currentTarget)} type="button"><Laugh size={14} /> React</button>}
                          <button onClick={() => {
                            setSelectedMessageIds((current) => [...new Set([...current, ...actionMessageIds])])
                            setMenuFor(null)
                          }} type="button"><Check size={14} /> Select</button>
                          {isTea && !message.mine && (!liveMessages || message.authorId) && <button onClick={() => { onReplyInbox(message.author, message.authorId); setMenuFor(null) }} type="button"><Send size={14} /> Reply Inbox</button>}
                          {liveMessages && message.mine && !message.deletedAt && <button onClick={() => {
                            setEditingMessage(message)
                            setReplyingTo(null)
                            setDraft(message.body)
                            setMenuFor(null)
                          }} type="button"><Pencil size={14} /> Edit message</button>}
                          {liveMessages && <button onClick={() => requestDeleteMessages(actionMessageIds, groupedMediaMessages.every((item) => item.mine && !item.deletedAt))} type="button"><Trash2 size={14} /> Delete</button>}
                          {!message.deletedAt && !message.media && !message.poll && !message.sticker && Boolean(message.body.trim()) && <button onClick={() => {
                            if (!navigator.clipboard) {
                              setNotice('Clipboard access is unavailable in this browser.')
                            } else {
                              void navigator.clipboard.writeText(message.body)
                                .then(() => setNotice('Message copied.'))
                                .catch(() => setNotice('Clipboard permission was not granted.'))
                            }
                            setMenuFor(null)
                          }} type="button"><Paperclip size={14} /> Copy text</button>}
                        </div>
                      </div>
                    )}
                    {!message.deletedAt && reactions.length > 0 && <div className="reaction-row" aria-label="Message reactions">
                      {reactions.map((reaction) => (
                        <button
                          className={reaction.reactedByMe ? 'reaction-selected' : ''}
                          key={reaction.emoji}
                          onClick={() => liveMessages
                            ? onToggleReaction?.(message.id, reaction.emoji)
                            : toggleReaction(message.id, reaction.emoji)}
                          type="button"
                          aria-label={`${reaction.emoji} reaction, ${reaction.count} total`}
                        >{reaction.emoji} {reaction.count}</button>
                      ))}
                    </div>}
                    {reactionPickerFor === message.id && <div className="reaction-picker">
                      <EmojiPicker
                        colorScheme={theme}
                        width={300}
                        height={360}
                        lazyLoadEmojis
                        suggestedEmojisMode="recent"
                        previewConfig={{ showPreview: false, defaultCaption: '', defaultEmoji: '💚' }}
                        onEmojiClick={({ emoji }) => {
                        if (liveMessages) onToggleReaction?.(message.id, emoji)
                        else toggleReaction(message.id, emoji)
                        setReactionPickerFor(null)
                        }}
                      />
                    </div>}
                  </div>
                </div>
              </article>
            )
          })}
          <div ref={endRef} />
        </div>
      </div>

      {showScrollToBottom && <button className="scroll-to-bottom" onClick={jumpToLatest} type="button" aria-label="Jump to latest messages" title="Jump to latest messages">
        <ArrowDown size={18} />
      </button>}

      <div className="composer-wrap">
        {selectionMode && <div className="message-selection-toolbar" role="toolbar" aria-label="Selected message actions">
          <button onClick={() => setSelectedMessageIds([])} type="button" aria-label="Cancel selection"><X size={15} /></button>
          <strong>{selectedMessageIds.length} selected</strong>
          {selectedMessageIds.length === 1 && <button onClick={() => {
            const selected = messages.find((message) => message.id === selectedMessageIds[0])
            if (selected) setReplyingTo(selected)
            setSelectedMessageIds([])
          }} type="button"><MessageCircle size={15} /> Reply</button>}
          {selectedMessageIds.length === 1 && <button onClick={() => {
            openReactionPicker(selectedMessageIds[0])
            setSelectedMessageIds([])
          }} type="button"><Laugh size={15} /> React</button>}
          {liveMessages && <button onClick={() => requestDeleteMessages(selectedMessageIds, everyoneCanDeleteSelection)} type="button"><Trash2 size={15} /> Delete</button>}
        </div>}
        {showEmojiPicker && <div className="emoji-picker">
          <EmojiPicker
            colorScheme={theme}
            width="100%"
            height={330}
            lazyLoadEmojis
            suggestedEmojisMode="recent"
            previewConfig={{ showPreview: false, defaultCaption: '', defaultEmoji: '😎' }}
            searchPlaceHolder="Search emojis"
            onEmojiClick={({ emoji }) => {
              setDraft((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${emoji}`)
              setShowEmojiPicker(false)
            }}
          />
        </div>}
        {(replyingTo || editingMessage) && <div className="reply-preview"><span><strong>{editingMessage ? 'Editing your message' : `Replying to ${replyingTo?.author}`}</strong><small>{editingMessage?.body ?? replyingTo?.body}</small></span><button onClick={() => {
          setReplyingTo(null)
          setEditingMessage(null)
          setDraft('')
        }} type="button" aria-label="Cancel edit or reply"><X size={15} /></button></div>}
        {mentionSuggestions.length > 0 && <div className="mention-suggestions" role="listbox" aria-label="Mention a community member">
          {mentionSuggestions.map((member) => <button key={member.id} onClick={() => insertMention(member.username)} type="button" role="option">@{member.username}</button>)}
        </div>}
        {showPollComposer && <form className="poll-composer" onSubmit={(event) => { void submitPoll(event) }}>
          <div className="poll-composer-header"><strong>Create a poll</strong><button onClick={() => setShowPollComposer(false)} type="button" aria-label="Close poll composer"><X size={15} /></button></div>
          <input value={pollQuestion} onChange={(event) => setPollQuestion(event.target.value)} placeholder="Ask a question" minLength={3} maxLength={300} required />
          {pollOptions.map((option, index) => <input
            key={index}
            value={option}
            onChange={(event) => setPollOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
            placeholder={`Option ${index + 1}`}
            maxLength={120}
            required={index < 2}
          />)}
          <div className="poll-composer-actions">
            {pollOptions.length < 6 && <button onClick={() => setPollOptions((current) => [...current, ''])} type="button">Add option</button>}
            <button type="submit" disabled={creatingPoll || !online || !canSend}>{creatingPoll ? 'Creating…' : 'Create poll'}</button>
          </div>
        </form>}
        {showStickerPicker && <div className="sticker-picker" role="dialog" aria-label={`${communityName} stickers`}>
          <div className="sticker-picker-header">
            <strong>Stickers</strong>
            <small>{visibleStickerOptions.length} available</small>
            <button onClick={() => { setShowStickerPicker(false); setStickerSearch('') }} type="button" aria-label="Close stickers"><X size={15} /></button>
          </div>
          <label className="sticker-search">
            <Search size={14} />
            <input
              aria-label="Search stickers"
              onChange={(event) => setStickerSearch(event.target.value)}
              placeholder="Search stickers"
              value={stickerSearch}
            />
          </label>
          <div className="sticker-grid">
            {visibleStickerOptions.map((sticker) => <button
              key={sticker.code}
              onClick={() => { void chooseSticker(sticker.code) }}
              type="button"
              aria-label={`Send ${sticker.label} sticker`}
              disabled={creatingPoll || !online || !canSend}
            >
              {isIllustratedSticker(sticker.code)
                ? <StickerArtwork className="sticker-art character-sticker-art" code={sticker.code} />
                : isImageSticker(sticker.code)
                ? <img src={`/stickers/${sticker.code}.svg`} alt="" />
                : <span className="sticker-art" aria-hidden="true">{sticker.emoji}</span>}
              <span>{sticker.label}</span>
            </button>)}
            {!visibleStickerOptions.length && <p className="sticker-empty">No stickers match that search.</p>}
          </div>
        </div>}
        <form ref={composerFormRef} className="composer" onSubmit={(event) => { void submitMessage(event) }}>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,audio/webm,audio/mp4,audio/ogg,audio/mpeg,video/mp4,video/webm"
            multiple
            onChange={(event) => {
              chooseAttachments(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {attachments.length > 0 && <div className={`attachment-preview ${attachments.length > 1 ? 'has-multiple-images' : ''}`}>
            <div className={`attachment-preview-media ${attachments.length > 1 ? 'attachment-preview-images' : ''}`}>
              {attachments.map((attachment, index) => <div className="attachment-preview-item" key={`${attachment.file.name}-${attachment.file.lastModified}-${index}`}>
                {attachment.file.type.startsWith('image/') && <img src={attachment.url} alt={`Selected image ${index + 1}`} />}
                {attachments.length === 1 && attachment.file.type.startsWith('video/') && <video controls playsInline preload="metadata" src={attachment.url} />}
                {attachments.length === 1 && attachment.file.type.startsWith('audio/') && <audio controls preload="metadata" src={attachment.url} />}
                {attachments.length > 1 && <button
                  className="attachment-preview-remove"
                  onClick={() => setAttachments(attachments
                    .filter((_, itemIndex) => itemIndex !== index)
                    .map((item) => ({ file: item.file, url: URL.createObjectURL(item.file) })))}
                  type="button"
                  aria-label={`Remove image ${index + 1}`}
                ><X size={13} /></button>}
              </div>)}
            </div>
            <span>{attachments.length > 1
              ? `${attachments.length} images selected`
              : '1 attachment selected'}</span>
            <label><input type="checkbox" checked={viewOnceDraft} onChange={(event) => setViewOnceDraft(event.target.checked)} /> Once</label>
            <button onClick={() => setAttachments([])} type="button" aria-label="Discard selected media"><X size={14} /></button>
          </div>}
          {recording && <div className="voice-recording" role="status">
            <span className="recording-indicator"><i /> Recording</span>
            <div className="recording-waveform" aria-label={`Recording waveform, ${formatDuration(recordingSeconds)} elapsed`}>
              {recordingWaveform.map((level, index) => <i key={index} style={{ height: `${Math.max(3, Math.round(level * 22))}px` }} />)}
            </div>
            <strong>{formatDuration(recordingSeconds)}</strong>
            <button onClick={cancelRecording} type="button" aria-label="Cancel recording"><X size={16} /></button>
            <button onClick={stopRecording} type="button" aria-label="Stop recording"><Square size={14} /></button>
          </div>}
          <button className="icon-button composer-add" onClick={() => fileInputRef.current?.click()} type="button" aria-label="Add image, audio, or video" disabled={!liveMessages || !canSend}><ImagePlus size={19} /></button>
          <button className="icon-button composer-add" onClick={() => {
            if (!liveMessages || !canSend) {
              setNotice('Voice messages require a signed-in conversation.')
              return
            }
            void startRecording()
          }} type="button" aria-label="Record voice message" disabled={recording || !online || !liveMessages || !canSend}>
            <Mic size={18} />
          </button>
          <textarea
            aria-label="Write a message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setShowStickerPicker(false)
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                composerFormRef.current?.requestSubmit()
              }
            }}
            placeholder={nativePhoneLayout ? 'Mbabarira, umbwire…' : isTea ? 'C’mon, ngwino utubwire the other thing…' : `Message ${privateName}…`}
            maxLength={10000}
            rows={1}
          />
          <button className="icon-button composer-emoji composer-popover-trigger" onClick={() => {
            setShowEmojiPicker((current) => !current)
            setShowStickerPicker(false)
            setShowPollComposer(false)
          }} type="button" aria-label="Choose an emoji" aria-expanded={showEmojiPicker}><Smile size={19} /></button>
          <button className="icon-button composer-emoji composer-popover-trigger" onClick={() => {
            setShowStickerPicker((current) => !current)
            setShowEmojiPicker(false)
            setShowPollComposer(false)
          }} type="button" aria-label="Choose a sticker" aria-expanded={showStickerPicker}><Sticker size={18} /></button>
          <button className="icon-button composer-emoji composer-popover-trigger" onClick={() => {
            if (!liveMessages || !canSend) {
              setNotice('Polls need a signed-in conversation.')
              return
            }
            setShowPollComposer((current) => !current)
            setShowEmojiPicker(false)
            setShowStickerPicker(false)
          }} type="button" aria-label="Create a poll" aria-expanded={showPollComposer}><BarChart3 size={18} /></button>
          <button className={`send-button ${(draft.trim() || attachments.length) && canSend && online ? 'ready' : ''}`} type="submit" aria-label={attachments.length ? 'Send media' : 'Send message'} disabled={(!draft.trim() && !attachments.length) || !canSend || !online}><Send size={17} /></button>
        </form>
        <div className="composer-hint"><span><Sparkles size={11} /> If they discovered you, change your username, sibyoo.</span>        <span><span className="desktop-hint">{isTea ? 'Messages which are not tea are not allowed.' : 'Uwababiri gusa.'}</span><span className="mobile-hint">{liveMessages ? 'Sent to this conversation' : 'Preview only · local, not delivered'}</span> <span className="hint-heart">♥</span></span></div>
      </div>
      {isTea && <button className="mobile-members" onClick={onOpenMembers} type="button"><Users size={16} /> Community</button>}
      {notice && <div className="chat-notice" role="status">{notice}</div>}
      {deleteConfirmation && <div
        className="message-delete-overlay"
        onClick={(event) => {
          if (event.target === event.currentTarget) setDeleteConfirmation(null)
        }}
      >
        <section className="message-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="message-delete-title">
          <h2 id="message-delete-title">{deleteConfirmation.messageIds.length === 1 ? 'Delete message?' : `Delete ${deleteConfirmation.messageIds.length} messages?`}</h2>
          {deleteConfirmation.allowEveryone && <button
            className="delete-everyone"
            onClick={() => { void confirmDeleteMessages(true) }}
            type="button"
          >Delete for everyone</button>}
          <button
            className="delete-for-me"
            onClick={() => { void confirmDeleteMessages(false) }}
            type="button"
          >Delete for me</button>
          <button className="delete-cancel" onClick={() => setDeleteConfirmation(null)} type="button" autoFocus>Cancel</button>
        </section>
      </div>}
    </main>
  )
}

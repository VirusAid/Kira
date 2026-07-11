/** Чат — список диалогов + лента сообщений + композер. */
import { useEffect, useRef, useState } from 'react'
import {
  Plus, Send, Square, Trash2, Pin, PinOff, Pencil, Copy, Check,
  RotateCcw, Eye, Search, X, Volume2, VolumeX
} from 'lucide-react'
import { useChatStore } from '@/state/chatStore'
import { useAppStore } from '@/state/appStore'
import { Markdown } from '@/components/Markdown'
import { KiraEmblem } from '@/components/KiraEmblem'
import { speakOnce, stopSpeaker, onSpeakingChange, getSpeakingId } from '@/voice/speaker'
import { timeAgo } from './HomeView'
import type { ChatMessage } from '@shared/types'

export function ChatView() {
  const {
    chats, activeChatId, messages, streaming, streamText, actionEvents,
    openChat, newChat, deleteChat, renameChat, togglePin,
    sendMessage, stopGeneration, regenerate
  } = useChatStore()
  const settings = useAppStore((s) => s.settings)

  const [input, setInput] = useState('')
  const [withScreen, setWithScreen] = useState(false)
  const [chatFilter, setChatFilter] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // автопрокрутка
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streamText, actionEvents])

  const submit = (): void => {
    if (!input.trim() || streaming) return
    void sendMessage(input, { withScreen })
    setInput('')
    setWithScreen(false)
  }

  const filteredChats = chats
    .filter((c) => c.title.toLowerCase().includes(chatFilter.toLowerCase()))
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt)

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Список диалогов */}
      <div style={styles.chatList}>
        <div style={{ display: 'flex', gap: 8, padding: '14px 12px 10px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-2)' }} />
            <input
              style={{ width: '100%', paddingLeft: 30, fontSize: 12.5 }}
              placeholder="Поиск диалогов"
              value={chatFilter}
              onChange={(e) => setChatFilter(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" style={{ padding: '8px 11px' }} onClick={() => void newChat()}>
            <Plus size={15} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '0 8px 12px' }}>
          {filteredChats.map((c) => (
            <div
              key={c.id}
              style={{
                ...styles.chatItem,
                background: c.id === activeChatId ? 'var(--accent-soft)' : 'transparent',
                borderColor: c.id === activeChatId ? 'var(--border)' : 'transparent'
              }}
              onClick={() => void openChat(c.id)}
            >
              {renamingId === c.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  style={{ fontSize: 12.5, padding: '4px 8px', width: '100%' }}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { void renameChat(c.id, renameValue); setRenamingId(null) }
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={() => setRenamingId(null)}
                />
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                    }}>
                      {c.pinned && <Pin size={11} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />}
                      {c.title}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{timeAgo(c.updatedAt)}</div>
                  </div>
                  <div style={styles.chatItemActions} className="chat-actions">
                    <button className="icon-btn" style={{ width: 24, height: 24 }}
                      onClick={(e) => { e.stopPropagation(); void togglePin(c.id) }}>
                      {c.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                    </button>
                    <button className="icon-btn" style={{ width: 24, height: 24 }}
                      onClick={(e) => { e.stopPropagation(); setRenamingId(c.id); setRenameValue(c.title) }}>
                      <Pencil size={12} />
                    </button>
                    <button className="icon-btn" style={{ width: 24, height: 24 }}
                      onClick={(e) => { e.stopPropagation(); void deleteChat(c.id) }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {filteredChats.length === 0 && (
            <div className="muted" style={{ textAlign: 'center', padding: 20 }}>Диалогов нет</div>
          )}
        </div>
      </div>

      {/* Лента сообщений */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 26px' }}>
          {!activeChatId && messages.length === 0 && (
            <div className="empty-state" style={{ height: '100%' }}>
              <KiraEmblem size={132} state={streaming ? 'thinking' : 'idle'} />
              <h2 style={{ fontSize: 19, color: 'var(--text-0)', marginTop: 6 }}>Привет, я Kira</h2>
              <p style={{ maxWidth: 420, lineHeight: 1.6 }}>
                Я могу открывать программы, управлять файлами и системой, запускать протоколы,
                помнить важное о тебе и просто разговаривать. Напиши что-нибудь или включи голос.
              </p>
            </div>
          )}

          {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}

          {/* Выполненные действия */}
          {streaming && actionEvents.map((a, i) => (
            <div key={`act-${i}`} style={styles.actionChip} className="anim-in">
              <span style={{ color: a.ok ? 'var(--ok)' : 'var(--err)' }}>{a.ok ? '✓' : '✗'}</span>
              {a.message}
            </div>
          ))}

          {/* Стриминг */}
          {streaming && (
            <div style={{ ...styles.bubbleRow, justifyContent: 'flex-start', alignItems: 'flex-end', gap: 8 }}>
              <KiraEmblem size={30} state="thinking" />
              <div style={{ ...styles.bubble, ...styles.assistantBubble }}>
                {streamText
                  ? <div><Markdown content={streamText} /><span className="stream-caret" /></div>
                  : <div style={{ display: 'flex', gap: 5, padding: '4px 2px' }}>
                      {[0, 1, 2].map((i) => (
                        <span key={i} style={{
                          width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)',
                          animation: `thinkBounce 1.3s ${i * 0.18}s infinite`
                        }} />
                      ))}
                    </div>}
              </div>
            </div>
          )}
        </div>

        {/* Композер */}
        <div style={styles.composerWrap}>
          {withScreen && (
            <div style={styles.screenBadge}>
              <Eye size={13} /> Kira увидит текущий экран
              <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => setWithScreen(false)}>
                <X size={11} />
              </button>
            </div>
          )}
          <div style={styles.composer}>
            <button
              className="icon-btn"
              title="Показать Kira экран (vision)"
              style={{ color: withScreen ? 'var(--accent-text)' : undefined, background: withScreen ? 'var(--accent-soft)' : undefined }}
              onClick={() => setWithScreen((v) => !v)}
            >
              <Eye size={17} />
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              style={styles.textarea}
              placeholder={`Напиши Kira… (${settings?.userName ?? ''}, Enter — отправить)`}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            {streaming ? (
              <button className="btn btn-danger" style={{ padding: '9px 13px' }} onClick={stopGeneration} title="Остановить">
                <Square size={15} />
              </button>
            ) : (
              <>
                {messages.some((m) => m.role === 'assistant') && (
                  <button className="icon-btn" title="Перегенерировать последний ответ" onClick={() => void regenerate()}>
                    <RotateCcw size={16} />
                  </button>
                )}
                <button className="btn btn-primary" style={{ padding: '9px 14px' }} onClick={submit} disabled={!input.trim()}>
                  <Send size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const { editingMessageId, setEditing, editMessage, deleteMessage } = useChatStore()
  const [copied, setCopied] = useState(false)
  const [editValue, setEditValue] = useState(msg.content)
  const [speaking, setSpeaking] = useState(getSpeakingId() === msg.id)
  const isUser = msg.role === 'user'
  const editing = editingMessageId === msg.id

  useEffect(() => onSpeakingChange((id) => setSpeaking(id === msg.id)), [msg.id])

  const copy = (): void => {
    void navigator.clipboard.writeText(msg.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div style={{ ...styles.bubbleRow, justifyContent: isUser ? 'flex-end' : 'flex-start' }}
      className={isUser ? 'msg-in-right' : 'msg-in-left'}>
      <div style={{
        ...styles.bubble,
        ...(isUser ? styles.userBubble : styles.assistantBubble),
        ...(msg.error ? { borderColor: 'rgba(248,113,113,0.4)' } : {})
      }}>
        {editing ? (
          <div>
            <textarea
              autoFocus
              value={editValue}
              rows={3}
              style={{ width: '100%', minWidth: 280, resize: 'vertical' }}
              onChange={(e) => setEditValue(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 7, marginTop: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 12 }} onClick={() => setEditing(null)}>
                Отмена
              </button>
              <button className="btn btn-primary" style={{ padding: '5px 11px', fontSize: 12 }}
                onClick={() => void editMessage(msg.id, editValue)}>
                Сохранить
              </button>
            </div>
          </div>
        ) : (
          <>
            <Markdown content={msg.content} />
            <div style={styles.msgMeta}>
              <span>
                {new Date(msg.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                {msg.editedAt && ' · изменено'}
                {msg.model && !isUser && ` · ${msg.model.split('/').pop()}`}
              </span>
              <span style={{ display: 'flex', gap: 3 }}>
                <button className="icon-btn" style={{ width: 22, height: 22 }} title="Копировать" onClick={copy}>
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                </button>
                {!isUser && (
                  <button className="icon-btn" style={{ width: 22, height: 22, color: speaking ? 'var(--accent-text)' : undefined }}
                    title={speaking ? 'Остановить озвучку' : 'Прочитать вслух'}
                    onClick={() => (speaking ? stopSpeaker() : void speakOnce(msg.content, msg.id))}>
                    {speaking ? <VolumeX size={11} /> : <Volume2 size={11} />}
                  </button>
                )}
                {isUser && (
                  <button className="icon-btn" style={{ width: 22, height: 22 }} title="Редактировать"
                    onClick={() => { setEditValue(msg.content); setEditing(msg.id) }}>
                    <Pencil size={11} />
                  </button>
                )}
                <button className="icon-btn" style={{ width: 22, height: 22 }} title="Удалить"
                  onClick={() => void deleteMessage(msg.id)}>
                  <Trash2 size={11} />
                </button>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  chatList: {
    width: 248, flexShrink: 0, display: 'flex', flexDirection: 'column',
    borderRight: '1px solid var(--border)', background: 'rgba(12,12,22,0.35)'
  },
  chatItem: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '9px 11px', borderRadius: 10, cursor: 'pointer',
    border: '1px solid transparent', marginBottom: 2, transition: 'background 0.13s'
  },
  chatItemActions: { display: 'flex', gap: 1, opacity: 0.75 },
  bubbleRow: { display: 'flex', marginBottom: 14 },
  bubble: {
    maxWidth: 'min(680px, 82%)', padding: '12px 16px', borderRadius: 16,
    fontSize: 'var(--font-size)', lineHeight: 1.55
  },
  userBubble: {
    background: 'linear-gradient(135deg, rgba(139,92,246,0.28), rgba(109,40,217,0.22))',
    border: '1px solid var(--border-strong)',
    borderBottomRightRadius: 5
  },
  assistantBubble: {
    background: 'var(--panel)',
    backdropFilter: 'blur(12px)',
    border: '1px solid var(--border)',
    borderBottomLeftRadius: 5
  },
  msgMeta: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 7, fontSize: 10.5, color: 'var(--text-2)', gap: 14
  },
  actionChip: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '6px 13px', marginBottom: 10, marginRight: 8,
    borderRadius: 999, fontSize: 12,
    background: 'var(--accent-soft)', border: '1px solid var(--border)',
    color: 'var(--text-1)'
  },
  composerWrap: { padding: '10px 22px 18px', borderTop: '1px solid var(--border)' },
  composer: {
    display: 'flex', alignItems: 'flex-end', gap: 9,
    background: 'var(--panel)', backdropFilter: 'blur(16px)',
    border: '1px solid var(--border)', borderRadius: 16, padding: 9
  },
  textarea: {
    flex: 1, resize: 'none', background: 'none', border: 'none', boxShadow: 'none',
    maxHeight: 160, padding: '8px 4px', lineHeight: 1.5
  },
  screenBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    fontSize: 12, color: 'var(--accent-text)',
    background: 'var(--accent-soft)', border: '1px solid var(--border)',
    borderRadius: 999, padding: '4px 12px', marginBottom: 8
  }
}

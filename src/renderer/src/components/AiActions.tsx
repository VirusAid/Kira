/**
 * AI Actions — всплывающее меню действий над ВЫДЕЛЕННЫМ текстом.
 * Открывается по глобальной горячей клавише (main шлёт 'ai-actions:open' с
 * текстом). Пользователь выбирает действие → Kira возвращает результат, который
 * можно скопировать или вставить обратно (заменить выделение).
 */
import { useEffect, useState } from 'react'
import { Languages, Lightbulb, Wand2, AlignLeft, Sparkles, Copy, ClipboardPaste, X, Loader2, CheckCheck, CornerDownLeft } from 'lucide-react'
import { kira } from '@/api'
import { overlayStyle } from '@/views/MemoryView'

interface Action { id: string; label: string; icon: typeof Wand2; instruction: string }

const ACTIONS: Action[] = [
  { id: 'translate_ru', label: 'Перевести на русский', icon: Languages, instruction: 'Переведи текст на русский язык.' },
  { id: 'translate_en', label: 'Перевести на английский', icon: Languages, instruction: 'Translate the text into English.' },
  { id: 'explain', label: 'Объяснить', icon: Lightbulb, instruction: 'Объясни простыми словами, что это значит.' },
  { id: 'rewrite', label: 'Переписать грамотно', icon: Wand2, instruction: 'Перепиши текст грамотно и понятно, сохранив смысл.' },
  { id: 'shorten', label: 'Сократить', icon: AlignLeft, instruction: 'Сократи текст до сути, сохранив главное.' },
  { id: 'summary', label: 'Кратко о чём', icon: Sparkles, instruction: 'Сделай краткое резюме текста в 1-3 предложениях.' }
]

export function AiActions() {
  const [text, setText] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState('')
  const [copied, setCopied] = useState(false)
  const [custom, setCustom] = useState('')

  useEffect(() => {
    return kira.on('ai-actions:open', (payload) => {
      setText(String(payload ?? ''))
      setResult('')
      setBusy(null)
      setCopied(false)
    })
  }, [])

  if (text === null) return null

  const close = (): void => setText(null)

  const run = async (a: Action): Promise<void> => {
    setBusy(a.id)
    setResult('')
    const r = await kira.ai.quick(a.instruction, text)
    setBusy(null)
    setResult(r.ok ? r.result : `Ошибка: ${r.error || 'не удалось'}`)
  }

  const runCustom = async (): Promise<void> => {
    const instr = custom.trim()
    if (!instr || busy) return
    setBusy('custom')
    setResult('')
    const r = await kira.ai.quick(instr, text)
    setBusy(null)
    setResult(r.ok ? r.result : `Ошибка: ${r.error || 'не удалось'}`)
  }

  const copy = (): void => {
    void navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const replace = (): void => {
    close()
    // небольшая задержка, чтобы фокус вернулся в исходное окно
    setTimeout(() => void kira.ai.replaceSelection(result), 350)
  }

  return (
    <div style={overlayStyle} onClick={close}>
      <div className="card" style={{ width: 520, maxHeight: '86vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Sparkles size={17} color="var(--accent-text)" />
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>AI Actions</h3>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={close}><X size={16} /></button>
        </div>

        <div style={{
          fontSize: 12.5, color: 'var(--text-1)', background: 'var(--bg-2)', borderRadius: 8,
          padding: '8px 12px', marginBottom: 14, maxHeight: 90, overflow: 'auto', whiteSpace: 'pre-wrap'
        }}>{text.slice(0, 600)}{text.length > 600 ? '…' : ''}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {ACTIONS.map((a) => (
            <button key={a.id} className="btn btn-ghost" style={{ justifyContent: 'flex-start' }}
              onClick={() => void run(a)} disabled={!!busy}>
              {busy === a.id ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <a.icon size={14} />}
              {a.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            style={{ flex: 1 }}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runCustom() }}
            placeholder="Своё действие: напр. «сделай список задач из этого»"
            disabled={!!busy}
          />
          <button className="btn btn-ghost" onClick={() => void runCustom()} disabled={!!busy || !custom.trim()}>
            {busy === 'custom' ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <CornerDownLeft size={14} />}
          </button>
        </div>

        {result && (
          <div className="anim-in" style={{ marginTop: 14 }}>
            <div style={{
              fontSize: 13, lineHeight: 1.55, background: 'var(--bg-1)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '10px 12px', whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto'
            }}>{result}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-ghost" onClick={copy}>
                {copied ? <CheckCheck size={14} color="var(--accent-text)" /> : <Copy size={14} />} {copied ? 'Скопировано' : 'Копировать'}
              </button>
              <button className="btn btn-primary" onClick={replace}>
                <ClipboardPaste size={14} /> Заменить выделение
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

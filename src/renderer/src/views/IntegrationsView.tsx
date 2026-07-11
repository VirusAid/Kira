/** Интеграции — подключение внешних сервисов (Obsidian, Notion, Google). */
import { useEffect, useState } from 'react'
import { Plug, FolderOpen, Check, ExternalLink, Loader2, FileText, StickyNote, Mail, MessageCircle, AlertTriangle } from 'lucide-react'
import { useAppStore } from '@/state/appStore'
import { kira } from '@/api'

export function IntegrationsView() {
  const { settings, saveSettings } = useAppStore()
  const [status, setStatus] = useState<{ obsidian: boolean; notion: boolean; google: boolean; discord: boolean }>({ obsidian: false, notion: false, google: false, discord: false })
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = (): void => { void kira.integrations.status().then(setStatus) }
  useEffect(refresh, [])

  if (!settings) return null
  const upd = (p: Partial<typeof settings>): void => void saveSettings({ ...settings, ...p })

  const pickVault = async (): Promise<void> => {
    const dir = await kira.files.pickFolder()
    if (dir) { upd({ obsidianVault: dir }); setTimeout(refresh, 300) }
  }

  const connectGoogle = async (): Promise<void> => {
    setBusy('google'); setMsg('Открываю окно входа Google…')
    const r = await kira.integrations.connectGoogle()
    setMsg(r.message); setBusy(''); refresh()
  }

  return (
    <div className="view-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Plug size={22} style={{ color: 'var(--accent-text)' }} />
        <h2 className="section-title">Интеграции</h2>
      </div>
      <p className="muted" style={{ marginBottom: 22 }}>
        Подключи сервисы — и Kira будет работать с твоими заметками, календарём и задачами. Всё подключается тобой, ключи хранятся локально.
      </p>
      {msg && <div className="card" style={{ marginBottom: 16, background: 'var(--bg-2)', fontSize: 12.5, color: 'var(--accent-text)' }}>{msg}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
        {/* Obsidian */}
        <Card icon={<StickyNote size={19} />} title="Obsidian" ok={status.obsidian}
          desc="Локальные заметки. Kira ищет, читает и создаёт заметки в твоём хранилище.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost press" onClick={() => void pickVault()}>
              <FolderOpen size={14} /> {settings.obsidianVault ? 'Сменить папку' : 'Выбрать папку хранилища'}
            </button>
            {settings.obsidianVault && <span className="muted" style={{ fontSize: 11.5 }}>…{settings.obsidianVault.slice(-40)}</span>}
          </div>
        </Card>

        {/* Notion */}
        <Card icon={<FileText size={19} />} title="Notion" ok={status.notion}
          desc="Поиск и создание страниц. Kira ведёт заметки и базы прямо в Notion.">
          <input type="password" style={{ width: '100%', marginBottom: 8 }} placeholder="Internal Integration Token (secret_…)"
            value={settings.notionToken} onChange={(e) => upd({ notionToken: e.target.value })} onBlur={refresh} />
          <ol className="muted" style={{ fontSize: 11.5, paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
            <li>Открой <A href="https://www.notion.so/my-integrations">notion.so/my-integrations</A> → «New integration» → скопируй токен сюда.</li>
            <li>На нужной странице Notion: «•••» → «Connections» → добавь свою интеграцию.</li>
          </ol>
        </Card>

        {/* Google (Календарь + Gmail) */}
        <Card icon={<Mail size={19} />} title="Google — Календарь и Gmail" ok={status.google}
          desc="Kira видит события и почту, рассказывает план дня, читает и отправляет письма.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input style={{ width: '100%' }} placeholder="Client ID"
              value={settings.googleClientId} onChange={(e) => upd({ googleClientId: e.target.value })} />
            <input type="password" style={{ width: '100%' }} placeholder="Client Secret"
              value={settings.googleClientSecret} onChange={(e) => upd({ googleClientSecret: e.target.value })} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary press" onClick={() => void connectGoogle()} disabled={busy === 'google' || !settings.googleClientId}>
                {busy === 'google' ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <ExternalLink size={14} />}
                {status.google ? 'Переподключить' : 'Подключить Google'}
              </button>
              {status.google && <>
                <button className="btn btn-ghost press" onClick={() => void kira.integrations.calendarToday().then((r) => setMsg(r.data ? String(r.data) : r.message))}>События сегодня</button>
                <button className="btn btn-ghost press" onClick={() => void kira.integrations.gmailCheck().then((r) => setMsg(r.data ? String(r.data) : r.message))}>Проверить почту</button>
              </>}
            </div>
          </div>
          <ol className="muted" style={{ fontSize: 11.5, paddingLeft: 18, lineHeight: 1.7, marginTop: 10 }}>
            <li>Открой <A href="https://console.cloud.google.com/apis/credentials">Google Cloud Console → Credentials</A>.</li>
            <li>Создай «OAuth client ID» типа <b>Desktop app</b>. Включи Google Calendar API и Gmail API.</li>
            <li>В «OAuth consent screen» добавь себя в Test users.</li>
            <li>Скопируй Client ID и Secret сюда → «Подключить Google» → войди в браузере.</li>
          </ol>
        </Card>

        {/* Discord */}
        <Card icon={<MessageCircle size={19} />} title="Discord" ok={status.discord}
          desc="Kira отправляет сообщения в твой канал и может предупреждать о личных сообщениях.">
          <input type="password" style={{ width: '100%', marginBottom: 8 }} placeholder="URL вебхука (для отправки сообщений)"
            value={settings.discordWebhook} onChange={(e) => upd({ discordWebhook: e.target.value })} onBlur={refresh} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {status.discord && <button className="btn btn-ghost press" onClick={() => void kira.integrations.discordTest().then((r) => setMsg(r.message))}>Отправить тест</button>}
          </div>
          <ol className="muted" style={{ fontSize: 11.5, paddingLeft: 18, lineHeight: 1.7, margin: '8px 0 0' }}>
            <li>В Discord: настройки сервера → «Интеграции» → «Вебхуки» → «Новый вебхук».</li>
            <li>Выбери канал, «Копировать URL вебхука» и вставь сюда.</li>
          </ol>

          {/* Слежение за ЛС — с предупреждением */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <Toggle label="Предупреждать о личных сообщениях"
              checked={settings.discordDmAlerts} onChange={(v) => { upd({ discordDmAlerts: v }); setTimeout(refresh, 300) }} />
            {settings.discordDmAlerts && (
              <div style={{ marginTop: 10 }}>
                <div className="card" style={{ background: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.3)', marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--err)', lineHeight: 1.5 }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>Чтение личных сообщений требует твоего <b>пользовательского токена</b>. Это против правил Discord
                      и теоретически может привести к блокировке аккаунта. Используй на свой риск.</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="password" style={{ flex: 1 }} placeholder="Пользовательский токен Discord"
                    value={settings.discordUserToken} onChange={(e) => upd({ discordUserToken: e.target.value })} />
                  <button className="btn btn-ghost press" onClick={() => void kira.integrations.discordVerify().then((r) => { setMsg(r.ok ? `Токен верный: ${r.name}` : 'Токен неверный'); refresh() })}>
                    Проверить
                  </button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function Card({ icon, title, desc, ok, soon, children }: {
  icon: React.ReactNode; title: string; desc: string; ok: boolean; soon?: boolean; children: React.ReactNode
}) {
  return (
    <div className="card" style={{ opacity: soon ? 0.7 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: ok ? 'rgba(52,211,153,0.13)' : 'var(--bg-2)', color: ok ? 'var(--ok)' : 'var(--accent-text)' }}>{icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <div className="muted" style={{ fontSize: 12 }}>{desc}</div>
        </div>
        {ok ? <span className="badge" style={{ color: 'var(--ok)', borderColor: 'rgba(52,211,153,0.3)' }}><Check size={11} /> Подключено</span>
          : soon ? <span className="badge" style={{ fontSize: 10 }}>скоро</span>
          : <span className="badge" style={{ fontSize: 10, opacity: 0.7 }}>не подключено</span>}
      </div>
      {children}
    </div>
  )
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)' }}>{children}</a>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{label}</span>
      <button onClick={() => onChange(!checked)} style={{
        width: 44, height: 24, borderRadius: 999, position: 'relative', flexShrink: 0,
        background: checked ? 'var(--accent)' : 'var(--bg-3)', transition: 'background 0.2s'
      }}>
        <span style={{ position: 'absolute', top: 3, left: checked ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
      </button>
    </div>
  )
}

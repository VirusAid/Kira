/** Главный экран: приветствие, статистика, активные задачи, быстрый доступ. */
import { useEffect, useMemo } from 'react'
import { MessageSquare, FolderKanban, Zap, Brain, ArrowRight, Play, Sparkles, UserCircle } from 'lucide-react'
import { useAppStore } from '@/state/appStore'
import { useChatStore } from '@/state/chatStore'
import { useProjectStore, useProtocolStore, useMemoryStore, useLogStore, useAbilityStore } from '@/state/dataStores'
import { KiraEmblem } from '@/components/KiraEmblem'

export function HomeView() {
  const { settings, setView, stats, refreshStats, setOpenProject } = useAppStore()
  const { chats, openChat, newChat } = useChatStore()
  const projects = useProjectStore((s) => s.projects)
  const { protocols, run } = useProtocolStore()
  const abilities = useAbilityStore((s) => s.abilities)
  const memory = useMemoryStore((s) => s.entries)
  const logs = useLogStore((s) => s.logs)

  useEffect(() => { void refreshStats() }, [refreshStats])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    const name = settings?.userName || 'друг'
    if (h < 5) return `Поздняя ночь, ${name}. Я на связи`
    if (h < 12) return `Доброе утро, ${name}`
    if (h < 18) return `Добрый день, ${name}`
    return `Добрый вечер, ${name}`
  }, [settings])

  const activeProjects = projects.filter((p) => p.status === 'active')
  const recentChanges = logs.slice(0, 5)

  // профиль пользователя, который Kira дополняет со временем (update_profile)
  const profileFacts = useMemo(() => {
    const raw = settings?.userProfile || ''
    return raw
      .split(/\n|(?<=[.;])\s+/)
      .map((s) => s.replace(/^[•\-*]\s*/, '').trim())
      .filter((s) => s.length > 1)
      .slice(0, 14)
  }, [settings])

  return (
    <div className="view-container">
      {/* Приветствие */}
      <div className="anim-in" style={styles.hero}>
        <KiraEmblem size={66} state="idle" />
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 750, letterSpacing: 0.3 }}>{greeting}</h1>
          <p style={{ color: 'var(--text-1)', marginTop: 5, fontSize: 14 }}>
            Все системы в норме. Чем займёмся?
          </p>
        </div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }}
          onClick={() => { void newChat(); setView('chat') }}>
          Начать диалог <ArrowRight size={15} />
        </button>
      </div>

      {/* Статистика */}
      <div className="stagger" style={styles.statsRow}>
        <StatCard icon={<MessageSquare size={18} />} value={chats.length} label="диалогов"
          onClick={() => setView('chat')} />
        <StatCard icon={<FolderKanban size={18} />} value={activeProjects.length} label="активных проектов"
          onClick={() => setView('projects')} />
        <StatCard icon={<Zap size={18} />} value={protocols.length} label="протоколов"
          onClick={() => setView('protocols')} />
        <StatCard icon={<Sparkles size={18} />} value={abilities.length} label="навыков"
          onClick={() => setView('abilities')} />
        <StatCard icon={<Brain size={18} />} value={memory.length} label="записей памяти"
          onClick={() => setView('memory')} />
        {stats && (
          <div className="card" style={{ flex: 1.4, display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
            <span className="muted">Система</span>
            <span style={{ fontSize: 13.5 }}>
              CPU {stats.cpuPercent}% · RAM {stats.memUsedGB}/{stats.memTotalGB} ГБ · {stats.uptimeHours} ч
            </span>
          </div>
        )}
      </div>

      {/* Профиль: то, что Kira узнала о тебе — растёт со временем */}
      <section className="card anim-in" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: profileFacts.length ? 12 : 0 }}>
          <UserCircle size={17} style={{ color: 'var(--accent-text)' }} />
          <h3 style={{ fontSize: 14.5, fontWeight: 700 }}>Что Kira о тебе знает</h3>
          <span className="muted" style={{ fontSize: 11.5 }}>· растёт со временем</span>
          <button className="muted" style={{ marginLeft: 'auto', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => setView('settings')}>
            Изменить <ArrowRight size={12} />
          </button>
        </div>
        {profileFacts.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {profileFacts.map((f, i) => (
              <span key={i} style={{
                fontSize: 12.5, padding: '5px 11px', borderRadius: 8,
                background: 'var(--accent-soft)', color: 'var(--text-0)',
                border: '1px solid var(--border)'
              }}>{f}</span>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.55 }}>
            Kira ещё узнаёт тебя. Общайся с ней и рассказывай о себе — она будет запоминать
            привычки, вкусы и стиль, и профиль начнёт расти сам.
          </p>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        {/* Последние проекты */}
        <section className="card anim-in">
          <SectionHeader title="Последние проекты" onMore={() => setView('projects')} />
          {activeProjects.length === 0 && <Empty text="Создай первый проект во вкладке «Проекты»" />}
          {activeProjects.slice(0, 4).map((p) => (
            <button key={p.id} style={styles.listItem} onClick={() => setOpenProject(p.id)}>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</div>
                <div className="muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.description || 'Без описания'}
                </div>
              </div>
              <div style={{ width: 70 }}>
                <div style={{ height: 4, borderRadius: 4, background: 'var(--bg-2)' }}>
                  <div style={{ height: '100%', width: `${p.progress}%`, borderRadius: 4, background: 'var(--accent)' }} />
                </div>
                <div className="muted" style={{ fontSize: 10.5, textAlign: 'right', marginTop: 2 }}>{p.progress}%</div>
              </div>
            </button>
          ))}
        </section>

        {/* Последние диалоги */}
        <section className="card anim-in">
          <SectionHeader title="Последние диалоги" onMore={() => setView('chat')} />
          {chats.length === 0 && <Empty text="Диалогов пока нет — начни первый" />}
          {chats.slice(0, 4).map((c) => (
            <button key={c.id} style={styles.listItem}
              onClick={() => { void openChat(c.id); setView('chat') }}>
              <MessageSquare size={14} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
                <div className="muted">{c.messageCount} сообщений · {timeAgo(c.updatedAt)}</div>
              </div>
            </button>
          ))}
        </section>

        {/* Быстрые протоколы */}
        <section className="card anim-in">
          <SectionHeader title="Протоколы" onMore={() => setView('protocols')} />
          {protocols.length === 0 && <Empty text="Протоколы — последовательности действий одним кликом" />}
          {protocols.slice(0, 4).map((p) => (
            <div key={p.id} style={styles.listItem}>
              <Zap size={14} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</div>
                <div className="muted">{p.steps.length} шагов · запусков: {p.runCount}</div>
              </div>
              <button className="icon-btn" title="Запустить" onClick={() => void run(p.id)}>
                <Play size={14} />
              </button>
            </div>
          ))}
        </section>

        {/* Последние изменения */}
        <section className="card anim-in">
          <SectionHeader title="Последние изменения" onMore={() => setView('logs')} />
          {recentChanges.length === 0 && <Empty text="Журнал пока пуст" />}
          {recentChanges.map((l) => (
            <div key={l.id} style={{ ...styles.listItem, cursor: 'default' }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: l.level === 'error' ? 'var(--err)' : l.level === 'warn' ? 'var(--warn)' : 'var(--ok)'
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.message}</div>
                <div className="muted" style={{ fontSize: 11 }}>{l.source} · {timeAgo(l.createdAt)}</div>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

function StatCard({ icon, value, label, onClick }: {
  icon: React.ReactNode; value: number; label: string; onClick: () => void
}) {
  return (
    <button className="card clickable" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left' }} onClick={onClick}>
      <div style={{
        width: 40, height: 40, borderRadius: 11, flexShrink: 0,
        background: 'var(--accent-soft)', color: 'var(--accent-text)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 21, fontWeight: 750 }}>{value}</div>
        <div className="muted">{label}</div>
      </div>
    </button>
  )
}

function SectionHeader({ title, onMore }: { title: string; onMore: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <h3 style={{ fontSize: 14.5, fontWeight: 700 }}>{title}</h3>
      <button className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }} onClick={onMore}>
        Все <ArrowRight size={12} />
      </button>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="muted" style={{ padding: '14px 0' }}>{text}</div>
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} дн назад`
  return new Date(ts).toLocaleDateString('ru-RU')
}

const styles: Record<string, React.CSSProperties> = {
  hero: {
    display: 'flex', alignItems: 'center', gap: 18,
    padding: '26px 28px', marginBottom: 16,
    background: 'linear-gradient(135deg, rgba(139,92,246,0.13), rgba(30,20,60,0.35))',
    border: '1px solid var(--border)', borderRadius: 18,
    backdropFilter: 'blur(16px)'
  },
  heroOrb: { width: 52, height: 52, flexShrink: 0 },
  statsRow: { display: 'flex', gap: 14 },
  listItem: {
    display: 'flex', alignItems: 'center', gap: 11, width: '100%',
    padding: '9px 10px', borderRadius: 9, transition: 'background 0.13s',
    cursor: 'pointer'
  }
}

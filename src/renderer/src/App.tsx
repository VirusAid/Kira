/** Kira — корневой компонент: оболочка, навигация, глобальные оверлеи. */
import { useEffect, useRef } from 'react'
import { TitleBar } from '@/components/TitleBar'
import { Sidebar } from '@/components/Sidebar'
import { RightPanel } from '@/components/RightPanel'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { VoiceOverlay } from '@/components/VoiceOverlay'
import { ImmersiveVoice } from '@/components/ImmersiveVoice'
import { Onboarding } from '@/components/Onboarding'
import { AiActions } from '@/components/AiActions'
import { HomeView } from '@/views/HomeView'
import { ChatView } from '@/views/ChatView'
import { ProjectsView } from '@/views/ProjectsView'
import { ProtocolsView } from '@/views/ProtocolsView'
import { AbilitiesView } from '@/views/AbilitiesView'
import { MemoryView } from '@/views/MemoryView'
import { FilesView } from '@/views/FilesView'
import { AutomationView } from '@/views/AutomationView'
import { IntegrationsView } from '@/views/IntegrationsView'
import { SystemsView } from '@/views/SystemsView'
import { SettingsView } from '@/views/SettingsView'
import { LogsView } from '@/views/LogsView'
import { useAppStore } from '@/state/appStore'
import { useChatStore } from '@/state/chatStore'
import { useLogStore, useMemoryStore, useProjectStore, useProtocolStore, useAutomationStore, useAbilityStore } from '@/state/dataStores'
import { useVoice } from '@/voice/useVoice'
import { speakOnce } from '@/voice/speaker'
import { kira } from '@/api'

export default function App() {
  const { view, rightPanelOpen, loadSettings, setSearchOpen, pushConfirm, settings,
    voiceImmersive, setVoiceImmersive } = useAppStore()
  const voice = useVoice()

  // из боковой панели — с полноэкранным режимом; извне (эмблема/трей) — без него
  const startVoice = (immersive = false): void => { void voice.start(); if (immersive) setVoiceImmersive(true) }
  const stopVoice = (): void => { voice.stop(); setVoiceImmersive(false) }

  // начальная загрузка данных
  useEffect(() => {
    void loadSettings()
    void useChatStore.getState().loadChats()
    void useLogStore.getState().load()
    void useMemoryStore.getState().load()
    void useProjectStore.getState().load()
    void useProtocolStore.getState().load()
    void useAutomationStore.getState().load()
    void useAbilityStore.getState().load()

    // подтверждения опасных действий от Kira
    const offConfirm = kira.on('ai:confirm', (payload) => {
      const { confirmId, description } = payload as { confirmId: string; description: string }
      pushConfirm({ confirmId, description })
    })

    // сработавшее напоминание — Kira озвучивает его
    const offReminder = kira.on('reminder:fired', (payload) => {
      const r = payload as { id: string; text: string }
      if (useAppStore.getState().settings?.voiceEnabled) {
        void speakOnce(`Напоминание: ${r.text}`, `reminder-${r.id}`)
      }
    })

    // вызов по горячей клавише — переходим в чат
    const offSummon = kira.on('app:summon', () => useAppStore.getState().setView('chat'))

    // проактивные фразы Kira (брифинг, предупреждения) — озвучиваем
    const offPulse = kira.on('pulse:say', (payload) => {
      const text = String(payload)
      if (useAppStore.getState().settings?.voiceEnabled) void speakOnce(text, `pulse-${Date.now()}`)
    })

    // переключение голоса из трея
    const offTray = kira.on('tray:toggle-voice', () => {
      const v = useAppStore.getState()
      void v // переключаем через глобальный хук ниже
      window.dispatchEvent(new CustomEvent('kira-toggle-voice'))
    })

    return () => { offConfirm(); offReminder(); offSummon(); offPulse(); offTray() }
  }, [loadSettings, pushConfirm])

  // клик по эмблеме/трею: выкл → слушать; говорит → прервать; иначе → выключить
  useEffect(() => {
    const handler = (): void => {
      if (voice.state === 'off') startVoice()
      else if (voice.state === 'speaking' || voice.state === 'thinking') voice.stopSpeaking()
      else stopVoice()
    }
    window.addEventListener('kira-toggle-voice', handler)
    return () => window.removeEventListener('kira-toggle-voice', handler)
  }, [voice.state])

  // транслируем состояние голоса в угловой оверлей (для окна поверх экрана)
  const voiceRef = useRef({ state: voice.state, level: voice.level })
  voiceRef.current = { state: voice.state, level: voice.level }
  useEffect(() => {
    if (voice.state === 'off') {
      kira.overlay.voiceUpdate({ active: false, state: 'off', level: 0 })
      return
    }
    const id = setInterval(() => {
      const v = voiceRef.current
      kira.overlay.voiceUpdate({ active: true, state: v.state, level: v.level })
    }, 120)
    return () => clearInterval(id)
  }, [voice.state])

  // горячие клавиши
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearchOpen])

  if (!settings) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="aurora" aria-hidden>
        <span className="a1" />
        <span className="a2" />
        <span className="a3" />
      </div>
      <div className="hud-grid" aria-hidden />
      <div className="hud-corners" aria-hidden>
        <span className="tl" /><span className="tr" /><span className="bl" /><span className="br" />
      </div>
      <TitleBar />
      <div className="app-body">
        <Sidebar
          voiceState={voice.state}
          voiceLevel={voice.level}
          onToggleVoice={() => (voice.state === 'off' ? startVoice(true) : stopVoice())}
        />
        <main className="app-main" key={view}>
          <div className="view-enter" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {view === 'home' && <HomeView />}
            {view === 'chat' && <ChatView />}
            {view === 'projects' && <ProjectsView />}
            {view === 'protocols' && <ProtocolsView />}
            {view === 'abilities' && <AbilitiesView />}
            {view === 'memory' && <MemoryView />}
            {view === 'files' && <FilesView />}
            {view === 'automation' && <AutomationView />}
            {view === 'integrations' && <IntegrationsView />}
            {view === 'systems' && <SystemsView />}
            {view === 'settings' && <SettingsView />}
            {view === 'logs' && <LogsView />}
          </div>
        </main>
        {rightPanelOpen && <RightPanel />}
      </div>

      {!settings.onboarded && <Onboarding onDone={() => useAppStore.getState().loadSettings()} />}
      <GlobalSearch />
      <ConfirmDialog />
      <AiActions />
      {voice.state !== 'off' && voiceImmersive ? (
        <ImmersiveVoice
          state={voice.state}
          level={voice.level}
          onMinimize={() => setVoiceImmersive(false)}
          onStop={stopVoice}
        />
      ) : (
        <VoiceOverlay
          state={voice.state}
          level={voice.level}
          error={voice.lastError}
          onExpand={() => setVoiceImmersive(true)}
          onStop={stopVoice}
        />
      )}
    </div>
  )
}

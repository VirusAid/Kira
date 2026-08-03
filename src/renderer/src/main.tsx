import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Overlay from './Overlay'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installErrorHandlers } from './errors'
import './styles/global.css'
import './styles/animations.css'

// маленькое плавающее окно голосового режима (#overlay) vs основное приложение
// подписки ставим ДО отрисовки: ошибка при первом рендере тоже должна дойти
installErrorHandlers()

const isOverlay = window.location.hash.includes('overlay')
if (isOverlay) document.body.classList.add('overlay-body')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>{isOverlay ? <Overlay /> : <App />}</ErrorBoundary>
  </React.StrictMode>
)

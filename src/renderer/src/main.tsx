import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Overlay from './Overlay'
import './styles/global.css'
import './styles/animations.css'

// маленькое плавающее окно голосового режима (#overlay) vs основное приложение
const isOverlay = window.location.hash.includes('overlay')
if (isOverlay) document.body.classList.add('overlay-body')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isOverlay ? <Overlay /> : <App />}</React.StrictMode>
)

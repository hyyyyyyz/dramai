import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { initI18n } from './i18n'
import { App } from './app/App'

await initI18n()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

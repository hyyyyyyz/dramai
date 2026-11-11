import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/v2/styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

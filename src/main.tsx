import './lib/pwaInstall'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
      <PwaUpdatePrompt />
    </AppErrorBoundary>
  </StrictMode>,
)

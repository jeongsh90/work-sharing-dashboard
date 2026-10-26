import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmHost } from '@/components/confirm-dialog'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <ConfirmHost />
    </TooltipProvider>
  </StrictMode>,
)

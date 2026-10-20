import { useEffect, useState } from 'react'

import { AppSidebar } from '@/components/app-sidebar'
import { LoginForm } from '@/components/login-form'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { loadSession, logout, verifySession, type Session } from '@/lib/auth'
import { MENU_GROUPS } from '@/lib/menu'

function environmentName() {
  const { hostname } = window.location
  if (hostname.endsWith('.ts.net')) return 'Tailscale 서버'
  if (hostname.endsWith('github.io')) return 'GitHub Pages'
  return '로컬'
}

const MENU_TITLES = new Map(MENU_GROUPS.flatMap((g) => g.items).map((item) => [item.id, item.title]))

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [activeId, setActiveId] = useState('home')

  useEffect(() => {
    verifySession().then(setSession)
  }, [])

  if (!session) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
        <div className="w-full max-w-sm md:max-w-4xl">
          <LoginForm onLogin={setSession} />
        </div>
      </div>
    )
  }

  return (
    <SidebarProvider>
      <AppSidebar
        session={session}
        activeId={activeId}
        onNavigate={setActiveId}
        onLogout={async () => {
          await logout()
          setSession(null)
          setActiveId('home')
        }}
      />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-center" />
          <h1 className="text-sm font-medium">{MENU_TITLES.get(activeId)}</h1>
        </header>
        <main className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">{environmentName()}</p>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

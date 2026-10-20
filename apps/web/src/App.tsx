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

// 페이지가 바뀔 때 새로 그려지는 영역에 붙이는 페이드 효과.
const FADE_IN = 'animate-in fade-in duration-300 motion-reduce:animate-none'

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [activeId, setActiveId] = useState('home')

  useEffect(() => {
    verifySession().then(setSession)
  }, [])

  if (!session) {
    return (
      <div className={`flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10 ${FADE_IN}`}>
        <div className="w-full max-w-sm md:max-w-4xl">
          <LoginForm onLogin={setSession} />
        </div>
      </div>
    )
  }

  return (
    <SidebarProvider className={FADE_IN}>
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
          <h1 key={activeId} className={`text-sm font-medium ${FADE_IN}`}>
            {MENU_TITLES.get(activeId)}
          </h1>
        </header>
        <div key={activeId} data-page className={`flex flex-1 items-center justify-center ${FADE_IN}`}>
          <p className="text-sm text-muted-foreground">{environmentName()}</p>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

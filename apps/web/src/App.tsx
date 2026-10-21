import { useEffect, useState } from 'react'

import { AppSidebar } from '@/components/app-sidebar'
import { HeaderActions } from '@/components/header-actions'
import { HomePage } from '@/components/home/home-page'
import { LoginForm } from '@/components/login-form'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { loadSession, logout, verifySession, type Session } from '@/lib/auth'
import { MENU_GROUPS } from '@/lib/menu'
import { markAllRead } from '@/lib/notifications'

function environmentName() {
  const { hostname } = window.location
  if (hostname.endsWith('.ts.net')) return 'Tailscale 서버'
  if (hostname.endsWith('github.io')) return 'GitHub Pages'
  return '로컬'
}

const MENU_TITLES = new Map(MENU_GROUPS.flatMap((g) => g.items).map((item) => [item.id, item.title]))

// 페이지가 바뀔 때 새로 그려지는 영역에 붙이는 페이드 효과.
// duration-300 은 transition 시간까지 바꿔 테마 전환 때 글자색이 늦게 바뀌므로 애니메이션 시간만 지정한다.
const FADE_IN = 'animate-in fade-in [--tw-animation-duration:300ms] motion-reduce:animate-none'

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [activeId, setActiveId] = useState('home')

  useEffect(() => {
    verifySession().then(setSession)
  }, [])

  // 알림함을 열면 알림을 확인한 것으로 본다.
  useEffect(() => {
    if (activeId === 'notifications') markAllRead()
  }, [activeId])

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
      <SidebarInset className="min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-center" />
          <h1 key={activeId} className={`text-sm font-medium ${FADE_IN}`}>
            {MENU_TITLES.get(activeId)}
          </h1>
          <HeaderActions onOpenNotifications={() => setActiveId('notifications')} />
        </header>
        <div key={activeId} data-page className={`flex min-w-0 flex-1 flex-col ${FADE_IN}`}>
          {activeId === 'home' ? (
            <HomePage />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
              <p>준비 중인 화면입니다.</p>
              <p className="text-xs">{environmentName()}</p>
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

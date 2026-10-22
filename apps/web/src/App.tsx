import { useEffect, useState } from 'react'

import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { FeedbackPage } from '@/components/feedback-page'
import { FilesPage } from '@/components/files-page'
import { HomePage } from '@/components/home/home-page'
import { MePage } from '@/components/me-page'
import { NotificationsPage } from '@/components/notifications-page'
import { OverlayScrollbar } from '@/components/overlay-scrollbar'
import { LoginForm } from '@/components/login-form'
import { RequestDetailPage } from '@/components/requests/request-detail-page'
import { RequestFormPage } from '@/components/requests/request-form-page'
import { RequestListPage } from '@/components/requests/request-list-page'
import { SignupForm } from '@/components/signup-form'
import { TeamPage } from '@/components/team-page'
import { VersionPage } from '@/components/version-page'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { UNAUTHORIZED_EVENT } from '@/lib/api'
import { useAskOnFirstClick } from '@/lib/desktop-notify'
import { isManager, loadSession, logout, verifySession, writeStored, type Session } from '@/lib/auth'
import { menuFor, PAGE_TITLES } from '@/lib/menu'
import { markAllRead, useNotificationSync } from '@/lib/notifications'
import { navigate, useRoute } from '@/lib/router'
import { useSmoothScroll } from '@/lib/smooth-scroll'
import { clearCache } from '@/lib/store'

function environmentName() {
  const { hostname } = window.location
  if (hostname.endsWith('.ts.net')) return 'Tailscale 서버'
  if (hostname.endsWith('github.io')) return 'GitHub Pages'
  return '로컬'
}

// 페이지가 바뀔 때 새로 그려지는 영역에 붙이는 페이드 효과.
// duration-300 은 transition 시간까지 바꿔 테마 전환 때 글자색이 늦게 바뀌므로 애니메이션 시간만 지정한다.
const FADE_IN = 'animate-in fade-in [--tw-animation-duration:300ms] motion-reduce:animate-none'

function Placeholder() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
      <p>준비 중인 화면입니다.</p>
      <p className="text-xs">{environmentName()}</p>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const route = useRoute()

  // 페이지 전체 스크롤을 Lenis 로 부드럽게
  useSmoothScroll()
  useNotificationSync(session?.id ?? null)
  // PC 알림 권한을 아직 묻지 않았으면 로그인 후 첫 클릭에 묻는다.
  useAskOnFirstClick(!!session)

  useEffect(() => {
    verifySession().then(setSession)
    // 서버가 로그인이 풀렸다고 하면 로그인 화면으로
    const onUnauthorized = () => {
      writeStored(null)
      setSession(null)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  // 알림함을 열면 알림을 확인한 것으로 본다.
  useEffect(() => {
    if (route.page === 'notifications') markAllRead()
  }, [route.page])

  if (!session) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
        <div className="w-full max-w-sm md:max-w-4xl">
          {/* 로그인 전에는 회원가입(#/signup)과 로그인만 있다. */}
          {route.page === 'signup' ? (
            <SignupForm key="signup" className={FADE_IN} />
          ) : (
            <LoginForm key="login" className={FADE_IN} onLogin={setSession} />
          )}
        </div>
      </div>
    )
  }

  // 역할에 없는 메뉴 주소로 들어오면 홈을 보여 준다.
  const allowed = new Set(menuFor(session.role).flatMap((g) => g.items.map((i) => i.id)))
  const page = route.page === 'request-detail' || allowed.has(route.page) ? route.page : 'home'
  const pageKey = page === 'request-detail' ? `request-${route.id}` : page

  const content = (() => {
    switch (page) {
      case 'home':
        return <HomePage />
      case 'request':
        return <RequestFormPage session={session} />
      case 'inbox':
        return <RequestListPage session={session} mode="inbox" />
      case 'my-requests':
        return <RequestListPage session={session} mode="mine" />
      case 'request-detail':
        return (
          <RequestDetailPage
            id={route.id!}
            session={session}
            onBack={() => (window.history.length > 1 ? window.history.back() : navigate(isManager(session) ? 'inbox' : 'home'))}
          />
        )
      case 'files':
        return <FilesPage />
      case 'notifications':
        return <NotificationsPage />
      case 'me':
        return <MePage session={session} onSessionChange={setSession} />
      case 'team':
        return <TeamPage session={session} />
      case 'feedback':
        return <FeedbackPage session={session} />
      case 'version':
        return <VersionPage />
      default:
        return <Placeholder />
    }
  })()

  return (
    <SidebarProvider className={FADE_IN}>
      <AppSidebar
        session={session}
        activeId={page === 'request-detail' ? '' : page}
        onNavigate={(id) => navigate(id)}
        onSessionChange={setSession}
        onLogout={async () => {
          await logout()
          clearCache()
          setSession(null)
          navigate('home')
        }}
      />
      <SidebarInset className="min-w-0">
        {/* 페이지 세로 스크롤바: 헤더 아래 오른쪽 */}
        <OverlayScrollbar target={() => window} className="fixed top-16 right-0.5 bottom-1 w-1.5" />
        <AppHeader
          title={PAGE_TITLES[page] ?? ''}
          titleClassName={FADE_IN}
          onOpenNotifications={() => navigate('notifications')}
          // 요청자는 어느 화면에서든 헤더 오른쪽 버튼으로 바로 디자인 요청을 쓴다.
          onNewRequest={session.role === 'requester' ? () => navigate('request') : undefined}
        />
        <div key={pageKey} data-page className={`flex min-w-0 flex-1 flex-col ${FADE_IN}`}>
          {content}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

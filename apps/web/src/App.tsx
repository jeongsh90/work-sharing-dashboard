import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react'

import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { HomePage } from '@/components/home/home-page'
import { OverlayScrollbar } from '@/components/overlay-scrollbar'
import { LoginForm } from '@/components/login-form'
import { PageState } from '@/components/page-state'
import { dockItemCount, FloatingDock } from '@/components/home/floating-dock'
import { UpdateNotice } from '@/components/update-notice'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { UNAUTHORIZED_EVENT } from '@/lib/api'
import { useAskOnFirstClick } from '@/lib/desktop-notify'
import { isManager, loadSession, logout, verifySession, writeStored, type Session } from '@/lib/auth'
import { menuFor, PAGE_TITLES } from '@/lib/menu'
import { markAllRead, useNotificationSync } from '@/lib/notifications'
import { navigate, useRoute } from '@/lib/router'
import { recoverScroll, useSmoothScroll } from '@/lib/smooth-scroll'
import { clearCache } from '@/lib/store'

// 홈 말고는 화면을 열 때 받는다(첫 화면이 빨리 뜨게). 로그인한 뒤 잠깐 쉬었다가 미리 받아 두어
// 메뉴를 누를 때 네트워크를 기다리지 않게 한다(연결이 느리거나 PC 가 막 깨어났을 때 "불러오는 중"이 오래 남지 않게).
const PAGE_LOADERS: (() => Promise<unknown>)[] = []
function lazyPage<M, C extends ComponentType<any>>(load: () => Promise<M>, pick: (m: M) => C) {
  PAGE_LOADERS.push(load)
  return lazy(() => load().then((m) => ({ default: pick(m) })))
}
const FeedbackPage = lazyPage(() => import('@/components/feedback-page'), (m) => m.FeedbackPage)
const FilesPage = lazyPage(() => import('@/components/files-page'), (m) => m.FilesPage)
const LibraryPage = lazyPage(() => import('@/components/library-page'), (m) => m.LibraryPage)
const NoticeListPage = lazyPage(() => import('@/components/notices/notice-list-page'), (m) => m.NoticeListPage)
const NoticeDetailPage = lazyPage(() => import('@/components/notices/notice-detail-page'), (m) => m.NoticeDetailPage)
const NoticeEditPage = lazyPage(() => import('@/components/notices/notice-edit-page'), (m) => m.NoticeEditPage)
const MePage = lazyPage(() => import('@/components/me-page'), (m) => m.MePage)
const NotificationsPage = lazyPage(() => import('@/components/notifications-page'), (m) => m.NotificationsPage)
const RequestDetailPage = lazyPage(() => import('@/components/requests/request-detail-page'), (m) => m.RequestDetailPage)
const RequestFormPage = lazyPage(() => import('@/components/requests/request-form-page'), (m) => m.RequestFormPage)
const RequestListPage = lazyPage(() => import('@/components/requests/request-list-page'), (m) => m.RequestListPage)
const SchedulePage = lazyPage(() => import('@/components/schedule-page'), (m) => m.SchedulePage)
const OrgPage = lazyPage(() => import('@/components/org-page'), (m) => m.OrgPage)
const SignupForm = lazy(() => import('@/components/signup-form').then((m) => ({ default: m.SignupForm })))
const TeamPage = lazyPage(() => import('@/components/team-page'), (m) => m.TeamPage)
const ToolsPage = lazyPage(() => import('@/components/tools-page'), (m) => m.ToolsPage)
const LoginBackground = lazy(() => import('@/components/login-background'))
const WorklogPage = lazyPage(() => import('@/components/worklog-page'), (m) => m.WorklogPage)
const VersionPage = lazyPage(() => import('@/components/version-page'), (m) => m.VersionPage)

// 새 버전을 올리면 예전 화면 조각 파일이 사라진다. 그 조각을 못 받으면 새로 고쳐 새 버전을 받는다.
window.addEventListener('vite:preloadError', () => window.location.reload())

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

const DOCK_PAD = ['', 'pb-16', 'pb-32', 'pb-48']

// 자동 새로 고침을 하지 않는 화면(긴 글을 쓰는 화면)
const NO_AUTO_RELOAD = new Set<string>(['request', 'notice-edit'])

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const route = useRoute()

  // 페이지 전체 스크롤을 Lenis 로 부드럽게
  useSmoothScroll()
  useNotificationSync(session?.id ?? null)
  // PC 알림 권한을 아직 묻지 않았으면 로그인 후 첫 클릭에 묻는다.
  useAskOnFirstClick(!!session)
  // 3분마다 사이트를 새로 받는다(새 버전·데이터 반영). 글을 쓰는 중이거나 창(대화상자)이 열려 있으면
  // 입력이 날아가지 않게 그때는 건너뛰고 1분 뒤 다시 확인한다.
  // 디자인 요청 작성·공지 작성 화면은 칸에서 잠깐 손을 떼도(파일 고르기·다른 창 보기) 내용이 날아가지 않게 아예 새로 고치지 않는다.
  const pageRef = useRef(route.page)
  pageRef.current = route.page
  useEffect(() => {
    let last = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - last < 3 * 60_000) return
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      const overlayOpen = !!document.querySelector('[role=dialog][data-state=open], [role=alertdialog][data-state=open]')
      const writing = NO_AUTO_RELOAD.has(pageRef.current)
      if (typing || overlayOpen || writing || document.visibilityState !== 'visible') {
        last = Date.now() - 2 * 60_000
        return
      }
      last = Date.now()
      window.location.reload()
    }, 30_000)
    return () => clearInterval(timer)
  }, [])

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

  // 로그인해 있으면 첫 화면이 뜬 뒤 나머지 화면 조각을 미리 받아 둔다
  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => PAGE_LOADERS.forEach((load) => load().catch(() => {})), 1500)
    return () => clearTimeout(timer)
  }, [session])

  // 알림함을 열면 알림을 확인한 것으로 본다.
  useEffect(() => {
    if (route.page === 'notifications') markAllRead()
  }, [route.page])

  // 화면을 옮기면 창·메뉴가 닫히는 효과가 끝난 뒤 남은 스크롤 잠금이 있는지 확인해 푼다.
  useEffect(() => {
    const timer = setTimeout(recoverScroll, 400)
    return () => clearTimeout(timer)
  }, [route.page, route.id])

  if (!session) {
    return (
      <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-muted p-6 md:p-10">
        {/* 배경 그림(gsap 을 쓰므로 따로 불러온다) */}
        <Suspense fallback={null}>
          <LoginBackground />
        </Suspense>
        <div className="relative z-10 w-full max-w-sm md:max-w-4xl">
          {/* 로그인 전에는 회원가입(#/signup)과 로그인만 있다. */}
          {route.page === 'signup' ? (
            <Suspense fallback={<PageState />}>
              <SignupForm key="signup" className={FADE_IN} />
            </Suspense>
          ) : (
            <LoginForm key="login" className={FADE_IN} onLogin={setSession} />
          )}
        </div>
      </div>
    )
  }

  // 역할에 없는 메뉴 주소로 들어오면 홈을 보여 준다.
  const allowed = new Set(menuFor(session).flatMap((g) => g.items.map((i) => i.id)))
  // 공지사항 상세는 누구나, 쓰기·고치기는 관리자만
  if (allowed.has('notices')) allowed.add('notice-detail')
  if (isManager(session)) allowed.add('notice-edit')
  const page = route.page === 'request-detail' || allowed.has(route.page) ? route.page : 'home'
  const pageKey = page === 'request-detail' ? `request-${route.id}` : page.startsWith('notice-') ? `${page}-${route.id}` : page
  // 요청 상세는 아래 처리 버튼이 있어 오른쪽 아래 버튼 묶음을 숨긴다
  const showDock = page !== 'request-detail'

  const content = (() => {
    switch (page) {
      case 'home':
        return <HomePage session={session} onSessionChange={setSession} />
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
      case 'notices':
        return <NoticeListPage session={session} />
      case 'notice-detail':
        return <NoticeDetailPage id={route.id!} session={session} />
      case 'notice-edit':
        return <NoticeEditPage id={route.id!} />
      case 'library':
        return <LibraryPage session={session} />
      case 'notifications':
        return <NotificationsPage />
      case 'me':
        return <MePage session={session} onSessionChange={setSession} />
      case 'team':
        return <TeamPage session={session} />
      case 'feedback':
        return <FeedbackPage session={session} />
      case 'version':
        return <VersionPage session={session} />
      case 'schedule':
        return <SchedulePage session={session} />
      case 'org':
        return <OrgPage />
      case 'tools':
        return <ToolsPage />
      case 'worklog':
        return <WorklogPage session={session} />
      default:
        return <Placeholder />
    }
  })()

  // 계정을 바꾸면 이 탭의 로그인을 새 계정으로 바꾸고, 받아 둔 데이터를 비운 뒤 홈으로 간다.
  const onSwitched = (token: string, user: Session) => {
    writeStored({ token, user })
    clearCache()
    setSession(user)
    navigate('home')
  }

  return (
    <SidebarProvider className={FADE_IN}>
      <AppSidebar
        session={session}
        activeId={page === 'request-detail' ? '' : page.startsWith('notice-') ? 'notices' : page}
        onNavigate={(id) => navigate(id)}
        onSessionChange={setSession}
        onLogout={async () => {
          await logout()
          clearCache()
          setSession(null)
          navigate('home')
        }}
        onSwitched={onSwitched}
      />
      {/* 로그인하면 업데이트 공지(다시 보지 않기 전까지) */}
      <UpdateNotice key={session.id} session={session} />
      <SidebarInset className="min-w-0">
        {/* 페이지 세로 스크롤바: 헤더 아래 오른쪽 */}
        <OverlayScrollbar target={() => window} className="fixed top-16 right-0.5 bottom-1 w-1.5" />
        <AppHeader
          title={PAGE_TITLES[page] ?? ''}
          titleClassName={FADE_IN}
          onOpenNotifications={() => navigate('notifications')}
          // 요청자는 어느 화면에서든 헤더 오른쪽 버튼으로 바로 디자인 요청을 쓴다.
          onNewRequest={session.role === 'requester' ? () => navigate('request') : undefined}
          currentId={session.id}
          onSwitched={onSwitched}
        />
        {/* 오른쪽 아래 버튼 묶음(컨펌 대기·받은 요청·내 현재 상태)이 내용 끝을 가리지 않게 아래 여백을 둔다.
            요청 상세에서는 아래 처리 버튼과 겹쳐 버튼 묶음을 숨긴다 */}
        <div key={pageKey} data-page className={`flex min-w-0 flex-1 flex-col ${showDock ? DOCK_PAD[dockItemCount(session)] : ''} ${FADE_IN}`}>
          <Suspense fallback={<PageState />}>{content}</Suspense>
        </div>
        {showDock && <FloatingDock session={session} onSessionChange={setSession} raised={page === 'request'} />}
      </SidebarInset>
    </SidebarProvider>
  )
}

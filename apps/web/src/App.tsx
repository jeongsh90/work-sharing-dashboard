import { useEffect, useState } from 'react'

import { LoginForm } from '@/components/login-form'
import { Button } from '@/components/ui/button'
import { loadSession, logout, verifySession, type Session } from '@/lib/auth'

function environmentName() {
  const { hostname } = window.location
  if (hostname.endsWith('.ts.net')) return 'Tailscale 서버'
  if (hostname.endsWith('github.io')) return 'GitHub Pages'
  return '로컬'
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)

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
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-end gap-3 border-b px-6 py-3 text-sm">
        <span>
          {session.name} ({session.id})
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await logout()
            setSession(null)
          }}
        >
          로그아웃
        </Button>
      </header>
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{environmentName()}</p>
      </main>
    </div>
  )
}

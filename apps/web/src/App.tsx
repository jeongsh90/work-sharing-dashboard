function environmentName() {
  const { hostname } = window.location
  if (hostname.endsWith('.ts.net')) return 'Tailscale 서버'
  if (hostname.endsWith('github.io')) return 'GitHub Pages'
  return '로컬'
}

export default function App() {
  return (
    <main className="flex min-h-svh items-center justify-center">
      <p className="text-sm text-muted-foreground">{environmentName()}</p>
    </main>
  )
}

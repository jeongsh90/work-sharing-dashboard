import { useEffect } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Section } from "@/components/home/home-page"
import { PAGE_GRID } from "@/lib/layout"
import type { Session } from "@/lib/auth"
import { formatDateTime } from "@/lib/requests"
import { markSeen } from "@/lib/seen"
import { APP_VERSION, BUILD_TIME, CHANGELOG, COMMIT } from "@/lib/version"

function environmentName() {
  const { hostname } = window.location
  if (hostname.endsWith(".ts.net")) return "사내 서버(Tailscale)"
  if (hostname.endsWith("github.io")) return "GitHub Pages"
  return "로컬"
}

export function VersionPage({ session }: { session: Session }) {
  // 버전 정보를 열면 이번 버전은 본 것으로 본다(메뉴의 N 표시가 사라진다).
  useEffect(() => markSeen(session.id, "version", APP_VERSION), [session.id])
  const rows = [
    ["버전", `v${APP_VERSION}`],
    ["배포 일시", `${BUILD_TIME.getFullYear()}년 ${formatDateTime(BUILD_TIME)}`],
    ["커밋", COMMIT || "-"],
    ["접속 주소", `${environmentName()} · ${window.location.host}`],
  ]

  return (
    <div className={PAGE_GRID}>
      <div className="col-span-12 flex flex-col gap-6 lg:col-span-8 xl:col-span-6">
        <Card>
          <CardHeader>
            <CardTitle>디자인 요청·작업 관리 시스템</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Section title="변경 내역">
          <ol className="flex flex-col gap-3">
            {CHANGELOG.map((r, i) => (
              <li key={r.version} className="rounded-xl border bg-card p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-semibold tabular-nums">v{r.version}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{r.date}</span>
                  {i === 0 && <Badge variant="secondary">현재</Badge>}
                </div>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                  {r.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  )
}

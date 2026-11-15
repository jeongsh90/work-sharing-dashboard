import { useState } from "react"
import { Check, Copy, ExternalLink } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Section } from "@/components/home/home-page"
import { PAGE_GRID } from "@/lib/layout"
import { copyText } from "@/lib/clipboard"

// 지원 > 접속 주소·IP: 디자인 요청 시스템(과 영업 대시보드)에 들어오는 주소와 서버 PC 의 IP 를 한 곳에 모은다.
// 주소·IP 가 바뀌면 아래 값만 고치면 된다(사내 IP 는 공유기가 바꿀 수 있다. 빠른 주소는 서버가 5분마다 저절로 맞춘다).

type Address = { url: string; where: string; note: string }

const SITES: { title: string; addresses: Address[] }[] = [
  {
    title: "디자인 요청 시스템",
    addresses: [
      { url: "https://desktop-ai8fjlj.tail1460cb.ts.net", where: "어디서나", note: "회사 밖·휴대폰(데이터)에서도 들어옵니다. 기본 주소." },
      { url: "https://owenfood-wsd.duckdns.org:4443", where: "사무실 안", note: "사무실 와이파이·유선에서만. 큰 파일 올리고 받기가 가장 빠릅니다." },
      { url: "http://192.168.219.101:4173", where: "사무실 안", note: "IP 로 바로 들어가는 주소." },
      { url: "http://100.126.235.112:4173", where: "Tailscale", note: "Tailscale 을 켠 PC·휴대폰에서." },
    ],
  },
  {
    title: "영업 대시보드",
    addresses: [
      { url: "https://desktop-ai8fjlj.tail1460cb.ts.net:8443", where: "어디서나", note: "회사 밖·휴대폰(데이터)에서도 들어옵니다." },
      { url: "http://192.168.219.101:4174", where: "사무실 안", note: "IP 로 바로 들어가는 주소." },
      { url: "http://100.126.235.112:4174", where: "Tailscale", note: "Tailscale 을 켠 PC·휴대폰에서." },
    ],
  },
]

const IPS: { label: string; ip: string; note: string }[] = [
  { label: "사무실 내부 IP (서버 PC)", ip: "192.168.219.101", note: "사무실 안에서 쓰는 주소" },
  { label: "Tailscale IP", ip: "100.126.235.112", note: "Tailscale 에 연결된 기기끼리 쓰는 주소" },
  { label: "사무실 공인 IP", ip: "106.243.95.34", note: "밖에서 보이는 회사 주소. 이 IP 로 바로 들어오지는 못합니다." },
]

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`${label} 복사`}
      onClick={async () => {
        await copyText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check /> : <Copy />}
    </Button>
  )
}

export function AccessPage() {
  const here = window.location.origin

  return (
    <div className={PAGE_GRID}>
      <div className="col-span-12 flex flex-col gap-6 lg:col-span-10 lg:col-start-2 xl:col-span-8 xl:col-start-3">
        {SITES.map((site) => (
          <Section key={site.title} title={site.title}>
            <ul className="flex flex-col divide-y rounded-xl border bg-card">
              {site.addresses.map((a) => {
                const current = a.url === here
                return (
                  <li key={a.url} className="flex items-center gap-3 px-4 py-3">
                    <Badge variant="outline" className="w-20 shrink-0 justify-center">
                      {a.where}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm break-all">{a.url}</span>
                        {current && <Badge variant="secondary">지금 접속한 주소</Badge>}
                      </p>
                      <p className="text-xs break-keep text-muted-foreground">{a.note}</p>
                    </div>
                    <CopyButton text={a.url} label={a.url} />
                    <Button variant="ghost" size="icon-sm" asChild>
                      <a href={a.url} target="_blank" rel="noreferrer" aria-label={`${a.url} 새 창으로 열기`}>
                        <ExternalLink />
                      </a>
                    </Button>
                  </li>
                )
              })}
            </ul>
          </Section>
        ))}

        <Section title="IP 주소">
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {IPS.map((x) => (
              <li key={x.ip} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{x.label}</p>
                  <p className="text-xs break-keep text-muted-foreground">{x.note}</p>
                </div>
                <span className="font-mono text-sm tabular-nums">{x.ip}</span>
                <CopyButton text={x.ip} label={x.label} />
              </li>
            ))}
          </ul>
          <p className="text-xs break-keep text-muted-foreground">
            사무실 안 주소가 안 열리면 회사 밖 주소(ts.net)로 들어와 주세요. 사무실 내부 IP 는 공유기 설정에 따라 바뀔 수 있습니다.
          </p>
        </Section>
      </div>
    </div>
  )
}

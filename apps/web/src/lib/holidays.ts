import { useMemo } from 'react'

import { useApi } from './store'

// 공휴일(서버 /api/holidays 가 공공데이터포털 특일 정보를 받아 둔다). 날짜 'yyyy-MM-dd' → 이름
type Holiday = { date: string; name: string }

const pad = (n: number) => String(n).padStart(2, '0')
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// 두 해까지(달력이 연말·연초에 걸칠 때) 받는다. 공휴일은 잘 바뀌지 않아 하루에 한 번만 새로 받는다.
export function useHolidays(fromYear: number, toYear = fromYear) {
  const first = useApi<Holiday[]>(`/holidays?year=${fromYear}`, 86_400_000)
  const second = useApi<Holiday[]>(toYear !== fromYear ? `/holidays?year=${toYear}` : null, 86_400_000)
  return useMemo(
    () => new Map([...(first.data ?? []), ...(second.data ?? [])].map((h) => [h.date, h.name] as const)),
    [first.data, second.data],
  )
}

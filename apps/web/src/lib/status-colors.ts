import type { RequestStatus } from './requests'

// 상태별 색. 상태 배지와 작업자 카드의 작업 표시가 같은 색을 쓴다.
// 글자와 함께 보여 색만으로 구분하지 않는다.
export const STATUS_TEXT: Record<RequestStatus, string> = {
  requested: 'text-slate-700 dark:text-slate-300',
  'needs-info': 'text-amber-800 dark:text-amber-300',
  waiting: 'text-sky-700 dark:text-sky-300',
  'in-progress': 'text-blue-700 dark:text-blue-300',
  review: 'text-violet-700 dark:text-violet-300',
  revising: 'text-orange-800 dark:text-orange-300',
  approved: 'text-teal-700 dark:text-teal-300',
  done: 'text-emerald-700 dark:text-emerald-300',
  canceled: 'text-muted-foreground',
}

export const STATUS_BG: Record<RequestStatus, string> = {
  requested: 'bg-slate-500/10',
  'needs-info': 'bg-amber-500/15',
  waiting: 'bg-sky-500/10',
  'in-progress': 'bg-blue-500/10',
  review: 'bg-violet-500/10',
  revising: 'bg-orange-500/15',
  approved: 'bg-teal-500/10',
  done: 'bg-emerald-500/10',
  canceled: 'bg-muted',
}

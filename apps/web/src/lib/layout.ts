// 본문 레이아웃 기준: 본문 폭을 모두 쓰는 12칸 그리드. 각 영역은 col-span-* 으로 칸 수를 정한다.
export const PAGE_GRID = 'grid w-full grid-cols-12 gap-x-4 gap-y-8 p-4 md:gap-x-6 md:p-6'

// 영역 안에서 다시 12칸으로 나눌 때 쓴다(카드 묶음 등).
export const INNER_GRID = 'grid grid-cols-12 gap-4 md:gap-6'

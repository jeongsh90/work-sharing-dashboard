import Lenis, { type LenisOptions } from 'lenis'
import { useEffect, type RefObject } from 'react'

// 페이지(창) 전체에 붙은 Lenis. 화면 안 특정 위치로 옮길 때 쓴다.
let pageLenis: Lenis | null = null

// 요소가 화면 가운데쯤 오게 부드럽게 스크롤한다.
export function scrollToElement(el: HTMLElement) {
  const offset = -(window.innerHeight / 2 - el.getBoundingClientRect().height / 2)
  if (pageLenis) pageLenis.scrollTo(el, { offset })
  else el.scrollIntoView({ block: 'center' })
}

// Lenis 부드러운 스크롤(https://lenis.dev). 움직임 줄이기 설정이면 기본 스크롤을 쓴다.
// wrapperRef 를 주면 그 요소(스크롤 영역)와 첫 자식(내용)에 붙이고, 없으면 페이지(창) 전체에 붙인다.
// allowNestedScroll: 안쪽에서 따로 스크롤되는 영역(사이드바, 표 등)은 그 영역이 스크롤되게 둔다.
export function useSmoothScroll(options: LenisOptions = {}, wrapperRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const wrapper = wrapperRef?.current
    if (wrapperRef && !wrapper) return
    const lenis = new Lenis({
      autoRaf: true,
      allowNestedScroll: true,
      ...options,
      ...(wrapper ? { wrapper, content: wrapper.firstElementChild ?? wrapper } : {}),
    })
    if (!wrapper) pageLenis = lenis
    return () => {
      if (pageLenis === lenis) pageLenis = null
      lenis.destroy()
    }
    // 옵션은 처음 한 번만 적용한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

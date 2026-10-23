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

// 열린 창(대화상자)·메뉴가 없는데 스크롤 잠금이 남아 있으면 푼다.
// (Radix 창이 닫히는 도중 화면이 바뀌면 body 의 잠금 표시가 남아 페이지 스크롤이 멈출 수 있다)
// 휠을 굴릴 때마다 불리므로 잠금이 실제로 남아 있을 때만 DOM 을 찾고 고친다(평소에는 속성 몇 개만 본다).
export function recoverScroll() {
  const body = document.body
  const locked =
    body.hasAttribute('data-scroll-locked') ||
    body.style.pointerEvents === 'none' ||
    body.style.overflow === 'hidden' ||
    !!pageLenis?.isStopped
  if (!locked) return
  const overlayOpen = document.querySelector(
    '[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu][data-state=open], [data-radix-popper-content-wrapper]',
  )
  if (overlayOpen) return
  body.removeAttribute('data-scroll-locked')
  if (body.style.pointerEvents === 'none') body.style.pointerEvents = ''
  if (body.style.overflow === 'hidden') body.style.overflow = ''
  if (pageLenis?.isStopped) pageLenis.start()
  pageLenis?.resize()
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
    // 스크롤이 멈춘 채 남는 경우를 막는다: 휠을 굴릴 때 열린 창·메뉴가 없으면 남은 스크롤 잠금을 풀고 다시 움직이게 한다.
    let queued = false
    const onWheel = () => {
      if (wrapper || queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        recoverScroll()
      })
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel)
      if (pageLenis === lenis) pageLenis = null
      lenis.destroy()
    }
    // 옵션은 처음 한 번만 적용한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

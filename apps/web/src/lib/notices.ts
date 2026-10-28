import DOMPurify from 'dompurify'

import { fileUrl } from './api'

// 공지사항(서버 apps/api/src/notices.ts)

export type NoticeSummary = {
  id: number
  title: string
  pinned: boolean
  authorId: string
  authorName: string
  createdAt: number
  updatedAt: number
  views: number
  attachments: number
  read: boolean
}

export type NoticeFile = { id: string; name: string; mime: string; size: number }

export type NoticeDetail = NoticeSummary & {
  body: string
  files: NoticeFile[]
  prev: { id: number; title: string } | null
  next: { id: number; title: string } | null
}

// 본문 그림은 로그인이 필요해 주소(src) 대신 파일 id(data-file-id)로 저장하고, 보여 줄 때 브라우저 안 주소로 바꾼다.

// 저장용: 그림 주소(blob:)를 빼고 파일 id 만 남긴다
export function toStoredHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('img[data-file-id]').forEach((img) => img.removeAttribute('src'))
  // 끝에 남은 빈 줄은 뺀다
  let last = doc.body.lastElementChild
  while (last && last.tagName === 'P' && !last.textContent?.trim() && !last.querySelector('img')) {
    last.remove()
    last = doc.body.lastElementChild
  }
  return doc.body.innerHTML
}

// 보여 주기용: 안전한 태그만 남기고(sanitize), 그림에 브라우저 안 주소를 채운다. 링크는 새 창으로.
export async function toViewHtml(html: string) {
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['data-file-id', 'target'] })
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  await Promise.all(
    [...doc.querySelectorAll<HTMLImageElement>('img[data-file-id]')].map(async (img) => {
      try {
        img.src = await fileUrl(img.dataset.fileId!)
      } catch {
        img.alt = img.alt || '그림을 불러오지 못했습니다'
      }
    }),
  )
  doc.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  })
  return doc.body.innerHTML
}

// 최근 사흘 안에 올라온 글
export const isRecent = (at: number) => Date.now() - at < 3 * 24 * 60 * 60 * 1000

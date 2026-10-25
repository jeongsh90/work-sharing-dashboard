import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

import { UPLOAD_DIR } from './config.ts'

// 화면에 보여 줄 줄인 이미지. 원본은 그대로 두고, 처음 요청할 때 만들어 uploads/resized 에 저장해 둔다.
// thumb: 목록·슬라이드 아래 작은 그림 칸(정사각 320px, 칸에 맞게 가운데를 잘라 채운다)
// view: 이미지를 눌렀을 때 보는 크기(긴 쪽 2000px 안으로, 비율 유지)
// wide: 세로로 긴 시안을 그대로 보는 곳(가로 1600px 안으로, 세로는 비율대로)
const SIZES = {
  thumb: (img: sharp.Sharp) => img.resize(320, 320, { fit: 'cover', withoutEnlargement: true }),
  view: (img: sharp.Sharp) => img.resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }),
  wide: (img: sharp.Sharp) => img.resize({ width: 1600, withoutEnlargement: true }),
}
export type ImageSize = keyof typeof SIZES

export const isImageSize = (v: string): v is ImageSize => v in SIZES

// 움직이는 GIF·SVG 는 원본 그대로 보낸다.
export const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

const RESIZED_DIR = join(UPLOAD_DIR, 'resized')
const pending = new Map<string, Promise<Buffer>>()

export function resizedImage(fileId: string, size: ImageSize) {
  const key = `${fileId}-${size}`
  let job = pending.get(key)
  if (!job) {
    job = (async () => {
      const target = join(RESIZED_DIR, `${key}.webp`)
      try {
        return await readFile(target)
      } catch {
        // 아직 없으면 만든다
      }
      const out = await SIZES[size](sharp(join(UPLOAD_DIR, fileId), { limitInputPixels: false }).rotate())
        .webp({ quality: size === 'thumb' ? 78 : 85 })
        .toBuffer()
      await mkdir(RESIZED_DIR, { recursive: true })
      const tmp = `${target}.${process.pid}.tmp`
      await writeFile(tmp, out)
      await rename(tmp, target)
      return out
    })()
    pending.set(key, job)
    job.finally(() => pending.delete(key)).catch(() => {})
  }
  return job
}

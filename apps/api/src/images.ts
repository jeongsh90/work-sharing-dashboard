import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

import { UPLOAD_DIR } from './config.ts'

// 화면에 보여 줄 줄인 이미지. 원본은 그대로 두고, 처음 요청할 때 만들어 uploads/resized 에 저장해 둔다.
// thumb: 목록·슬라이드 아래 작은 그림 칸(정사각 320px, 칸에 맞게 가운데를 잘라 채운다)
// view: 이미지를 눌렀을 때 보는 크기(긴 쪽 2000px 안으로, 비율 유지)
// wide: 세로로 긴 시안을 그대로 보는 곳(가로 1600px 안으로, 세로는 비율대로)
// w640~w1920: 보여 줄 칸 너비에 맞춘 가로 크기(세로는 비율대로). 원본보다 키우지 않는다.
// v640~v1920: 보여 줄 칸(가로·세로) 안에 들어가는 크기(크게 보기 창). 원본보다 키우지 않는다.
const byWidth = (width: number) => (img: sharp.Sharp) => img.resize({ width, withoutEnlargement: true })
const inBox = (n: number) => (img: sharp.Sharp) => img.resize(n, n, { fit: 'inside', withoutEnlargement: true })
const SIZES = {
  thumb: (img: sharp.Sharp) => img.resize(320, 320, { fit: 'cover', withoutEnlargement: true }),
  view: (img: sharp.Sharp) => img.resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }),
  wide: byWidth(1600),
  w640: byWidth(640),
  w960: byWidth(960),
  w1280: byWidth(1280),
  w1600: byWidth(1600),
  w1920: byWidth(1920),
  v640: inBox(640),
  v960: inBox(960),
  v1280: inBox(1280),
  v1600: inBox(1600),
  v1920: inBox(1920),
}
export type ImageSize = keyof typeof SIZES

export const isImageSize = (v: string): v is ImageSize => Object.hasOwn(SIZES, v)

// 움직이는 GIF·SVG 는 원본 그대로 보낸다.
export const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

const RESIZED_DIR = join(UPLOAD_DIR, 'resized')
// 줄인 이미지. null 이면 줄이지 못해(너무 긴 이미지) 원본을 그대로 보낸다.
export type Resized = { data: Buffer; type: 'image/webp' | 'image/jpeg' } | null
const pending = new Map<string, Promise<Resized>>()

// WebP 는 가로·세로 16383px 까지라, 세로로 아주 긴 상세페이지 시안은 JPEG(65535px 까지)로 만든다.
// 그보다도 길면 원본을 그대로 보낸다.
const WEBP_MAX = 16383
const JPEG_MAX = 65535

// 줄인 뒤 크기(긴 쪽). 원본보다 키우지 않는다.
function outLongest(size: ImageSize, width: number, height: number) {
  if (size === 'thumb') return Math.min(320, Math.max(width, height))
  const box = size === 'view' ? 2000 : size.startsWith('v') ? Number(size.slice(1)) : 0
  const scale = box ? Math.min(1, box / width, box / height) : Math.min(1, (size === 'wide' ? 1600 : Number(size.slice(1))) / width)
  return Math.round(Math.max(width, height) * scale)
}

// 만들어 둔 것이 있으면 그것(undefined 면 아직 없음)
async function cached(key: string): Promise<Resized | undefined> {
  for (const [ext, type] of [['webp', 'image/webp'], ['jpg', 'image/jpeg']] as const) {
    try {
      return { data: await readFile(join(RESIZED_DIR, `${key}.${ext}`)), type }
    } catch {
      // 없으면 다음
    }
  }
  try {
    await readFile(join(RESIZED_DIR, `${key}.original`))
    return null
  } catch {
    return undefined
  }
}

async function save(name: string, data: Buffer) {
  await mkdir(RESIZED_DIR, { recursive: true })
  const target = join(RESIZED_DIR, name)
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, target)
}

export function resizedImage(fileId: string, size: ImageSize) {
  const key = `${fileId}-${size}`
  let job = pending.get(key)
  if (!job) {
    job = (async (): Promise<Resized> => {
      const hit = await cached(key)
      if (hit !== undefined) return hit
      // 줄인 뒤 크기를 먼저 셈해서 형식을 고른다(사진 방향 정보로 가로·세로가 바뀌는 경우 포함)
      const meta = await sharp(join(UPLOAD_DIR, fileId), { limitInputPixels: false }).metadata()
      const turned = (meta.orientation ?? 1) >= 5
      const w = (turned ? meta.height : meta.width) ?? 1
      const h = (turned ? meta.width : meta.height) ?? 1
      const longest = outLongest(size, w, h)
      if (longest > JPEG_MAX) {
        await save(`${key}.original`, Buffer.alloc(0))
        return null
      }
      const quality = size === 'thumb' ? 78 : 85
      const img = SIZES[size](sharp(join(UPLOAD_DIR, fileId), { limitInputPixels: false }).rotate())
      if (longest <= WEBP_MAX) {
        const data = await img.webp({ quality }).toBuffer()
        await save(`${key}.webp`, data)
        return { data, type: 'image/webp' }
      }
      // JPEG 는 투명을 못 담아 흰 바탕으로 채운다
      const data = await img.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
      await save(`${key}.jpg`, data)
      return { data, type: 'image/jpeg' }
    })()
    pending.set(key, job)
    job.finally(() => pending.delete(key)).catch(() => {})
  }
  return job
}

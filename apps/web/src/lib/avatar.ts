import { api, uploadFile } from './api'
import { updateStoredUser, type Session } from './auth'
import { invalidate } from './store'

// 프로필 사진: 가운데를 정사각형으로 잘라 256px JPEG 로 줄인 뒤 올린다(원본이 커도 몇십 KB).
const SIZE = 256

async function squareJpeg(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff' // 투명 PNG 는 흰 바탕
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진을 바꾸지 못했습니다.'))), 'image/jpeg', 0.88),
  )
  return new File([blob], 'profile.jpg', { type: 'image/jpeg' })
}

async function saveAvatar(avatarId: string | null) {
  const { user } = await api<{ user: Session }>('/me', { method: 'PATCH', body: { avatarId } })
  updateStoredUser(user)
  invalidate()
  return user
}

export async function uploadAvatar(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일을 골라 주세요.')
  const uploaded = await uploadFile(await squareJpeg(file))
  return saveAvatar(uploaded.id)
}

export function removeAvatar() {
  return saveAvatar(null)
}

// 동영상 → WebP·GIF 모션: 프리미어 프로 "모션"(위치·비율 조정·폭 비율·회전·기준점·깜박임 제거·자르기)과 "불투명도"를 장면마다 그대로 적용한다.
// 위치·기준점은 원본 동영상 픽셀 기준이다(null = 가운데). 화면(출력) 크기는 원본과 같은 비율이고, 비는 곳은 검정(프리미어 시퀀스 배경과 같다).

export type Motion = {
  x: number | null // 위치(원본 픽셀, null = 가운데)
  y: number | null
  scale: number // 비율 조정 %(균일 비율이면 가로·세로 모두, 아니면 세로)
  scaleW: number // 폭 비율 조정 %(균일 비율을 끄면 가로)
  uniform: boolean
  rotation: number // 도
  ax: number | null // 기준점(원본 픽셀, null = 가운데)
  ay: number | null
  flicker: number // 깜박임 제거 필터 0 ~ 1
  cropL: number // 자르기 % (0 ~ 100)
  cropT: number
  cropR: number
  cropB: number
  opacity: number // 불투명도 %
}

export const NO_MOTION: Motion = {
  x: null,
  y: null,
  scale: 100,
  scaleW: 100,
  uniform: true,
  rotation: 0,
  ax: null,
  ay: null,
  flicker: 0,
  cropL: 0,
  cropT: 0,
  cropR: 0,
  cropB: 0,
  opacity: 100,
}

export const isNoMotion = (m: Motion, w: number, h: number) =>
  (m.x === null || m.x === w / 2) &&
  (m.y === null || m.y === h / 2) &&
  m.scale === 100 &&
  (m.uniform || m.scaleW === 100) &&
  m.rotation === 0 &&
  (m.ax === null || m.ax === w / 2) &&
  (m.ay === null || m.ay === h / 2) &&
  m.flicker === 0 &&
  m.cropL === 0 &&
  m.cropT === 0 &&
  m.cropR === 0 &&
  m.cropB === 0 &&
  m.opacity === 100

// 장면 하나를 출력 캔버스(outW×outH)에 모션대로 그린다. srcW·srcH = 원본 동영상 크기
export function drawWithMotion(
  ctx: CanvasRenderingContext2D,
  video: CanvasImageSource,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  m: Motion,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (isNoMotion(m, srcW, srcH)) {
    ctx.drawImage(video, 0, 0, outW, outH)
    return
  }
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, outW, outH)
  const k = outW / srcW
  const l = (srcW * m.cropL) / 100
  const t = (srcH * m.cropT) / 100
  const r = srcW * (1 - m.cropR / 100)
  const b = srcH * (1 - m.cropB / 100)
  if (r - l < 0.5 || b - t < 0.5 || m.opacity <= 0) return
  ctx.save()
  ctx.globalAlpha = Math.min(1, m.opacity / 100)
  // 깜박임 제거: 아주 살짝 흐리게(1 이면 원본 1px)
  if (m.flicker > 0) ctx.filter = `blur(${(m.flicker * k).toFixed(2)}px)`
  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.translate(m.x ?? srcW / 2, m.y ?? srcH / 2)
  ctx.rotate((m.rotation * Math.PI) / 180)
  ctx.scale((m.uniform ? m.scale : m.scaleW) / 100, m.scale / 100)
  ctx.translate(-(m.ax ?? srcW / 2), -(m.ay ?? srcH / 2))
  ctx.drawImage(video, l, t, r - l, b - t, l, t, r - l, b - t)
  ctx.restore()
}

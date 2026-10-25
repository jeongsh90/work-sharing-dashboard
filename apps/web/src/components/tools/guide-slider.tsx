import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"

// 단계별 안내 이미지 슬라이드. 이미지 크기가 달라도 같은 크기의 틀(16:10, 흰 바탕)에 맞춰 보여 준다.
export type GuideStep = { src: string; caption: string }

export function GuideSlider({ title, steps }: { title: string; steps: GuideStep[] }) {
  const [i, setI] = useState(0)
  const go = (d: number) => setI((n) => (n + d + steps.length) % steps.length)
  const step = steps[i]

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      aria-roledescription="슬라이드"
      aria-label={title}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1)
        if (e.key === "ArrowRight") go(1)
      }}
    >
      <div className="flex items-center gap-2">
        <h3 className="mr-auto font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {i + 1} / {steps.length}
        </span>
      </div>

      {/* 같은 크기의 틀: 이미지는 비율을 지킨 채 가운데 맞춘다 */}
      <div className="relative aspect-[16/10] overflow-hidden rounded-lg border bg-white">
        <img
          key={step.src}
          src={step.src}
          alt={`${i + 1}단계: ${step.caption}`}
          className="absolute inset-0 m-auto size-full object-contain p-2"
          draggable={false}
        />
        {steps.length > 1 && (
          <>
            <Button
              size="icon"
              className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full shadow-md"
              aria-label="이전 단계"
              onClick={() => go(-1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full shadow-md"
              aria-label="다음 단계"
              onClick={() => go(1)}
            >
              <ChevronRight />
            </Button>
          </>
        )}
      </div>

      <p className="text-sm">
        <span className="mr-1.5 font-semibold text-primary tabular-nums">{i + 1}.</span>
        {step.caption}
      </p>

      {/* 단계 점: 눌러서 바로 이동 */}
      <div className="flex justify-center gap-1.5">
        {steps.map((s, n) => (
          <button
            key={s.src}
            type="button"
            aria-label={`${n + 1}단계로`}
            aria-current={n === i}
            className={`h-1.5 rounded-full transition-all ${n === i ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"}`}
            onClick={() => setI(n)}
          />
        ))}
      </div>
    </section>
  )
}

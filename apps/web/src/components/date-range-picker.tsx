import { format } from "date-fns"
import { ko as koFormat } from "date-fns/locale"
import { CalendarIcon } from "lucide-react"
import type { DateRange, Matcher } from "react-day-picker"
import { ko } from "react-day-picker/locale"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useIsMobile } from "@/hooks/use-mobile"

export type { DateRange }

const label = (d: Date) => format(d, "yyyy. MM. dd (EEE)", { locale: koFormat })

// shadcn 날짜 범위 선택(Range Picker). 넓은 화면은 두 달, 좁은 화면은 한 달을 보여 준다.
export function DateRangePicker({
  id,
  value,
  onChange,
  disabled,
  placeholder = "기간을 골라 주세요",
  invalid,
  single = false,
}: {
  single?: boolean // 한 날짜만 고른다(value.from 만 쓴다)
  id?: string
  value: DateRange | undefined
  onChange: (range: DateRange | undefined) => void
  disabled?: Matcher | Matcher[]
  placeholder?: string
  invalid?: boolean
}) {
  const isMobile = useIsMobile()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-invalid={invalid ? true : undefined}
          className="w-full justify-start px-2.5 font-normal"
        >
          <CalendarIcon data-icon="inline-start" />
          {value?.from ? (
            <span className="truncate">
              {label(value.from)}
              {!single && value.to && value.to.getTime() !== value.from.getTime() && ` - ${label(value.to)}`}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {single ? (
          <Calendar
            mode="single"
            defaultMonth={value?.from}
            selected={value?.from}
            onSelect={(d) => onChange(d ? { from: d, to: undefined } : undefined)}
            disabled={disabled}
            locale={ko}
          />
        ) : (
          <Calendar
            mode="range"
            defaultMonth={value?.from}
            selected={value}
            onSelect={onChange}
            numberOfMonths={isMobile ? 1 : 2}
            disabled={disabled}
            locale={ko}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

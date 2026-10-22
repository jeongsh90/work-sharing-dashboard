import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useFileUrl } from "@/lib/api"
import { initials } from "@/lib/requests"

// 사람 아바타: 프로필 사진이 있으면 사진, 없으면 이름 첫 글자.
// 사진은 로그인이 필요한 서버 파일이라 받아서 브라우저 안 주소로 바꿔 보여 준다(useFileUrl).
export function UserAvatar({
  name,
  avatarId,
  className,
  fallbackClassName,
}: {
  name: string
  avatarId?: string | null
  className?: string
  fallbackClassName?: string
}) {
  const { url } = useFileUrl(avatarId ?? null)
  return (
    <Avatar className={className}>
      {url && <AvatarImage src={url} alt={`${name} 프로필 사진`} className="object-cover" />}
      <AvatarFallback className={fallbackClassName}>{initials(name)}</AvatarFallback>
    </Avatar>
  )
}

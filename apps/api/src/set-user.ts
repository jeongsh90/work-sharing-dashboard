// 계정을 만들거나 비밀번호를 바꾼다.
// 사용법: WSD_PASSWORD=<비밀번호> npm run user:set -- <아이디> <이름> <역할>
// 비밀번호는 화면이나 기록에 남지 않게 환경변수로만 받는다.
import { USERS_FILE } from './config.ts'
import { setUser, type Role } from './users.ts'

const [id, name, role] = process.argv.slice(2)
const password = process.env.WSD_PASSWORD

if (!id || !name || role !== 'superadmin' || !password) {
  console.error('사용법: WSD_PASSWORD=<비밀번호> npm run user:set -- <아이디> <이름> superadmin')
  process.exit(1)
}

await setUser({ id: id.toLowerCase(), name, role: role as Role }, password)
console.log(`${id} 계정을 저장했습니다: ${USERS_FILE}`)

// 계정을 만들거나 비밀번호를 바꾼다. 화면의 팀 관리에서도 할 수 있다.
// 사용법: WSD_PASSWORD=<비밀번호> npm run user:set -- <아이디> <이름> <역할> [부서] [직급]
// 역할: superadmin | admin | designer | requester
// 비밀번호는 화면이나 기록에 남지 않게 환경변수로만 받는다.
import { DB_FILE } from './config.ts'
import { createUser, findUser, ROLES, setPassword, updateUser, type Role } from './users.ts'

const [rawId, name, role, department = '', rank = ''] = process.argv.slice(2)
const password = process.env.WSD_PASSWORD

if (!rawId || !name || !ROLES.includes(role as Role) || !password) {
  console.error(`사용법: WSD_PASSWORD=<비밀번호> npm run user:set -- <아이디> <이름> <${ROLES.join('|')}> [부서] [직급]`)
  process.exit(1)
}

const id = rawId.toLowerCase()
const fields = { name, role: role as Role, department, rank, position: '' }
if (findUser(id)) updateUser(id, fields)
else createUser(id, fields)
await setPassword(id, password)
console.log(`${id} 계정을 저장했습니다: ${DB_FILE}`)

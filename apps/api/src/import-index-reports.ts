// 폴더에 있는 구글 색인 보고서(YYMMDD_..색인..html / ..서치콘솔..html, 같은 이름의 .pdf)를 날짜별로 등록한다. 같은 날짜는 바꾼다.
// 사용법: npm run index-reports:import -- "<폴더>"
// 화면(구글 색인 보고서 → 보고서 올리기)에서도 하나씩 올릴 수 있다.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { saveIndexReport } from './index-reports.ts'
import type { PublicUser } from './users.ts'

const dir = process.argv[2]
if (!dir || !existsSync(dir)) {
  console.error('사용법: npm run index-reports:import -- "<보고서 폴더>"')
  process.exit(1)
}

const actor = { id: 'admin', role: 'superadmin' } as PublicUser
const files = readdirSync(dir).filter((f) => /^\d{6}_.*(색인|서치콘솔).*\.html$/i.test(f)).sort()
for (const f of files) {
  const [, yy, mm, dd] = f.match(/^(\d{2})(\d{2})(\d{2})_/)!
  const pdfFile = join(dir, f.replace(/\.html$/i, '.pdf'))
  const r = saveIndexReport(actor, {
    date: `20${yy}-${mm}-${dd}`,
    html: readFileSync(join(dir, f), 'utf8'),
    ...(existsSync(pdfFile) ? { pdf: readFileSync(pdfFile).toString('base64'), pdfName: basename(pdfFile) } : {}),
  })
  console.log(`${r.replaced ? '바꿈' : '등록'} 20${yy}-${mm}-${dd}  ${f}${existsSync(pdfFile) ? ' (+PDF)' : ''}`)
}
console.log(`${files.length}개 처리`)

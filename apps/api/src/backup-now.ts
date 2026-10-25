// 지금 바로 외장 하드에 백업한다: npm run backup
import { BACKUP_DIR } from './config.ts'
import { runBackup } from './backup.ts'

if (!BACKUP_DIR) {
  console.log('백업 폴더가 정해지지 않았습니다(WSD_BACKUP_DIR).')
} else {
  const result = await runBackup()
  process.exit(result ? 0 : 1)
}

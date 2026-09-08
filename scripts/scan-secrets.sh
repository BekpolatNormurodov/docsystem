#!/usr/bin/env bash
# Maxfiy ma'lumot (sessiya tokeni, parol, kalit) commit'ga tushib ketmasin.
#
# NEGA BOR: 2026-09-06 da cabinet-api-skeleton/test-dry-run.ts ga BRIGHT'ning HAQIQIY
# cabinet.sud.uz sessiya tokeni qattiq yozilib, OMMAVIY GitHub repozitoriyasiga push
# qilingan edi. Cabinet tokenida amal qilish muddati yo'q — uni ko'rgan har kim firma
# nomidan sudga da'vo yubora olardi. Bu guard aynan o'sha sinf xatoni to'sadi.
#
# Ishlatish:
#   • qo'lda tekshirish:   bash scripts/scan-secrets.sh            (butun ishchi daraxt)
#   • commit oldidan:      .githooks/pre-commit orqali (faqat staged o'zgarishlar)
#   • CI'da:               bash scripts/scan-secrets.sh --all
#
# Chiqish kodi: 0 — toza, 1 — sir topildi.
set -uo pipefail

MODE="${1:-staged}"   # staged | --all
RED=$'\033[0;31m'; YEL=$'\033[1;33m'; GRN=$'\033[0;32m'; NC=$'\033[0m'
FOUND=0

# Faqat matn-manba fayllari — reference-data va misollar chetlab o'tiladi izoh bilan.
scan_target() {
  if [ "$MODE" = "--all" ]; then
    git ls-files -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' '*.json' '*.env*' 2>/dev/null
  else
    git diff --cached --name-only --diff-filter=ACM -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' '*.json' '*.env*' 2>/dev/null
  fi
}

# Bir faylda bir naqshni qidirib, topilsa xato beradi.
hit() {
  local file="$1" label="$2" regex="$3"
  # Kirish: staged'da index'dagi versiya, --all'da diskdagi.
  local content
  if [ "$MODE" = "--all" ]; then content="$(cat "$file" 2>/dev/null)"; else content="$(git show ":$file" 2>/dev/null)"; fi
  local m
  m="$(printf '%s\n' "$content" | grep -niEI "$regex" | grep -viE "process\.env|SAMPLE_|EXAMPLE|PLACEHOLDER|change[_-]?me|<your|xxxx|\.\.\.|// ?namuna|// ?misol" | grep -vE "[:=] *['\"][A-Z0-9_]+['\"]" | head -5)"
  if [ -n "$m" ]; then
    echo "${RED}✗ ${file}${NC}  — ${YEL}${label}${NC}"
    printf '%s\n' "$m" | sed 's/^/    /'
    FOUND=1
  fi
}

for f in $(scan_target); do
  [ -f "$f" ] || [ "$MODE" = "staged" ] || continue
  # Test/spec fayllar soxta sir bilan tekshiradi — ular sir emas.
  case "$f" in *.test.ts|*.test.tsx|*.spec.ts|*.test.js|*.spec.js|*.example|*.example.*) continue;; esac
  # 1) Sessiya tokeni / sir: UUID nomi token|secret|auth|key|password bo'lgan o'zgaruvchiga.
  hit "$f" "sirга o'xshash UUID (token/secret/auth/key/password)" \
    "(token|secret|auth|apikey|api_key|password|passwd|pwd)[a-z_]*['\"]?\s*[:=]\s*['\"][0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}['\"]"
  # 2) X-AUTH-TOKEN / Bearer qattiq yozilgan
  hit "$f" "X-AUTH-TOKEN / Bearer qattiq yozilgan" \
    "(x-auth-token|authorization|bearer)['\"]?\s*[:=]\s*['\"][A-Za-z0-9._-]{20,}['\"]"
  # 3) Umumiy parol/kalit qattiq yozilgan (12+ belgili)
  hit "$f" "parol/kalit qattiq yozilgan" \
    "(password|passwd|pwd|secret|private_key|client_secret)[a-z_]*['\"]?\s*[:=]\s*['\"][^'\"[:space:]]{12,}['\"]"
  # 4) PEM private key bloki
  hit "$f" "PEM private key" \
    "BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY"
done

if [ "$FOUND" -ne 0 ]; then
  echo
  echo "${RED}Maxfiy ma'lumot topildi — commit to'xtatildi.${NC}"
  echo "Sirni koddan olib tashlang va process.env / getStoredCabinetSession orqali oling."
  echo "Agar bu HAQIQATAN sir emas (masalan reference GUID), qatorga izoh qo'shing: // namuna"
  exit 1
fi
[ "$MODE" = "--all" ] && echo "${GRN}✓ Sir topilmadi (butun repo).${NC}"
exit 0

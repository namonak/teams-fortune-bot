#!/usr/bin/env bash
set -euo pipefail

app_id="${MicrosoftAppId:-}"
if [ -z "$app_id" ] && [ -f .env ]; then
  app_id="$(sed -n 's/^MicrosoftAppId=//p' .env | head -n 1 | tr -d '\r')"
fi
[[ "$app_id" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] || {
  echo '저… 앱 ID가 이상해요… .env에 MicrosoftAppId를 UUID 형식으로 적어 주세요…' >&2
  exit 1
}

stamp="$(TZ=Asia/Seoul date '+%Y%m%d-%H%M%S')"
archive="dist/team-fortune-bot-$stamp.zip"
package_dir="$(mktemp -d)"
trap 'rm -rf "$package_dir"' EXIT

mkdir -p dist
sed "s/{{MICROSOFT_APP_ID}}/$app_id/g" appPackage/manifest.json > "$package_dir/manifest.json"
# 같은 초의 재실행도 이전 ZIP의 다른 파일을 유지하지 않도록 새로 생성한다.
zip -q -j "$package_dir/app.zip" "$package_dir/manifest.json" appPackage/color.png appPackage/outline.png
zip -T "$package_dir/app.zip" >/dev/null
cp "$package_dir/app.zip" "$archive"
printf '설치 꾸러미를 만들어 두었어요… %s (쓱)\n' "$archive"

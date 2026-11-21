#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

release_dir="${1:-}"
if [[ -z "$release_dir" || ! -d "$release_dir/company" || ! -d "$release_dir/admin" ]]; then
  echo "Usage: bash deploy-hostinger.sh /tmp/masar-release-<stamp>" >&2
  exit 2
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this from the Hostinger root terminal; nothing changed." >&2
  exit 3
fi
case "$release_dir" in /tmp/masar-release-*) ;; *) echo "Unexpected release path; nothing changed." >&2; exit 3 ;; esac

company_root=/var/www/inviha/company
admin_root=/var/www/inviha/admin
backend_settings=/opt/inviha-backend/platform-settings.mjs
school_server=/opt/inviha-school-api/school-server.js
backend_service=inviha-backend
school_service=inviha-school-api
expected_settings_sha=6ed1fb6fc10e2c89f15ba7da3358cd7e4f013d40b23b612dab4560bcafcedd8a
expected_school_sha=cfd24ac98c851fa49e0ceef93d4e27d137657f3833d1f679ebfd54719a4c1d92
company_js=assets/index-zINWtPtE.js
company_css=assets/index-Du-3SwZJ.css
admin_js=assets/index-F38pae9O.js
admin_css=assets/index-Cfvhqi1P.css
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/var/backups/masar-ui-review-$stamp"
company_stage="/var/www/inviha/.company-stage-$stamp"
admin_stage="/var/www/inviha/.admin-stage-$stamp"
company_previous="/var/www/inviha/company.previous-$stamp"
admin_previous="/var/www/inviha/admin.previous-$stamp"
company_failed="/var/www/inviha/company.failed-$stamp"
admin_failed="/var/www/inviha/admin.failed-$stamp"
company_swapped=0
admin_swapped=0
backend_changed=0
school_changed=0

verify_site() {
  local root="$1" js="$2" css="$3" asset
  test -s "$root/index.html"
  grep -Fq "$js" "$root/index.html"
  grep -Fq "$css" "$root/index.html"
  test -s "$root/$js"
  test -s "$root/$css"
  while IFS= read -r asset; do test -s "$root/$asset"; done < <(grep -oE 'assets/[^" ]+\.(js|css)' "$root/index.html" | sort -u)
}

rollback() {
  code=$?
  trap - ERR
  if [[ "$admin_swapped" -eq 1 ]]; then
    [[ ! -e "$admin_root" ]] || mv "$admin_root" "$admin_failed" || true
    [[ ! -e "$admin_previous" ]] || mv "$admin_previous" "$admin_root" || true
  fi
  if [[ "$company_swapped" -eq 1 ]]; then
    [[ ! -e "$company_root" ]] || mv "$company_root" "$company_failed" || true
    [[ ! -e "$company_previous" ]] || mv "$company_previous" "$company_root" || true
  fi
  if [[ "$backend_changed" -eq 1 ]]; then cp -a "$backup/platform-settings.mjs" "$backend_settings" || true; fi
  if [[ "$school_changed" -eq 1 ]]; then cp -a "$backup/school-server.js" "$school_server" || true; fi
  if [[ "$backend_changed" -eq 1 ]]; then systemctl restart "$backend_service" || true; fi
  if [[ "$school_changed" -eq 1 ]]; then systemctl restart "$school_service" || true; fi
  echo "Deployment failed and rollback was attempted. Backup: $backup" >&2
  exit "$code"
}
trap rollback ERR

for path in "$company_root" "$admin_root" "$backend_settings" "$school_server"; do
  [[ -e "$path" && ! -L "$path" ]] || { echo "Expected live path is missing or is a symlink: $path" >&2; exit 4; }
done
systemctl is-active --quiet "$backend_service"
systemctl is-active --quiet "$school_service"
curl --fail --silent --max-time 5 http://127.0.0.1:3001/health >/dev/null
curl --fail --silent --max-time 5 http://127.0.0.1:3003/api/health >/dev/null
nginx -t
verify_site "$release_dir/company" "$company_js" "$company_css"
verify_site "$release_dir/admin" "$admin_js" "$admin_css"

current_settings_sha="$(sha256sum "$backend_settings" | awk '{print $1}')"
current_school_sha="$(sha256sum "$school_server" | awk '{print $1}')"
if [[ "$current_settings_sha" != "$expected_settings_sha" ]] && ! grep -Fq "loginContacts:Object.freeze(['supportEmail','supportPhone','whatsappNumber'])" "$backend_settings"; then
  echo "Live settings code changed since review; stopping." >&2
  exit 5
fi
if [[ "$current_school_sha" != "$expected_school_sha" ]]; then
  grep -Fq "password.length<4)return res.status(400).json({error:'school_company_admin_name_email_and_4_character_password_required'});" "$school_server" || { echo "Live School API code changed since review; stopping." >&2; exit 5; }
fi

mkdir -m 700 -p /var/backups
mkdir -m 700 "$backup"
cp -a "$backend_settings" "$backup/platform-settings.mjs"
cp -a "$school_server" "$backup/school-server.js"
cp -a "$company_root" "$backup/company"
cp -a "$admin_root" "$backup/admin"
mkdir -m 755 "$company_stage" "$admin_stage"
cp -a "$company_root/." "$company_stage/"
cp -a "$admin_root/." "$admin_stage/"
cp -a "$release_dir/company/." "$company_stage/"
cp -a "$release_dir/admin/." "$admin_stage/"
verify_site "$company_stage" "$company_js" "$company_css"
verify_site "$admin_stage" "$admin_js" "$admin_css"

backend_changed=1
school_changed=1
python3 - "$backend_settings" "$school_server" "$expected_settings_sha" "$expected_school_sha" <<'PY'
import hashlib, os, stat, sys
from pathlib import Path

def replace_once(path_arg, expected_sha, old, new, already):
    path = Path(path_arg)
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    text = raw.decode('utf-8')
    if already in text:
        return
    if digest != expected_sha:
        raise SystemExit(f'Live file changed since review: {path}')
    if text.count(old) != 1:
        raise SystemExit(f'Expected one reviewed source location in {path}; found {text.count(old)}')
    mode = stat.S_IMODE(path.stat().st_mode)
    temp = path.with_name(path.name + '.new-release')
    temp.write_text(text.replace(old, new, 1), encoding='utf-8', newline='')
    os.chmod(temp, mode)
    os.chown(temp, path.stat().st_uid, path.stat().st_gid)
    os.replace(temp, path)

replace_once(
    sys.argv[1], sys.argv[3],
    '  tracking:Object.freeze([',
    "  loginContacts:Object.freeze(['supportEmail','supportPhone','whatsappNumber']),\n  tracking:Object.freeze([",
    "loginContacts:Object.freeze(['supportEmail','supportPhone','whatsappNumber'])"
)
replace_once(
    sys.argv[2], sys.argv[4],
    "password.length<12)return res.status(400).json({error:'school_company_admin_name_email_and_12_character_password_required'});",
    "password.length<4)return res.status(400).json({error:'school_company_admin_name_email_and_4_character_password_required'});",
    "password.length<4)return res.status(400).json({error:'school_company_admin_name_email_and_4_character_password_required'});"
)
PY

node --check "$backend_settings"
node --check "$school_server"
systemctl restart "$backend_service"
systemctl restart "$school_service"
for attempt in {1..20}; do
  if systemctl is-active --quiet "$backend_service" && systemctl is-active --quiet "$school_service" && \
     curl --fail --silent --max-time 5 http://127.0.0.1:3001/health >/dev/null && \
     curl --fail --silent --max-time 5 http://127.0.0.1:3003/api/health >/dev/null; then
    break
  fi
  [[ "$attempt" -lt 20 ]]
  sleep 2
done

mv "$company_root" "$company_previous"
company_swapped=1
mv "$company_stage" "$company_root"
mv "$admin_root" "$admin_previous"
admin_swapped=1
mv "$admin_stage" "$admin_root"
verify_site "$company_root" "$company_js" "$company_css"
verify_site "$admin_root" "$admin_js" "$admin_css"

curl --noproxy '*' --resolve track.almasar.qa:443:127.0.0.1 --fail --silent --show-error --max-time 15 https://track.almasar.qa/ | grep -Fq "$company_js"
curl --noproxy '*' --resolve admin.almasar.qa:443:127.0.0.1 --fail --silent --show-error --max-time 15 https://admin.almasar.qa/admin/ | grep -Fq "$admin_js"
curl --fail --silent --max-time 5 http://127.0.0.1:3001/health >/dev/null
curl --fail --silent --max-time 5 http://127.0.0.1:3003/api/health >/dev/null

trap - ERR
echo "Company portal deployed: https://track.almasar.qa/"
echo "Super Admin deployed: https://admin.almasar.qa/admin/"
echo "Backend and School API health checks passed; no database migration was run."
echo "Backup copy: $backup"
echo "Previous company web root: $company_previous"
echo "Previous Super Admin web root: $admin_previous"

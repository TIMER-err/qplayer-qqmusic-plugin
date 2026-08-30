#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "$0")/.." && pwd)
stage_dir=$(mktemp -d)
trap 'rm -rf "$stage_dir"' EXIT
mkdir -p "$stage_dir/META-INF" "$project_dir/dist"

cp "$project_dir/plugin.json" "$stage_dir/plugin.json"
for directory in src ui assets; do
  if [[ -d "$project_dir/$directory" ]]; then
    cp -R "$project_dir/$directory" "$stage_dir/$directory"
  fi
done

readarray -t identity < <(python3 - "$project_dir/plugin.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as source:
    manifest = json.load(source)
print(manifest["id"])
print(manifest["version"])
PY
)
plugin_id=${identity[0]}
plugin_version=${identity[1]}

python3 - "$stage_dir" <<'PY'
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
files = {}
for path in sorted(root.rglob("*")):
    if path.is_file() and "META-INF" not in path.relative_to(root).parts:
        name = path.relative_to(root).as_posix()
        files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
(root / "META-INF" / "qplayer-files.json").write_text(
    json.dumps(files, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

if [[ -n "${QPLAYER_PLUGIN_SIGNING_KEY:-}" ]]; then
  openssl dgst -sha256 -sign "$QPLAYER_PLUGIN_SIGNING_KEY" \
    -out "$stage_dir/META-INF/qplayer.sig.bin" \
    "$stage_dir/META-INF/qplayer-files.json"
  openssl base64 -A -in "$stage_dir/META-INF/qplayer.sig.bin" \
    -out "$stage_dir/META-INF/qplayer.sig"
  rm "$stage_dir/META-INF/qplayer.sig.bin"
fi

output="$project_dir/dist/$plugin_id-$plugin_version.qplug"
(
  cd "$stage_dir"
  jar --create --file "$output" --no-manifest \
    --date=2000-01-01T00:00:00Z -C "$stage_dir" .
)
printf '%s\n' "$output"

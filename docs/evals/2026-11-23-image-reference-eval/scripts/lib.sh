#!/bin/bash
# usage: gen NAME MODEL SIZE PROMPT   |  edit NAME MODEL SIZE FIDELITY PROMPT IMG...
K="${OPENAI_API_KEY:?set OPENAI_API_KEY}"
D=$(dirname "$0")
save() { # name, json file
  python3 -I - "$1" "$2" "$D/raw" <<'PY'
import sys,json,base64
name,f,out=sys.argv[1:4]
j=json.load(open(f))
if 'error' in j: print(name,'ERROR',json.dumps(j['error'])[:400]); sys.exit()
open(f"{out}/{name}.png",'wb').write(base64.b64decode(j['data'][0]['b64_json']))
u=j.get('usage',{})
print(name,'OK',json.dumps(u))
with open(f"{out}/usage.jsonl",'a') as fh: fh.write(json.dumps({'name':name,'usage':u})+"\n")
PY
}
gen() { local n=$1 m=$2 s=$3 p=$4; local t0=$(date +%s)
  curl -s https://api.openai.com/v1/images/generations -H "Authorization: Bearer $K" -H 'Content-Type: application/json' \
   -d "$(python3 -I -c 'import json,sys;print(json.dumps({"model":sys.argv[1],"size":sys.argv[2],"prompt":sys.argv[3],"quality":"medium","n":1}))' "$m" "$s" "$p")" > "$D/raw/$n.json"
  save "$n" "$D/raw/$n.json"; echo "  $(( $(date +%s)-t0 ))s"; }
edit() { local n=$1 m=$2 s=$3 fid=$4 p=$5; shift 5; local args=(); for i in "$@"; do args+=(-F "image[]=@$i"); done
  local fa=(); [ "$fid" != "-" ] && fa=(--form-string "input_fidelity=$fid"); local t0=$(date +%s)
  curl -s https://api.openai.com/v1/images/edits -H "Authorization: Bearer $K" --form-string "model=$m" --form-string "size=$s" --form-string "quality=medium" "${fa[@]}" --form-string "prompt=$p" "${args[@]}" > "$D/raw/$n.json"
  save "$n" "$D/raw/$n.json"; echo "  $(( $(date +%s)-t0 ))s"; }

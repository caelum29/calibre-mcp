#!/usr/bin/env bash
# Post-production pipeline for the README demo GIF: turns a raw Claude Desktop screen
# recording (.mov) into a cinematic multi-scene GIF (+ mp4) — crop, per-scene speed ramp,
# intro/outro cards, bottom caption pills, light zoom-ins, two-pass palette encode.
# Usage: W=720 FPS=12 scripts/demo-gif.sh <input.mov> scripts/demo-scenes.tsv demo.gif   (ffmpeg ≥ 6, macOS)
#
# scenes.tsv — one scene per line, TAB-separated:  start  end  speed  caption  [zoom cx cy]
#   start/end  seconds in the source; speed = playback multiplier (5 = 5× faster);
#   caption    text for the bottom pill ("-" = none); zoom = e.g. 1.15 with focus point
#   cx,cy      as 0..1 fractions of the frame (optional; no zoom when omitted).
set -euo pipefail

IN=${1:?input .mov}; SCENES=${2:?scenes.tsv}; OUT=${3:-demo.gif}
W=${W:-800}                       # output width; height follows the crop aspect
FPS=${FPS:-15}
CROP=${CROP:-}                    # optional "w:h:x:y" in source pixels; default = auto-detect
BG=0x0f0f10; ACCENT=0xd97757     # Claude-ish dark + terracotta accent
TITLE=${TITLE:-calibre-mcp}
SUBTITLE=${SUBTITLE:-Your Calibre library, searched by meaning}
OUTRO=${OUTRO:-github.com/caelum29/calibre-mcp}
# closing card: headline + up to 3 lines of tool names (";"-separated), then the repo URL
OUTRO_TITLE=${OUTRO_TITLE:-…and 19 tools in total}
OUTRO_LINES=${OUTRO_LINES:-find duplicates · audit metadata quality · recover metadata from ISBN;bulk edit · merge books · topical bundles · extract ISBN;read any chapter · build the semantic index · open in Calibre}
MP4=${MP4:-assets/demo.mp4}

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
# Homebrew ffmpeg has no drawtext → text goes through PNG overlays rendered by a tiny Swift helper
swiftc -O -o "$TMP/text" "$(dirname "$0")/demo-gif-text.swift"
txt() { "$TMP/text" "$@"; }   # txt out.png W H "text|size|hex|yFrac[|bold]"...

# --- crop: auto-detect the window bounds on a mid frame (letterbox-style black/desk edges)
if [[ -z $CROP ]]; then
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
  CROP=$(ffmpeg -v info -ss "$(awk "BEGIN{print $DUR/2}")" -t 1 -i "$IN" -vf cropdetect=24:2:0 -f null - 2>&1 \
        | grep -o 'crop=[0-9:]*' | tail -1 | cut -d= -f2)
fi
IFS=: read -r CW CH _ _ <<<"$CROP"
H=$(( (W * CH / CW) / 2 * 2 ))     # keep even for h264
echo "crop=$CROP → ${W}x${H} @ ${FPS}fps" >&2

BASE="crop=$CROP,scale=$W:$H:flags=lanczos"
LIST="$TMP/list.txt"; : >"$LIST"; i=0

# --- intro card (2.2 s): title + subtitle + accent rule, fade in/out
txt "$TMP/intro.png" "$W" "$H" "$TITLE|$((W/11))|ffffff|0.42|bold" "$SUBTITLE|$((W/30))|b8b8bd|0.58"
ffmpeg -v error -y -f lavfi -i "color=c=$BG:s=${W}x${H}:d=2.2:r=$FPS" -i "$TMP/intro.png" -filter_complex "\
[0:v][1:v]overlay=0:0,drawbox=x=(iw-$((W/8)))/2:y=ih/2-2:w=$((W/8)):h=3:color=$ACCENT:t=fill,\
fade=t=in:st=0:d=0.4,fade=t=out:st=1.8:d=0.4" -pix_fmt yuv420p "$TMP/clip_intro.mp4"
echo "file '$TMP/clip_intro.mp4'" >>"$LIST"

# --- scenes
while IFS=$'\t' read -r S E SPEED CAP ZOOM CX CY; do
  [[ -z ${S:-} || $S == \#* ]] && continue
  i=$((i+1)); VF="$BASE,setpts=PTS/$SPEED,fps=$FPS"
  # zoom-in: crop shrinks over 1.5 s toward the focus point, then scale back (Ken Burns)
  if [[ -n ${ZOOM:-} && $ZOOM != "-" ]]; then
    Z="(1+($ZOOM-1)*min(t/1.5\,1))"
    VF="$VF,crop=w='iw/$Z':h='ih/$Z':x='(iw-ow)*${CX:-0.5}':y='(ih-oh)*${CY:-0.5}',scale=$W:$H:flags=lanczos"
  fi
  # bottom caption band with fade-in
  INPUTS=(-ss "$S" -to "$E" -i "$IN"); FC="[0:v]$VF"
  if [[ -n ${CAP:-} && $CAP != "-" ]]; then
    PH=$((W/22)); txt "$TMP/cap_$i.png" "$W" "$((PH*2))" "$CAP|$((W/42))|ffffff|0.5"
    # loop the PNG for the scene length: a 1-frame input would freeze the fade at t=0
    D=$(awk "BEGIN{print ($E-$S)/$SPEED+1}"); INPUTS+=(-loop 1 -t "$D" -i "$TMP/cap_$i.png")
    FC="$FC,drawbox=x=0:y=ih-$((PH*2)):w=iw:h=$((PH*2)):color=black@0.55:t=fill[v];[1:v]format=rgba,fade=t=in:st=0:d=0.35:alpha=1[c];[v][c]overlay=0:H-h:shortest=1"
  fi
  ffmpeg -nostdin -v error -y "${INPUTS[@]}" -filter_complex "$FC" -shortest -an -pix_fmt yuv420p "$TMP/clip_$i.mp4"
  echo "file '$TMP/clip_$i.mp4'" >>"$LIST"
done <"$SCENES"

# --- outro: 1 s hold on the last frame, then a closing card (headline, tool list, URL)
ffmpeg -v error -y -sseof -0.1 -i "$TMP/clip_$i.mp4" -vf "tpad=stop_mode=clone:stop_duration=1,trim=duration=1,setpts=PTS-STARTPTS" -pix_fmt yuv420p "$TMP/clip_hold.mp4"
echo "file '$TMP/clip_hold.mp4'" >>"$LIST"
SPECS=("$OUTRO_TITLE|$((W/16))|ffffff|0.30|bold"); y=0.47; IFS=';' read -ra LINES <<<"$OUTRO_LINES"
for l in "${LINES[@]}"; do SPECS+=("$l|$((W/40))|c8c8cd|$y"); y=$(awk "BEGIN{print $y+0.085}"); done
SPECS+=("$OUTRO|$((W/34))|d97757|0.86")
txt "$TMP/outro.png" "$W" "$H" "${SPECS[@]}"
ffmpeg -v error -y -f lavfi -i "color=c=$BG:s=${W}x${H}:d=3.6:r=$FPS" -i "$TMP/outro.png" -filter_complex "\
[0:v][1:v]overlay=0:0,fade=t=in:st=0:d=0.5" -pix_fmt yuv420p "$TMP/clip_outro.mp4"
echo "file '$TMP/clip_outro.mp4'" >>"$LIST"

# --- concat → mp4 (for social posts) + two-pass palette GIF
ffmpeg -v error -y -f concat -safe 0 -i "$LIST" -c:v libx264 -crf 20 -pix_fmt yuv420p "$TMP/full.mp4"
[[ -n $MP4 ]] && cp "$TMP/full.mp4" "$MP4"
ffmpeg -v error -y -i "$TMP/full.mp4" -vf "fps=$FPS,palettegen=max_colors=${COLORS:-128}:stats_mode=diff" "$TMP/pal.png"
ffmpeg -v error -y -i "$TMP/full.mp4" -i "$TMP/pal.png" -lavfi "fps=$FPS[x];[x][1:v]paletteuse=dither=${DITHER:-none}:diff_mode=rectangle" "$OUT"
ls -l "$OUT" | awk '{printf "%s  %.1f MB\n",$9,$5/1048576}' >&2
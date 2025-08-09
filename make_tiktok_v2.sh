#!/usr/bin/env bash
set -euo pipefail

# TikTok Crypto Video Builder (v2 - robust CSV parsing)
# Requires: ffmpeg 4+, optional espeak-ng
# Usage: ./make_tiktok_v2.sh

FPS=30
SIZE=1080x1920
OUT=output.mp4

has_cmd() { command -v "$1" >/dev/null 2>&1; }

if ! has_cmd ffmpeg; then
  echo "Error: ffmpeg is required." >&2
  exit 1
fi

mkdir -p build

# Normalize line endings on storyboard and captions (remove CR)
if [ -f "storyboard.csv" ]; then
  tr -d '\r' < storyboard.csv > build/storyboard.norm.csv
else
  echo "Missing storyboard.csv" >&2
  exit 1
fi

if [ -f "captions.ass" ]; then
  tr -d '\r' < captions.ass > build/captions.norm.ass
  CAPTIONS="build/captions.norm.ass"
else
  CAPTIONS=""
fi

# Voiceover handling
if [ ! -f "audio/voiceover.mp3" ]; then
  if has_cmd espeak-ng && [ -f "voiceover.txt" ]; then
    echo "Generating placeholder voiceover with espeak-ng..."
    espeak-ng -s 155 -v en-US+m3 -f voiceover.txt --stdout | ffmpeg -y -f wav -i - -ac 2 -ar 48000 -b:a 192k audio/voiceover.mp3
  else
    echo "Warning: No audio/voiceover.mp3 found and espeak-ng not available. Proceeding without voiceover."
  fi
fi

# Optional music normalization
if [ -f "audio/music.mp3" ]; then
  echo "Normalizing music loudness..."
  ffmpeg -y -i audio/music.mp3 -af loudnorm=I=-22:TP=-1.5:LRA=11 build/music_norm.mp3
  MUSIC="build/music_norm.mp3"
else
  MUSIC=""
fi

echo "Parsing storyboard and rendering scenes..."
# Read normalized CSV line by line, skip header
lineno=0
> build/concat.txt
while IFS=, read -r FNAME START DURATION CUE; do
  lineno=$((lineno+1))
  # Skip header if present
  if [ "$lineno" -eq 1 ] && [[ "$FNAME" == "filename" ]]; then
    continue
  fi
  # Trim whitespace
  FNAME="${FNAME## }"; FNAME="${FNAME%% }"
  START="${START## }"; START="${START%% }"
  DURATION="${DURATION## }"; DURATION="${DURATION%% }"
  CUE="${CUE## }"; CUE="${CUE%% }"

  # Validate fields
  if [ -z "${FNAME:-}" ] || [ -z "${START:-}" ] || [ -z "${DURATION:-}" ]; then
    echo "Error: malformed CSV at line $lineno -> '$FNAME,$START,$DURATION,$CUE'" >&2
    exit 1
  fi
  if [[ ! "$FNAME" =~ \.png$ ]]; then
    echo "Error: filename must be a .png at line $lineno -> '$FNAME'" >&2
    exit 1
  fi
  if [ ! -f "scenes/$FNAME" ]; then
    echo "Error: missing scenes/$FNAME" >&2
    exit 1
  fi

  BASENAME="${FNAME%%.png}"
  echo "  line $lineno -> scene=$FNAME start=$STARTs duration=${DURATION}s cue=$CUE"

  # Zoom from 1.0 to 1.06 over duration with 30fps
  # Use zoompan with deterministic frame count
  ffmpeg -y -loop 1 -t "$DURATION" -i "scenes/$FNAME" \
    -vf "scale=1080:1920,zoompan=z='min(zoom+0.0009,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps=${FPS}:d=$(($DURATION*${FPS})),format=yuv420p" \
    -r ${FPS} -pix_fmt yuv420p -an "build/${BASENAME}.mp4"

  echo "file 'build/${BASENAME}.mp4'" >> build/concat.txt
done < build/storyboard.norm.csv

echo "Concatenating segments..."
ffmpeg -y -f concat -safe 0 -i build/concat.txt -c copy "build/video_nocaptions.mp4"

# Burn captions (ASS) if available
if [ -n "$CAPTIONS" ]; then
  echo "Burning captions..."
  ffmpeg -y -i "build/video_nocaptions.mp4" -vf "ass=${CAPTIONS}" -c:a copy "build/video_captions.mp4"
  VIDEO="build/video_captions.mp4"
else
  VIDEO="build/video_nocaptions.mp4"
fi

# Mix audio: voiceover + music (duck music under VO)
if [ -f "audio/voiceover.mp3" ] && [ -n "$MUSIC" ]; then
  echo "Mixing voiceover with ducked music..."
  ffmpeg -y -i "$VIDEO" -i audio/voiceover.mp3 -i "$MUSIC" \
    -filter_complex "[1:a]aformat=channel_layouts=stereo,volume=1.0[vo];\
                     [2:a]aformat=channel_layouts=stereo,compand=gain=-2[bg];\
                     [bg][vo]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[ducked];\
                     [ducked]volume=0.5[mix]" \
    -map 0:v -map "[mix]" -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p -r ${FPS} \
    -c:a aac -b:a 192k -shortest "$OUT"
elif [ -f "audio/voiceover.mp3" ]; then
  echo "Muxing voiceover only..."
  ffmpeg -y -i "$VIDEO" -i audio/voiceover.mp3 -map 0:v -map 1:a -c:v libx264 -pix_fmt yuv420p -r ${FPS} -c:a aac -b:a 192k -shortest "$OUT"
elif [ -n "$MUSIC" ]; then
  echo "Muxing music only..."
  ffmpeg -y -i "$VIDEO" -i "$MUSIC" -map 0:v -map 1:a -c:v libx264 -pix_fmt yuv420p -r ${FPS} -c:a aac -b:a 192k -shortest "$OUT"
else
  echo "No audio sources found. Exporting silent video..."
  ffmpeg -y -i "$VIDEO" -c:v libx264 -pix_fmt yuv420p -r ${FPS} -an "$OUT"
fi

echo "Done -> $OUT"

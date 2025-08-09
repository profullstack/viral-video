#!/usr/bin/env bash
set -euo pipefail

# TikTok Crypto Video Builder
# Requires: ffmpeg 4+, optional: espeak-ng (for quick TTS if voiceover.mp3 missing)
# Usage: ./make_tiktok.sh
#
# Expected structure:
#   scenes/scene01.png ... scene06.png (replace with your AI frames)
#   captions.ass
#   storyboard.csv
#   audio/voiceover.mp3 (optional; else auto-TTS from voiceover.txt if espeak-ng exists)
#   audio/music.mp3 (optional background music)

FPS=30
SIZE=1080x1920
OUT=output.mp4

has_cmd() { command -v "$1" >/dev/null 2>&1; }

if ! has_cmd ffmpeg; then
  echo "Error: ffmpeg is required." >&2
  exit 1
fi

mkdir -p build

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

# Create per-scene video segments with gentle Ken Burns zoom
# Read storyboard.csv (filename,start,duration,cue)
echo "Rendering scene segments..."
tail -n +2 storyboard.csv | while IFS=, read -r FNAME START DURATION CUE; do
  DURATION=${DURATION//[$'\r']}
  BASENAME=$(basename "$FNAME" .png)
  if [ ! -f "scenes/$FNAME" ]; then
    echo "Missing scenes/$FNAME — create or replace with your AI art."; exit 1
  fi
  # Zoom from 1.0 to 1.06 over duration
  ffmpeg -y -loop 1 -t "$DURATION" -i "scenes/$FNAME" \
    -vf "scale=1080:1920,zoompan=z='min(zoom+0.0009,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps=${FPS}:d=$(($DURATION*${FPS})),format=yuv420p" \
    -r ${FPS} -pix_fmt yuv420p -an "build/${BASENAME}.mp4"
done

# Concat video segments
echo "Concatenating segments..."
CONCAT_FILE="build/concat.txt"
: > "$CONCAT_FILE"
for S in build/scene*.mp4; do
  echo "file '$S'" >> "$CONCAT_FILE"
done

ffmpeg -y -f concat -safe 0 -i "$CONCAT_FILE" -c copy "build/video_nocaptions.mp4"

# Burn captions (ASS)
if [ -f "captions.ass" ]; then
  echo "Burning captions..."
  ffmpeg -y -i "build/video_nocaptions.mp4" -vf "ass=captions.ass" -c:a copy "build/video_captions.mp4"
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
echo "Tip: Replace scenes/*.png with your AI-generated frames and add audio/voiceover.mp3 + audio/music.mp3 for best results."

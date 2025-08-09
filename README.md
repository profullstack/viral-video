
TikTok Crypto Video Kit (60s, 1080x1920)

What you have:
- make_tiktok.sh — builds output.mp4 with ffmpeg
- scenes/*.png — placeholder title cards (replace with your AI-generated frames)
- captions.ass — styled captions burned into the video
- storyboard.csv — scene timing (seconds)
- voiceover.txt — narration script (male, smooth, educational)
- audio/voiceover.mp3 — (optional) add your own TTS/VO here
- audio/music.mp3 — (optional) background track

Quick start:
1) Replace the PNGs in scenes/ with your AI cartoon frames (keep the same filenames).
2) Add audio/voiceover.mp3 (male, smooth) and optionally audio/music.mp3.
   - No VO? If espeak-ng is installed, the script will auto-generate a placeholder VO from voiceover.txt.
3) Run:
   chmod +x make_tiktok.sh
   ./make_tiktok.sh
4) Upload output.mp4 to TikTok.

Notes:
- Scene timings are defined in storyboard.csv. Change durations to fit your final VO, then re-run the script.
- The script gently zooms into each still for movement. If you use short video clips instead, render them separately and edit the concat step.
- Captions are burned from captions.ass. Edit text/timings to match your VO precisely.

Disclaimer: Educational content only, not financial advice.

# Crate

**A social media manager for DJs and producers.** Built for bass music artists who'd rather be
making tunes than wrangling content: Crate takes footage straight off your camera, keeps it
organised, makes it the right shape for every app, tells you when to post, and gives you ideas
when you're stuck.

Windows first, with macOS and Linux builds from the same code.

## What it does

| | |
|---|---|
| **Imports your camera card** | Plug in your Sony ZV-E10 II card and Crate offers to import it. Clips and photos are copied into dated shoot folders, renamed by when they were filmed, and anything already imported is skipped. RAW files are paired with their JPGs. |
| **Knows your footage** | Reads Sony's metadata: real recording time, camera, frame rate, and whether you shot in S-Log. Thumbnails, durations and sizes for everything. |
| **Sorts it** | Tags (studio, crowd, drop, b2b…), star ratings, notes, status (new / keeper / edited / posted), filters and search. Tag a whole selection in one go. |
| **Makes it ready for every platform** | Shows, per platform, whether a file can go up as-is or what needs fixing. One click makes Instagram Reels, Feed, Story, TikTok, YouTube Shorts and videos, Facebook Reels, X, and Spotify Canvas loops: right shape (crop, or fit with a blurred background), right length, H.264, your LUT applied to S-Log clips, loudness evened out to −14 LUFS, and optional text on screen. |
| **Plans your week** | A calendar of posts with captions, hashtags, files and target platforms. A weekly post goal, streaks, and a "Today" screen that says what's next. |
| **Reminds you** | Desktop notifications when a post is due, a daily nudge if you're behind on your goal, and a heads-up when there's untagged footage piling up. Runs quietly in the tray. |
| **Gives you ideas** | Claude suggests post ideas based on your sound, what's coming up (releases, gigs) and the footage you actually have. It also writes captions and hashtags by looking at frames from your clip. |
| **Posting in seconds** | "Post to Instagram/TikTok" copies the caption and hashtags and opens the ready file, so posting is drag, paste, done. Then tick it off. |
| **Instagram stats** | Connect your Instagram (Creator or Business account) to see recent posts with likes and comments, and your best days and times to post. |

## Install on Windows

Until there's a proper release, the installer is built automatically on GitHub:

1. Open this repository on GitHub and click the **Actions** tab.
2. Click the latest green **Build** run, scroll to **Artifacts**, and download
   **Crate-Windows-Installer**.
3. Unzip it and double-click `Crate-Setup-….exe`.
4. Windows will probably say *"Windows protected your PC"* because the installer isn't signed
   yet. Click **More info → Run anyway**.
5. Crate opens and walks you through three quick setup steps.

## First run

1. **Tell it about you**: artist name, genres, your sound, how you talk. This makes ideas and
   captions sound like you.
2. **Pick where your footage lives**: a drive with plenty of space. 4K eats storage.
3. **Add a Claude API key** (optional, for ideas and captions): sign up at
   [console.anthropic.com](https://console.anthropic.com), add a few pounds of credit under
   Billing, create a key under API keys, and paste it in. A batch of ideas costs a few pence.
4. **Connect Instagram** (optional) from the Accounts page. See
   [docs/INSTAGRAM_SETUP.md](docs/INSTAGRAM_SETUP.md).
5. **If you shoot S-Log3**, download Sony's free LUTs and pick the S-Log3 to 709 `.cube` file in
   Settings. Crate applies it automatically when exporting clips it knows are S-Log.

## A typical week

- **After a session or gig**: plug in the card, click *Import now*, give the shoot a name.
- **Ten minutes later**: star the best bits and tag them.
- **Pick a clip → Vertical pack**: Reels, TikTok, Shorts and Facebook versions are made for you.
- **Make a post with it**: let Claude draft the caption, pick a time.
- **When the reminder pops up**: click *Post to Instagram*, paste, upload, tick *Done*.

## For developers

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it's built and how to add platforms,
export formats and features, and [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.

```
npm install
npm run dev        # run the app with live reload
npm test           # unit tests + an end-to-end import/export test with real ffmpeg
npm run dist:win   # build the Windows installer
```

# Connecting Instagram

Crate talks to Instagram through Meta's official **Instagram API with Instagram Login**. Meta
only lets apps use it with *professional* accounts, and it needs a (free) Meta developer app.
You do this once; it takes about 15 minutes.

## 1. Make your Instagram a Creator account

In the Instagram app: **Settings → Account type and tools → Switch to professional account →
Creator**. It's free, nothing is lost, and you get post stats. (Business also works.)

## 2. Create a Meta developer app

1. On a computer, go to <https://developers.facebook.com/apps> and log in with Facebook.
   Register as a developer if it asks (free).
2. Click **Create app**. Call it something like "Crate for Silkie".
3. When it asks what the app is for, pick the option about **managing messaging and content on
   Instagram**.

## 3. Generate your access token

1. In the app's dashboard, open **Instagram → API setup with Instagram login**.
2. Under **Generate access tokens**, click **Add account** and log in to your Instagram.
3. Click **Generate token** next to your account and copy the long token.
4. In Crate, open **Accounts → Instagram**, paste the token and click **Connect**.

If Meta says your account isn't allowed: in the dashboard go to **App roles → Roles → Add
people**, add your Instagram username as an **Instagram tester**, accept the invite in Instagram
under **Settings → Website permissions → Tester invites**, then try step 3 again.

## What Crate does with it

- Reads your profile (followers, post count) and your recent posts with likes and comments.
- Works out your best days and times to post from that.
- Keeps the token fresh automatically. Tokens last 60 days and Crate renews them whenever you
  open your Instagram stats, so it keeps working as long as you use it now and then.
- The token is stored encrypted on your computer only.

## Why Crate doesn't post to Instagram directly (yet)

Meta's publishing API only accepts photos and videos from a **public web address**, not from a
file on your computer. Direct posting needs Crate to upload the file somewhere public first,
which is on the roadmap. Until then, **Post to Instagram** in the planner copies your caption
and hashtags and opens the ready-made file, so posting from Instagram on the web or desktop is a
drag, a paste and a click.

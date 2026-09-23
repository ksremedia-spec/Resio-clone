# 10 · Putting Buildline on the company iPads (TestFlight)

This is for R. P. Valois & Co.'s own devices. The app never goes on the public
App Store. Written for whoever holds the Apple developer account; no coding
knowledge is needed, but you do need a Mac.

## What you need

* A Mac with **Xcode** installed (free, from the Mac App Store, about 15 GB).
* The company's **Apple Developer** account signed in to Xcode
  (Xcode → Settings → Accounts → add your Apple ID).
* **Node.js 22+** and **pnpm** on the Mac (`npm install -g pnpm`).
* **CocoaPods** on the Mac: `sudo gem install cocoapods` (one time).
* The address of the Buildline server, e.g. `https://buildline.rpvalois.com`
  (see `11-server-setup.md`). The app can also be pointed at a different
  server from its sign-in screen, so a staging build is not required.

## One-time setup in App Store Connect (about 10 minutes)

1. Sign in at https://appstoreconnect.apple.com.
2. **Apps → + → New App.** Platform iOS, name `RPV Buildline`, bundle ID
   `com.rpvalois.buildline` (create it under Certificates, Identifiers &
   Profiles → Identifiers if it is not offered), SKU `rpv-buildline`.
   Nothing here is public until you press "Submit for review", which you
   never will.
3. **Users and Access → + ** to add the people who should be able to install
   builds. Give field staff the "Customer Support" or "Marketing" role: it is
   the lowest role that still lets them be TestFlight testers. Up to 100
   people.

## Building and uploading (each time you want a new version)

From a Terminal on the Mac, inside the project folder:

```bash
pnpm install
VITE_API_URL=https://buildline.rpvalois.com pnpm --filter @buildline/ipad build
cd apps/ipad
npx cap sync ios
npx cap open ios
```

`cap sync` copies the web app into the iOS project and installs the native
plugins. `cap open` opens it in Xcode. Then in Xcode:

1. Click the **App** project at the top of the left sidebar, choose the
   **App** target, open **Signing & Capabilities**, tick **Automatically
   manage signing** and pick the company **Team**. Xcode creates the
   certificate and profile for you.
2. In **General**, bump **Version** (for example 1.0.1) each time you upload.
   Build number must go up too; Xcode does that when "Automatically manage"
   is on, otherwise add one.
3. At the top, choose **Any iOS Device (arm64)** as the destination.
4. **Product → Archive.** Wait a few minutes.
5. In the Organizer window that opens: **Distribute App → TestFlight &
   App Store → Upload.** Accept the defaults.
6. Back in App Store Connect → your app → **TestFlight**, the build appears
   after 5 to 15 minutes of processing. The first build asks a couple of
   export-compliance questions: answer **No** to "uses encryption" (the app
   only uses standard HTTPS).
7. Under **Internal Testing**, create a group (for example "RPV staff"), tick
   the build, and add the people from step 3 of the setup.

Each person then installs the free **TestFlight** app from the App Store,
opens the invitation email, and taps **Install**. Updates arrive through
TestFlight automatically.

## The 90-day rule

TestFlight builds stop working 90 days after upload. Put a reminder in the
calendar to repeat "Building and uploading" every two to three months, or
whenever there is a new version anyway. If that becomes a nuisance, switch to
**Ad Hoc** distribution (below), which has no expiry.

## Alternative: Ad Hoc (no expiry, fixed set of iPads)

1. Collect each iPad's identifier: Settings → General → About → tap the
   serial number area to see the UDID, or plug it into the Mac and read it in
   Finder. Register them at developer.apple.com → Devices. Up to 100.
2. In Xcode, after **Product → Archive**, choose **Distribute App → Release
   Testing (Ad Hoc)** and export. You get an `.ipa` file.
3. Install it on each iPad with the free **Apple Configurator** app on the
   Mac, or host the `.ipa` on your server with an install link. Buildline's
   server can host it: put the file in the `SERVE_CLIENT_DIR` folder and
   share the link.

## Pointing the app at a different server

On the sign-in screen, tap **change** next to "Server" and enter the full
address. This is kept on the device only. Use it to test against a staging
server, or if the company moves servers, without rebuilding the app.

## What the native app adds over Safari

Camera and photo library access for daily-log photos, a proper Home Screen
icon and name, no browser chrome, and the app keeps running in the background
while the time clock is open. Everything else is identical to opening the
server address in Safari and using **Add to Home Screen**, which is a fine
fallback for anyone who cannot install TestFlight.

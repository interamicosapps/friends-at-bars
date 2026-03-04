# iOS App Store Build Guide

This guide covers building and deploying the iOS app using Codemagic CI/CD from Windows, as well as alternative methods using Xcode on macOS.

## Prerequisites

- Apple Developer Program membership ($99/year) - Required for App Store submission
- Codemagic account (free tier available)
- Git repository connected to Codemagic
- Code signing certificates and provisioning profiles

## Current Setup

- **App ID**: `com.barfest.app`
- **App Name**: Bar Fest
- **Platform**: Capacitor 8.0.0 with React + TypeScript
- **Build System**: Codemagic CI/CD (cloud-based macOS)

## Step 1: Set Up Apple Developer Account

1. Enroll in Apple Developer Program at [developer.apple.com](https://developer.apple.com)
2. Pay the $99 annual fee
3. Create an App ID matching your Bundle ID: `com.barfest.app`
4. Generate code signing certificates:
   - Distribution Certificate (for App Store)
   - Development Certificate (for testing, optional)
5. Create Provisioning Profiles:
   - App Store Distribution Profile
   - Development Profile (optional)

## Step 2: Configure Codemagic

### 2.1 Upload Certificates to Codemagic

1. Log in to [Codemagic](https://codemagic.io)
2. Go to **Teams** → **Code signing identities**
3. Upload your certificates:
   - Distribution Certificate (.p12 file)
   - Provisioning Profile (.mobileprovision file)
4. Create a **Group** for these credentials (e.g., `app_store_credentials`)
5. Note the group name for use in `codemagic.yaml`

### 2.2 Update codemagic.yaml

1. Open `codemagic.yaml` in the project root
2. Update the `groups` section with your credential group name:
   ```yaml
   groups:
     - app_store_credentials  # Replace with your group name
   ```
3. Update the email recipient:
   ```yaml
   email:
     recipients:
       - your-email@example.com
   ```
4. (Optional) Configure App Store Connect integration:
   - Set `submit_to_testflight: true` for automatic TestFlight uploads
   - Set `submit_to_app_store: true` for automatic App Store submission
   - Add beta group names if using TestFlight

### 2.3 Connect Repository

1. In Codemagic dashboard, ensure your GitHub repository is connected
2. The repository should be: `friends-at-bars`
3. Codemagic will automatically detect the `codemagic.yaml` file

## Step 3: Prepare App Icons

iOS requires app icons in multiple sizes. You'll need to add these to:
`ios/App/App/Assets.xcassets/AppIcon.appiconset/`

Required sizes:
- 20x20 (@2x, @3x)
- 29x29 (@2x, @3x)
- 40x40 (@2x, @3x)
- 60x60 (@2x, @3x)
- 76x76 (@1x, @2x)
- 83.5x83.5 (@2x)
- 1024x1024 (@1x)

You can use tools like:
- [App Icon Generator](https://www.appicon.co/)
- [IconKitchen](https://icon.kitchen/)

Update `Contents.json` in the AppIcon.appiconset folder to reference all icon files.

## Step 4: Build and Deploy

### Option A: Automatic Build (Recommended)

1. Push code to your repository:
   ```bash
   git add .
   git commit -m "Prepare for iOS build"
   git push
   ```
2. Codemagic will automatically detect the push and start a build
3. Monitor the build in the Codemagic dashboard
4. Once complete, the IPA will be available for download or automatic upload

### Option B: Manual Build

1. Go to Codemagic dashboard
2. Select your app
3. Click **Start new build**
4. Select the branch and workflow
5. Click **Start build**

## Step 5: App Store Connect Setup

1. Log in to [App Store Connect](https://appstoreconnect.apple.com)
2. Create a new app:
   - Platform: iOS
   - Bundle ID: `com.barfest.app`
   - App Name: Bar Fest
3. Complete app information:
   - Description
   - Keywords
   - Support URL
   - Privacy Policy URL (required)
   - Category
   - Age Rating
4. Upload screenshots (required sizes):
   - iPhone 6.7" Display (1290 x 2796 pixels)
   - iPhone 6.5" Display (1242 x 2688 pixels)
   - iPhone 5.5" Display (1242 x 2208 pixels)
   - iPad Pro 12.9" (2048 x 2732 pixels)
5. Set pricing and availability

## Step 6: Submit for Review

1. In App Store Connect, go to your app
2. Select the build uploaded by Codemagic
3. Complete any remaining metadata
4. Click **Submit for Review**
5. Apple typically reviews within 24-48 hours

## Local Development (If Mac Available)

If you have access to a Mac, you can also build locally:

### Prerequisites
- macOS with Xcode installed
- Apple Developer account
- Code signing certificates installed in Keychain

### Build Steps

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build web app:
   ```bash
   npm run build
   ```

3. Sync Capacitor:
   ```bash
   npm run cap:sync:ios
   ```

4. Open in Xcode:
   ```bash
   npm run cap:open:ios
   ```

5. In Xcode:
   - Select your development team
   - Configure signing & capabilities
   - Build and run on simulator or device
   - Archive for App Store (Product → Archive)
   - Upload to App Store Connect

## Troubleshooting

### Build Fails in Codemagic

- **Check logs**: Review build logs in Codemagic dashboard
- **Verify certificates**: Ensure certificates are properly uploaded and not expired
- **Check Bundle ID**: Verify Bundle ID matches in Xcode project and App Store Connect
- **Dependencies**: Ensure all npm dependencies are listed in `package.json`

### Code Signing Issues

- Verify certificates are valid and not expired
- Check provisioning profile matches Bundle ID
- Ensure certificates are in the correct Codemagic group
- Verify group name matches in `codemagic.yaml`

### App Rejected by Apple

- Review [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- Ensure privacy policy URL is accessible
- Check that all required app information is complete
- Verify app functionality matches description

## Useful Commands

```bash
# Build web app
npm run build

# Sync Capacitor iOS
npm run cap:sync:ios

# Open iOS project in Xcode (requires Mac)
npm run cap:open:ios

# Build for both platforms
npm run cap:build

# Build for iOS only
npm run cap:build:ios
```

## Resources

- [Codemagic Documentation](https://docs.codemagic.io/)
- [Capacitor iOS Guide](https://capacitorjs.com/docs/ios)
- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [App Store Connect Help](https://help.apple.com/app-store-connect/)

## Notes

- The app uses MapLibre GL for maps (compatible with iOS)
- No location permissions required (static map data)
- Supabase client works on iOS (web-based)
- StatusBar plugin is configured for iOS

## Next Steps After LLC Setup

1. ✅ Codemagic account created and repository connected
2. ⏳ Enroll in Apple Developer Program
3. ⏳ Generate and upload certificates to Codemagic
4. ⏳ Update `codemagic.yaml` with credential group
5. ⏳ Add app icons (all required sizes)
6. ⏳ Create app in App Store Connect
7. ⏳ Trigger first build
8. ⏳ Submit for review


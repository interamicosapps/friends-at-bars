# Native SwiftUI Bar Fest (iOS)

Replaces the Capacitor WebView product UI on iPhone. Catalog (venues / deals / games) comes from Supabase; live check-ins, chat, and `live_locations` reuse existing RPCs/tables.

## Open in Xcode

1. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).
2. Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (Codemagic env injects into Info.plist).
3. From this folder:

```bash
cd native/ios/BarFest
xcodegen generate
open BarFest.xcodeproj
```

4. Set your Development Team, run on a device/simulator.

### Location

`BarFest/Location/` is the absorbed `BarFestNativeLiveLocation` CoreLocation engine (venue radius 100m, heartbeat upserts to `live_locations`). Chat posting still requires a fresh `live_locations` row for the anonymous Keychain user id.

## Test Mode / Log (dev)

Shown when `bundleId` contains `.test` **or** Info.plist `ENABLE_DEV_TEST_MODE_UI` is true (set by `native-ios-test-workflow`).

- Top **Test Mode** chip — mock headcounts + include catalog test venues  
- Chat location pin — simulate OS location deny for composer  
- **Log** tab — location/system diagnostic lines  

## App icon

- **Production** (`com.barfest.app`): `BarFest/Assets.xcassets/AppIcon.appiconset` — black “BF” beer-mug mark (from `temporary/new_logos/Bar Fest Logo 7 black.png`).
- **Test** (`com.barfest.app.test`): `AppIcon-Test.appiconset` — green background variant. Codemagic `native-ios-test-workflow` sets `ASSETCATALOG_COMPILER_APPICON_NAME` / `CFBundleIconName` to `AppIcon-Test`.
- **Splash** (both): `LaunchLogo.imageset` — no-background mark on the black splash screen.
- White variant is kept unused under `temporary/new_logos/` for later.

Wired via `ASSETCATALOG_COMPILER_APPICON_NAME` in `project.yml` (default `AppIcon`) and `CFBundleIconName` in Info.plist.

## Version / build numbers (hardcoded)

Edit **both** places before each TestFlight upload (must stay in sync):

1. [`BarFest/Info.plist`](BarFest/Info.plist) — `CFBundleShortVersionString` / `CFBundleVersion`
2. Root [`codemagic.yaml`](../../../codemagic.yaml) — `native-ios-workflow` vars `NATIVE_MARKETING_VERSION` / `NATIVE_BUILD_NUMBER`

After `xcodegen`, CI runs `git checkout` on Info.plist and re-applies those hardcodes so XcodeGen cannot reset the build to `1`.

## TestFlight (Codemagic)

| Workflow | Bundle | ASC |
|----------|--------|-----|
| `native-ios-workflow` | `com.barfest.app` | Bar Fest (production) |
| `native-ios-test-workflow` | `com.barfest.app.test` | Bar Fest Test |

See root `codemagic.yaml`. Manual start: pick branch + matching workflow.

## Tabs

| Tab | Source |
|-----|--------|
| Activities | `live_locations` counts + `checkins` |
| Deals | `catalog_listings` |
| Chat | `chat_posts` + RPCs + native composer (16pt+) |
| Map | `MKMapView` / SwiftUI `Map` + `catalog_venues` |
| Games | Ride the Bus / Switch Search (words from CMS `catalog_game_content`, bundled fallback) |

## Content updates without App Store

Edit via Vercel admin CMS → Supabase. Pull-to-refresh in app.

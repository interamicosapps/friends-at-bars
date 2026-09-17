import SwiftUI
import CoreLocation

@main
struct BarFestApp: App {
    @StateObject private var appModel = AppModel()
    @StateObject private var testMode = TestModeStore.shared

    init() {
        // Re-attach geofences / significant-location ASAP so a cold wake from a region
        // event can resume presence writes before the catalog finishes loading.
        VenueLiveLocationEngine.shared.restoreIfNeeded()
    }

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environmentObject(appModel)
                .environmentObject(testMode)
        }
    }
}

/// Hosts main UI plus cold-start splash overlay (once per process launch).
private struct AppRootView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var showSplash = true

    var body: some View {
        ZStack {
            RootTabView()
            if showSplash {
                StartupSplashView(isBootstrapComplete: appModel.initialBootstrapFinished) {
                    DiagnosticLog.shared.append(category: "system", message: "AppRoot splash overlay removed")
                    showSplash = false
                    appModel.markSplashDismissed()
                }
                .transition(.opacity)
                .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.15), value: showSplash)
        .task {
            DiagnosticLog.shared.append(
                category: "system",
                message: "AppRoot bootstrap task start showSplash=\(showSplash)"
            )
            await appModel.bootstrap()
            DiagnosticLog.shared.append(
                category: "system",
                message: "AppRoot bootstrap task returned initialBootstrapFinished=\(appModel.initialBootstrapFinished)"
            )
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var venues: [CatalogVenue] = []
    @Published var listings: [CatalogListing] = []
    @Published var geographies: [CatalogGeography] = []
    @Published var areas: [CatalogArea] = []
    @Published var venueCounts: [String: Int] = [:]
    @Published var wordPackReady = false
    @Published var lastVenueName: String?
    /// Venues currently in footprint ∪ 15 m buffer (closest center first).
    @Published private(set) var proximityVenueNames: [String] = []
    /// True after ~20 s continuously in a proximity zone — drives wait check-in popup.
    @Published private(set) var waitPromptEligible = false
    @Published var errorMessage: String?
    @Published var isRefreshing = false
    @Published var initialBootstrapFinished = false
    /// True after the cold-start splash overlay is actually gone (not merely bootstrap-complete).
    @Published private(set) var splashDidDismiss = false
    @Published var lastKnownCoordinate: CLLocationCoordinate2D?
    @Published var manualGeographyId: UUID?
    @Published private(set) var waitSummaries: [String: WaitTimeSummary] = [:]
    @Published private(set) var myWaitMinutesByVenue: [String: Int] = [:]

    private let locationBridge = LocationBridge()
    private let manualGeographyKey = "barfest_manual_geography_id"

    /// Geography IDs the current catalog load exposes (active + non-test unless Test Mode).
    private var visibleGeographyIds: Set<UUID> {
        Set(geographies.map(\.id))
    }

    /// Venues whose parent geography is visible — geography active/test supersedes venue flags in the app.
    var venuesInVisibleGeographies: [CatalogVenue] {
        venues.filter { venue in
            guard let gid = venue.geography_id else { return false }
            return visibleGeographyIds.contains(gid)
        }
    }

    var resolvedGeography: CatalogGeography? {
        if let id = manualGeographyId, let match = geographies.first(where: { $0.id == id }) {
            return match
        }
        return GeographyResolver.automatic(coordinate: lastKnownCoordinate, from: geographies)
    }

    var scopedVenues: [CatalogVenue] {
        let base = venuesInVisibleGeographies
        guard let geo = resolvedGeography else { return base }
        return base.filter { $0.geography_id == geo.id }
    }

    var scopedListings: [CatalogListing] {
        let names = Set(scopedVenues.map(\.name))
        guard !names.isEmpty else { return [] }
        return listings.filter { names.contains($0.venue_name) }
    }

    var scopedAreas: [CatalogArea] {
        let visible = areas.filter { visibleGeographyIds.contains($0.geography_id) }
        guard let geo = resolvedGeography else { return visible }
        return visible.filter { $0.geography_id == geo.id }
    }

    /// GPS-derived geography (no manual banner override). Nil if outside all regions.
    var gpsGeography: CatalogGeography? {
        GeographyResolver.geographyContaining(
            coordinate: lastKnownCoordinate,
            from: geographies
        )
    }

    func markSplashDismissed() {
        guard !splashDidDismiss else { return }
        splashDidDismiss = true
        DiagnosticLog.shared.append(category: "system", message: "Splash dismissed — UI revealed")
    }

    func setManualGeography(_ id: UUID?, source: String = "manual") {
        let previousResolved = resolvedGeography?.name ?? "nil"
        manualGeographyId = id
        if let id {
            UserDefaults.standard.set(id.uuidString, forKey: manualGeographyKey)
        } else {
            UserDefaults.standard.removeObject(forKey: manualGeographyKey)
        }
        logGeographyChange(source: source, previousResolved: previousResolved)
        Task { await refreshWaitTimes() }
    }

    private func logGeographyChange(source: String, previousResolved: String) {
        let resolved = resolvedGeography?.name ?? "nil"
        let manual = manualGeographyId
            .flatMap { id in geographies.first(where: { $0.id == id })?.name }
            ?? "automatic"
        let gps = gpsGeography?.name ?? "nil"
        let geoList = geographies.map(\.name).joined(separator: ", ")
        DiagnosticLog.shared.append(
            category: "geography",
            message: """
            \(source) manual=\(manual) gps=\(gps) resolved \(previousResolved)→\(resolved) \
            scoped venues=\(scopedVenues.count) listings=\(scopedListings.count) areas=\(scopedAreas.count)
            """
        )
        DiagnosticLog.shared.append(
            category: "geography",
            message: "catalog geographies (\(geographies.count)): \(geoList.isEmpty ? "(none)" : geoList)"
        )
    }

    func waitSummary(for venueName: String) -> WaitTimeSummary {
        waitSummaries[venueName] ?? .none
    }

    func myWaitMinutes(for venueName: String) -> Int? {
        myWaitMinutesByVenue[venueName]
    }

    func refreshWaitTimes() async {
        let names = Set(scopedVenues.map(\.name))
        guard !names.isEmpty, let geoId = resolvedGeography?.id else {
            waitSummaries = [:]
            myWaitMinutesByVenue = [:]
            return
        }

        var reports: [WaitTimeReport] = []
        if TestModeStore.shared.useMockCheckIns {
            reports = TestWaitTimeStore.shared.reports(for: Array(names))
        } else {
            do {
                reports = try await WaitTimeService.fetchReports(geographyId: geoId)
                    .filter { names.contains($0.venueName) }
            } catch {
                DiagnosticLog.shared.append(
                    category: "location",
                    message: "wait times fetch failed: \(error.localizedDescription)",
                    level: "error"
                )
            }
        }

        waitSummaries = WaitTimeAggregator.summariesByVenue(reports: reports)
        var mine: [String: Int] = [:]
        for report in reports where report.isMine {
            mine[report.venueName] = report.minutes
        }
        myWaitMinutesByVenue = mine
    }

    func submitWaitReport(venueName: String, waitMinutes: Int, isMock: Bool = false) async throws {
        if TestModeStore.shared.useMockCheckIns {
            TestWaitTimeStore.shared.upsert(venueName: venueName, minutes: waitMinutes)
            if isMock {
                try? await WaitTimeService.submitReport(
                    venueName: venueName,
                    waitMinutes: waitMinutes,
                    latitude: nil,
                    longitude: nil,
                    isMock: true
                )
            }
            await refreshWaitTimes()
            return
        }

        guard let lat = lastKnownCoordinate?.latitude,
              let lon = lastKnownCoordinate?.longitude else {
            throw NSError(
                domain: "WaitTime",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Location required to report wait time"]
            )
        }
        try await WaitTimeService.submitReport(
            venueName: venueName,
            waitMinutes: waitMinutes,
            latitude: lat,
            longitude: lon,
            isMock: false
        )
        await refreshWaitTimes()
    }

    func bootstrap() async {
        let t0 = CFAbsoluteTimeGetCurrent()
        DiagnosticLog.shared.append(
            category: "system",
            message: "Bootstrap begin bundle=\(Bundle.main.bundleIdentifier ?? "?") testUI=\(DevTestMode.isUIEnabled)"
        )
        defer {
            initialBootstrapFinished = true
            let elapsed = CFAbsoluteTimeGetCurrent() - t0
            DiagnosticLog.shared.append(
                category: "system",
                message: String(
                    format: "Bootstrap finished elapsed=%.2fs venues=%d listings=%d geos=%d counts=%d error=%@",
                    elapsed,
                    venues.count,
                    listings.count,
                    geographies.count,
                    venueCounts.count,
                    errorMessage ?? "nil"
                )
            )
        }

        await CatalogStore.shared.loadCachedVenuesIfNeeded()
        venues = await CatalogStore.shared.venues
        DiagnosticLog.shared.append(
            category: "system",
            message: "Bootstrap cache loaded venues=\(venues.count) t=\(String(format: "%.2fs", CFAbsoluteTimeGetCurrent() - t0))"
        )

        if let raw = UserDefaults.standard.string(forKey: manualGeographyKey) {
            manualGeographyId = UUID(uuidString: raw)
            if let id = manualGeographyId {
                DiagnosticLog.shared.append(
                    category: "geography",
                    message: "bootstrap restored manual geography id=\(id.uuidString.prefix(8))…"
                )
            }
        }

        DiagnosticLog.shared.append(
            category: "system",
            message: "Bootstrap refreshCatalog begin t=\(String(format: "%.2fs", CFAbsoluteTimeGetCurrent() - t0))"
        )
        // Force-kill cold starts can hang indefinitely on network — don't block splash forever.
        let catalogTimedOut = await withTimeout(seconds: 18) {
            await self.refreshCatalog()
        }
        if catalogTimedOut {
            DiagnosticLog.shared.append(
                category: "error",
                message: "Bootstrap refreshCatalog TIMED OUT after 18s — continuing with cached/partial data venues=\(venues.count) listings=\(listings.count)",
                level: "error"
            )
            venues = await CatalogStore.shared.venues
            listings = await CatalogStore.shared.listings
            geographies = await CatalogStore.shared.geographies
            areas = await CatalogStore.shared.areas
        } else {
            DiagnosticLog.shared.append(
                category: "system",
                message: "Bootstrap refreshCatalog done t=\(String(format: "%.2fs", CFAbsoluteTimeGetCurrent() - t0)) venues=\(venues.count) listings=\(listings.count)"
            )
            logGeographyChange(source: "bootstrap", previousResolved: "—")
        }

        DiagnosticLog.shared.append(
            category: "system",
            message: "Bootstrap locationBridge.start begin t=\(String(format: "%.2fs", CFAbsoluteTimeGetCurrent() - t0))"
        )
        locationBridge.start(
            venues: venuesInVisibleGeographies,
            onVenue: { [weak self] name in
                Task { @MainActor in
                    let previous = self?.lastVenueName
                    if let name {
                        self?.lastVenueName = name
                    }
                    if let name, name != previous {
                        let reported = self?.myWaitMinutes(for: name) != nil
                        WaitTimeNotificationManager.notifyCheckInIfNeeded(
                            venueName: name,
                            userAlreadyReported: reported
                        )
                    }
                    if name == nil, self?.proximityVenueNames.isEmpty == true {
                        self?.lastVenueName = nil
                        WaitTimeNotificationManager.clearVenueTracking()
                    }
                }
            },
            onProximity: { [weak self] candidates, primary, eligible in
                Task { @MainActor in
                    guard let self else { return }
                    let previousEligible = self.waitPromptEligible
                    self.proximityVenueNames = candidates
                    self.waitPromptEligible = eligible
                    if let primary {
                        self.lastVenueName = primary
                    } else if candidates.isEmpty {
                        self.lastVenueName = nil
                    }
                    if eligible, !previousEligible, let primary {
                        let reported = self.myWaitMinutes(for: primary) != nil
                        WaitTimeNotificationManager.notifyCheckInIfNeeded(
                            venueName: primary,
                            userAlreadyReported: reported
                        )
                        DiagnosticLog.shared.append(
                            category: "location",
                            message: "wait prompt eligible primary=\(primary) candidates=\(candidates.count)"
                        )
                    }
                    if candidates.isEmpty {
                        WaitTimeNotificationManager.clearVenueTracking()
                    }
                }
            },
            onPresenceWrite: { [weak self] action in
                Task { @MainActor in
                    await self?.refreshLiveCountsOnly(source: "presence-\(action)")
                }
            },
            onCoordinate: { [weak self] coord in
                Task { @MainActor in
                    guard let self else { return }
                    let previousResolved = self.resolvedGeography?.name
                    self.lastKnownCoordinate = coord
                    guard self.manualGeographyId == nil else { return }
                    let newResolved = self.resolvedGeography?.name
                    if previousResolved != newResolved {
                        self.logGeographyChange(
                            source: "gps",
                            previousResolved: previousResolved ?? "nil"
                        )
                    }
                }
            }
        )
        let state = VenueLiveLocationEngine.shared.currentState()
        lastVenueName = state.lastVenue
        await refreshWaitTimes()
        DiagnosticLog.shared.append(
            category: "location",
            message: "Bootstrap presence engineRunning=\(state.isRunning) lastVenue=\(state.lastVenue ?? "nil")"
        )
    }

    /// Returns `true` if `operation` did not finish within `seconds`.
    private func withTimeout(seconds: TimeInterval, operation: @escaping @MainActor () async -> Void) async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            group.addTask { @MainActor in
                await operation()
                return false
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                return true
            }
            let first = await group.next() ?? true
            group.cancelAll()
            return first
        }
    }

    /// Lightweight headcount refresh after our own upsert/deactivate (avoids full catalog round-trip).
    func refreshLiveCountsOnly(source: String) async {
        do {
            if TestModeStore.shared.useMockCheckIns {
                venueCounts = try await LiveLocationService.mockVenueCounts()
            } else {
                venueCounts = try await LiveLocationService.venueCounts()
            }
            await logHeadcountSnapshot(source: source)
        } catch {
            DiagnosticLog.shared.append(
                category: "location",
                message: "headcount refresh[\(source)] failed: \(error.localizedDescription)",
                level: "error"
            )
        }
    }

    func refreshCatalog() async {
        isRefreshing = true
        let t0 = CFAbsoluteTimeGetCurrent()
        DiagnosticLog.shared.append(category: "system", message: "refreshCatalog begin")
        defer {
            isRefreshing = false
            DiagnosticLog.shared.append(
                category: "system",
                message: String(
                    format: "refreshCatalog end elapsed=%.2fs venues=%d listings=%d geos=%d",
                    CFAbsoluteTimeGetCurrent() - t0,
                    venues.count,
                    listings.count,
                    geographies.count
                )
            )
        }
        let includeTest = DevTestMode.isUIEnabled || TestModeStore.shared.useMockCheckIns
        do {
            try await CatalogStore.shared.refresh(includeTest: includeTest)
            venues = await CatalogStore.shared.venues
            listings = await CatalogStore.shared.listings
            geographies = await CatalogStore.shared.geographies
            areas = await CatalogStore.shared.areas
            if let id = manualGeographyId, !geographies.contains(where: { $0.id == id }) {
                setManualGeography(nil, source: "catalog-invalidate")
            }
            let cmsLibrary = await CatalogStore.shared.switchSearchLibrary
            let wordPack = await CatalogStore.shared.wordPack
            wordPackReady = cmsLibrary != nil || !wordPack.isEmpty
            if TestModeStore.shared.useMockCheckIns {
                venueCounts = try await LiveLocationService.mockVenueCounts()
                DiagnosticLog.shared.append(
                    category: "location",
                    message: "venueCounts using CMS mock_venue_attendance (\(venueCounts.count) venues)"
                )
            } else {
                venueCounts = try await LiveLocationService.venueCounts()
            }
            locationBridge.updateVenues(venuesInVisibleGeographies)
            errorMessage = nil
            await logCatalogDiagnostics(source: "refresh")
            await logHeadcountSnapshot(source: "refresh")
            await refreshWaitTimes()
        } catch {
            errorMessage = error.localizedDescription
            venues = await CatalogStore.shared.venues
            listings = await CatalogStore.shared.listings
            geographies = await CatalogStore.shared.geographies
            areas = await CatalogStore.shared.areas
            DiagnosticLog.shared.append(
                category: "error",
                message: "Catalog refresh failed: \(error.localizedDescription)",
                level: "error"
            )
            await logCatalogDiagnostics(source: "refresh-failed-partial")
        }
    }

    /// Pull-to-refresh focused path: refresh catalog + live headcounts and log clearly.
    func refreshHeadcounts(source: String = "pull-to-refresh") async {
        DiagnosticLog.shared.append(
            category: "location",
            message: "headcount refresh begin source=\(source) authAlways=\(LocationAuthorizationStore.shared.isAuthorized) lastVenue=\(lastVenueName ?? "nil")"
        )
        await refreshCatalog()
    }

    private func logHeadcountSnapshot(source: String) async {
        let total = venueCounts.values.reduce(0, +)
        let top = venueCounts.sorted { $0.value > $1.value }.prefix(5)
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: ", ")
        DiagnosticLog.shared.append(
            category: "location",
            message: "headcount snapshot[\(source)] people=\(total) venues=\(venueCounts.count) maxAgeSec=\(AppConfig.liveLocationCountMaxAgeSeconds) top=\(top.isEmpty ? "(none)" : top)"
        )
    }

    /// Logs listing/venue breakdown to help diagnose Deals showing fewer rows than expected.
    private func logCatalogDiagnostics(source: String) async {
        let includeTest = DevTestMode.isUIEnabled || TestModeStore.shared.useMockCheckIns
        let version = await CatalogStore.shared.contentVersion.map(String.init) ?? "nil"
        let areas = Dictionary(grouping: listings, by: \.area).mapValues(\.count)
        let areaSummary = areas.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ", ")
        let withPriority = listings.filter { $0.priority > 0 }.count
        let venuesSample = listings.prefix(8).map(\.venue_name).joined(separator: ", ")
        let hint: String
        if listings.count <= 6 {
            hint = "HINT: only \(listings.count) rows in Supabase — re-run catalog_seed.sql or CMS Import web listings (47)"
        } else if listings.count < 40 {
            hint = "HINT: partial catalog (\(listings.count)/47 expected) — check Supabase catalog_listings"
        } else {
            hint = "catalog looks complete"
        }
        DiagnosticLog.shared.append(
            category: "system",
            message: """
            Catalog[\(source)] venues=\(venues.count) listings=\(listings.count) \
            priority=\(withPriority) version=\(version) includeTest=\(includeTest) mock=\(TestModeStore.shared.useMockCheckIns)
            """
        )
        DiagnosticLog.shared.append(
            category: "system",
            message: "Catalog areas: \(areaSummary.isEmpty ? "(none)" : areaSummary)"
        )
        DiagnosticLog.shared.append(
            category: "system",
            message: "Catalog sample venues: \(venuesSample.isEmpty ? "(none)" : venuesSample)"
        )
        DiagnosticLog.shared.append(category: "system", message: hint)
        DiagnosticLog.shared.append(
            category: "system",
            message: "Supabase host: \(AppConfig.supabaseURL)"
        )
    }

}

/// Wires catalog venues into VenueLiveLocationEngine.
@MainActor
final class LocationBridge: VenueLiveLocationEngineDelegate {
    private var onVenue: ((String?) -> Void)?
    private var onProximity: (([String], String?, Bool) -> Void)?
    private var onPresenceWrite: ((String) -> Void)?
    private var onCoordinate: ((CLLocationCoordinate2D) -> Void)?

    private static func records(from venues: [CatalogVenue]) -> [VenueRecord] {
        venues.map { venue in
            VenueRecord(
                name: venue.name,
                area: venue.area,
                coordinates: [venue.latitude, venue.longitude],
                footprint: venue.footprintCorners
            )
        }
    }

    func start(
        venues: [CatalogVenue],
        onVenue: @escaping (String?) -> Void,
        onProximity: (([String], String?, Bool) -> Void)? = nil,
        onPresenceWrite: ((String) -> Void)? = nil,
        onCoordinate: ((CLLocationCoordinate2D) -> Void)? = nil
    ) {
        self.onVenue = onVenue
        self.onProximity = onProximity
        self.onPresenceWrite = onPresenceWrite
        self.onCoordinate = onCoordinate
        do {
            let records = Self.records(from: venues)
            try VenueLiveLocationEngine.shared.applyConfiguration(
                supabaseUrl: AppConfig.supabaseURL,
                supabaseAnonKey: AppConfig.supabaseAnonKey,
                userId: AnonymousIdentity.userId(),
                venues: records,
                heartbeatMs: AppConfig.liveLocationHeartbeatMs,
                pollIntervalMs: 10_000,
                venueRadiusM: AppConfig.venueRadiusMeters,
                skipSupabase: false
            )
            VenueLiveLocationEngine.shared.eventDelegate = self
            LocationAuthorizationStore.shared.softStartTrackingIfPossible()
            DiagnosticLog.shared.append(
                category: "location",
                message: "presence engine start venues=\(records.count) auth=\(LocationAuthorizationStore.shared.status.rawValue) footprintHalf=\(Int(AppConfig.venueFootprintDefaultHalfMeters))m buffer=\(Int(AppConfig.venueExitRadiusMeters))m exitWait=\(Int(AppConfig.presenceExitConfirmSeconds))s approach=\(Int(AppConfig.venueApproachRadiusMeters))m"
            )
        } catch {
            print("LocationBridge start: \(error)")
            DiagnosticLog.shared.append(
                category: "location",
                message: "Tracking start failed: \(error.localizedDescription)",
                level: "error"
            )
        }
    }

    func updateVenues(_ venues: [CatalogVenue]) {
        let records = Self.records(from: venues)
        try? VenueLiveLocationEngine.shared.applyConfiguration(
            supabaseUrl: AppConfig.supabaseURL,
            supabaseAnonKey: AppConfig.supabaseAnonKey,
            userId: AnonymousIdentity.userId(),
            venues: records,
            heartbeatMs: AppConfig.liveLocationHeartbeatMs,
            pollIntervalMs: 10_000,
            venueRadiusM: AppConfig.venueRadiusMeters,
            skipSupabase: false
        )
    }

    nonisolated func engine(_ engine: VenueLiveLocationEngine, didUpdateCoordinate coordinate: CLLocationCoordinate2D) {
        Task { @MainActor in
            self.onCoordinate?(coordinate)
        }
    }

    nonisolated func engine(
        _ engine: VenueLiveLocationEngine,
        willWrite action: String,
        venueName: String,
        venueChanged: Bool,
        heartbeatDue: Bool
    ) {
        // Engine logs upsert intent; bridge only reacts to didWrite.
    }

    nonisolated func engine(_ engine: VenueLiveLocationEngine, didWrite action: String, venueName: String?) {
        Task { @MainActor in
            self.onVenue?(venueName)
            self.onPresenceWrite?(action)
        }
    }

    nonisolated func engine(
        _ engine: VenueLiveLocationEngine,
        didUpdateProximity candidates: [String],
        primary: String?,
        waitPromptEligible: Bool
    ) {
        Task { @MainActor in
            self.onProximity?(candidates, primary, waitPromptEligible)
        }
    }

    nonisolated func engine(_ engine: VenueLiveLocationEngine, didFailWrite message: String) {
        Task { @MainActor in
            DiagnosticLog.shared.append(
                category: "location",
                message: "bridge write failed: \(message)",
                level: "error"
            )
        }
    }

    nonisolated func engineDidLoseAuthorization(_ engine: VenueLiveLocationEngine) {
        Task { @MainActor in
            self.onVenue?(nil)
            self.onProximity?([], nil, false)
            DiagnosticLog.shared.append(
                category: "location",
                message: "Lost Always authorization",
                level: "warn"
            )
        }
    }
}

import CoreLocation
import Foundation

/// Presence engine: dual-radius geofences, dwell + exit hysteresis, sticky indoor
/// heartbeats, adaptive accuracy, offline write queue, significant-change / visit wakes.
///
/// Supabase is only written when the user is confirmed inside a bar (or sticky there).
final class VenueLiveLocationEngine: NSObject, CLLocationManagerDelegate {
    static let shared = VenueLiveLocationEngine()

    /// iOS allows ~20 monitored regions per app.
    static let maxMonitoredRegions = 20
    private static let regionIdPrefix = "bf:"

    enum Keys {
        static let supabaseUrl = "barfest_native_supabaseUrl"
        static let supabaseAnonKey = "barfest_native_supabaseAnonKey"
        static let userId = "barfest_native_userId"
        static let venuesJson = "barfest_native_venuesJson"
        static let heartbeatMs = "barfest_native_heartbeatMs"
        static let pollIntervalMs = "barfest_native_pollIntervalMs"
        static let venueRadiusM = "barfest_native_venueRadiusM"
        static let skipSupabase = "barfest_native_skipSupabase"
        static let trackingEnabled = "barfest_native_trackingEnabled"
        static let stickyVenue = "barfest_native_stickyVenue"
        static let pendingWrites = "barfest_native_pendingWrites"
    }

    weak var eventDelegate: VenueLiveLocationEngineDelegate?

    private let manager = CLLocationManager()
    private let queue = DispatchQueue(label: "com.barfest.native-live-location", qos: .userInitiated)
    /// Marks `queue` so nested calls can avoid `queue.sync` deadlocks (timers run on this queue).
    private static let engineQueueKey = DispatchSpecificKey<UInt8>()
    private static let engineQueueToken: UInt8 = 1

    private var venues: [VenueRecord] = []
    private var supabase: SupabaseLiveLocationAPI?
    private var userId: String = ""
    private var heartbeatMs: Int = AppConfig.liveLocationHeartbeatMs
    private var pollIntervalMs: Int = 10_000
    private var venueRadiusM: Double = AppConfig.venueRadiusMeters
    private var approachRadiusM: Double = AppConfig.venueApproachRadiusMeters
    private var exitRadiusM: Double = AppConfig.venueExitRadiusMeters
    private var hardClearRadiusM: Double = AppConfig.venueHardClearRadiusMeters
    private var skipSupabase = false

    private var isRunning = false
    private var lastProcessTime: TimeInterval = 0
    private var lastWrittenVenue: String?
    private var lastWriteAtMs: TimeInterval = 0
    private var stickyVenue: String?
    private var dwellVenue: String?
    private var dwellFixCount = 0
    private var exitCandidateVenue: String?
    private var exitCandidateSinceMs: TimeInterval = 0
    private var lastKnownLocation: CLLocation?
    private var lastGpsCallbackAtMs: TimeInterval = 0
    private var gpsCallbackCount = 0
    private var highAccuracyMode = false
    private var watchdogTimer: DispatchSourceTimer?
    private var stickyHeartbeatTimer: DispatchSourceTimer?
    private var monitoredVenueNames: Set<String> = []
    private var isFlushingQueue = false

    /// Venues whose footprint ∪ 15 m buffer currently contains the user (center-distance sorted).
    private var proximityCandidates: [String] = []
    private var proximityPrimary: String?
    private var proximityZoneEnteredAtMs: Double = 0
    private var waitPromptEligible = false
    /// True after we have deactivated because the user left the polygon but is still in the buffer.
    private var leftPolygonPendingExit = false

    private override init() {
        super.init()
        queue.setSpecific(key: Self.engineQueueKey, value: Self.engineQueueToken)
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 25
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .other
        if #available(iOS 11.0, *) {
            manager.showsBackgroundLocationIndicator = true
        }
        stickyVenue = UserDefaults.standard.string(forKey: Keys.stickyVenue)
        if let stickyVenue {
            lastWrittenVenue = stickyVenue
        }
    }

    /// Runs `work` on the engine queue without deadlocking when already on that queue.
    private func onEngineQueue<T>(_ work: () throws -> T) rethrows -> T {
        if DispatchQueue.getSpecific(key: Self.engineQueueKey) != nil {
            return try work()
        }
        return try queue.sync(execute: work)
    }

    func applyConfiguration(
        supabaseUrl: String,
        supabaseAnonKey: String,
        userId: String,
        venues: [VenueRecord],
        heartbeatMs: Int,
        pollIntervalMs: Int,
        venueRadiusM: Double,
        skipSupabase: Bool
    ) throws {
        let defaults = UserDefaults.standard
        defaults.set(supabaseUrl, forKey: Keys.supabaseUrl)
        defaults.set(supabaseAnonKey, forKey: Keys.supabaseAnonKey)
        defaults.set(userId, forKey: Keys.userId)
        defaults.set(heartbeatMs, forKey: Keys.heartbeatMs)
        defaults.set(pollIntervalMs, forKey: Keys.pollIntervalMs)
        defaults.set(venueRadiusM, forKey: Keys.venueRadiusM)
        defaults.set(skipSupabase, forKey: Keys.skipSupabase)

        let venuesData = try JSONEncoder().encode(venues)
        defaults.set(String(data: venuesData, encoding: .utf8), forKey: Keys.venuesJson)

        try onEngineQueue {
            self.userId = userId
            self.venues = venues
            self.heartbeatMs = heartbeatMs
            self.pollIntervalMs = pollIntervalMs
            self.venueRadiusM = venueRadiusM
            self.approachRadiusM = AppConfig.venueApproachRadiusMeters
            self.exitRadiusM = AppConfig.venueExitRadiusMeters
            self.hardClearRadiusM = AppConfig.venueHardClearRadiusMeters
            self.skipSupabase = skipSupabase
            if skipSupabase {
                self.supabase = nil
            } else {
                self.supabase = try SupabaseLiveLocationAPI(
                    supabaseUrl: supabaseUrl,
                    anonKey: supabaseAnonKey
                )
            }
        }

        logPresence(
            "config venues=\(venues.count) footprintHalf=\(Int(AppConfig.venueFootprintDefaultHalfMeters))m buffer=\(Int(exitRadiusM))m exitWait=\(Int(AppConfig.presenceExitConfirmSeconds))s approach=\(Int(approachRadiusM))m dwell=\(AppConfig.presenceDwellFixCount) sticky=\(stickyVenue ?? "nil")"
        )

        refreshMonitoredRegions(reason: "config")

        if isRunning, !venues.isEmpty {
            if let last = onEngineQueue({ lastKnownLocation }) {
                onEngineQueue { lastProcessTime = 0 }
                processLocation(last, force: true, source: "config-rescan")
            } else {
                manager.requestLocation()
            }
        }

        flushPendingWrites(reason: "config")
    }

    func loadConfigurationFromDefaults() -> Bool {
        let defaults = UserDefaults.standard
        guard
            let supabaseUrl = defaults.string(forKey: Keys.supabaseUrl),
            let anonKey = defaults.string(forKey: Keys.supabaseAnonKey),
            let userId = defaults.string(forKey: Keys.userId),
            let venuesJson = defaults.string(forKey: Keys.venuesJson),
            let venuesData = venuesJson.data(using: .utf8)
        else {
            return false
        }

        let venues = (try? JSONDecoder().decode([VenueRecord].self, from: venuesData)) ?? []
        let heartbeatMs = defaults.integer(forKey: Keys.heartbeatMs)
        let pollIntervalMs = defaults.integer(forKey: Keys.pollIntervalMs)
        let venueRadiusM = defaults.double(forKey: Keys.venueRadiusM)
        let skipSupabase = defaults.bool(forKey: Keys.skipSupabase)

        do {
            try applyConfiguration(
                supabaseUrl: supabaseUrl,
                supabaseAnonKey: anonKey,
                userId: userId,
                venues: venues,
                heartbeatMs: heartbeatMs > 0 ? heartbeatMs : AppConfig.liveLocationHeartbeatMs,
                pollIntervalMs: pollIntervalMs > 0 ? pollIntervalMs : 10_000,
                venueRadiusM: venueRadiusM > 0 ? venueRadiusM : AppConfig.venueRadiusMeters,
                skipSupabase: skipSupabase
            )
            return true
        } catch {
            return false
        }
    }

    /// Matches GPS mode to the current permission. While Using detects the bar on screen and does not write attendance. Always also writes attendance and keeps updating after the app closes.
    func adoptAuthorization(_ status: CLAuthorizationStatus) {
        switch status {
        case .authorizedAlways:
            setCountsInAttendance(true)
            try? startTracking()
        case .authorizedWhenInUse:
            setCountsInAttendance(false)
            try? startTracking()
        default:
            guard isRunning else { return }
            stopTracking(deactivate: true)
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.eventDelegate?.engineDidLoseAuthorization(self)
            }
        }
    }

    func startTracking() throws {
        let status = manager.authorizationStatus
        let always = status == .authorizedAlways
        let whileUsing = status == .authorizedWhenInUse
        guard always || whileUsing else {
            let message =
                "Location permission is required for presence (status=\(status.rawValue))."
            logPresence(message, level: "warn")
            throw NSError(
                domain: "BarFestNativeLiveLocation",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: message]
            )
        }

        var accuracyNote = "full"
        if #available(iOS 14.0, *) {
            switch manager.accuracyAuthorization {
            case .fullAccuracy: accuracyNote = "precise"
            case .reducedAccuracy: accuracyNote = "reduced"
            @unknown default: accuracyNote = "unknown"
            }
        }

        UserDefaults.standard.set(true, forKey: Keys.trackingEnabled)
        if always {
            manager.allowsBackgroundLocationUpdates = true
            startSignificantLocationChangesIfPossible()
            manager.startMonitoringVisits()
            refreshMonitoredRegions(reason: "startTracking")
        } else {
            if manager.allowsBackgroundLocationUpdates {
                manager.allowsBackgroundLocationUpdates = false
            }
            manager.stopMonitoringSignificantLocationChanges()
            manager.stopMonitoringVisits()
            clearMonitoredRegions(reason: "while-using")
        }
        applyAccuracyMode(high: stickyVenue != nil)
        if !isRunning {
            manager.startUpdatingLocation()
            startWatchdog()
            startStickyHeartbeatTimer()
        }
        manager.requestLocation()
        isRunning = true

        let venueCount = onEngineQueue { venues.count }
        logPresence(
            "tracking ON mode=\(always ? "always" : "while-using") counted=\(always) accuracyAuth=\(accuracyNote) venues=\(venueCount) regions=\(manager.monitoredRegions.count) sticky=\(stickyVenue ?? "nil") pending=\(pendingWriteCount())"
        )
        flushPendingWrites(reason: "start")
    }

    /// While Using keeps local bar detection and drops this phone from the live count.
    private func setCountsInAttendance(_ counts: Bool) {
        if !counts {
            if !skipSupabase, lastWrittenVenue != nil || stickyVenue != nil {
                enqueueOrSendDeactivate(source: "while-using")
            }
            skipSupabase = true
            UserDefaults.standard.set(true, forKey: Keys.skipSupabase)
            onEngineQueue { self.supabase = nil }
            return
        }

        guard skipSupabase || supabase == nil else { return }
        skipSupabase = false
        UserDefaults.standard.set(false, forKey: Keys.skipSupabase)
        let defaults = UserDefaults.standard
        guard
            let supabaseUrl = defaults.string(forKey: Keys.supabaseUrl),
            let anonKey = defaults.string(forKey: Keys.supabaseAnonKey),
            let api = try? SupabaseLiveLocationAPI(supabaseUrl: supabaseUrl, anonKey: anonKey)
        else { return }
        onEngineQueue { self.supabase = api }
    }

    func stopTracking(deactivate: Bool = true) {
        stopWatchdog()
        stopStickyHeartbeatTimer()
        UserDefaults.standard.set(false, forKey: Keys.trackingEnabled)
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        manager.stopMonitoringVisits()
        clearMonitoredRegions(reason: "stopTracking")
        isRunning = false

        if deactivate, stickyVenue != nil || lastWrittenVenue != nil {
            clearSticky(reason: "stopTracking")
            enqueueOrSendDeactivate(source: "stopTracking")
        }

        onEngineQueue {
            lastWrittenVenue = nil
            lastWriteAtMs = 0
            dwellVenue = nil
            dwellFixCount = 0
            exitCandidateVenue = nil
            exitCandidateSinceMs = 0
        }
    }

    func restoreIfNeeded() {
        guard UserDefaults.standard.bool(forKey: Keys.trackingEnabled) else { return }
        guard loadConfigurationFromDefaults() else { return }
        guard manager.authorizationStatus == .authorizedAlways else { return }
        try? startTracking()
        logPresence("restored tracking sticky=\(stickyVenue ?? "nil")")
    }

    func currentState() -> (isRunning: Bool, lastVenue: String?, lastWriteAtMs: Int64) {
        onEngineQueue {
            (
                isRunning,
                stickyVenue ?? lastWrittenVenue,
                Int64(lastWriteAtMs)
            )
        }
    }

    // MARK: - Geofences / significant / visits

    private func startSignificantLocationChangesIfPossible() {
        guard CLLocationManager.significantLocationChangeMonitoringAvailable() else { return }
        manager.startMonitoringSignificantLocationChanges()
    }

    private func refreshMonitoredRegions(reason: String) {
        guard manager.authorizationStatus == .authorizedAlways else { return }
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
            logPresence("geofence unavailable (\(reason))", level: "warn")
            return
        }
        guard manager.authorizationStatus == .authorizedAlways else { return }

        let venuesSnapshot = onEngineQueue { venues }
        let wakeRadius = onEngineQueue { approachRadiusM }
        let origin = onEngineQueue { lastKnownLocation }

        guard !venuesSnapshot.isEmpty else {
            clearMonitoredRegions(reason: "\(reason)-empty")
            return
        }

        let ranked: [VenueRecord]
        if let origin {
            ranked = venuesSnapshot
                .compactMap { v -> (VenueRecord, Double)? in
                    guard v.coordinates.count >= 2 else { return nil }
                    let d = Self.haversineMeters(
                        lat1: origin.coordinate.latitude,
                        lon1: origin.coordinate.longitude,
                        lat2: v.coordinates[0],
                        lon2: v.coordinates[1]
                    )
                    return (v, d)
                }
                .sorted { $0.1 < $1.1 }
                .prefix(Self.maxMonitoredRegions)
                .map(\.0)
        } else {
            var pick: [VenueRecord] = venuesSnapshot.filter {
                $0.name.localizedCaseInsensitiveContains("Test Location")
            }
            for v in venuesSnapshot where pick.count < Self.maxMonitoredRegions {
                if !pick.contains(where: { $0.name == v.name }) {
                    pick.append(v)
                }
            }
            ranked = Array(pick.prefix(Self.maxMonitoredRegions))
        }

        let desiredNames = Set(ranked.map(\.name))
        let existing = manager.monitoredRegions.compactMap { region -> (String, CLRegion)? in
            guard let name = venueName(fromRegionId: region.identifier) else { return nil }
            return (name, region)
        }

        for (name, region) in existing where !desiredNames.contains(name) {
            manager.stopMonitoring(for: region)
        }

        var started = 0
        let cappedRadius = min(wakeRadius, manager.maximumRegionMonitoringDistance)
        for venue in ranked {
            guard venue.coordinates.count >= 2 else { continue }
            let id = regionId(for: venue.name)
            let center = CLLocationCoordinate2D(
                latitude: venue.coordinates[0],
                longitude: venue.coordinates[1]
            )
            let region = CLCircularRegion(center: center, radius: cappedRadius, identifier: id)
            region.notifyOnEntry = true
            region.notifyOnExit = true
            manager.startMonitoring(for: region)
            started += 1
        }

        onEngineQueue { monitoredVenueNames = desiredNames }
        // Log only when the set changes meaningfully or on start/config.
        if reason == "config" || reason == "startTracking" || reason.hasPrefix("auth") {
            let sample = ranked.prefix(4).map(\.name).joined(separator: ", ")
            logPresence(
                "geofence refresh[\(reason)] n=\(started) wake=\(Int(cappedRadius))m sample=[\(sample)]"
            )
        }
    }

    private func clearMonitoredRegions(reason: String) {
        let count = manager.monitoredRegions.count
        for region in manager.monitoredRegions {
            manager.stopMonitoring(for: region)
        }
        onEngineQueue { monitoredVenueNames = [] }
        if count > 0 {
            logPresence("geofence cleared[\(reason)] n=\(count)")
        }
    }

    private func regionId(for venueName: String) -> String {
        let safe = venueName
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
        return String((Self.regionIdPrefix + safe).prefix(200))
    }

    private func venueName(fromRegionId id: String) -> String? {
        guard id.hasPrefix(Self.regionIdPrefix) else { return nil }
        let venuesSnapshot = onEngineQueue { venues }
        return venuesSnapshot.first(where: { regionId(for: $0.name) == id })?.name
    }

    // MARK: - Adaptive accuracy

    private func applyAccuracyMode(high: Bool) {
        if high == highAccuracyMode { return }
        highAccuracyMode = high
        if high {
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            manager.distanceFilter = 10
        } else {
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.distanceFilter = 40
        }
        logPresence("accuracy mode=\(high ? "near/high" : "far/coarse")")
    }

    private func updateAccuracyForDistance(_ distance: Double?) {
        let near =
            stickyVenue != nil
            || (distance.map { $0 < approachRadiusM } ?? false)
        applyAccuracyMode(high: near)
    }

    // MARK: - Watchdog + sticky heartbeat

    private func startWatchdog() {
        stopWatchdog()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 30, repeating: 45)
        timer.setEventHandler { [weak self] in
            guard let self, self.isRunning else { return }
            let now = Date().timeIntervalSince1970 * 1000
            let lastGps = self.lastGpsCallbackAtMs
            if lastGps == 0 || now - lastGps >= 60_000 {
                DispatchQueue.main.async { self.manager.requestLocation() }
            }
            self.evaluateStickyTimers(source: "watchdog")
        }
        timer.resume()
        watchdogTimer = timer
    }

    private func stopWatchdog() {
        watchdogTimer?.cancel()
        watchdogTimer = nil
    }

    private func startStickyHeartbeatTimer() {
        stopStickyHeartbeatTimer()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        // Check often; actual upsert gated by heartbeatMs.
        timer.schedule(deadline: .now() + 60, repeating: 60)
        timer.setEventHandler { [weak self] in
            self?.evaluateStickyTimers(source: "timer")
        }
        timer.resume()
        stickyHeartbeatTimer = timer
    }

    private func stopStickyHeartbeatTimer() {
        stickyHeartbeatTimer?.cancel()
        stickyHeartbeatTimer = nil
    }

    /// Exit countdown + optional indoor heartbeat. Timer handlers already run on `queue`.
    private func evaluateStickyTimers(source: String) {
        if shouldCompleteExit() {
            completeExit(source: "exit-\(source)")
            return
        }
        // Advance wait-prompt eligibility without needing a fresh GPS sample.
        if proximityZoneEnteredAtMs > 0, !waitPromptEligible, !proximityCandidates.isEmpty {
            let now = Date().timeIntervalSince1970 * 1000
            let elapsed = (now - proximityZoneEnteredAtMs) / 1000
            if elapsed >= AppConfig.waitPromptProximitySeconds {
                waitPromptEligible = true
                publishProximity()
            }
        }
        maybeStickyHeartbeat(source: source)
    }

    private func maybeStickyHeartbeat(source: String) {
        guard let venue = stickyVenue else { return }

        let exiting = onEngineQueue { exitCandidateVenue != nil && exitCandidateSinceMs > 0 }
        if exiting {
            logPresence("sticky heartbeat[\(source)] skipped — exit pending")
            return
        }

        let due = Date().timeIntervalSince1970 * 1000 - lastWriteAtMs >= Double(heartbeatMs)
        guard due else { return }

        if let loc = lastKnownLocation {
            let lat = loc.coordinate.latitude
            let lon = loc.coordinate.longitude
            guard let edge = distanceToFootprintEdge(named: venue, latitude: lat, longitude: lon) else {
                return
            }
            if edge > AppConfig.venueHardClearRadiusMeters {
                logPresence(
                    "hard clear[\(source)] \(venue) edge=\(Int(edge))m >\(Int(AppConfig.venueHardClearRadiusMeters))m"
                )
                completeExit(source: "hard-clear-\(source)")
                return
            }
            if !isInsideFootprint(named: venue, latitude: lat, longitude: lon) {
                logPresence(
                    "sticky heartbeat[\(source)] blocked — outside polygon edge=\(Int(edge))m"
                )
                beginExitCandidate(venue: venue, source: "sticky-\(source)")
                // Headcount only while inside polygon — deactivate write now.
                if lastWrittenVenue != nil {
                    enqueueOrSendDeactivate(source: "left-polygon-\(source)")
                    onEngineQueue {
                        lastWrittenVenue = nil
                        lastWriteAtMs = 0
                    }
                    leftPolygonPendingExit = true
                }
                if shouldCompleteExit() {
                    completeExit(source: "sticky-\(source)")
                }
                return
            }
            performUpsert(
                venueName: venue,
                latitude: lat,
                longitude: lon,
                source: "sticky-\(source)",
                venueChanged: false
            )
            return
        }

        logPresence("sticky heartbeat[\(source)] skipped — no lastKnownLocation")
    }

    // MARK: - CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        adoptAuthorization(manager.authorizationStatus)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as NSError).code
        if code == CLError.locationUnknown.rawValue { return }
        logPresence("GPS fail code=\(code) \(error.localizedDescription)", level: "error")
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }

        if !isRunning,
           UserDefaults.standard.bool(forKey: Keys.trackingEnabled),
           manager.authorizationStatus == .authorizedAlways {
            logPresence("wake â†’ resume tracking")
            try? startTracking()
        }

        onEngineQueue {
            lastKnownLocation = location
            lastGpsCallbackAtMs = Date().timeIntervalSince1970 * 1000
            gpsCallbackCount += 1
        }

        let n = onEngineQueue { gpsCallbackCount }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.eventDelegate?.engine(self, didUpdateCoordinate: location.coordinate)
        }

        if manager.authorizationStatus == .authorizedAlways && (n == 1 || n % 8 == 0) {
            refreshMonitoredRegions(reason: "gps")
        }

        let now = Date().timeIntervalSince1970 * 1000
        let shouldProcess: Bool = onEngineQueue {
            if now - lastProcessTime < Double(pollIntervalMs) { return false }
            lastProcessTime = now
            return true
        }
        guard shouldProcess else { return }

        processLocation(location, force: false, source: "gps")
        flushPendingWrites(reason: "gps")
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        let name = venueName(fromRegionId: region.identifier) ?? region.identifier
        logPresence("approach ENTER \(name)")
        applyAccuracyMode(high: true)
        if !isRunning, manager.authorizationStatus == .authorizedAlways {
            try? startTracking()
        }
        onEngineQueue { lastProcessTime = 0 }
        if let last = onEngineQueue({ lastKnownLocation }) {
            processLocation(last, force: true, source: "approach-enter:\(name)")
        }
        manager.requestLocation()
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        let name = venueName(fromRegionId: region.identifier) ?? region.identifier
        logPresence("approach EXIT \(name)")
        // Left the 400m approach fence of the sticky venue — past hard-clear; drop immediately.
        if stickyVenue == name {
            logPresence("hard clear[approach-exit] \(name) left \(Int(approachRadiusM))m wake fence")
            completeExit(source: "approach-exit")
            return
        }
        manager.requestLocation()
    }

    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        logPresence(
            "geofence fail id=\(region?.identifier ?? "?") \(error.localizedDescription)",
            level: "error"
        )
    }

    func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        logPresence(
            String(
                format: "visit wake +/-%.0fm @ %.5f,%.5f",
                visit.horizontalAccuracy,
                visit.coordinate.latitude,
                visit.coordinate.longitude
            )
        )
        applyAccuracyMode(high: true)
        if !isRunning,
           UserDefaults.standard.bool(forKey: Keys.trackingEnabled),
           manager.authorizationStatus == .authorizedAlways {
            try? startTracking()
        }
        manager.requestLocation()
        let synthetic = CLLocation(
            coordinate: visit.coordinate,
            altitude: 0,
            horizontalAccuracy: visit.horizontalAccuracy,
            verticalAccuracy: -1,
            timestamp: visit.departureDate == .distantFuture ? visit.arrivalDate : visit.departureDate
        )
        processLocation(synthetic, force: true, source: "visit")
    }

    // MARK: - Presence decision

    private func processLocation(_ location: CLLocation, force: Bool, source: String) {
        let lat = location.coordinate.latitude
        let lon = location.coordinate.longitude
        let accuracy = location.horizontalAccuracy
        let venueCount = onEngineQueue { venues.count }

        if venueCount == 0 {
            logPresence("scan[\(source)] no venues configured", level: "warn")
            return
        }

        let scored = scoreVenues(latitude: lat, longitude: lon)
        guard let nearest = scored.first else {
            logPresence("scan[\(source)] no coords on venues", level: "warn")
            return
        }

        updateAccuracyForDistance(nearest.centerDistance)

        let accuracyUsableForExit =
            accuracy > 0 && accuracy <= AppConfig.presenceMaxAccuracyForExitMeters

        let inZone = scored.filter { $0.edgeDistance <= AppConfig.venueExitRadiusMeters }
        let insidePolygon = inZone.filter(\.inside)
        updateProximityState(inZone: inZone, nowMs: Date().timeIntervalSince1970 * 1000)

        // Prefer presence at closest-center venue among those that contain the user.
        if let present = insidePolygon.first {
            clearExitCandidate()
            leftPolygonPendingExit = false
            let dwellState = onEngineQueue { () -> (ready: Bool, count: Int) in
                if dwellVenue != present.name {
                    dwellVenue = present.name
                    dwellFixCount = 1
                } else {
                    dwellFixCount += 1
                }
                return (dwellFixCount >= AppConfig.presenceDwellFixCount, dwellFixCount)
            }
            if !dwellState.ready {
                logPresence(
                    "dwell \(dwellState.count)/\(AppConfig.presenceDwellFixCount) \(present.name) edge=\(Int(present.edgeDistance))m +/-\(Int(accuracy))m [\(source)]"
                )
                return
            }

            setSticky(present.name)
            let writeDecision = shouldUpsert(venue: present.name, force: force)
            if writeDecision.write {
                performUpsert(
                    venueName: present.name,
                    latitude: lat,
                    longitude: lon,
                    source: source,
                    venueChanged: writeDecision.changed
                )
            } else {
                logPresence("presence ok \(present.name) - heartbeat not due yet")
            }
            return
        }

        resetDwell()

        // Outside all polygons — sticky / buffer handling.
        if let sticky = stickyVenue {
            let stickyScore = scored.first(where: { $0.name == sticky })
            let stickyEdge = stickyScore?.edgeDistance ?? .greatestFiniteMagnitude
            let stickyInBuffer = stickyEdge <= AppConfig.venueExitRadiusMeters

            if stickyInBuffer {
                if !accuracyUsableForExit {
                    logPresence(
                        "sticky HOLD \(sticky) - GPS +/-\(Int(accuracy))m too coarse to exit (need <=\(Int(AppConfig.presenceMaxAccuracyForExitMeters))m) edge=\(Int(stickyEdge))m"
                    )
                    return
                }
                // Left polygon but still in 15 m buffer — drop headcount, start 20 s exit timer.
                if lastWrittenVenue != nil || !leftPolygonPendingExit {
                    if lastWrittenVenue != nil {
                        enqueueOrSendDeactivate(source: "left-polygon-\(source)")
                        onEngineQueue {
                            lastWrittenVenue = nil
                            lastWriteAtMs = 0
                        }
                    }
                    leftPolygonPendingExit = true
                    beginExitCandidate(venue: sticky, source: source)
                } else {
                    beginExitCandidate(venue: sticky, source: source)
                }
                if shouldCompleteExit() {
                    completeExit(source: source)
                }
                return
            }

            // Beyond 15 m buffer → hard clear.
            if !accuracyUsableForExit {
                logPresence(
                    "sticky HOLD \(sticky) - GPS +/-\(Int(accuracy))m too coarse for hard clear edge=\(Int(stickyEdge))m"
                )
                return
            }
            logPresence(
                "hard clear[\(source)] \(sticky) edge=\(Int(stickyEdge))m >\(Int(AppConfig.venueHardClearRadiusMeters))m"
            )
            completeExit(source: "hard-clear-\(source)")
            return
        }

        // No sticky: approaching buffer only (wait-prompt proximity already updated).
        if let near = inZone.first {
            logPresence(
                "buffer zone \(near.name) edge=\(Int(near.edgeDistance))m (not inside polygon) [\(source)]"
            )
        } else if nearest.centerDistance < approachRadiusM {
            logPresence(
                "approach zone \(nearest.name) center=\(Int(nearest.centerDistance))m edge=\(Int(nearest.edgeDistance))m [\(source)]"
            )
        }
    }

    private struct VenueScore {
        let name: String
        let centerDistance: Double
        let edgeDistance: Double
        let inside: Bool
    }

    private func scoreVenues(latitude: Double, longitude: Double) -> [VenueScore] {
        let venuesSnapshot = onEngineQueue { venues }
        var scored: [VenueScore] = []
        for venue in venuesSnapshot {
            guard venue.coordinates.count >= 2 else { continue }
            let corners = venue.resolvedCorners
            let inside = VenueFootprintGeometry.contains(
                latitude: latitude,
                longitude: longitude,
                corners: corners
            )
            let edge = VenueFootprintGeometry.distanceMetersToEdge(
                latitude: latitude,
                longitude: longitude,
                corners: corners
            )
            let center = VenueFootprintGeometry.haversineMeters(
                lat1: latitude,
                lon1: longitude,
                lat2: venue.centerLatitude,
                lon2: venue.centerLongitude
            )
            scored.append(
                VenueScore(
                    name: venue.name,
                    centerDistance: center,
                    edgeDistance: edge,
                    inside: inside
                )
            )
        }
        // Inside first, then closest center (tie-break for multi-venue).
        return scored.sorted { a, b in
            if a.inside != b.inside { return a.inside && !b.inside }
            return a.centerDistance < b.centerDistance
        }
    }

    private func updateProximityState(inZone: [VenueScore], nowMs: Double) {
        let names = inZone.map(\.name)
        let primary = names.first
        let previousNames = proximityCandidates
        let previousPrimary = proximityPrimary
        let wasEligible = waitPromptEligible

        if names.isEmpty {
            proximityCandidates = []
            proximityPrimary = nil
            proximityZoneEnteredAtMs = 0
            waitPromptEligible = false
            if !previousNames.isEmpty || wasEligible {
                publishProximity()
            }
            return
        }

        if proximityZoneEnteredAtMs == 0 {
            proximityZoneEnteredAtMs = nowMs
        }
        proximityCandidates = names
        proximityPrimary = primary

        let elapsedSec = (nowMs - proximityZoneEnteredAtMs) / 1000
        let eligible = elapsedSec >= AppConfig.waitPromptProximitySeconds
        let changed =
            names != previousNames
            || primary != previousPrimary
            || eligible != wasEligible
        waitPromptEligible = eligible
        if changed {
            publishProximity()
        }
    }

    private func publishProximity() {
        let candidates = proximityCandidates
        let primary = proximityPrimary
        let eligible = waitPromptEligible
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.eventDelegate?.engine(
                self,
                didUpdateProximity: candidates,
                primary: primary,
                waitPromptEligible: eligible
            )
        }
    }

    private func isInsideFootprint(named name: String, latitude: Double, longitude: Double) -> Bool {
        guard let venue = onEngineQueue({ venues.first(where: { $0.name == name }) }) else {
            return false
        }
        return VenueFootprintGeometry.contains(
            latitude: latitude,
            longitude: longitude,
            corners: venue.resolvedCorners
        )
    }

    private func distanceToFootprintEdge(
        named name: String,
        latitude: Double,
        longitude: Double
    ) -> Double? {
        guard let venue = onEngineQueue({ venues.first(where: { $0.name == name }) }) else {
            return nil
        }
        return VenueFootprintGeometry.distanceMetersToEdge(
            latitude: latitude,
            longitude: longitude,
            corners: venue.resolvedCorners
        )
    }

    private func distanceToVenue(named name: String, latitude: Double, longitude: Double) -> Double? {
        // Center distance — used by geofence ranking helpers.
        let venuesSnapshot = onEngineQueue { venues }
        guard let venue = venuesSnapshot.first(where: { $0.name == name }),
              venue.coordinates.count >= 2
        else { return nil }
        return Self.haversineMeters(
            lat1: latitude,
            lon1: longitude,
            lat2: venue.coordinates[0],
            lon2: venue.coordinates[1]
        )
    }

    @discardableResult
    private func noteDwell(venue: String, resetOther: Bool) -> Bool {
        onEngineQueue {
            if dwellVenue != venue {
                dwellVenue = venue
                dwellFixCount = 1
            } else {
                dwellFixCount += 1
            }
            if resetOther { /* already switched above */ }
            return dwellFixCount >= AppConfig.presenceDwellFixCount
        }
    }

    private func resetDwell() {
        onEngineQueue {
            dwellVenue = nil
            dwellFixCount = 0
        }
    }

    private func shouldUpsert(venue: String, force: Bool) -> (write: Bool, changed: Bool) {
        onEngineQueue {
            let changed = venue != lastWrittenVenue
            let msSince = Date().timeIntervalSince1970 * 1000 - lastWriteAtMs
            let heartbeatDue = msSince >= Double(heartbeatMs) || lastWriteAtMs == 0
            if changed { return (true, true) }
            if force, msSince < 30_000, lastWriteAtMs > 0 { return (false, false) }
            if heartbeatDue { return (true, false) }
            return (false, false)
        }
    }

    private func beginExitCandidate(venue: String, source: String) {
        let now = Date().timeIntervalSince1970 * 1000
        let started: Bool = onEngineQueue {
            if exitCandidateVenue == venue, exitCandidateSinceMs > 0 {
                return false
            }
            exitCandidateVenue = venue
            exitCandidateSinceMs = now
            return true
        }
        if started {
            logPresence(
                "exit candidate \(venue) - need \(Int(AppConfig.presenceExitConfirmSeconds))s outside polygon (buffer ≤\(Int(AppConfig.venueExitRadiusMeters))m) [\(source)]"
            )
        } else {
            let elapsed = onEngineQueue { (now - exitCandidateSinceMs) / 1000 }
            logPresence("exit pending \(venue) \(Int(elapsed))s/\(Int(AppConfig.presenceExitConfirmSeconds))s [\(source)]")
        }
    }

    private func clearExitCandidate() {
        onEngineQueue {
            exitCandidateVenue = nil
            exitCandidateSinceMs = 0
        }
    }

    private func shouldCompleteExit() -> Bool {
        onEngineQueue {
            guard exitCandidateVenue != nil, exitCandidateSinceMs > 0 else { return false }
            let elapsed = Date().timeIntervalSince1970 * 1000 - exitCandidateSinceMs
            return elapsed >= AppConfig.presenceExitConfirmSeconds * 1000
        }
    }

    private func completeExit(source: String) {
        let venue = stickyVenue ?? exitCandidateVenue ?? "?"
        logPresence("exit confirmed \(venue) [\(source)] - deactivating")
        clearSticky(reason: source)
        resetDwell()
        clearExitCandidate()
        leftPolygonPendingExit = false
        enqueueOrSendDeactivate(source: source)
        applyAccuracyMode(high: false)
        // Proximity may still include buffer-only venues; re-publish after sticky clear.
        if proximityCandidates.isEmpty {
            waitPromptEligible = false
            proximityZoneEnteredAtMs = 0
            publishProximity()
        }
    }

    private func setSticky(_ venue: String) {
        stickyVenue = venue
        UserDefaults.standard.set(venue, forKey: Keys.stickyVenue)
        applyAccuracyMode(high: true)
    }

    private func clearSticky(reason: String) {
        if stickyVenue != nil {
            logPresence("sticky cleared (\(reason)) was=\(stickyVenue ?? "nil")")
        }
        stickyVenue = nil
        UserDefaults.standard.removeObject(forKey: Keys.stickyVenue)
        onEngineQueue {
            lastWrittenVenue = nil
            lastWriteAtMs = 0
        }
    }

    // MARK: - Writes + offline queue

    private struct PendingWrite: Codable, Equatable {
        enum Kind: String, Codable { case upsert, deactivate }
        var kind: Kind
        var venueName: String?
        var latitude: Double?
        var longitude: Double?
        var enqueuedAtMs: Double
    }

    private func pendingWriteCount() -> Int {
        loadPendingWrites().count
    }

    private func loadPendingWrites() -> [PendingWrite] {
        guard let data = UserDefaults.standard.data(forKey: Keys.pendingWrites),
              let items = try? JSONDecoder().decode([PendingWrite].self, from: data)
        else { return [] }
        return items
    }

    private func savePendingWrites(_ items: [PendingWrite]) {
        if let data = try? JSONEncoder().encode(items) {
            UserDefaults.standard.set(data, forKey: Keys.pendingWrites)
        }
    }

    private func enqueue(_ item: PendingWrite) {
        var items = loadPendingWrites()
        // Collapse: latest upsert replaces prior upserts; deactivate clears upserts.
        switch item.kind {
        case .deactivate:
            items.removeAll { $0.kind == .upsert }
            items.removeAll { $0.kind == .deactivate }
            items.append(item)
        case .upsert:
            items.removeAll { $0.kind == .upsert }
            items.removeAll { $0.kind == .deactivate }
            items.append(item)
        }
        savePendingWrites(items)
        logPresence("queue +\(item.kind.rawValue) pending=\(items.count) venue=\(item.venueName ?? "nil")")
    }

    private func flushPendingWrites(reason: String) {
        guard !skipSupabase, supabase != nil else { return }
        let items = loadPendingWrites()
        guard !items.isEmpty else { return }
        guard !isFlushingQueue else { return }
        isFlushingQueue = true
        logPresence("queue flush[\(reason)] n=\(items.count)")
        flushNext(items)
    }

    private func flushNext(_ items: [PendingWrite]) {
        guard let first = items.first else {
            isFlushingQueue = false
            return
        }
        let rest = Array(items.dropFirst())
        switch first.kind {
        case .upsert:
            guard let venue = first.venueName else {
                savePendingWrites(rest)
                flushNext(rest)
                return
            }
            sendUpsert(
                venueName: venue,
                latitude: first.latitude ?? 0,
                longitude: first.longitude ?? 0,
                source: "queue",
                venueChanged: true
            ) { [weak self] ok in
                guard let self else { return }
                if ok {
                    self.savePendingWrites(rest)
                    self.flushNext(rest)
                } else {
                    self.isFlushingQueue = false
                }
            }
        case .deactivate:
            sendDeactivate(source: "queue") { [weak self] ok in
                guard let self else { return }
                if ok {
                    self.savePendingWrites(rest)
                    self.flushNext(rest)
                } else {
                    self.isFlushingQueue = false
                }
            }
        }
    }

    private func performUpsert(
        venueName: String,
        latitude: Double,
        longitude: Double,
        source: String,
        venueChanged: Bool
    ) {
        guard !skipSupabase else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.eventDelegate?.engine(
                self,
                willWrite: "upsert",
                venueName: venueName,
                venueChanged: venueChanged,
                heartbeatDue: !venueChanged
            )
        }

        logPresence(
            "upsert[\(source)] \(venueName) changed=\(venueChanged) @ \(String(format: "%.5f", latitude)),\(String(format: "%.5f", longitude))"
        )

        sendUpsert(
            venueName: venueName,
            latitude: latitude,
            longitude: longitude,
            source: source,
            venueChanged: venueChanged
        ) { [weak self] ok in
            guard let self else { return }
            if !ok {
                self.enqueue(
                    PendingWrite(
                        kind: .upsert,
                        venueName: venueName,
                        latitude: latitude,
                        longitude: longitude,
                        enqueuedAtMs: Date().timeIntervalSince1970 * 1000
                    )
                )
            }
        }
    }

    private func enqueueOrSendDeactivate(source: String) {
        guard !skipSupabase else { return }
        sendDeactivate(source: source) { [weak self] ok in
            guard let self else { return }
            if !ok {
                self.enqueue(
                    PendingWrite(
                        kind: .deactivate,
                        venueName: nil,
                        latitude: nil,
                        longitude: nil,
                        enqueuedAtMs: Date().timeIntervalSince1970 * 1000
                    )
                )
            }
        }
    }

    private func sendUpsert(
        venueName: String,
        latitude: Double,
        longitude: Double,
        source: String,
        venueChanged: Bool,
        completion: ((Bool) -> Void)? = nil
    ) {
        guard let api = supabase else {
            completion?(false)
            return
        }
        api.upsertLiveLocation(
            userId: userId,
            venueName: venueName,
            latitude: latitude,
            longitude: longitude
        ) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                self.onEngineQueue {
                    self.lastWrittenVenue = venueName
                    self.lastWriteAtMs = Date().timeIntervalSince1970 * 1000
                }
                self.setSticky(venueName)
                self.logPresence("upsert ok[\(source)] \(venueName) sticky=ON")
                DispatchQueue.main.async {
                    self.eventDelegate?.engine(self, didWrite: "upsert", venueName: venueName)
                }
                completion?(true)
            case .failure(let err):
                self.notifyWriteError(err)
                completion?(false)
            }
        }
    }

    private func sendDeactivate(source: String, completion: ((Bool) -> Void)? = nil) {
        guard let api = supabase else {
            completion?(false)
            return
        }
        logPresence("deactivate[\(source)]")
        api.deactivateLiveLocation(userId: userId) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                self.logPresence("deactivate ok[\(source)]")
                DispatchQueue.main.async {
                    self.eventDelegate?.engine(self, didWrite: "deactivate", venueName: nil)
                }
                completion?(true)
            case .failure(let err):
                self.notifyWriteError(err)
                completion?(false)
            }
        }
    }

    private func nearestVenues(
        latitude: Double,
        longitude: Double,
        limit: Int
    ) -> [(name: String, distance: Double)] {
        let venuesSnapshot = onEngineQueue { venues }
        var scored: [(name: String, distance: Double)] = []
        for venue in venuesSnapshot {
            guard venue.coordinates.count >= 2 else { continue }
            let d = Self.haversineMeters(
                lat1: latitude,
                lon1: longitude,
                lat2: venue.coordinates[0],
                lon2: venue.coordinates[1]
            )
            scored.append((venue.name, d))
        }
        return scored.sorted { $0.distance < $1.distance }.prefix(limit).map { $0 }
    }

    private func logPresence(_ message: String, level: String = "info") {
        DispatchQueue.main.async {
            DiagnosticLog.shared.append(category: "location", message: message, level: level)
        }
    }

    private func notifyWriteError(_ error: Error) {
        let message: String
        if let apiErr = error as? SupabaseAPIError,
           case .httpStatus(let code, let body) = apiErr {
            message = "HTTP \(code): \(body)"
        } else {
            message = error.localizedDescription
        }
        logPresence("write failed: \(message)", level: "error")
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.eventDelegate?.engine(self, didFailWrite: message)
        }
    }

    private static func haversineMeters(
        lat1: Double,
        lon1: Double,
        lat2: Double,
        lon2: Double
    ) -> Double {
        let R = 6_371_000.0
        let phi1 = lat1 * .pi / 180
        let phi2 = lat2 * .pi / 180
        let dPhi = (lat2 - lat1) * .pi / 180
        let dLambda = (lon2 - lon1) * .pi / 180
        let a =
            sin(dPhi / 2) * sin(dPhi / 2)
            + cos(phi1) * cos(phi2) * sin(dLambda / 2) * sin(dLambda / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return R * c
    }
}

protocol VenueLiveLocationEngineDelegate: AnyObject {
    func engine(_ engine: VenueLiveLocationEngine, didUpdateCoordinate coordinate: CLLocationCoordinate2D)
    func engine(
        _ engine: VenueLiveLocationEngine,
        willWrite action: String,
        venueName: String,
        venueChanged: Bool,
        heartbeatDue: Bool
    )
    func engine(_ engine: VenueLiveLocationEngine, didWrite action: String, venueName: String?)
    func engine(_ engine: VenueLiveLocationEngine, didFailWrite message: String)
    func engineDidLoseAuthorization(_ engine: VenueLiveLocationEngine)
    func engine(
        _ engine: VenueLiveLocationEngine,
        didUpdateProximity candidates: [String],
        primary: String?,
        waitPromptEligible: Bool
    )
}

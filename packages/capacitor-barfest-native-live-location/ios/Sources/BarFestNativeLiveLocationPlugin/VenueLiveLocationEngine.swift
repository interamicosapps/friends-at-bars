import CoreLocation
import Foundation

/// Haversine nearest venue + heartbeat writes (runs on native threads, not WebView).
final class VenueLiveLocationEngine: NSObject, CLLocationManagerDelegate {
    static let shared = VenueLiveLocationEngine()

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
    }

    weak var eventDelegate: VenueLiveLocationEngineDelegate?

    private let manager = CLLocationManager()
    private let queue = DispatchQueue(label: "com.barfest.native-live-location", qos: .userInitiated)

    private var venues: [VenueRecord] = []
    private var supabase: SupabaseLiveLocationAPI?
    private var userId: String = ""
    private var heartbeatMs: Int = 300_000
    private var pollIntervalMs: Int = 10_000
    private var venueRadiusM: Double = 100
    private var skipSupabase = false

    private var isRunning = false
    private var lastProcessTime: TimeInterval = 0
    private var lastWrittenVenue: String?
    private var lastWriteAtMs: TimeInterval = 0
    private var hadActiveVenueRow = false

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 25
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .other
        if #available(iOS 11.0, *) {
            manager.showsBackgroundLocationIndicator = true
        }
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

        try queue.sync {
            self.userId = userId
            self.venues = venues
            self.heartbeatMs = heartbeatMs
            self.pollIntervalMs = pollIntervalMs
            self.venueRadiusM = venueRadiusM
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
                heartbeatMs: heartbeatMs > 0 ? heartbeatMs : 300_000,
                pollIntervalMs: pollIntervalMs > 0 ? pollIntervalMs : 10_000,
                venueRadiusM: venueRadiusM > 0 ? venueRadiusM : 100,
                skipSupabase: skipSupabase
            )
            return true
        } catch {
            return false
        }
    }

    func startTracking() throws {
        let status = manager.authorizationStatus
        guard status == .authorizedAlways else {
            throw NSError(
                domain: "BarFestNativeLiveLocation",
                code: 1,
                userInfo: [
                    NSLocalizedDescriptionKey:
                        "Always location permission is required for background live tracking."
                ]
            )
        }

        UserDefaults.standard.set(true, forKey: Keys.trackingEnabled)
        manager.allowsBackgroundLocationUpdates = true
        manager.startUpdatingLocation()
        isRunning = true
    }

    func stopTracking(deactivate: Bool = true) {
        UserDefaults.standard.set(false, forKey: Keys.trackingEnabled)
        manager.stopUpdatingLocation()
        isRunning = false

        if deactivate, hadActiveVenueRow, !skipSupabase, let api = supabase, !userId.isEmpty {
            api.deactivateLiveLocation(userId: userId) { _ in }
        }

        queue.sync {
            lastWrittenVenue = nil
            lastWriteAtMs = 0
            hadActiveVenueRow = false
        }
    }

    func restoreIfNeeded() {
        guard UserDefaults.standard.bool(forKey: Keys.trackingEnabled) else { return }
        guard loadConfigurationFromDefaults() else { return }
        guard manager.authorizationStatus == .authorizedAlways else { return }
        try? startTracking()
    }

    func currentState() -> (isRunning: Bool, lastVenue: String?, lastWriteAtMs: Int64) {
        queue.sync {
            (
                isRunning,
                lastWrittenVenue,
                Int64(lastWriteAtMs)
            )
        }
    }

    // MARK: - CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != .authorizedAlways, isRunning {
            stopTracking(deactivate: true)
            DispatchQueue.main.async { [weak self] in
                self?.eventDelegate?.engineDidLoseAuthorization(self!)
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.eventDelegate?.engine(self, didFailWrite: error.localizedDescription)
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.eventDelegate?.engine(
                self,
                didUpdateCoordinate: location.coordinate
            )
        }

        let now = Date().timeIntervalSince1970 * 1000
        let shouldProcess: Bool = queue.sync {
            if now - lastProcessTime < Double(pollIntervalMs) {
                return false
            }
            lastProcessTime = now
            return true
        }
        guard shouldProcess else { return }

        processLocation(location)
    }

    private func processLocation(_ location: CLLocation) {
        let lat = location.coordinate.latitude
        let lon = location.coordinate.longitude
        let venueName = nearestVenueName(latitude: lat, longitude: lon)

        if venueName == nil {
            let shouldDeactivate: Bool = queue.sync {
                guard hadActiveVenueRow else { return false }
                hadActiveVenueRow = false
                lastWrittenVenue = nil
                lastWriteAtMs = 0
                return true
            }
            if shouldDeactivate, !skipSupabase, let api = supabase {
                api.deactivateLiveLocation(userId: userId) { [weak self] result in
                    if case .failure(let err) = result {
                        self?.notifyWriteError(err)
                    }
                }
            }
            return
        }

        let writeDecision: (venueChanged: Bool, heartbeatDue: Bool, name: String) = queue.sync {
            let name = venueName!
            let venueChanged = name != lastWrittenVenue
            let heartbeatDue = Date().timeIntervalSince1970 * 1000 - lastWriteAtMs >= Double(heartbeatMs)
            return (venueChanged, heartbeatDue, name)
        }

        guard writeDecision.venueChanged || writeDecision.heartbeatDue else { return }
        guard !skipSupabase, let api = supabase else { return }

        api.upsertLiveLocation(
            userId: userId,
            venueName: writeDecision.name,
            latitude: lat,
            longitude: lon
        ) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success:
                self.queue.sync {
                    self.lastWrittenVenue = writeDecision.name
                    self.lastWriteAtMs = Date().timeIntervalSince1970 * 1000
                    self.hadActiveVenueRow = true
                }
            case .failure(let err):
                self.notifyWriteError(err)
            }
        }
    }

    private func nearestVenueName(latitude: Double, longitude: Double) -> String? {
        let venuesSnapshot = queue.sync { venues }
        var closest: (name: String, distance: Double)?

        for venue in venuesSnapshot {
            guard venue.coordinates.count >= 2 else { continue }
            let d = Self.haversineMeters(
                lat1: latitude,
                lon1: longitude,
                lat2: venue.coordinates[0],
                lon2: venue.coordinates[1]
            )
            if d < venueRadiusM {
                if closest == nil || d < closest!.distance {
                    closest = (venue.name, d)
                }
            }
        }
        return closest?.name
    }

    private func notifyWriteError(_ error: Error) {
        let message: String
        if let apiErr = error as? SupabaseAPIError,
           case .httpStatus(let code, let body) = apiErr {
            message = "HTTP \(code): \(body)"
        } else {
            message = error.localizedDescription
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
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
    func engine(_ engine: VenueLiveLocationEngine, didFailWrite message: String)
    func engineDidLoseAuthorization(_ engine: VenueLiveLocationEngine)
}

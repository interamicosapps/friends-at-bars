import Foundation
import Capacitor
import CoreLocation

@objc(BarFestNativeLiveLocationPlugin)
public class BarFestNativeLiveLocationPlugin: CAPPlugin, CAPBridgedPlugin, VenueLiveLocationEngineDelegate {
    public let identifier = "BarFestNativeLiveLocationPlugin"
    public let jsName = "BarFestNativeLiveLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise)
    ]

    public override func load() {
        VenueLiveLocationEngine.shared.eventDelegate = self
        VenueLiveLocationEngine.shared.restoreIfNeeded()
    }

    @objc func configure(_ call: CAPPluginCall) {
        guard let supabaseUrl = call.getString("supabaseUrl"),
              let supabaseAnonKey = call.getString("supabaseAnonKey"),
              let userId = call.getString("userId") else {
            call.reject("supabaseUrl, supabaseAnonKey, and userId are required")
            return
        }

        let heartbeatMs = call.getInt("heartbeatMs") ?? 300_000
        let pollIntervalMs = call.getInt("pollIntervalMs") ?? 10_000
        let venueRadiusMeters = call.getDouble("venueRadiusMeters") ?? 100
        let skipSupabase = call.getBool("skipSupabase") ?? false

        let venues: [VenueRecord]
        if let json = call.getString("venuesJson"),
           let data = json.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([VenueRecord].self, from: data) {
            venues = decoded
        } else if let venuesArray = call.getArray("venues", JSObject.self) {
            var parsed: [VenueRecord] = []
            for item in venuesArray {
                guard let name = item["name"] as? String else { continue }
                let area = item["area"] as? String ?? ""
                if let coords = item["coordinates"] as? [Double], coords.count >= 2 {
                    parsed.append(VenueRecord(name: name, area: area, coordinates: coords))
                } else if let coords = item["coordinates"] as? [NSNumber], coords.count >= 2 {
                    parsed.append(
                        VenueRecord(
                            name: name,
                            area: area,
                            coordinates: coords.map { $0.doubleValue }
                        )
                    )
                }
            }
            venues = parsed
        } else {
            call.reject("venues or venuesJson is required")
            return
        }

        do {
            try VenueLiveLocationEngine.shared.applyConfiguration(
                supabaseUrl: supabaseUrl,
                supabaseAnonKey: supabaseAnonKey,
                userId: userId,
                venues: venues,
                heartbeatMs: heartbeatMs,
                pollIntervalMs: pollIntervalMs,
                venueRadiusM: venueRadiusMeters,
                skipSupabase: skipSupabase
            )
            call.resolve()
        } catch {
            call.reject("Configure failed: \(error.localizedDescription)")
        }
    }

    @objc func startTracking(_ call: CAPPluginCall) {
        do {
            try VenueLiveLocationEngine.shared.startTracking()
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func stopTracking(_ call: CAPPluginCall) {
        VenueLiveLocationEngine.shared.stopTracking(deactivate: true)
        call.resolve()
    }

    @objc func getState(_ call: CAPPluginCall) {
        let state = VenueLiveLocationEngine.shared.currentState()
        call.resolve([
            "isRunning": state.isRunning,
            "lastVenue": state.lastVenue as Any,
            "lastWriteAtMs": state.lastWriteAtMs
        ])
    }

    // MARK: - VenueLiveLocationEngineDelegate

    func engine(_ engine: VenueLiveLocationEngine, didUpdateCoordinate coordinate: CLLocationCoordinate2D) {
        notifyListeners(
            "locationUpdate",
            data: [
                "latitude": coordinate.latitude,
                "longitude": coordinate.longitude
            ]
        )
    }

    func engine(_ engine: VenueLiveLocationEngine, didFailWrite message: String) {
        notifyListeners("writeError", data: ["message": message])
    }

    func engineDidLoseAuthorization(_ engine: VenueLiveLocationEngine) {
        notifyListeners("authorizationLost", data: [:])
    }
}

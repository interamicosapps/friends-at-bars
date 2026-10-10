import CoreLocation
import Combine
import UIKit

/// Observes location authorization and requests Always/When In Use like the web Allow Location CTAs.
@MainActor
final class LocationAuthorizationStore: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = LocationAuthorizationStore()

    @Published private(set) var status: CLAuthorizationStatus

    private let manager = CLLocationManager()

    /// Attendance writes and background presence. While Using is not enough.
    var isAuthorized: Bool {
        status == .authorizedAlways
    }

    /// Map, activities, chat, and on-screen bar detection.
    var canUseLocation: Bool {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            return true
        default:
            return false
        }
    }

    /// Chat works with When In Use or Always.
    var canUseChatLocation: Bool {
        canUseLocation
    }

    /// True when location is While Using. The app works; this phone is not in the attendance count.
    var needsAlwaysUpgrade: Bool {
        status == .authorizedWhenInUse
    }

    private override init() {
        status = manager.authorizationStatus
        super.init()
        manager.delegate = self
    }

    func refresh() {
        status = manager.authorizationStatus
    }

    /// Quiet start on app launch — request only if never asked; never open Settings here.
    func softStartTrackingIfPossible() {
        refresh()
        switch status {
        case .notDetermined:
            manager.requestAlwaysAuthorization()
            DiagnosticLog.shared.append(
                category: "location",
                message: "softStart: requesting Always (notDetermined)"
            )
        case .authorizedAlways:
            DiagnosticLog.shared.append(
                category: "location",
                message: "softStart: Always — starting presence engine"
            )
            VenueLiveLocationEngine.shared.adoptAuthorization(.authorizedAlways)
        case .authorizedWhenInUse:
            DiagnosticLog.shared.append(
                category: "location",
                message: "softStart: WhenInUse — foreground presence, not counted in attendance",
                level: "warn"
            )
            VenueLiveLocationEngine.shared.adoptAuthorization(.authorizedWhenInUse)
        default:
            DiagnosticLog.shared.append(
                category: "location",
                message: "softStart: cannot track status=\(status.rawValue)",
                level: "warn"
            )
        }
    }

    /// Opens this app's page in Settings. Use after iOS has already recorded a choice.
    func openLocationSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
        DiagnosticLog.shared.append(
            category: "location",
            message: "Opened Settings status=\(status.rawValue)"
        )
    }

    /// User-tapped Allow Location (Activities gate, Map overlay).
    /// The system prompt is only used before iOS has a choice. After that, Settings opens.
    func requestAllowLocation(thenStartTracking: Bool = true) {
        refresh()
        switch status {
        case .notDetermined:
            manager.requestAlwaysAuthorization()
            DiagnosticLog.shared.append(
                category: "location",
                message: "Allow Location tapped status=\(status.rawValue) — system prompt"
            )
        case .denied, .restricted, .authorizedWhenInUse:
            DiagnosticLog.shared.append(
                category: "location",
                message: "Allow Location tapped status=\(status.rawValue) — Settings"
            )
            openLocationSettings()
        case .authorizedAlways:
            DiagnosticLog.shared.append(
                category: "location",
                message: "Allow Location tapped status=\(status.rawValue)"
            )
            if thenStartTracking {
                VenueLiveLocationEngine.shared.adoptAuthorization(.authorizedAlways)
            }
        @unknown default:
            manager.requestAlwaysAuthorization()
        }
    }

    /// Chat gate: When In Use is sufficient; starts lightweight GPS reader.
    func requestChatLocation() {
        refresh()
        switch status {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            openLocationSettings()
        case .authorizedWhenInUse, .authorizedAlways:
            break
        @unknown default:
            manager.requestWhenInUseAuthorization()
        }
        DiagnosticLog.shared.append(
            category: "location",
            message: "Chat location request status=\(status.rawValue)"
        )
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            self.status = manager.authorizationStatus
            DiagnosticLog.shared.append(
                category: "location",
                message: "Authorization changed status=\(manager.authorizationStatus.rawValue)"
            )
            if manager.authorizationStatus == .authorizedAlways
                || manager.authorizationStatus == .authorizedWhenInUse {
                VenueLiveLocationEngine.shared.adoptAuthorization(manager.authorizationStatus)
            }
            if manager.authorizationStatus == .authorizedWhenInUse {
                DiagnosticLog.shared.append(
                    category: "location",
                    message: "authChanged WhenInUse — chat enabled; live headcounts need Always",
                    level: "warn"
                )
            }
        }
    }
}
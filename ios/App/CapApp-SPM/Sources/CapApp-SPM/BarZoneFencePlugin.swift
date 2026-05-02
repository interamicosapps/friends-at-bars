import Capacitor
import CoreLocation
import Foundation

@objc(BarZoneFencePlugin)
public class BarZoneFencePlugin: CAPPlugin, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let regionIdentifier = "BarFestBarZone"

    public override func load() {
        super.load()
        manager.delegate = self
    }

    private func authorizeIfNeeded() {
        let status = manager.authorizationStatus
        if status == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
    }

    @objc func startMonitoring(_ call: CAPPluginCall) {
        guard let latitude = call.getDouble("latitude"),
              let longitude = call.getDouble("longitude"),
              let radius = call.getDouble("radiusMeters") else {
            call.reject("Missing latitude, longitude, or radiusMeters")
            return
        }

        if latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 {
            call.reject("Invalid coordinates")
            return
        }

        if radius < 50 || radius > 50_000 {
            call.reject("radiusMeters must be between 50 and 50000")
            return
        }

        for region in manager.monitoredRegions {
            manager.stopMonitoring(for: region)
        }

        authorizeIfNeeded()
        let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        let circle = CLCircularRegion(
            center: center,
            radius: radius,
            identifier: regionIdentifier
        )
        circle.notifyOnEntry = true
        circle.notifyOnExit = true

        DispatchQueue.main.async {
            self.manager.startMonitoring(for: circle)
            call.resolve()
        }
    }

    @objc func stopMonitoring(_ call: CAPPluginCall) {
        for region in manager.monitoredRegions {
            if region.identifier == regionIdentifier {
                manager.stopMonitoring(for: region)
            }
        }
        call.resolve()
    }

    private func notify(_ name: String) {
        DispatchQueue.main.async {
            self.notifyListeners(name, data: [:])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier == regionIdentifier else { return }
        notify("barZoneEnter")
    }

    public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard region.identifier == regionIdentifier else { return }
        notify("barZoneExit")
    }

    public func locationManager(
        _: CLLocationManager,
        monitoringDidFailFor _: CLRegion?,
        withError error: Error
    ) {
        CAPLog.print("[BarZoneFence] monitoring failed:", error.localizedDescription)
    }
}

import Capacitor
import Foundation
import MapKit
import UIKit

@objc(BarFestNativeMapPlugin)
public class BarFestNativeMapPlugin: CAPPlugin, CAPBridgedPlugin, MKMapViewDelegate {
    public let identifier = "BarFestNativeMapPlugin"
    public let jsName = "BarFestNativeMap"
    public let pluginMethods: [CAPPluginMethod] = [
        .init(name: "initialize", returnType: CAPPluginReturnPromise),
        .init(name: "setRegion", returnType: CAPPluginReturnPromise),
        .init(name: "setVenues", returnType: CAPPluginReturnPromise),
        .init(name: "setUserCoordinate", returnType: CAPPluginReturnPromise),
        .init(name: "setFrame", returnType: CAPPluginReturnPromise),
        .init(name: "getDebugState", returnType: CAPPluginReturnPromise),
        .init(name: "destroy", returnType: CAPPluginReturnPromise)
    ]

    private var mapView: MKMapView?
    private var venueAnnotations: [MKPointAnnotation] = []
    private var userAnnotation: MKPointAnnotation?
    private var regionNotifyWorkItem: DispatchWorkItem?

    @objc func initialize(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let vc = self.bridge?.viewController else {
                call.reject("No view controller")
                return
            }
            let centerLat = call.getDouble("centerLat") ?? 39.9917
            let centerLon = call.getDouble("centerLon") ?? -83.0067
            let spanLat = call.getDouble("spanLat") ?? 0.06
            let spanLon = call.getDouble("spanLon") ?? 0.06

            if self.mapView == nil {
                // Start with zero size; TS will call `setFrame` to match the React map container.
                let mv = MKMapView(frame: .zero)
                mv.autoresizingMask = []
                mv.delegate = self
                mv.mapType = .standard
                mv.isRotateEnabled = true
                mv.isPitchEnabled = true
                mv.showsUserLocation = false
                vc.view.insertSubview(mv, at: 0)
                self.mapView = mv

                if let wv = self.bridge?.webView {
                    wv.isOpaque = false
                    wv.backgroundColor = .clear
                    wv.scrollView.backgroundColor = .clear
                }
            }

            let region = MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: centerLat, longitude: centerLon),
                span: MKCoordinateSpan(latitudeDelta: spanLat, longitudeDelta: spanLon)
            )
            self.mapView?.setRegion(region, animated: false)
            call.resolve()
        }
    }

    @objc func setRegion(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let mv = self.mapView else {
                call.reject("Map not initialized")
                return
            }
            let centerLat = call.getDouble("centerLat") ?? 39.9917
            let centerLon = call.getDouble("centerLon") ?? -83.0067
            let spanLat = call.getDouble("spanLat") ?? 0.04
            let spanLon = call.getDouble("spanLon") ?? 0.04
            let region = MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: centerLat, longitude: centerLon),
                span: MKCoordinateSpan(latitudeDelta: spanLat, longitudeDelta: spanLon)
            )
            mv.setRegion(region, animated: true)
            call.resolve()
        }
    }

    @objc func setVenues(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let mv = self.mapView else {
                call.reject("Map not initialized")
                return
            }
            for a in self.venueAnnotations {
                mv.removeAnnotation(a)
            }
            self.venueAnnotations.removeAll()

            guard let venues = call.getArray("venues") as? [Any] else {
                call.resolve()
                return
            }
            for item in venues {
                guard let v = item as? [String: Any],
                      let name = v["name"] as? String else { continue }
                let lat = Self.readDouble(v["lat"])
                let lon = Self.readDouble(v["lon"])
                guard let lat = lat, let lon = lon else { continue }
                let ann = MKPointAnnotation()
                ann.coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
                ann.title = name
                ann.subtitle = "venue"
                mv.addAnnotation(ann)
                self.venueAnnotations.append(ann)
            }
            call.resolve()
        }
    }

    @objc func setUserCoordinate(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let mv = self.mapView else {
                call.reject("Map not initialized")
                return
            }
            if let prev = self.userAnnotation {
                mv.removeAnnotation(prev)
                self.userAnnotation = nil
            }
            let lat = call.getDouble("lat")
            let lon = call.getDouble("lon")
            if let lat = lat, let lon = lon, !lat.isNaN, !lon.isNaN {
                let ann = MKPointAnnotation()
                ann.coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
                ann.title = "__user__"
                ann.subtitle = "user"
                mv.addAnnotation(ann)
                self.userAnnotation = ann
            }
            call.resolve()
        }
    }

    @objc func setFrame(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let mv = self.mapView else {
                call.reject("Map not initialized")
                return
            }

            let left = call.getDouble("left") ?? 0
            let top = call.getDouble("top") ?? 0
            let width = call.getDouble("width") ?? 0
            let height = call.getDouble("height") ?? 0

            // Avoid collapsing the map due to transient empty rects.
            guard width > 0, height > 0 else {
                call.resolve()
                return
            }

            // JS sends viewport-relative CSS/DOM rect (getBoundingClientRect). Map that into
            // vc.view coordinates: viewport origin in scroll content space is contentOffset.
            guard let wv = self.bridge?.webView, let vc = self.bridge?.viewController else {
                mv.frame = CGRect(x: left, y: top, width: width, height: height)
                call.resolve()
                return
            }
            let sv = wv.scrollView
            let offset = sv.contentOffset
            let contentRect = CGRect(
                x: offset.x + CGFloat(left),
                y: offset.y + CGFloat(top),
                width: CGFloat(width),
                height: CGFloat(height)
            )
            let mapped = sv.convert(contentRect, to: vc.view)
            mv.frame = mapped
            call.resolve()
        }
    }

    @objc func getDebugState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let vc = self.bridge?.viewController else {
                call.reject("No view controller")
                return
            }

            let mapFrame = self.mapView?.frame ?? .zero
            let webView = self.bridge?.webView
            let webFrame = webView?.frame ?? .zero
            let webOffset = webView?.scrollView.contentOffset ?? .zero
            let rootBounds = vc.view.bounds

            call.resolve([
                "mapFrameX": mapFrame.origin.x,
                "mapFrameY": mapFrame.origin.y,
                "mapFrameWidth": mapFrame.size.width,
                "mapFrameHeight": mapFrame.size.height,
                "webViewFrameX": webFrame.origin.x,
                "webViewFrameY": webFrame.origin.y,
                "webViewFrameWidth": webFrame.size.width,
                "webViewFrameHeight": webFrame.size.height,
                "webViewOffsetX": webOffset.x,
                "webViewOffsetY": webOffset.y,
                "rootViewWidth": rootBounds.size.width,
                "rootViewHeight": rootBounds.size.height
            ])
        }
    }

    @objc func destroy(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let mv = self.mapView {
                mv.delegate = nil
                mv.removeFromSuperview()
                self.mapView = nil
            }
            self.venueAnnotations.removeAll()
            self.userAnnotation = nil
            if let wv = self.bridge?.webView {
                wv.isOpaque = true
                wv.backgroundColor = .white
                wv.scrollView.backgroundColor = .white
            }
            call.resolve()
        }
    }

    // MARK: - MKMapViewDelegate

    public func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
        guard let ann = view.annotation as? MKPointAnnotation else { return }
        if ann.title == "__user__" { return }
        if let name = ann.title {
            notifyListeners("venueTap", data: ["venueName": name])
        }
        mapView.deselectAnnotation(ann, animated: true)
    }

    public func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        guard let point = annotation as? MKPointAnnotation else { return nil }
        let id = point.subtitle == "user" ? "userPin" : "venuePin"
        var v = mapView.dequeueReusableAnnotationView(withIdentifier: id) as? MKMarkerAnnotationView
        if v == nil {
            v = MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: id)
            v?.canShowCallout = false
        } else {
            v?.annotation = annotation
        }
        if id == "userPin" {
            v?.markerTintColor = UIColor(red: 0.06, green: 0.73, blue: 0.51, alpha: 1)
            v?.glyphImage = nil
        } else {
            v?.markerTintColor = UIColor(red: 0.23, green: 0.51, blue: 0.96, alpha: 1)
        }
        return v
    }

    public func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
        regionNotifyWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            let r = mapView.region
            self.notifyListeners("regionChanged", data: [
                "centerLat": r.center.latitude,
                "centerLon": r.center.longitude,
                "spanLat": r.span.latitudeDelta,
                "spanLon": r.span.longitudeDelta
            ])
        }
        regionNotifyWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: work)
    }

    private static func readDouble(_ value: Any?) -> Double? {
        if value == nil { return nil }
        if value is NSNull { return nil }
        if let d = value as? Double { return d }
        if let n = value as? NSNumber { return n.doubleValue }
        if let s = value as? String, let d = Double(s) { return d }
        return nil
    }
}

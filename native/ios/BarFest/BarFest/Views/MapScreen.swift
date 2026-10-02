import MapKit
import SwiftUI
import UIKit

struct MapScreen: View {
    @EnvironmentObject private var appModel: AppModel
    @ObservedObject private var testMode = TestModeStore.shared
    @ObservedObject private var locationAuth = LocationAuthorizationStore.shared
    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 39.981997, longitude: -83.004427),
            span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
        )
    )
    @State private var selectedCard: VenueLocationCard?
    @State private var mapPage: UUID?
    @State private var venueSearch = ""
    @FocusState private var searchFocused: Bool
    /// Camera span used to decide which pins overlap. Updated as the user zooms.
    @State private var visibleSpan = MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
    @State private var mapSize: CGSize = CGSize(width: 390, height: 700)
    @State private var didCaptureCamera = false

    private var searchQuery: String {
        venueSearch.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var searchResults: [CatalogVenue] {
        guard !searchQuery.isEmpty else { return [] }
        return appModel.scopedVenues
            .filter { $0.name.localizedCaseInsensitiveContains(searchQuery) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private var showSearchResults: Bool {
        searchFocused || !searchQuery.isEmpty
    }

    /// Live OS permission, or Test Mode mock + simulate-location toggle.
    private var mapUnlocked: Bool {
        if testMode.uiEnabled && testMode.useMockCheckIns {
            return testMode.simulateLocationAllowed
        }
        return locationAuth.isAuthorized
    }

    /// Highest live headcount among location pins. Shared bars use one count.
    private var maxAttendance: Int {
        mapPins.reduce(0) { partial, card in
            max(partial, card.attendance(in: appModel.venueCounts))
        }
    }

    private var mapPins: [VenueLocationCard] {
        VenueLocationGrouping.cards(from: appModel.scopedVenues)
    }

    /// Individual markers plus cluster bubbles for pins that would overlap at this zoom.
    private var markerLayout: MapMarkerLayout {
        MapClustering.layout(
            pins: mapPins,
            span: visibleSpan,
            mapSize: mapSize,
            keepingVisible: selectedCard?.id
        )
    }

    /// Opening frame. Caps a wide geography so the map starts at neighborhood scale
    /// (~5 miles), not the whole city. Pinch out still reaches the metro.
    private var mapRegion: MKCoordinateRegion {
        let center: CLLocationCoordinate2D
        let fitted: Double
        if let geo = appModel.resolvedGeography {
            center = CLLocationCoordinate2D(latitude: geo.latitude, longitude: geo.longitude)
            fitted = geo.radius_miles / 69.0 * 2.1
        } else {
            center = CLLocationCoordinate2D(latitude: 39.981997, longitude: -83.004427)
            fitted = 0.08
        }
        let delta = min(0.08, max(0.04, fitted))
        return MKCoordinateRegion(
            center: center,
            span: MKCoordinateSpan(latitudeDelta: delta, longitudeDelta: delta)
        )
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Map(position: $position) {
                    ForEach(markerLayout.clusters) { cluster in
                        let counts = cluster.members.map { $0.attendance(in: appModel.venueCounts) }
                        let busiest = counts.max() ?? 0
                        let people = counts.reduce(0, +)
                        Annotation(
                            "\(people) people, \(cluster.members.count) bars",
                            coordinate: cluster.coordinate,
                            anchor: .center
                        ) {
                            Button {
                                dismissSelection()
                                focusCluster(cluster.members)
                            } label: {
                                BusynessCluster(
                                    people: people,
                                    venueCount: cluster.members.count,
                                    color: Self.markerColor(count: busiest, maxCount: maxAttendance)
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(people) people across \(cluster.members.count) bars")
                            .accessibilityHint("Zooms in to show each bar")
                        }
                        .annotationTitles(.hidden)
                    }

                    ForEach(markerLayout.pins) { card in
                        let count = card.attendance(in: appModel.venueCounts)
                        Annotation(
                            card.title,
                            coordinate: coordinate(for: card),
                            anchor: .center
                        ) {
                            Button {
                                cyclePin(card)
                            } label: {
                                BusynessPin(
                                    count: count,
                                    color: Self.markerColor(count: count, maxCount: maxAttendance),
                                    isSelected: selectedCard?.id == card.id
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(pinAccessibilityLabel(card, count: count))
                        }
                        .annotationTitles(.hidden)
                    }

                    if mapUnlocked {
                        UserAnnotation()
                    }
                }
                .mapStyle(.standard(
                    elevation: .flat,
                    emphasis: .muted,
                    pointsOfInterest: .excludingAll,
                    showsTraffic: false
                ))
                .tint(.green)
                .mapControls {
                    MapCompass()
                }
                .onMapCameraChange(frequency: .continuous) { context in
                    captureSpan(context.region.span)
                }
                .background {
                    GeometryReader { proxy in
                        Color.clear
                            .onAppear { updateMapSize(proxy.size) }
                            .onChange(of: proxy.size) { _, newSize in
                                updateMapSize(newSize)
                            }
                    }
                }
                .disabled(!mapUnlocked || showSearchResults)

                if !mapUnlocked {
                    if testMode.uiEnabled && testMode.useMockCheckIns {
                        testModeLocationGate
                    } else {
                        LocationAllowOverlay()
                    }
                }

                if mapUnlocked {
                    ZStack(alignment: .top) {
                        if showSearchResults {
                            Color.black.opacity(0.45)
                                .ignoresSafeArea()
                                .onTapGesture { dismissSearch() }
                        }

                        VStack(spacing: 10) {
                            searchBar
                                .padding(.horizontal, 12)

                            HStack {
                                if testMode.uiEnabled && testMode.useMockCheckIns {
                                    simulateLocationButton
                                }
                                Spacer(minLength: 0)
                                locateMeButton
                            }
                            .padding(.horizontal, 12)

                            if showSearchResults {
                                searchResultsPanel
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.top, 8)
                    }
                    .zIndex(5)
                }
            }
            .overlay(alignment: .bottom) {
                if let card = selectedCard, !showSearchResults {
                    venuePopup(card)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 12)
                }
            }
            .overlay(alignment: .bottomLeading) {
                if mapUnlocked, selectedCard == nil, !showSearchResults {
                    busynessLegend
                        .padding(.leading, 12)
                        .padding(.bottom, 14)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .onChange(of: testMode.useMockCheckIns) { _, _ in
                dismissSelection()
                Task { await appModel.refreshCatalog() }
            }
            .onChange(of: testMode.simulateLocationAllowed) { _, allowed in
                if !allowed { dismissSelection() }
            }
            .onAppear {
                locationAuth.refresh()
                let region = mapRegion
                visibleSpan = region.span
                position = .region(region)
            }
            .onChange(of: appModel.resolvedGeography?.id) { _, _ in
                dismissSelection()
                let region = mapRegion
                visibleSpan = region.span
                didCaptureCamera = false
                position = .region(region)
            }
        }
    }

    // MARK: - Search / floating controls

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search bars", text: $venueSearch)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($searchFocused)
                .onSubmit { searchFocused = false }
            if !venueSearch.isEmpty {
                Button {
                    venueSearch = ""
                    searchFocused = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(uiColor: .secondarySystemGroupedBackground))
        )
    }

    private var locateMeButton: some View {
        Button {
            withAnimation {
                position = .userLocation(fallback: .automatic)
            }
        } label: {
            Image(systemName: "location.fill")
                .font(.body.weight(.semibold))
                .foregroundStyle(.primary)
                .frame(width: 40, height: 40)
                .background(
                    Circle()
                        .fill(Color(uiColor: .secondarySystemGroupedBackground))
                )
                .shadow(color: .black.opacity(0.25), radius: 3, y: 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Center on my location")
    }

    private var simulateLocationButton: some View {
        Button {
            testMode.simulateLocationAllowed.toggle()
            DiagnosticLog.shared.append(
                category: "system",
                message: "Map simulate location allowed=\(testMode.simulateLocationAllowed)"
            )
        } label: {
            Image(systemName: testMode.simulateLocationAllowed
                  ? "dot.scope"
                  : "location.slash")
                .font(.body.weight(.semibold))
                .foregroundStyle(testMode.simulateLocationAllowed ? Color.accentColor : .secondary)
                .frame(width: 40, height: 40)
                .background(
                    Circle()
                        .fill(Color(uiColor: .secondarySystemGroupedBackground))
                )
                .shadow(color: .black.opacity(0.25), radius: 3, y: 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            testMode.simulateLocationAllowed
                ? "Simulate location on"
                : "Simulate location off"
        )
    }

    private var searchResultsPanel: some View {
        HStack(alignment: .top, spacing: 0) {
            Color.clear
                .frame(width: 28)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .onTapGesture { dismissSearch() }

            Group {
                if searchQuery.isEmpty {
                    Text("Start typing a bar name")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 28)
                } else if searchResults.isEmpty {
                    Text("No bars match that search")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 28)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(searchResults) { venue in
                                Button {
                                    selectVenue(venue)
                                } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(venue.name)
                                                .font(.body.weight(.medium))
                                                .foregroundStyle(.primary)
                                            if !venue.area.isEmpty {
                                                Text(venue.area)
                                                    .font(.caption2)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.tertiary)
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 12)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                Divider().opacity(0.35)
                            }
                        }
                    }
                    .frame(maxHeight: 320)
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color(uiColor: .secondarySystemGroupedBackground))
            )

            Color.clear
                .frame(width: 28)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .onTapGesture { dismissSearch() }
        }
    }

    // MARK: - Selection / camera

    private func selectVenue(_ venue: CatalogVenue) {
        dismissSearch()
        guard let card = VenueLocationGrouping.card(
            containing: venue,
            in: appModel.scopedVenues
        ) else { return }
        selectCard(card, focus: venue)
    }

    private func selectCard(_ card: VenueLocationCard, focus: CatalogVenue) {
        selectedCard = card
        mapPage = focus.id
        snapCamera(to: focus)
    }

    /// First tap opens the location. Further taps on the same pin step through its bars.
    private func cyclePin(_ card: VenueLocationCard) {
        if selectedCard?.id == card.id,
           let current = mapPage,
           let idx = card.venues.firstIndex(where: { $0.id == current }),
           card.venues.count > 1 {
            let next = card.venues[(idx + 1) % card.venues.count]
            mapPage = next.id
            return
        }
        selectCard(card, focus: card.primary)
    }

    private func dismissSelection() {
        selectedCard = nil
        mapPage = nil
        dismissSearch()
    }

    private func dismissSearch() {
        venueSearch = ""
        searchFocused = false
        KeyboardObserver.dismiss()
    }

    /// Zooms so the bars in a cluster separate into individual markers.
    private func focusCluster(_ members: [VenueLocationCard]) {
        guard !members.isEmpty else { return }
        let lats = members.map(\.primary.latitude)
        let lons = members.map(\.primary.longitude)
        let minLat = lats.min() ?? 0
        let maxLat = lats.max() ?? 0
        let minLon = lons.min() ?? 0
        let maxLon = lons.max() ?? 0
        var latDelta = max((maxLat - minLat) * 2.8, 0.0012)
        var lonDelta = max((maxLon - minLon) * 2.8, 0.0012)
        if latDelta > visibleSpan.latitudeDelta * 0.92 {
            latDelta = max(visibleSpan.latitudeDelta * 0.45, 0.0012)
            lonDelta = max(visibleSpan.longitudeDelta * 0.45, 0.0012)
        }
        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLon + maxLon) / 2
        )
        withAnimation(.easeInOut(duration: 0.35)) {
            position = .region(MKCoordinateRegion(
                center: center,
                span: MKCoordinateSpan(latitudeDelta: latDelta, longitudeDelta: lonDelta)
            ))
        }
    }

    /// Centers the pin in the map viewport at a zoom similar to a tapped pin focus.
    private func snapCamera(to venue: CatalogVenue) {
        let region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: venue.latitude, longitude: venue.longitude),
            span: MKCoordinateSpan(latitudeDelta: 0.014, longitudeDelta: 0.014)
        )
        withAnimation(.easeInOut(duration: 0.35)) {
            position = .region(region)
        }
    }

    // MARK: - Gates / popup

    /// Soft gate for Test Mode when simulate-location is off (parity with Activities/Chat).
    private var testModeLocationGate: some View {
        ZStack {
            Color.black.opacity(0.72).ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "mappin.and.ellipse")
                    .font(.system(size: 40))
                Text("Simulate location access")
                    .font(.title3.bold())
                Text("Turn on the location toggle to preview the map with mock attendance — no Settings permission required in Test Mode.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Button {
                    testMode.simulateLocationAllowed = true
                } label: {
                    Text("Light Up the Map")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .padding(.horizontal, 24)

                Text(LocationPrivacyCopy.underButton)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .padding()
        }
    }

    @ViewBuilder
    private func venuePopup(_ card: VenueLocationCard) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            Button {
                selectedCard = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(6)
            }
            .buttonStyle(.plain)
            .padding(.trailing, 8)
            .padding(.top, 8)

            TabView(selection: $mapPage) {
                ForEach(card.venues) { venue in
                    mapVenuePage(venue, in: card)
                        .tag(Optional(venue.id))
                }
            }
            .tabViewStyle(.page(indexDisplayMode: card.venues.count > 1 ? .automatic : .never))
            .frame(height: 360)
        }
        .frame(maxWidth: 360)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(uiColor: .secondarySystemGroupedBackground))
        )
    }

    private func mapVenuePage(_ venue: CatalogVenue, in card: VenueLocationCard) -> some View {
        let count = card.attendance(in: appModel.venueCounts)
        let deals = todaysDeals(for: venue)
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(venue.name)
                    .font(.title3.bold())
                    .foregroundStyle(.primary)
                if !venue.area.isEmpty {
                    Text(venue.area.uppercased())
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .tracking(0.6)
                }
            }

            dealsSection(deals)

            WaitTimeLabel(summary: appModel.waitSummary(for: venue.name))

            Text(count == 0 ? "No Users at This Time" : "\(count) Users")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(count == 0 ? .secondary : .primary)
            if card.isShared {
                Text("Live at this location")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Button {
                openDirections(to: venue)
            } label: {
                Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color.accentColor)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 18)
    }

    @ViewBuilder
    private func dealsSection(_ deals: [CatalogListing]) -> some View {
        if deals.isEmpty {
            Text("No deals for today")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
        } else {
            let content = VStack(alignment: .leading, spacing: 10) {
                ForEach(deals) { deal in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(dealTitle(deal))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                        if !deal.details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text(deal.details)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if deals.count > 3 {
                ScrollView {
                    content
                }
                .frame(maxHeight: 118)
            } else {
                content
            }
        }
    }

    private func dealTitle(_ deal: CatalogListing) -> String {
        let title = deal.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty { return title }
        if !deal.time_label.isEmpty { return deal.time_label }
        return deal.type_labels.first ?? "Deal"
    }

    private func todaysDeals(for venue: CatalogVenue) -> [CatalogListing] {
        let day = DayFilter.today.rawValue
        return appModel.listings
            .filter { listing in
                listing.venue_name.caseInsensitiveCompare(venue.name) == .orderedSame
                    && listing.is_active
                    && (listing.days_of_week.isEmpty || listing.days_of_week.contains(day))
            }
            .sorted { lhs, rhs in
                if lhs.priority != rhs.priority { return lhs.priority > rhs.priority }
                return lhs.title < rhs.title
            }
    }

    /// Same quiet → busy → packed scale as the Activity list. Empty pins stay neutral.
    private static func markerColor(count: Int, maxCount: Int) -> Color {
        guard count > 0, maxCount > 0 else {
            return Color(white: 0.82)
        }
        let intensity = ActivitiesView.busynessIntensity(count: count, maxCount: maxCount)
        return ActivitiesView.busynessColor(intensity: intensity)
    }

    private func coordinate(for card: VenueLocationCard) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: card.primary.latitude, longitude: card.primary.longitude)
    }

    private func pinAccessibilityLabel(_ card: VenueLocationCard, count: Int) -> String {
        if count == 0 {
            return "\(card.title), no live users"
        }
        return "\(card.title), \(count) live users"
    }

    private func updateMapSize(_ newSize: CGSize) {
        guard newSize.width > 1, newSize.height > 1, newSize != mapSize else { return }
        mapSize = newSize
    }

    private func captureSpan(_ next: MKCoordinateSpan) {
        guard next.latitudeDelta > 0 else { return }
        if !didCaptureCamera {
            didCaptureCamera = true
            visibleSpan = next
            return
        }
        let delta = abs(next.latitudeDelta - visibleSpan.latitudeDelta) / visibleSpan.latitudeDelta
        if delta > 0.1 {
            visibleSpan = next
        }
    }

    private var busynessLegend: some View {
        HStack(spacing: 10) {
            legendItem("Quiet", intensity: 0.16)
            legendItem("Busy", intensity: 0.5)
            legendItem("Packed", intensity: 1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            Capsule(style: .continuous)
                .fill(Color(uiColor: .secondarySystemGroupedBackground))
        )
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.35), radius: 4, y: 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Busyness compared with the busiest bar tonight. Quiet, busy, and packed.")
    }

    private func legendItem(_ title: String, intensity: Double) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(ActivitiesView.busynessColor(intensity: intensity))
                .frame(width: 8, height: 8)
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.primary)
        }
    }

    private func openDirections(to venue: CatalogVenue) {
        let coordinate = CLLocationCoordinate2D(
            latitude: venue.latitude,
            longitude: venue.longitude
        )
        let placemark = MKPlacemark(coordinate: coordinate)
        let item = MKMapItem(placemark: placemark)
        item.name = venue.name
        item.openInMaps(launchOptions: [
            MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving,
        ])
        DiagnosticLog.shared.append(
            category: "system",
            message: "Opened Apple Maps directions to \(venue.name)"
        )
    }
}

/// Circular marker. Fill is the Activity busyness color; the ring is selection only.
private struct BusynessPin: View {
    let count: Int
    let color: Color
    let isSelected: Bool

    private var diameter: CGFloat {
        if isSelected { return 42 }
        return count > 0 ? 32 : 22
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(color)
                .frame(width: diameter, height: diameter)
                .overlay {
                    Circle()
                        .strokeBorder(Color.black.opacity(0.35), lineWidth: 1)
                }
            if count > 0 {
                Text("\(count)")
                    .font(.system(size: count > 99 ? 11 : 13, weight: .bold).monospacedDigit())
                    .foregroundStyle(Color.black.opacity(0.88))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .padding(.horizontal, 4)
            }
            if isSelected {
                Circle()
                    .strokeBorder(Color.white, lineWidth: 3)
                    .frame(width: diameter + 6, height: diameter + 6)
                    .shadow(color: .black.opacity(0.85), radius: 1)
            }
        }
        .frame(
            width: diameter + (isSelected ? 8 : 0),
            height: diameter + (isSelected ? 8 : 0)
        )
        .shadow(color: .black.opacity(0.4), radius: 2, y: 1)
        .animation(.easeInOut(duration: 0.2), value: isSelected)
    }
}

/// Overlapping bars collapsed into a pill. The large number is total people;
/// the caption is how many bars, so it is not read as one venue's headcount.
private struct BusynessCluster: View {
    let people: Int
    let venueCount: Int
    let color: Color

    private var barLabel: String {
        venueCount == 1 ? "1 bar" : "\(venueCount) bars"
    }

    var body: some View {
        VStack(spacing: 0) {
            Text("\(people)")
                .font(.system(size: 15, weight: .bold).monospacedDigit())
                .foregroundStyle(Color.black.opacity(0.88))
                .lineLimit(1)
            Text(barLabel)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Color.black.opacity(0.7))
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(Capsule(style: .continuous).fill(color))
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(Color.black.opacity(0.72), lineWidth: 2)
        )
        .shadow(color: .black.opacity(0.45), radius: 3, y: 1)
    }
}

private struct MapMarkerLayout {
    var pins: [VenueLocationCard]
    var clusters: [BarCluster]
}

private struct BarCluster: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let members: [VenueLocationCard]
}

/// Groups pins whose screen positions would overlap at the current zoom.
private enum MapClustering {
    /// Points closer than this (in screen points) share a cluster pill.
    private static let overlapDistance: CGFloat = 56

    static func layout(
        pins: [VenueLocationCard],
        span: MKCoordinateSpan,
        mapSize: CGSize,
        keepingVisible selectedID: String?
    ) -> MapMarkerLayout {
        let held = pins.filter { $0.id == selectedID }
        var pool = pins.filter { $0.id != selectedID }
        var singles: [VenueLocationCard] = []
        var clusters: [BarCluster] = []

        while !pool.isEmpty {
            let seed = pool.removeFirst()
            var members = [seed]
            var grew = true
            while grew {
                grew = false
                var index = 0
                while index < pool.count {
                    let candidate = pool[index]
                    let overlaps = members.contains { member in
                        pointDistance(from: member, to: candidate, span: span, mapSize: mapSize) < overlapDistance
                    }
                    if overlaps {
                        members.append(pool.remove(at: index))
                        grew = true
                    } else {
                        index += 1
                    }
                }
            }

            if members.count == 1, let only = members.first {
                singles.append(only)
            } else {
                clusters.append(cluster(from: members))
            }
        }

        return MapMarkerLayout(pins: held + singles, clusters: clusters)
    }

    private static func cluster(from members: [VenueLocationCard]) -> BarCluster {
        let latitude = members.reduce(0.0) { $0 + $1.primary.latitude } / Double(members.count)
        let longitude = members.reduce(0.0) { $0 + $1.primary.longitude } / Double(members.count)
        let id = members.map(\.id).sorted().joined(separator: "|")
        return BarCluster(
            id: id,
            coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
            members: members
        )
    }

    private static func pointDistance(
        from: VenueLocationCard,
        to: VenueLocationCard,
        span: MKCoordinateSpan,
        mapSize: CGSize
    ) -> CGFloat {
        let width = max(mapSize.width, 1)
        let height = max(mapSize.height, 1)
        let latDelta = max(span.latitudeDelta, 0.000_01)
        let lonDelta = max(span.longitudeDelta, 0.000_01)
        let x = (from.primary.longitude - to.primary.longitude) / lonDelta * width
        let y = (from.primary.latitude - to.primary.latitude) / latDelta * height
        return hypot(x, y)
    }
}

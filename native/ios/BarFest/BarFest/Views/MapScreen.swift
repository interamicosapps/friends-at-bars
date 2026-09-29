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

    private var mapRegion: MKCoordinateRegion {
        if let geo = appModel.resolvedGeography {
            let delta = max(0.04, geo.radius_miles / 69.0 * 2.1)
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: geo.latitude, longitude: geo.longitude),
                span: MKCoordinateSpan(latitudeDelta: delta, longitudeDelta: delta)
            )
        }
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 39.981997, longitude: -83.004427),
            span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
        )
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Map(position: $position) {
                    ForEach(mapPins) { card in
                        let count = card.attendance(in: appModel.venueCounts)
                        let isSelected = selectedCard?.id == card.id
                        Annotation(
                            card.title,
                            coordinate: CLLocationCoordinate2D(
                                latitude: card.primary.latitude,
                                longitude: card.primary.longitude
                            )
                        ) {
                            Button {
                                cyclePin(card)
                            } label: {
                                Image(systemName: "mappin.circle.fill")
                                    .font(isSelected ? .system(size: 44) : .title2)
                                    .foregroundStyle(pinColor(count: count, maxCount: maxAttendance))
                                    .shadow(color: .black.opacity(0.35), radius: 2, y: 1)
                                    .animation(.easeInOut(duration: 0.2), value: isSelected)
                            }
                            .buttonStyle(.plain)
                        }
                        .annotationTitles(.hidden)
                    }

                    if mapUnlocked {
                        UserAnnotation()
                    }
                }
                .mapStyle(.standard(pointsOfInterest: .excludingAll))
                .tint(.green)
                .mapControls {
                    MapCompass()
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
                position = .region(mapRegion)
            }
            .onChange(of: appModel.resolvedGeography?.id) { _, _ in
                dismissSelection()
                position = .region(mapRegion)
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
                .fill(Color(uiColor: .secondarySystemGroupedBackground).opacity(0.95))
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
                        .fill(Color(uiColor: .secondarySystemGroupedBackground).opacity(0.95))
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
                  ? "location.fill"
                  : "location.slash")
                .font(.body.weight(.semibold))
                .foregroundStyle(testMode.simulateLocationAllowed ? Color.accentColor : .secondary)
                .frame(width: 40, height: 40)
                .background(
                    Circle()
                        .fill(Color(uiColor: .secondarySystemGroupedBackground).opacity(0.95))
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

    /// Relative heat: white when empty / below ~half of tonight’s busiest bar; bright red at the max.
    private func pinColor(count: Int, maxCount: Int) -> Color {
        guard count > 0, maxCount > 0 else {
            return .white
        }
        let ratio = Double(count) / Double(maxCount)
        // Keep most pins near white; only the busier half of the range reddens.
        let heat = max(0, min(1, (ratio - 0.45) / 0.55))
        return Color(
            red: 1.0,
            green: 1.0 - heat * 0.85,
            blue: 1.0 - heat * 0.9
        )
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

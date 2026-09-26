import SwiftUI

struct ActivitiesView: View {
    @EnvironmentObject private var appModel: AppModel
    @ObservedObject private var testMode = TestModeStore.shared
    @ObservedObject private var locationAuth = LocationAuthorizationStore.shared
    @State private var populationSort: PopulationSort = .mostPopulated
    @State private var areaFilter: String?
    @State private var selectedVenue: CatalogVenue?
    @State private var venueSearch = ""
    @FocusState private var searchFocused: Bool
    @State private var showWaitCheckIn = false
    @State private var dismissedCheckInVenue: String?
    @State private var waitSubmitting = false
    @State private var waitSubmitError: String?
    @State private var checkInSelectedVenue: String = ""
    /// After splash, first unreported check-in waits 0.5s so Activities is visible first.
    @State private var allowCheckInOverlay = false
    @State private var checkInRevealTask: Task<Void, Never>?
    @State private var feedbackContext: CatalogFeedbackContext?

    private var searchQuery: String {
        venueSearch.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isSearching: Bool { !searchQuery.isEmpty }

    private var priorityDeals: [CatalogListing] {
        appModel.scopedListings
            .filter { $0.priority > 0 }
            .sorted { $0.priority < $1.priority }
    }

    /// Default: bars with live attendance only. While searching: include zero-attendance matches.
    private var filteredVenues: [CatalogVenue] {
        var list = appModel.scopedVenues
        if isSearching {
            list = list.filter { $0.name.localizedCaseInsensitiveContains(searchQuery) }
        } else {
            list = list.filter { appModel.venueCounts[$0.name, default: 0] > 0 }
        }
        if let areaFilter {
            list = list.filter { $0.area == areaFilter }
        }
        list.sort { a, b in
            let ca = appModel.venueCounts[a.name, default: 0]
            let cb = appModel.venueCounts[b.name, default: 0]
            if ca != cb {
                return populationSort == .mostPopulated ? ca > cb : ca < cb
            }
            return a.sort_order < b.sort_order
        }
        return list
    }

    /// Live: OS location. Test Mode + mock: simulate-location toggle (Chat parity).
    private var showBarAttendance: Bool {
        if testMode.uiEnabled && testMode.useMockCheckIns {
            return testMode.simulateLocationAllowed
        }
        return locationAuth.isAuthorized
    }

    var body: some View {
        NavigationStack {
            ZStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if testMode.useMockCheckIns {
                        HStack(spacing: 10) {
                            Text("Test Mode: showing mock headcounts")
                                .font(.caption)
                                .foregroundStyle(.cyan)
                            Spacer(minLength: 8)
                            Button {
                                testMode.simulateLocationAllowed.toggle()
                                DiagnosticLog.shared.append(
                                    category: "system",
                                    message: "Activities simulate location allowed=\(testMode.simulateLocationAllowed)"
                                )
                            } label: {
                                Image(systemName: testMode.simulateLocationAllowed
                                      ? "location.fill"
                                      : "location.slash")
                                    .font(.body.weight(.semibold))
                            }
                            .accessibilityLabel(
                                testMode.simulateLocationAllowed
                                    ? "Simulate location on"
                                    : "Simulate location off"
                            )
                        }
                    }

                    PriorityDealsCarousel(items: priorityDeals)

                    if showBarAttendance {
                        HorizontalChipScroll {
                            ForEach(appModel.scopedAreas) { area in
                                AreaFilterChip(
                                    title: area.short_name,
                                    accent: area.accentColor,
                                    selected: areaFilter == area.long_name
                                ) {
                                    if areaFilter == area.long_name {
                                        areaFilter = nil
                                        populationSort = .mostPopulated
                                    } else {
                                        areaFilter = area.long_name
                                        populationSort = .mostPopulated
                                    }
                                }
                            }
                        }
                    }

                    HStack(alignment: .center, spacing: 8) {
                        Text((areaFilter == nil ? "Bars" : areaFilter!).uppercased())
                            .font(.caption.weight(.semibold))
                            .tracking(1.1)
                            .foregroundStyle(.white.opacity(0.55))
                        Button {
                            openFeedback(category: .missingBar, source: "activities-header")
                        } label: {
                            Text("Missing Bar?")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.accentColor)
                        }
                        .buttonStyle(.plain)
                        Spacer(minLength: 8)
                        if showBarAttendance, !filteredVenues.isEmpty {
                            Button {
                                searchFocused = false
                                populationSort.toggle()
                            } label: {
                                Label(populationSort.rawValue, systemImage: "arrow.up.arrow.down")
                                    .font(.caption.weight(.semibold))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 7)
                                    .background(Color.white.opacity(0.1))
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Toggle population sort")
                        }
                    }

                    if showBarAttendance {
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
                                .fill(Color.white.opacity(0.08))
                        )

                        if filteredVenues.isEmpty {
                            if isSearching {
                                ContentUnavailableView(
                                    "No Bars Found From That Search",
                                    systemImage: "magnifyingglass",
                                    description: Text("Try another bar name or area.")
                                )
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 24)
                                .dismissKeyboardOnTap()
                            } else {
                                ActivitiesNoActivityEmptyState(areaName: areaFilter) {
                                    openFeedback(
                                        category: .missingBar,
                                        source: "activities-empty"
                                    )
                                }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 36)
                            }
                        } else {
                            let maxCount = filteredVenues
                                .map { appModel.venueCounts[$0.name, default: 0] }
                                .max() ?? 0
                            LazyVStack(spacing: 0) {
                                ForEach(Array(filteredVenues.enumerated()), id: \.element.id) { idx, venue in
                                    let count = appModel.venueCounts[venue.name, default: 0]
                                    let intensity = Self.busynessIntensity(
                                        count: count,
                                        maxCount: maxCount
                                    )
                                    Button {
                                        searchFocused = false
                                        selectedVenue = venue
                                    } label: {
                                        HStack(alignment: .center, spacing: 10) {
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text(venue.name)
                                                    .font(.body.weight(.semibold))
                                                    .foregroundStyle(.white)
                                                Text(venue.area)
                                                    .font(.caption2)
                                                    .foregroundStyle(.white.opacity(0.45))
                                                WaitTimeLabel(
                                                    summary: appModel.waitSummary(for: venue.name),
                                                    hidesWhenEmpty: true
                                                )
                                            }
                                            Spacer(minLength: 8)
                                            if count == 0 {
                                                Text("No Live Users")
                                                    .font(.caption.weight(.semibold))
                                                    .foregroundStyle(.white.opacity(0.4))
                                                    .multilineTextAlignment(.trailing)
                                            } else {
                                                HStack(spacing: 8) {
                                                    VenueBusynessMeter(intensity: intensity)
                                                    Text("\(count)")
                                                        .font(.title3.monospacedDigit().weight(.bold))
                                                        .foregroundStyle(Self.busynessColor(intensity: intensity))
                                                        .accessibilityLabel("\(count) live users")
                                                }
                                            }
                                            Image(systemName: "chevron.right")
                                                .font(.caption2.weight(.semibold))
                                                .foregroundStyle(.white.opacity(0.22))
                                        }
                                        .padding(.vertical, 14)
                                        .padding(.horizontal, 14)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    if idx < filteredVenues.count - 1 {
                                        Rectangle()
                                            .fill(Color.white.opacity(0.06))
                                            .frame(height: 1)
                                            .padding(.leading, 14)
                                    }
                                }
                            }
                            .background(
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .fill(Color.white.opacity(0.07))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
                            )
                            .dismissKeyboardOnTap()
                        }
                    } else {
                        ActivitiesLocationInlineGate()
                    }
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.black.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await reload(fromPullToRefresh: true) }

                if showWaitCheckIn, !checkInSelectedVenue.isEmpty {
                    Color.black.opacity(0.35)
                        .ignoresSafeArea()
                        .onTapGesture { dismissCheckIn(for: checkInSelectedVenue) }
                    WaitTimeCheckInPopup(
                        venueNames: checkInVenueOptions,
                        selectedVenueName: $checkInSelectedVenue,
                        selectedMinutes: appModel.myWaitMinutes(for: checkInSelectedVenue),
                        isSubmitting: waitSubmitting,
                        errorMessage: waitSubmitError,
                        onSelect: { minutes in
                            let venue = checkInSelectedVenue
                            Task { await submitWait(venueName: venue, minutes: minutes) }
                        },
                        onDismiss: { dismissCheckIn(for: checkInSelectedVenue) }
                    )
                    .transition(
                        .opacity.combined(with: .scale(scale: 0.96, anchor: .center))
                    )
                }

            }
            .onChange(of: testMode.useMockCheckIns) { _, _ in
                Task { await appModel.refreshCatalog(); await reload() }
            }
            .onChange(of: appModel.resolvedGeography?.id) { _, _ in
                areaFilter = nil
                venueSearch = ""
                searchFocused = false
                updateCheckInVisibility()
            }
            .onChange(of: appModel.lastVenueName) { old, new in
                if new != old {
                    dismissedCheckInVenue = nil
                }
                if new == nil {
                    cancelCheckInRevealDelay(unlockOverlay: appModel.splashDidDismiss)
                }
                syncCheckInSelectedVenue()
                updateCheckInVisibility()
            }
            .onChange(of: appModel.proximityVenueNames) { _, names in
                if names.isEmpty {
                    dismissedCheckInVenue = nil
                }
                syncCheckInSelectedVenue()
                updateCheckInVisibility()
            }
            .onChange(of: appModel.waitPromptEligible) { _, _ in
                updateCheckInVisibility()
            }
            .onChange(of: appModel.splashDidDismiss) { _, dismissed in
                if dismissed { beginPostSplashCheckInReveal() }
            }
            .onChange(of: appModel.initialBootstrapFinished) { _, finished in
                if finished { updateCheckInVisibility() }
            }
            .onAppear {
                locationAuth.refresh()
                if appModel.splashDidDismiss, !allowCheckInOverlay {
                    beginPostSplashCheckInReveal()
                } else {
                    updateCheckInVisibility()
                }
            }
            .sheet(item: $selectedVenue) { venue in
                VenueBarSheet(
                    venue: venue,
                    listings: todaysListings(for: venue),
                    waitSummary: appModel.waitSummary(for: venue.name),
                    geographyId: appModel.resolvedGeography?.id,
                    onReport: { ctx in
                        selectedVenue = nil
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                            feedbackContext = ctx
                        }
                    }
                )
                .presentationDetents([.medium, .large])
            }
            .sheet(item: $feedbackContext) { ctx in
                CatalogFeedbackSheet(context: ctx)
            }
        }
    }

    private func openFeedback(
        category: CatalogFeedbackCategory?,
        source: String,
        venueName: String? = nil
    ) {
        feedbackContext = CatalogFeedbackContext(
            category: category,
            venueName: venueName,
            listingId: nil,
            listingTitle: nil,
            sourceScreen: source,
            geographyId: appModel.resolvedGeography?.id
        )
    }

    private var checkInVenueOptions: [String] {
        let prox = appModel.proximityVenueNames
        if !prox.isEmpty { return prox }
        if let last = appModel.lastVenueName { return [last] }
        return []
    }

    private func syncCheckInSelectedVenue() {
        let options = checkInVenueOptions
        if options.isEmpty {
            checkInSelectedVenue = ""
            return
        }
        if let primary = appModel.lastVenueName, options.contains(primary) {
            checkInSelectedVenue = primary
        } else if !options.contains(checkInSelectedVenue) {
            checkInSelectedVenue = options[0]
        }
    }

    private func updateCheckInVisibility() {
        syncCheckInSelectedVenue()
        guard showBarAttendance else {
            showWaitCheckIn = false
            return
        }
        guard appModel.waitPromptEligible || appModel.lastVenueName != nil else {
            showWaitCheckIn = false
            return
        }
        // Prefer wait-prompt eligibility (20s in footprint ∪ buffer); also allow
        // confirmed presence (lastVenueName) once eligible or already written.
        let venue = checkInSelectedVenue
        guard !venue.isEmpty else {
            showWaitCheckIn = false
            return
        }
        guard appModel.waitPromptEligible else {
            showWaitCheckIn = false
            return
        }
        guard dismissedCheckInVenue != venue else {
            // If multi-venue and user dismissed one, still allow if others remain
            // and primary changed — treat dismissed as that specific name only.
            showWaitCheckIn = false
            return
        }
        guard appModel.splashDidDismiss, allowCheckInOverlay else {
            showWaitCheckIn = false
            return
        }
        withAnimation(.easeOut(duration: 0.28)) {
            showWaitCheckIn = true
        }
    }

    /// After splash, pause so Activities is readable before the first unreported check-in card.
    private func beginPostSplashCheckInReveal() {
        syncCheckInSelectedVenue()
        let venue = checkInSelectedVenue.isEmpty ? appModel.lastVenueName : checkInSelectedVenue
        let shouldDelay = showBarAttendance
            && appModel.waitPromptEligible
            && venue != nil
            && dismissedCheckInVenue != venue
            && venue.map { appModel.myWaitMinutes(for: $0) == nil } == true

        if shouldDelay {
            showWaitCheckIn = false
            checkInRevealTask?.cancel()
            checkInRevealTask = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 500_000_000)
                guard !Task.isCancelled else { return }
                allowCheckInOverlay = true
                DiagnosticLog.shared.append(
                    category: "system",
                    message: "Wait check-in overlay after splash delay venue=\(venue ?? "nil")"
                )
                updateCheckInVisibility()
            }
        } else {
            allowCheckInOverlay = true
            updateCheckInVisibility()
        }
    }

    private func cancelCheckInRevealDelay(unlockOverlay: Bool) {
        checkInRevealTask?.cancel()
        checkInRevealTask = nil
        if unlockOverlay {
            allowCheckInOverlay = true
        }
    }

    private func dismissCheckIn(for venue: String) {
        dismissedCheckInVenue = venue
        showWaitCheckIn = false
        waitSubmitError = nil
    }

    private func submitWait(venueName: String, minutes: Int) async {
        waitSubmitting = true
        waitSubmitError = nil
        defer { waitSubmitting = false }
        do {
            try await appModel.submitWaitReport(venueName: venueName, waitMinutes: minutes)
        } catch {
            waitSubmitError = error.localizedDescription
        }
    }

    /// Deals/events for this venue that apply today (empty `days_of_week` = any day).
    private func todaysListings(for venue: CatalogVenue) -> [CatalogListing] {
        let day = DayFilter.today.rawValue
        return appModel.listings
            .filter { listing in
                listing.venue_name.caseInsensitiveCompare(venue.name) == .orderedSame
                    && (listing.days_of_week.isEmpty || listing.days_of_week.contains(day))
            }
            .sorted { lhs, rhs in
                if lhs.priority != rhs.priority { return lhs.priority > rhs.priority }
                return lhs.title < rhs.title
            }
    }

    private func reload(fromPullToRefresh: Bool = false) async {
        if fromPullToRefresh {
            DiagnosticLog.shared.append(
                category: "location",
                message: "Activities pull-to-refresh — refreshing live headcounts"
            )
            await appModel.refreshHeadcounts(source: "activities-pull")
        } else {
            await appModel.refreshCatalog()
        }
        await appModel.refreshWaitTimes()
    }

    /// 0…1 relative to the busiest venue in the currently filtered list.
    static func busynessIntensity(count: Int, maxCount: Int) -> Double {
        guard count > 0, maxCount > 0 else { return 0 }
        return min(1, Double(count) / Double(maxCount))
    }

    /// Nightlife-friendly quiet → medium → hot scale (desaturated, readable on black).
    static func busynessColor(intensity: Double) -> Color {
        if intensity < 0.34 {
            return Color(red: 0.42, green: 0.78, blue: 0.58)
        }
        if intensity < 0.67 {
            return Color(red: 0.95, green: 0.72, blue: 0.32)
        }
        return Color(red: 0.96, green: 0.42, blue: 0.34)
    }
}

/// Short relative-busyness bar next to the headcount (color + fill length).
private struct VenueBusynessMeter: View {
    let intensity: Double

    var body: some View {
        let color = ActivitiesView.busynessColor(intensity: intensity)
        ZStack(alignment: .leading) {
            Capsule()
                .fill(Color.white.opacity(0.12))
            Capsule()
                .fill(color)
                .frame(width: max(4, 28 * intensity))
        }
        .frame(width: 28, height: 5)
        .accessibilityHidden(true)
    }
}

/// Empty state when no bars currently have live attendance (optionally scoped to an area).
private struct ActivitiesNoActivityEmptyState: View {
    var areaName: String?
    var onMissingTip: (() -> Void)?

    private var message: String {
        if let areaName, !areaName.isEmpty {
            return "No Activity in \(areaName)"
        }
        return "No Activity Yet"
    }

    var body: some View {
        VStack(spacing: 18) {
            SpilledCupGlyph()
                .frame(width: 88, height: 72)
                .foregroundStyle(.white)
            Text(message)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
            if let onMissingTip {
                CatalogFeedbackLinkButton(
                    title: "Missing Bar?",
                    action: onMissingTip
                )
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// Simple tipped-cup illustration inspired by the product empty state.
private struct SpilledCupGlyph: View {
    var body: some View {
        ZStack {
            // Spill puddle
            Capsule()
                .fill(Color.white.opacity(0.9))
                .frame(width: 52, height: 14)
                .offset(x: 18, y: 26)
            // Cup body (tipped)
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(Color.white, lineWidth: 3)
                .frame(width: 36, height: 44)
                .overlay(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(Color.white, lineWidth: 2.5)
                        .frame(width: 22, height: 10)
                        .offset(y: -22)
                )
                .rotationEffect(.degrees(-55))
                .offset(x: -10, y: -2)
        }
    }
}

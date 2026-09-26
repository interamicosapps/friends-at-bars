import SwiftUI

struct DealsView: View {
    @EnvironmentObject private var appModel: AppModel
    @Binding var searchFocusedForChrome: Bool
    @State private var dayFilter: DayFilter = .today
    @State private var areaFilter: String?
    @State private var venueSearch = ""
    @FocusState private var searchFocused: Bool
    @State private var feedbackContext: CatalogFeedbackContext?

    private static let dealGold = Color(red: 0.95, green: 0.72, blue: 0.28)
    private static let eventLilac = Color(red: 0.78, green: 0.58, blue: 0.95)

    init(searchFocusedForChrome: Binding<Bool> = .constant(false)) {
        _searchFocusedForChrome = searchFocusedForChrome
    }

    private var searchQuery: String {
        venueSearch.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var filteredListings: [CatalogListing] {
        appModel.scopedListings
            .filter { listing in
                if dayFilter != .all {
                    let day = dayFilter.rawValue
                    if !listing.days_of_week.isEmpty && !listing.days_of_week.contains(day) {
                        return false
                    }
                }
                if let areaFilter {
                    if listing.area != areaFilter {
                        return false
                    }
                }
                if !searchQuery.isEmpty {
                    if !listing.venue_name.localizedCaseInsensitiveContains(searchQuery) {
                        return false
                    }
                }
                return true
            }
            .sorted { lhs, rhs in
                if lhs.priority != rhs.priority { return lhs.priority > rhs.priority }
                return lhs.venue_name < rhs.venue_name
            }
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                filtersHeader
                if filteredListings.isEmpty {
                    emptyState
                } else {
                    dealsList
                }
            }
            .background(Color.black.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await appModel.refreshCatalog() }
            .sheet(item: $feedbackContext) { ctx in
                CatalogFeedbackSheet(context: ctx)
            }
            .onAppear { logDealsDiagnostics(event: "appear") }
            .onChange(of: appModel.listings.count) { _, _ in
                logDealsDiagnostics(event: "listings-changed")
            }
            .onChange(of: dayFilter) { _, _ in logDealsDiagnostics(event: "day-filter") }
            .onChange(of: areaFilter) { _, _ in logDealsDiagnostics(event: "area-filter") }
            .onChange(of: appModel.resolvedGeography?.id) { _, _ in
                areaFilter = nil
            }
            .onChange(of: searchFocused) { _, focused in
                searchFocusedForChrome = focused
            }
            .onChange(of: searchFocusedForChrome) { _, focused in
                if searchFocused != focused {
                    searchFocused = focused
                }
            }
        }
    }

    private var filtersHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            areaChips
            searchField
            dealsSectionHeader
        }
        .padding(.horizontal)
        .padding(.top, 4)
        .padding(.bottom, 10)
    }

    private var areaChips: some View {
        HorizontalChipScroll {
            ForEach(appModel.scopedAreas) { area in
                AreaFilterChip(
                    title: area.short_name,
                    accent: area.accentColor,
                    selected: areaFilter == area.long_name
                ) {
                    if areaFilter == area.long_name {
                        areaFilter = nil
                    } else {
                        areaFilter = area.long_name
                    }
                }
            }
        }
    }

    private var searchField: some View {
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
    }

    private var dealsSectionHeader: some View {
        HStack(alignment: .center, spacing: 8) {
            Text("DEALS")
                .font(.caption.weight(.semibold))
                .tracking(1.1)
                .foregroundStyle(.white.opacity(0.55))
            Button {
                openFeedback(category: .missingDeal, source: "deals-header")
            } label: {
                Text("Missing Deal?")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
            }
            .buttonStyle(.plain)
            Spacer(minLength: 8)
            dayFilterMenu
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if !searchQuery.isEmpty {
            ContentUnavailableView(
                "No Deals Found From That Search",
                systemImage: "magnifyingglass",
                description: Text("Try another bar name, day, or area.")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .dismissKeyboardOnTap()
            .safeAreaInset(edge: .bottom) {
                CatalogFeedbackLinkButton(title: "Missing Deal?") {
                    openFeedback(category: .missingDeal, source: "deals-search-empty")
                }
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
        } else {
            ContentUnavailableView(
                "No deals",
                systemImage: "tag",
                description: Text("Try another day or area, or pull to refresh.")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .dismissKeyboardOnTap()
            .safeAreaInset(edge: .bottom) {
                CatalogFeedbackLinkButton(title: "Missing Deal?") {
                    openFeedback(category: .missingDeal, source: "deals-empty")
                }
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
        }
    }

    private var dealsList: some View {
        List {
            ForEach(filteredListings) { item in
                dealRow(item)
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, trailing: 0, bottom: 0))
                    .listRowSeparatorTint(Color.white.opacity(0.08))
                    .listRowBackground(Color.white.opacity(0.07))
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button {
                            openFeedback(
                                category: .outdatedListing,
                                source: "deals-swipe",
                                venueName: item.venue_name,
                                listingId: item.id,
                                listingTitle: item.title.isEmpty
                                    ? item.venue_name
                                    : item.title
                            )
                        } label: {
                            Label("Report", systemImage: "flag")
                        }
                        .tint(.orange)
                    }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .dismissKeyboardOnTap()
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private func dealRow(_ item: CatalogListing) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.venue_name)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                Spacer(minLength: 8)
                if !item.area.isEmpty {
                    Text(item.area)
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.45))
                }
            }

            if !item.title.isEmpty {
                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.92))
            }

            if !item.time_label.isEmpty {
                Text(item.time_label)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.5))
            }

            if !item.details.isEmpty {
                Text(item.details)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.72))
            }

            HStack(spacing: 6) {
                ForEach(item.type_labels, id: \.self) { label in
                    let accent = typeAccent(for: label)
                    Text(label)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(accent.opacity(0.28))
                        .foregroundStyle(accent)
                        .clipShape(Capsule())
                }
                if !item.days_of_week.isEmpty {
                    Text(dayNames(item.days_of_week))
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.45))
                }
            }
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func openFeedback(
        category: CatalogFeedbackCategory?,
        source: String,
        venueName: String? = nil,
        listingId: UUID? = nil,
        listingTitle: String? = nil
    ) {
        feedbackContext = CatalogFeedbackContext(
            category: category,
            venueName: venueName,
            listingId: listingId,
            listingTitle: listingTitle,
            sourceScreen: source,
            geographyId: appModel.resolvedGeography?.id
        )
    }

    private func typeAccent(for label: String) -> Color {
        if label.localizedCaseInsensitiveContains("event") {
            return Self.eventLilac
        }
        return Self.dealGold
    }

    private func dismissDealsSearch() {
        searchFocused = false
        searchFocusedForChrome = false
        KeyboardObserver.dismiss()
    }

    private var dayFilterMenu: some View {
        Group {
            if searchFocused {
                Button(action: dismissDealsSearch) {
                    dayFilterLabel
                }
                .buttonStyle(.plain)
            } else {
                Menu {
                    ForEach(DayFilter.allCases) { day in
                        Button {
                            dayFilter = day
                        } label: {
                            HStack {
                                Text(day.label)
                                if dayFilter == day { Image(systemName: "checkmark") }
                            }
                        }
                    }
                } label: {
                    dayFilterLabel
                }
            }
        }
        .accessibilityLabel("Day filter, \(dayFilter.label)")
    }

    private var dayFilterLabel: some View {
        HStack(spacing: 5) {
            Text(dayFilter.label)
                .font(.caption.weight(.semibold))
            Image(systemName: "chevron.down")
                .font(.caption2.weight(.bold))
        }
        .foregroundStyle(.white.opacity(0.85))
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Color.white.opacity(0.1))
        .clipShape(Capsule())
    }

    private func logDealsDiagnostics(event: String) {
        let areas = Dictionary(grouping: appModel.listings, by: \.area).mapValues(\.count)
        let areaSummary = areas.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ", ")
        DiagnosticLog.shared.append(
            category: "system",
            message: """
            Deals[\(event)] total=\(appModel.listings.count) visible=\(filteredListings.count) \
            day=\(dayFilter.label) area=\(areaFilter ?? "All")
            """
        )
        if !areaSummary.isEmpty {
            DiagnosticLog.shared.append(
                category: "system",
                message: "Deals listing areas: \(areaSummary)"
            )
        }
        if appModel.listings.count <= 6 {
            DiagnosticLog.shared.append(
                category: "system",
                message: "Deals: Supabase returned only \(appModel.listings.count) listings — UI cannot show more until DB is re-seeded"
            )
        }
    }

    private func dayNames(_ days: [Int]) -> String {
        let map = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        return days.sorted().compactMap { d in
            (0 ..< map.count).contains(d) ? map[d] : nil
        }.joined(separator: ", ")
    }
}

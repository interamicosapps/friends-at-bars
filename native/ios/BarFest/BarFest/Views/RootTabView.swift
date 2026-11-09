import SwiftUI

private enum AppTab: Hashable {
    case activities
    case deals
    case chat
    case map
    case games
    case log

    var title: String {
        switch self {
        case .activities: return "Activity"
        case .deals: return "Deals"
        case .chat: return "Chat"
        case .map: return "Map"
        case .games: return "Games"
        case .log: return "Log"
        }
    }

    var systemImage: String {
        switch self {
        case .activities: return "bolt.fill"
        case .deals: return "tag.fill"
        case .chat: return "bubble.left.and.bubble.right.fill"
        case .map: return "map.fill"
        case .games: return "gamecontroller.fill"
        case .log: return "doc.text"
        }
    }
}

struct RootTabView: View {
    @EnvironmentObject private var appModel: AppModel
    @ObservedObject private var testMode = TestModeStore.shared
    @ObservedObject private var locationAuth = LocationAuthorizationStore.shared
    @ObservedObject private var keyboard = KeyboardObserver.shared
    @State private var selectedTab: AppTab = .activities
    @State private var shakeTriggers: [AppTab: Int] = [:]
    @State private var dealsSearchFocused = false
    /// Cold-start tab pick runs once after splash (and bootstrap when needed).
    @State private var didApplyLaunchTab = false

    private static let firstOpenKey = "barfest_has_completed_first_open"

    private var visibleTabs: [AppTab] {
        var tabs: [AppTab] = [.activities, .deals, .chat, .map, .games]
        if testMode.uiEnabled {
            tabs.append(.log)
        }
        return tabs
    }

    /// Same gate Activity uses for showing the bar list.
    private var canUseAttendance: Bool {
        if testMode.uiEnabled && testMode.useMockCheckIns {
            return testMode.simulateLocationAllowed
        }
        return locationAuth.canUseLocation
    }

    /// Matches Activity's default list: any scoped bar with live or recent count.
    private var hasActivityContent: Bool {
        let names = Set(appModel.scopedVenues.map(\.name))
        for name in names {
            if (appModel.venueCounts[name] ?? 0) > 0 { return true }
            if (appModel.recentWhileUsingCounts[name] ?? 0) > 0 { return true }
        }
        return false
    }

    private var asksPresenceConfirm: Bool {
        locationAuth.canUseLocation && !(testMode.uiEnabled && testMode.useMockCheckIns)
    }

    /// Inside bars still waiting on a yes, no, or tap-away. Closest is first.
    private var questionVenues: [String] {
        appModel.insideVenueNames.filter { name in
            if appModel.declinedPresenceVenues.contains(name) { return false }
            if appModel.dismissedPresenceVenues.contains(name) { return false }
            if appModel.confirmedPresenceVenue == name { return false }
            if appModel.myWaitMinutes(for: name) != nil,
               appModel.waitSummary(for: name).mode != .none {
                return false
            }
            return true
        }
    }

    private var showPresenceQuestion: Bool {
        asksPresenceConfirm
            && appModel.splashDidDismiss
            && appModel.confirmedPresenceVenue == nil
            && !questionVenues.isEmpty
    }

    var body: some View {
        ZStack {
            mainStack
            if showPresenceQuestion {
                Color.black.opacity(0.35)
                    .ignoresSafeArea()
                    .onTapGesture { dismissPresenceQuestion() }
                PresenceConfirmCard(venueNames: questionVenues) { name in
                    appModel.acceptPresence(venue: name, otherInside: questionVenues)
                } onDeclineAll: {
                    appModel.declinePresence(venues: questionVenues)
                }
                .id(questionVenues.joined(separator: "|"))
                .zIndex(2)
            }
            if testMode.uiEnabled && testMode.useMockCheckIns && testMode.showMockWaitReport {
                MockWaitReportOverlay(isPresented: $testMode.showMockWaitReport)
                    .zIndex(3)
            }
        }
        .onAppear {
            syncPresencePrompts()
            applyLaunchTabIfNeeded()
        }
        .onChange(of: testMode.useMockCheckIns) { _, _ in syncPresencePrompts() }
        .onChange(of: locationAuth.canUseLocation) { _, _ in syncPresencePrompts() }
        .onChange(of: appModel.splashDidDismiss) { _, _ in applyLaunchTabIfNeeded() }
        .onChange(of: appModel.initialBootstrapFinished) { _, _ in applyLaunchTabIfNeeded() }
        .onChange(of: appModel.venueCounts) { _, _ in applyLaunchTabIfNeeded() }
        .onChange(of: appModel.recentWhileUsingCounts) { _, _ in applyLaunchTabIfNeeded() }
    }

    private func dismissPresenceQuestion() {
        appModel.dismissPresenceQuestion(venues: questionVenues)
    }

    private func syncPresencePrompts() {
        VenueLiveLocationEngine.shared.setPresencePromptsEnabled(asksPresenceConfirm)
    }

    /// First open → Activity. Later: no location or empty Activity → Deals; else Activity.
    private func applyLaunchTabIfNeeded() {
        guard !didApplyLaunchTab else { return }
        guard appModel.splashDidDismiss else { return }

        let firstOpen = !UserDefaults.standard.bool(forKey: Self.firstOpenKey)
        if firstOpen {
            UserDefaults.standard.set(true, forKey: Self.firstOpenKey)
            selectedTab = .activities
            didApplyLaunchTab = true
            DiagnosticLog.shared.append(
                category: "system",
                message: "Launch tab=Activity reason=first-open"
            )
            return
        }

        if !canUseAttendance {
            selectedTab = .deals
            didApplyLaunchTab = true
            DiagnosticLog.shared.append(
                category: "system",
                message: "Launch tab=Deals reason=no-location"
            )
            return
        }

        guard appModel.initialBootstrapFinished else { return }

        if hasActivityContent {
            selectedTab = .activities
            didApplyLaunchTab = true
            DiagnosticLog.shared.append(
                category: "system",
                message: "Launch tab=Activity reason=has-activity"
            )
        } else {
            selectedTab = .deals
            didApplyLaunchTab = true
            DiagnosticLog.shared.append(
                category: "system",
                message: "Launch tab=Deals reason=empty-activity"
            )
        }
    }

    private var mainStack: some View {
        VStack(spacing: 0) {
            TestModeChrome()
            if selectedTab == .activities || selectedTab == .deals || selectedTab == .chat {
                GeographyBanner(
                    suppressMenuWhileKeyboard: selectedTab == .deals && dealsSearchFocused,
                    onSuppressTap: { dealsSearchFocused = false }
                )
            }
            // Custom tabs only — no system TabView/UITabBar (avoids iOS liquid-glass remnant).
            ZStack {
                tabPage(.activities) { ActivitiesView() }
                tabPage(.deals) {
                    DealsView(searchFocusedForChrome: $dealsSearchFocused)
                }
                tabPage(.chat) { ChatView() }
                tabPage(.map) { MapScreen() }
                tabPage(.games) { GamesHubView() }
                if testMode.uiEnabled {
                    tabPage(.log) { LogView() }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            if !keyboard.isVisible {
                customTabBar
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.22), value: keyboard.isVisible)
        .preferredColorScheme(.dark)
        .onChange(of: testMode.useMockCheckIns) { _, enabled in
            if !enabled { testMode.showMockWaitReport = false }
        }
        .onChange(of: testMode.uiEnabled) { _, enabled in
            if !enabled {
                testMode.showMockWaitReport = false
            }
            if !enabled, selectedTab == .log {
                selectedTab = .activities
            }
        }
    }

    @ViewBuilder
    private func tabPage<Content: View>(
        _ tab: AppTab,
        @ViewBuilder content: () -> Content
    ) -> some View {
        content()
            .opacity(selectedTab == tab ? 1 : 0)
            .allowsHitTesting(selectedTab == tab)
            .accessibilityHidden(selectedTab != tab)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var customTabBar: some View {
        HStack(spacing: 0) {
            ForEach(visibleTabs, id: \.self) { tab in
                Button {
                    select(tab)
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: tab.systemImage)
                            .font(.system(size: 18, weight: .semibold))
                        Text(tab.title)
                            .font(.caption2)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(selectedTab == tab ? Color.accentColor : Color.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                    .padding(.bottom, 6)
                    .modifier(TabShakeModifier(trigger: shakeTriggers[tab, default: 0]))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
            }
        }
        .background(
            Color(uiColor: .secondarySystemGroupedBackground)
                .ignoresSafeArea(edges: .bottom)
        )
        .overlay(alignment: .top) {
            Divider().opacity(0.5)
        }
    }

    private func select(_ tab: AppTab) {
        KeyboardObserver.dismiss()
        selectedTab = tab
        shakeTriggers[tab, default: 0] += 1
    }
}

/// Quick left-right rotation shake for tab icon + label.
private struct TabShakeModifier: ViewModifier {
    let trigger: Int
    @State private var angle: Double = 0

    func body(content: Content) -> some View {
        content
            .rotationEffect(.degrees(angle))
            .onChange(of: trigger) { _, _ in
                Task { @MainActor in
                    let kicks: [Double] = [12, -12, 9, -9, 5, -5, 0]
                    for kick in kicks {
                        withAnimation(.easeInOut(duration: 0.045)) {
                            angle = kick
                        }
                        try? await Task.sleep(nanoseconds: 45_000_000)
                    }
                }
            }
    }
}

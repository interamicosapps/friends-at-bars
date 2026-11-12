import SwiftUI
import UIKit

struct GamesHubView: View {
    @ObservedObject private var testMode = TestModeStore.shared
    @EnvironmentObject private var appModel: AppModel
    @State private var showSwitchSearch = false
    @State private var showRideTheBus = false
    @State private var showBoozed = false
    @State private var showMegaToe = false
    @State private var catalogGames: [CatalogGame] = []
    /// True after a successful `catalog_games` fetch this session (empty list is still success).
    @State private var catalogFetchSucceeded = false
    /// How far the scroll view is pulled past the bottom (rubber-band only).
    @State private var bottomOverscroll: CGFloat = 0

    private let overscrollFadeDistance: CGFloat = 48

    private var moreGamesOpacity: Double {
        Double(min(1, max(0, bottomOverscroll / overscrollFadeDistance)))
    }

    /// Production app → production CMS column.
    /// Test app → Test Mode on uses test column; Test Mode off uses production column.
    private var useTestGameFlags: Bool {
        testMode.uiEnabled && testMode.useMockCheckIns
    }

    private var filterLabel: String {
        useTestGameFlags ? "test" : "production"
    }

    private var sourceGames: [CatalogGame] {
        if catalogFetchSucceeded {
            return catalogGames
        }
        if !catalogGames.isEmpty {
            return catalogGames
        }
        return Self.fallbackGames
    }

    private var usingFallback: Bool {
        !catalogFetchSucceeded && catalogGames.isEmpty
    }

    private var visibleGames: [CatalogGame] {
        sourceGames.filter {
            useTestGameFlags ? $0.enabledInTest : $0.enabledInProduction
        }
    }

    private static let fallbackGames: [CatalogGame] = [
        CatalogGame(
            gameKey: "switch-search",
            title: "Switch Search",
            sortOrder: 10,
            enabledInTest: true,
            enabledInProduction: true,
            hasDetails: true
        ),
        CatalogGame(
            gameKey: "ride-the-bus",
            title: "Ride The Bus (beta)",
            sortOrder: 20,
            enabledInTest: true,
            enabledInProduction: true,
            hasDetails: false
        ),
        CatalogGame(
            gameKey: "boozed",
            title: "Boozed (beta)",
            sortOrder: 30,
            enabledInTest: true,
            enabledInProduction: true,
            hasDetails: false
        ),
        CatalogGame(
            gameKey: "mega-toe",
            title: "Megatoe",
            sortOrder: 40,
            enabledInTest: true,
            enabledInProduction: false,
            hasDetails: false
        ),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    ForEach(visibleGames) { game in
                        GameHubCard(
                            title: game.title,
                            imageName: Self.imageName(for: game.gameKey)
                        ) {
                            open(game.gameKey)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                // Opaque sheet so the peek label (drawn behind this content) cannot show through a card.
                .background(Color.black)
                // Anchors a UIKit probe inside the SwiftUI ScrollView so we can read real bounce offsets.
                .background {
                    GamesHubBottomOverscrollReader(bottomOverscroll: $bottomOverscroll)
                        .frame(width: 0, height: 0)
                }
            }
            .scrollContentBackground(.hidden)
            // Behind the scrolling cards, clipped to the rubber-band strip only.
            .background(alignment: .bottom) {
                Text("More Games to Come")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.55))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
                    .frame(height: bottomOverscroll, alignment: .center)
                    .clipped()
                    .opacity(moreGamesOpacity)
                    .allowsHitTesting(false)
                    .accessibilityHidden(moreGamesOpacity < 0.2)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Games")
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .task { await refreshGames(reason: "appear") }
            .onChange(of: testMode.useMockCheckIns) { _, on in
                DiagnosticLog.shared.append(
                    category: "system",
                    message: "Games filter → \(on && testMode.uiEnabled ? "test" : "production") (Test Mode mock=\(on))"
                )
                logGamesVisibility(reason: "test-mode-toggle")
            }
            .onChange(of: appModel.initialBootstrapFinished) { _, finished in
                if finished {
                    Task { await refreshGames(reason: "bootstrap") }
                }
            }
            .refreshable { await refreshGames(reason: "pull") }
            .fullScreenCover(isPresented: $showSwitchSearch) {
                SwitchSearchView()
            }
            .fullScreenCover(isPresented: $showRideTheBus) {
                RideTheBusView()
            }
            .fullScreenCover(isPresented: $showBoozed) {
                BoozedView()
            }
            .fullScreenCover(isPresented: $showMegaToe) {
                NavigationStack {
                    Text("Mega Toe — placeholder board. Port full rules from React in a follow-up.")
                        .padding()
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Close") { showMegaToe = false }
                            }
                        }
                }
            }
        }
    }

    private func refreshGames(reason: String) async {
        let ok = await CatalogStore.shared.refreshGames()
        let rows = await CatalogStore.shared.games
        await MainActor.run {
            catalogFetchSucceeded = ok || !rows.isEmpty
            if ok || !rows.isEmpty {
                catalogGames = rows
            }
            DiagnosticLog.shared.append(
                category: "system",
                message: """
                Games refresh[\(reason)] ok=\(ok) source=\(usingFallback ? "fallback" : "catalog") \
                rows=\(catalogGames.count) filter=\(filterLabel) shown=\(visibleGames.count)
                """
            )
            logGamesVisibility(reason: reason)
        }
    }

    private func logGamesVisibility(reason: String) {
        let source = usingFallback ? "fallback" : "catalog"
        let pool = sourceGames
        DiagnosticLog.shared.append(
            category: "system",
            message: "Games visibility[\(reason)] source=\(source) filter=\(filterLabel) pool=\(pool.count)"
        )
        for game in pool {
            let shown = useTestGameFlags ? game.enabledInTest : game.enabledInProduction
            let reasonText: String
            if shown {
                reasonText = "shown: \(filterLabel) flag on"
            } else if useTestGameFlags {
                reasonText = "hidden: enabled_in_test=false"
            } else {
                reasonText = "hidden: enabled_in_production=false"
            }
            DiagnosticLog.shared.append(
                category: "system",
                message: "Games \(game.gameKey) “\(game.title)” test=\(game.enabledInTest) prod=\(game.enabledInProduction) → \(reasonText)"
            )
        }
        if usingFallback {
            DiagnosticLog.shared.append(
                category: "system",
                message: "Games using offline fallback — CMS toggles may not match until catalog_games loads",
                level: "warn"
            )
        }
    }

    private func open(_ key: String) {
        switch key {
        case "switch-search": showSwitchSearch = true
        case "ride-the-bus": showRideTheBus = true
        case "boozed": showBoozed = true
        case "mega-toe": showMegaToe = true
        default: break
        }
    }

    private static func imageName(for key: String) -> String? {
        switch key {
        case "switch-search": return "SwitchSearchCardIcon"
        case "ride-the-bus": return "RideTheBusCardIcon"
        default: return nil
        }
    }
}

// MARK: - Bottom rubber-band “More Games” peek

/// Observes the enclosing `UIScrollView` content offset so rubber-band overscroll is tracked reliably.
private struct GamesHubBottomOverscrollReader: UIViewRepresentable {
    @Binding var bottomOverscroll: CGFloat

    func makeCoordinator() -> Coordinator {
        Coordinator(bottomOverscroll: $bottomOverscroll)
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.binding = $bottomOverscroll
        context.coordinator.attach(from: uiView)
    }

    final class Coordinator {
        var binding: Binding<CGFloat>
        private weak var scrollView: UIScrollView?
        private var offsetObservation: NSKeyValueObservation?
        private var sizeObservation: NSKeyValueObservation?
        private var insetObservation: NSKeyValueObservation?

        init(bottomOverscroll: Binding<CGFloat>) {
            binding = bottomOverscroll
        }

        func attach(from view: UIView, attempt: Int = 0) {
            // Scroll view is only in the hierarchy after SwiftUI finishes embedding.
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view else { return }
                guard let found = view.bf_enclosingScrollView() else {
                    if attempt < 12 {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self, weak view] in
                            guard let self, let view else { return }
                            self.attach(from: view, attempt: attempt + 1)
                        }
                    }
                    return
                }
                if scrollView === found { return }
                detach()
                scrollView = found
                observe(found)
                publishOverscroll(from: found)
            }
        }

        private func observe(_ scrollView: UIScrollView) {
            offsetObservation = scrollView.observe(\.contentOffset, options: [.new]) { [weak self] sv, _ in
                self?.publishOverscroll(from: sv)
            }
            sizeObservation = scrollView.observe(\.contentSize, options: [.new]) { [weak self] sv, _ in
                self?.publishOverscroll(from: sv)
            }
            insetObservation = scrollView.observe(\.contentInset, options: [.new]) { [weak self] sv, _ in
                self?.publishOverscroll(from: sv)
            }
        }

        private func publishOverscroll(from scrollView: UIScrollView) {
            let next = Self.bottomOverscroll(in: scrollView)
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                if abs(self.binding.wrappedValue - next) > 0.5 || (next == 0 && self.binding.wrappedValue != 0) {
                    self.binding.wrappedValue = next
                }
            }
        }

        private static func bottomOverscroll(in scrollView: UIScrollView) -> CGFloat {
            let inset = scrollView.adjustedContentInset
            let bottomRestOffset = max(
                -inset.top,
                scrollView.contentSize.height - scrollView.bounds.height + inset.bottom
            )
            return max(0, scrollView.contentOffset.y - bottomRestOffset)
        }

        private func detach() {
            offsetObservation?.invalidate()
            sizeObservation?.invalidate()
            insetObservation?.invalidate()
            offsetObservation = nil
            sizeObservation = nil
            insetObservation = nil
            scrollView = nil
        }

        deinit {
            detach()
        }
    }
}

private extension UIView {
    func bf_enclosingScrollView() -> UIScrollView? {
        var node: UIView? = self
        while let current = node {
            if let scroll = current as? UIScrollView {
                return scroll
            }
            node = current.superview
        }
        return nil
    }
}

/// Tappable game card — square preview on top, title bar underneath (taller rectangle overall).
private struct GameHubCard: View {
    let title: String
    let imageName: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            GameHubCardLabel(title: title, imageName: imageName)
        }
        .buttonStyle(.plain)
    }
}

private struct GameHubCardLabel: View {
    let title: String
    let imageName: String?

    private let cornerRadius: CGFloat = 22

    var body: some View {
        VStack(spacing: 0) {
            // Square image slot: full asset visible (letterboxed if not square). Title sits below — not overlaid.
            ZStack {
                Color.black
                if let imageName {
                    Image(imageName)
                        .resizable()
                        .scaledToFit()
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(1, contentMode: .fit)
            .clipped()

            Text(title)
                .font(.title3.bold())
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .padding(.horizontal, 12)
                .background(Color.black)
        }
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

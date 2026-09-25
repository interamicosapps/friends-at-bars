import SwiftUI

struct GamesHubView: View {
    @ObservedObject private var testMode = TestModeStore.shared
    @State private var showSwitchSearch = false
    @State private var showRideTheBus = false
    @State private var scrollContentFrame: CGRect = .zero
    @State private var scrollViewportHeight: CGFloat = 0

    /// How far the scroll view is pulled past the bottom (rubber-band only).
    private var bottomOverscroll: CGFloat {
        guard scrollViewportHeight > 0, scrollContentFrame.height > 0 else { return 0 }
        let maxScroll = max(0, scrollContentFrame.height - scrollViewportHeight)
        let scrolled = -scrollContentFrame.minY
        return max(0, scrolled - maxScroll)
    }

    private let overscrollFadeDistance: CGFloat = 48

    private var moreGamesOpacity: Double {
        Double(min(1, max(0, bottomOverscroll / overscrollFadeDistance)))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    GameHubCard(
                        title: "Switch Search",
                        imageName: "SwitchSearchCardIcon"
                    ) {
                        showSwitchSearch = true
                    }

                    GameHubCard(
                        title: "Ride The Bus beta",
                        imageName: nil
                    ) {
                        showRideTheBus = true
                    }

                    if testMode.uiEnabled {
                        NavigationLink {
                            Text("Mega Toe — placeholder board. Port full rules from React in a follow-up.")
                                .padding()
                        } label: {
                            GameHubCardLabel(
                                title: "Megatoe",
                                imageName: nil
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background {
                    GeometryReader { contentGeo in
                        Color.clear.preference(
                            key: GamesHubScrollContentFrameKey.self,
                            value: contentGeo.frame(in: .named("gameHubScroll"))
                        )
                    }
                }
            }
            .coordinateSpace(name: "gameHubScroll")
            .background {
                GeometryReader { viewportGeo in
                    Color.clear.preference(
                        key: GamesHubScrollViewportHeightKey.self,
                        value: viewportGeo.size.height
                    )
                }
            }
            .onPreferenceChange(GamesHubScrollContentFrameKey.self) { scrollContentFrame = $0 }
            .onPreferenceChange(GamesHubScrollViewportHeightKey.self) { scrollViewportHeight = $0 }
            .overlay(alignment: .bottom) {
                Text("More Games to Come")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.55))
                    .padding(.bottom, 28)
                    .opacity(moreGamesOpacity)
                    .offset(y: max(0, 18 - bottomOverscroll * 0.25))
                    .allowsHitTesting(false)
                    .accessibilityHidden(moreGamesOpacity < 0.2)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Games")
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .fullScreenCover(isPresented: $showSwitchSearch) {
                SwitchSearchView()
            }
            .fullScreenCover(isPresented: $showRideTheBus) {
                RideTheBusView()
            }
        }
    }
}

// MARK: - Bottom rubber-band “More Games” peek

private struct GamesHubScrollContentFrameKey: PreferenceKey {
    static var defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        value = nextValue()
    }
}

private struct GamesHubScrollViewportHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
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

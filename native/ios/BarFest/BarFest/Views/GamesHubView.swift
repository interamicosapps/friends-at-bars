import SwiftUI
import UIKit

struct GamesHubView: View {
    @ObservedObject private var testMode = TestModeStore.shared
    @State private var showSwitchSearch = false
    @State private var showRideTheBus = false
    /// How far the scroll view is pulled past the bottom (rubber-band only).
    @State private var bottomOverscroll: CGFloat = 0

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
                        title: "Ride The Bus (beta)",
                        imageName: "RideTheBusCardIcon"
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

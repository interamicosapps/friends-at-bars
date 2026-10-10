import SwiftUI

/// Shared privacy footnote under Allow Location CTAs.
enum LocationPrivacyCopy {
    static let underButton =
        "Your personal location is never shared, sold, or otherwise shown to anyone."
}

/// Persistent Activities reminder while location is While Using. Does not block the list.
struct AlwaysLocationHint: View {
    @ObservedObject private var auth = LocationAuthorizationStore.shared

    var body: some View {
        if auth.needsAlwaysUpgrade {
            VStack(alignment: .leading, spacing: 8) {
                Text("Set Location to Always to be counted at the bar, including after you leave the app.")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)

                Button {
                    auth.openLocationSettings()
                } label: {
                    Text("Settings")
                        .font(.caption.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(Color.white.opacity(0.14))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(0.08))
            )
        }
    }
}

/// Full-screen style prompt for Map.
struct LocationAllowOverlay: View {
    @ObservedObject private var auth = LocationAuthorizationStore.shared

    var body: some View {
        if !auth.canUseLocation {
            ZStack {
                Color.black.opacity(0.72).ignoresSafeArea()
                VStack(spacing: 16) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 40))

                    Text("See where the night is happening.")
                        .font(.title2.bold())
                        .multilineTextAlignment(.center)

                    Text("Enable location services to view a heat map of popular bars around you!")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    Button {
                        auth.requestAllowLocation()
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
    }
}

/// Horizontal chip row that cannot scroll vertically (fixes Deals filter rubber-band).
struct HorizontalChipScroll<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                content()
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(height: 34)
        .clipped()
    }
}

/// Inline Activity gate — replaces bar list when location is off.
struct ActivitiesLocationInlineGate: View {
    var body: some View {
        LocationInlineGate(
            systemImage: "map.fill",
            title: "Who Wants to Guess Which Bars are Popular?",
            subtitleAlways: "Always allow location to see real headcounts at bars near you and add yourself to the count.",
            subtitleEnable: "Enable Location to see real headcounts at bars near you and add yourself to the count.",
            cta: "Show Me What's Busy"
        )
    }
}

/// Inline Chat gate — replaces the feed when location is off.
struct ChatLocationInlineGate: View {
    var onAllow: (() -> Void)?

    var body: some View {
        LocationInlineGate(
            systemImage: "bubble.left.and.bubble.right.fill",
            title: "Be a Part of The Conversation",
            subtitleAlways: "Enable Location to Chat With Others",
            subtitleEnable: "Enable Location to Chat With Others",
            cta: "Start Chatting!",
            onAllow: onAllow
        )
    }
}

/// Shared full-card location prompt (Activities / Chat).
struct LocationInlineGate: View {
    var systemImage: String
    var title: String
    var subtitleAlways: String
    var subtitleEnable: String
    var cta: String
    var onAllow: (() -> Void)?

    @ObservedObject private var auth = LocationAuthorizationStore.shared

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: systemImage)
                .font(.system(size: 44))
                .foregroundStyle(.white.opacity(0.9))
                .symbolRenderingMode(.hierarchical)

            Text(title)
                .font(.title3.bold())
                .multilineTextAlignment(.center)
                .padding(.horizontal, 8)

            Text(auth.needsAlwaysUpgrade ? subtitleAlways : subtitleEnable)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 8)

            Button {
                if let onAllow {
                    onAllow()
                } else {
                    auth.requestAllowLocation()
                }
            } label: {
                Text(cta)
                    .font(.headline)
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 24)

            Text(LocationPrivacyCopy.underButton)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .padding(.horizontal, 12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(uiColor: .secondarySystemGroupedBackground))
        )
    }
}

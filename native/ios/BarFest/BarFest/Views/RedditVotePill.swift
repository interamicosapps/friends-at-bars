import SwiftUI

/// Horizontal Reddit-style vote control: ▲ score | ▼ inside a pill.
struct RedditVotePill: View {
    let score: Int
    let myVote: Int?
    let disabled: Bool
    var onLightBackground: Bool = false
    let onUp: () -> Void
    let onDown: () -> Void

    private var positiveTint: Color { Color(red: 0.2, green: 0.55, blue: 0.3) }
    private var negativeTint: Color { Color(red: 0.75, green: 0.2, blue: 0.2) }

    private var upTint: Color {
        if myVote == 1 { return positiveTint }
        return onLightBackground ? Color.black.opacity(0.45) : .secondary
    }

    private var downTint: Color {
        if myVote == -1 { return negativeTint }
        return onLightBackground ? Color.black.opacity(0.45) : .secondary
    }

    private var scoreTint: Color {
        if score > 0 { return positiveTint }
        if score < 0 { return negativeTint }
        return onLightBackground ? .black : .primary
    }

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onUp) {
                Image(systemName: myVote == 1 ? "arrow.up" : "arrow.up")
                    .font(.system(size: 14, weight: myVote == 1 ? .black : .semibold))
                    .foregroundStyle(upTint)
                    .frame(width: 32, height: 28)
            }
            .buttonStyle(.plain)
            .disabled(disabled)

            Text("\(score)")
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundStyle(scoreTint)
                .frame(minWidth: 24)

            Divider()
                .frame(height: 18)
                .overlay(onLightBackground ? Color.black.opacity(0.15) : Color.white.opacity(0.2))

            Button(action: onDown) {
                Image(systemName: "arrow.down")
                    .font(.system(size: 14, weight: myVote == -1 ? .black : .semibold))
                    .foregroundStyle(downTint)
                    .frame(width: 32, height: 28)
            }
            .buttonStyle(.plain)
            .disabled(disabled)
        }
        .padding(.horizontal, 4)
        .background(onLightBackground ? Color.black.opacity(0.06) : Color.white.opacity(0.08))
        .overlay(
            Capsule()
                .strokeBorder(
                    onLightBackground ? Color.black.opacity(0.12) : Color.white.opacity(0.18),
                    lineWidth: 1
                )
        )
        .clipShape(Capsule())
    }
}

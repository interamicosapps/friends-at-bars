import MapKit
import SwiftUI

/// Sheet shown when a user taps a bar on Activities — today’s deals/events + Directions.
struct VenueBarSheet: View {
    let venue: CatalogVenue
    let listings: [CatalogListing]
    var waitSummary: WaitTimeSummary = .none
    var geographyId: UUID? = nil
    var onReport: ((CatalogFeedbackContext) -> Void)? = nil
    @State private var index = 0
    private let rotateSeconds: TimeInterval = 4

    private var current: CatalogListing? {
        guard !listings.isEmpty else { return nil }
        return listings[index % listings.count]
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(venue.name)
                        .font(.title2.bold())
                    if !venue.area.isEmpty {
                        Text(venue.area)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    WaitTimeLabel(summary: waitSummary)
                }

                if listings.isEmpty {
                    Text("No deals or events for today")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 24)
                } else if let item = current {
                    dealCard(item)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            guard listings.count > 1 else { return }
                            withAnimation {
                                index = (index + 1) % listings.count
                            }
                        }
                        .task(id: listings.count) {
                            guard listings.count > 1 else { return }
                            while !Task.isCancelled {
                                try? await Task.sleep(nanoseconds: UInt64(rotateSeconds * 1_000_000_000))
                                guard !Task.isCancelled, listings.count > 1 else { break }
                                withAnimation(.easeInOut(duration: 0.25)) {
                                    index = (index + 1) % listings.count
                                }
                            }
                        }
                }

                Spacer(minLength: 0)

                Button {
                    openDirections()
                } label: {
                    Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)

                if onReport != nil {
                    Button {
                        let item = current
                        onReport?(
                            CatalogFeedbackContext(
                                category: item == nil ? .missingDeal : .outdatedListing,
                                venueName: venue.name,
                                listingId: item?.id,
                                listingTitle: item?.title.isEmpty == false
                                    ? item?.title
                                    : item?.venue_name,
                                sourceScreen: "venue-sheet",
                                geographyId: geographyId
                            )
                        )
                    } label: {
                        Text("Report")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { index = 0 }
            .onChange(of: listings.map(\.id)) { _, _ in index = 0 }
        }
    }

    private func dealCard(_ item: CatalogListing) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(carouselLabel(for: item.type_labels))
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color(red: 0.85, green: 0.72, blue: 0.45))
                        .tracking(0.6)
                    HStack(spacing: 6) {
                        ForEach(item.type_labels, id: \.self) { label in
                            Text(label)
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(badgeColor(for: label).opacity(0.25))
                                .foregroundStyle(badgeColor(for: label))
                                .clipShape(Capsule())
                        }
                    }
                }
                Spacer(minLength: 8)
                if listings.count > 1 {
                    HStack(spacing: 5) {
                        ForEach(0 ..< listings.count, id: \.self) { i in
                            Circle()
                                .fill(i == index ? Color(red: 0.78, green: 0.62, blue: 0.35) : Color.white.opacity(0.25))
                                .frame(width: 6, height: 6)
                        }
                    }
                }
            }

            if !item.title.isEmpty {
                Text(item.title)
                    .font(.title3.bold())
                    .foregroundStyle(.white)
            }
            if let when = dayTimeLabel(item), !when.isEmpty {
                Text(when)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white.opacity(0.7))
            }
            if !item.details.isEmpty {
                Text(item.details)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.9))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color(red: 0.18, green: 0.16, blue: 0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(Color(red: 0.45, green: 0.38, blue: 0.22).opacity(0.6), lineWidth: 1)
                )
        )
    }

    private func carouselLabel(for labels: [String]) -> String {
        if labels.contains(where: { $0.localizedCaseInsensitiveContains("event") }) {
            return "BAR EVENT"
        }
        return "BAR DEAL"
    }

    private func badgeColor(for label: String) -> Color {
        if label.localizedCaseInsensitiveContains("event") { return .purple }
        return Color(red: 0.9, green: 0.75, blue: 0.35)
    }

    private func dayTimeLabel(_ item: CatalogListing) -> String? {
        let map = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        let days = item.days_of_week.sorted()
        let dayPart: String
        if days.count == 1, let d = days.first, (0 ..< map.count).contains(d) {
            dayPart = map[d]
        } else if days.isEmpty {
            dayPart = ""
        } else {
            let short = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            dayPart = days.compactMap { (0 ..< short.count).contains($0) ? short[$0] : nil }.joined(separator: ", ")
        }
        let time = item.time_label.trimmingCharacters(in: .whitespacesAndNewlines)
        if dayPart.isEmpty && time.isEmpty { return nil }
        if dayPart.isEmpty { return time }
        if time.isEmpty { return dayPart }
        return "\(dayPart)  \(time)"
    }

    private func openDirections() {
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
            message: "Activities Directions → \(venue.name)"
        )
    }
}

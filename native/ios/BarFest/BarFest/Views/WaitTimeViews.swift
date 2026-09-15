import SwiftUI

struct WaitTimeLabel: View {
    let summary: WaitTimeSummary
    /// Activities rows stay clean when nobody has reported; detail popups keep the copy.
    var hidesWhenEmpty = false

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 60)) { _ in
            if summary.mode == .none && hidesWhenEmpty {
                EmptyView()
            } else {
                Text(summary.displayText)
                    .font(.caption2)
                    .foregroundStyle(summary.mode == .none ? .tertiary : .secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
        }
    }
}

struct WaitTimeBucketPicker: View {
    let selectedMinutes: Int?
    let isSubmitting: Bool
    let onSelect: (Int) -> Void

    var body: some View {
        HStack(spacing: 8) {
            ForEach(WaitTimeBucket.allCases) { bucket in
                Button {
                    onSelect(bucket.rawValue)
                } label: {
                    Text(bucket.shortLabel)
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(selectedMinutes == bucket.rawValue
                                      ? Color.accentColor
                                      : Color.white.opacity(0.1))
                        )
                        .foregroundStyle(selectedMinutes == bucket.rawValue ? .white : .primary)
                }
                .buttonStyle(.plain)
                .disabled(isSubmitting)
            }
        }
    }
}

/// Centered check-in card shown when the user is near a bar (Activities overlay).
struct WaitTimeCheckInPopup: View {
    let venueNames: [String]
    @Binding var selectedVenueName: String
    let selectedMinutes: Int?
    let isSubmitting: Bool
    let errorMessage: String?
    let onSelect: (Int) -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Check In")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.accentColor)
                        .tracking(0.5)
                    venueTitle
                    Text("Report your wait time or projected wait")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if selectedMinutes != nil {
                        Text("Tap another time to update your report")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                Spacer(minLength: 8)
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(6)
                }
                .buttonStyle(.plain)
            }

            WaitTimeBucketPicker(
                selectedMinutes: selectedMinutes,
                isSubmitting: isSubmitting,
                onSelect: onSelect
            )

            if isSubmitting {
                ProgressView()
                    .frame(maxWidth: .infinity)
            }

            if let errorMessage, !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(uiColor: .secondarySystemGroupedBackground))
                .shadow(color: .black.opacity(0.35), radius: 12, y: 4)
        )
        .padding(.horizontal, 20)
    }

    @ViewBuilder
    private var venueTitle: some View {
        if venueNames.count > 1 {
            Menu {
                ForEach(venueNames, id: \.self) { name in
                    Button {
                        selectedVenueName = name
                    } label: {
                        HStack {
                            Text(name)
                            if name == selectedVenueName {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(selectedVenueName)
                        .font(.title3.bold())
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white.opacity(0.7))
                }
            }
            .tint(.white)
        } else {
            Text(selectedVenueName)
                .font(.title3.bold())
                .foregroundStyle(.white)
        }
    }
}

/// Test Mode: same check-in card users see at a bar, with a bar picker for any mock venue.
struct MockWaitReportOverlay: View {
    @EnvironmentObject private var appModel: AppModel
    @Binding var isPresented: Bool
    @State private var selectedVenue: CatalogVenue?
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var venues: [CatalogVenue] {
        appModel.scopedVenues
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.45)
                .ignoresSafeArea()
                .onTapGesture { dismiss() }

            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Mock Check In")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.cyan)
                            .tracking(0.5)
                        venueMenu
                        Text("Report your wait time or projected wait")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let venue = selectedVenue, appModel.myWaitMinutes(for: venue.name) != nil {
                            Text("Tap another time to update your report")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                    Spacer(minLength: 8)
                    Button(action: dismiss) {
                        Image(systemName: "xmark")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(6)
                    }
                    .buttonStyle(.plain)
                }

                WaitTimeBucketPicker(
                    selectedMinutes: selectedVenue.flatMap { appModel.myWaitMinutes(for: $0.name) },
                    isSubmitting: isSubmitting || selectedVenue == nil,
                    onSelect: { minutes in
                        guard let venue = selectedVenue else { return }
                        Task { await submit(venue: venue, minutes: minutes) }
                    }
                )

                if isSubmitting {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                }

                if let errorMessage, !errorMessage.isEmpty {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            .padding(18)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color(uiColor: .secondarySystemGroupedBackground))
                    .shadow(color: .black.opacity(0.35), radius: 12, y: 4)
            )
            .padding(.horizontal, 20)
        }
        .onAppear {
            if selectedVenue == nil {
                selectedVenue = venues.first { $0.name == appModel.lastVenueName } ?? venues.first
            }
        }
    }

    private var venueMenu: some View {
        Menu {
            ForEach(venues) { venue in
                Button {
                    selectedVenue = venue
                    errorMessage = nil
                } label: {
                    Text(venue.name)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(selectedVenue?.name ?? "Choose a bar")
                    .font(.title3.bold())
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .tint(.white)
        .disabled(isSubmitting)
    }

    private func dismiss() {
        isPresented = false
        errorMessage = nil
    }

    private func submit(venue: CatalogVenue, minutes: Int) async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            try await appModel.submitWaitReport(
                venueName: venue.name,
                waitMinutes: minutes,
                isMock: true
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

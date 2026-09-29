import SwiftUI

/// Quick tip sheet: missing bar/deal, outdated listing, or other catalog feedback.
struct CatalogFeedbackSheet: View {
    let context: CatalogFeedbackContext
    @Environment(\.dismiss) private var dismiss

    @State private var category: CatalogFeedbackCategory
    @State private var message = ""
    @State private var venueName: String
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var didSend = false

    init(context: CatalogFeedbackContext) {
        self.context = context
        _category = State(initialValue: context.category ?? .missingBar)
        _venueName = State(initialValue: context.venueName ?? "")
    }

    private var canSubmit: Bool {
        let note = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = venueName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !note.isEmpty, note.count <= 500 else { return false }
        if context.prompt == .missingBar, name.isEmpty { return false }
        return true
    }

    private var navigationTitle: String {
        switch context.prompt {
        case .missingBar: return "Missing bar"
        case .missingDeal: return "Missing deal"
        case .reportedDeal: return "Report deal"
        case .reportedBar: return "Report bar"
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if didSend {
                    Section {
                        Text("Thanks — we got your tip. Editors review these in the CMS.")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    switch context.prompt {
                    case .reportedDeal:
                        detailsSection
                    case .missingBar:
                        barNameSection
                        detailsSection
                    case .missingDeal:
                        barNameSection
                        detailsSection
                    case .reportedBar:
                        Section("What’s wrong?") {
                            ForEach(CatalogFeedbackCategory.barReportCases) { item in
                                Button {
                                    category = item
                                } label: {
                                    HStack {
                                        Text(item.title)
                                            .foregroundStyle(.primary)
                                        Spacer()
                                        if category == item {
                                            Image(systemName: "checkmark.circle.fill")
                                                .foregroundStyle(Color.accentColor)
                                        }
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        detailsSection
                    }

                    if let errorMessage {
                        Section {
                            Text(errorMessage)
                                .foregroundStyle(.red)
                                .font(.footnote)
                        }
                    }
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(didSend ? "Done" : "Cancel") { dismiss() }
                }
                if !didSend {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Send") { Task { await submit() } }
                            .disabled(!canSubmit)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var barNameSection: some View {
        Section("Bar Name") {
            TextField("e.g. Fourth Street Taproom", text: $venueName)
                .textInputAutocapitalization(.words)
        }
    }

    private var detailsSection: some View {
        Section("Details") {
            TextField(
                "What’s missing or wrong?",
                text: $message,
                axis: .vertical
            )
            .lineLimit(3 ... 6)
            Text("\(message.count)/500")
                .font(.caption2)
                .foregroundStyle(message.count > 500 ? .red : .secondary)
        }
    }

    private func submit() async {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 500 else { return }
        busy = true
        errorMessage = nil
        defer { busy = false }

        var payload = context
        payload.category = category
        let name = venueName.trimmingCharacters(in: .whitespacesAndNewlines)
        payload.venueName = name.isEmpty ? context.venueName : name

        do {
            try await CatalogFeedbackService.submit(
                category: category,
                message: trimmed,
                context: payload
            )
            didSend = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Compact text button used under lists / empty states.
struct CatalogFeedbackLinkButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

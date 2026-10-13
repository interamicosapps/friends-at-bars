import SwiftUI

struct ChatView: View {
    @EnvironmentObject private var appModel: AppModel
    @ObservedObject private var testMode = TestModeStore.shared
    @ObservedObject private var localChat = TestChatStore.shared
    @ObservedObject private var locationAuth = LocationAuthorizationStore.shared
    @ObservedObject private var avatarStore = ChatAvatarStore.shared

    @State private var posts: [ChatPost] = []
    @State private var sort = "recent"
    @State private var draft = ""
    @State private var error: String?
    @State private var selectMode = false
    @State private var selectedIds: Set<UUID> = []
    @State private var showSoftHidden = false
    @State private var draggingId: UUID?
    @State private var dragTranslation: CGFloat = 0
    @State private var rowHeights: [UUID: CGFloat] = [:]
    @State private var suppressSelectUntil = Date.distantPast
    @State private var avatarPickerTarget: ChatAvatarPickerTarget?
    @FocusState private var composerFocused: Bool
    @State private var regionWarningFlash = false

    private var useLocal: Bool { testMode.uiEnabled && testMode.useMockCheckIns }
    private var remaining: Int { AppConfig.maxChatChars - draft.count }
    private var overCharLimit: Bool { remaining < 0 }

    private var venueOptions: [CatalogVenue] {
        appModel.scopedVenues.sorted {
            if $0.area != $1.area { return $0.area < $1.area }
            return $0.name < $1.name
        }
    }

    /// Production: When In Use or Always. Test local: simulateLocationAllowed.
    private var needLocationGate: Bool {
        if useLocal { return !testMode.simulateLocationAllowed }
        return !locationAuth.canUseChatLocation
    }

    private var viewedGeography: CatalogGeography? {
        appModel.resolvedGeography
    }

    /// User GPS must be inside the geography they are viewing to send.
    private var canSendInViewedGeography: Bool {
        if useLocal && testMode.simulateLocationAllowed { return true }
        guard let viewed = viewedGeography, let gps = appModel.gpsGeography else { return false }
        return viewed.id == gps.id
    }

    private var sendVenueName: String? {
        if useLocal {
            let v = localChat.simulatedVenueName.trimmingCharacters(in: .whitespacesAndNewlines)
            return v.isEmpty ? nil : v
        }
        if let venue = appModel.lastVenueName {
            return venue
        }
        guard let coord = appModel.lastKnownCoordinate else { return nil }
        var best: (name: String, distance: Double)?
        for venue in appModel.scopedVenues {
            let meters = GeographyResolver.haversineMeters(
                lat1: coord.latitude,
                lon1: coord.longitude,
                lat2: venue.latitude,
                lon2: venue.longitude
            )
            guard meters <= Double(venue.radius_m) else { continue }
            if best == nil || meters < best!.distance {
                best = (venue.name, meters)
            }
        }
        return best?.name
    }

    private var regionGateMessage: String {
        let name = viewedGeography?.name ?? "this"
        return "Must be located within \(name) region to send chat"
    }

    private var canReorder: Bool {
        useLocal && selectMode && sort == "recent"
    }

    private var displayedPosts: [ChatPost] {
        let feed = useLocal
            ? localChat.feed(sort: sort, includeHidden: selectMode && showSoftHidden)
            : posts
        guard let geoId = viewedGeography?.id else { return [] }
        let venueNames = Set(appModel.scopedVenues.map(\.name))
        return feed.filter { post in
            if let postGeo = post.geography_id {
                return postGeo == geoId
            }
            if post.venue_name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return false
            }
            return venueNames.contains(post.venue_name)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if needLocationGate {
                    if useLocal {
                        HStack {
                            Spacer()
                            Button {
                                testMode.simulateLocationAllowed.toggle()
                                DiagnosticLog.shared.append(
                                    category: "chat",
                                    message: "Simulate location allowed=\(testMode.simulateLocationAllowed)"
                                )
                            } label: {
                                Image(systemName: testMode.simulateLocationAllowed
                                      ? "location.fill"
                                      : "location.slash")
                            }
                            .padding()
                        }
                    }
                    Spacer(minLength: 24)
                    ChatLocationInlineGate {
                        if useLocal {
                            testMode.simulateLocationAllowed = true
                        } else {
                            locationAuth.requestChatLocation()
                            startChatLocationIfNeeded()
                        }
                    }
                    .padding(.horizontal)
                    Spacer()
                } else {
                    if useLocal {
                    HStack {
                        Picker("Sort", selection: $sort) {
                            Text("Recent").tag("recent")
                            Text("Popular").tag("popular")
                        }
                        .pickerStyle(.segmented)

                        Button {
                            testMode.simulateLocationAllowed.toggle()
                            DiagnosticLog.shared.append(
                                category: "chat",
                                message: "Simulate location allowed=\(testMode.simulateLocationAllowed)"
                            )
                        } label: {
                            Image(systemName: testMode.simulateLocationAllowed
                                  ? "location.fill"
                                  : "location.slash")
                        }

                        Button {
                            if selectMode {
                                exitSelectMode()
                            } else {
                                selectMode = true
                            }
                        } label: {
                            Image(systemName: selectMode ? "xmark" : "list.bullet")
                        }
                        .accessibilityLabel(selectMode ? "Exit select mode" : "Select messages")
                    }
                    .padding()
                    .dismissKeyboardOnTap()
                    .onChange(of: sort) { _, _ in
                        composerFocused = false
                        cancelDrag()
                        Task { await load() }
                    }
                    } else {
                    HStack(spacing: 12) {
                        Button {
                            avatarPickerTarget = .own
                        } label: {
                            ChatAvatarBadge(selection: avatarStore.selection, size: 32)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Change chat icon")

                        Picker("Sort", selection: $sort) {
                            Text("Recent").tag("recent")
                            Text("Popular").tag("popular")
                        }
                        .pickerStyle(.segmented)
                    }
                    .padding(.horizontal)
                    .padding(.top, 6)
                    .padding(.bottom, 8)
                    .dismissKeyboardOnTap()
                    .onChange(of: sort) { _, _ in
                        composerFocused = false
                        Task { await load() }
                    }
                    }

                    if selectMode && useLocal {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("\(selectedIds.count) selected")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Button {
                                    showSoftHidden.toggle()
                                } label: {
                                    Image(systemName: showSoftHidden ? "eye" : "eye.slash")
                                }
                                .accessibilityLabel(
                                    showSoftHidden
                                        ? "Hide soft-hidden chats"
                                        : "Show soft-hidden chats"
                                )
                                .foregroundStyle(showSoftHidden ? Color.accentColor : Color.secondary)
                                Button {
                                    localChat.nudgeScore(
                                        postIds: Array(selectedIds),
                                        direction: "up"
                                    )
                                } label: {
                                    Image(systemName: "chevron.up")
                                }
                                .disabled(selectedIds.isEmpty)
                                .accessibilityLabel("Add upvote to selected")
                                Button {
                                    localChat.nudgeScore(
                                        postIds: Array(selectedIds),
                                        direction: "down"
                                    )
                                } label: {
                                    Image(systemName: "chevron.down")
                                }
                                .disabled(selectedIds.isEmpty)
                                .accessibilityLabel("Add downvote to selected")
                                Button(role: .destructive) {
                                    let ids = Array(selectedIds)
                                    localChat.hide(postIds: ids)
                                    selectedIds.subtract(ids)
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .disabled(selectedIds.isEmpty)
                                .accessibilityLabel("Delete selected")
                            }
                            if canReorder, displayedPosts.count > 1 {
                                Text("Hold and drag to reorder")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal)
                        .padding(.bottom, 8)
                    }

                    if useLocal && !selectMode {
                        Text("Local test feed")
                            .font(.caption2)
                            .foregroundStyle(.cyan)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal)
                            .padding(.bottom, 4)
                    }

                    if useLocal && selectMode {
                        selectModeList
                    } else {
                        List {
                            ForEach(displayedPosts) { post in
                                chatRow(post)
                            }
                        }
                        .listStyle(.plain)
                        .scrollDismissesKeyboard(.interactively)
                        .dismissKeyboardOnTap()
                    }

                    if let error {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .padding(.horizontal)
                    }

                    composer
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(needLocationGate || useLocal ? .automatic : .hidden, for: .navigationBar)
            .toolbar {
                if !needLocationGate && useLocal {
                    ToolbarItem(placement: .topBarLeading) {
                        HStack(spacing: 8) {
                            Button {
                                avatarPickerTarget = .own
                            } label: {
                                ChatAvatarBadge(selection: avatarStore.selection, size: 32)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Change chat icon")

                            if useLocal {
                                Button {
                                    avatarPickerTarget = .otherUser
                                } label: {
                                    ChatAvatarBadge(selection: avatarStore.otherSelection, size: 32)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Change other user chat icon")
                            }
                        }
                    }
                    if useLocal {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Clear local") {
                                localChat.clearAll()
                                exitSelectMode()
                            }
                            .font(.caption)
                        }
                    }
                }
            }
            .sheet(item: $avatarPickerTarget) { target in
                ChatAvatarPickerSheet(target: target)
            }
            .task {
                await load()
                startChatLocationIfNeeded()
                if useLocal, !venueOptions.isEmpty {
                    let names = Set(venueOptions.map(\.name))
                    // An empty selection represents a geography-only post.
                    if !localChat.simulatedVenueName.isEmpty
                        && !names.contains(localChat.simulatedVenueName) {
                        localChat.simulatedVenueName =
                            venueOptions.first(where: { $0.name == "Test Location 1" })?.name
                            ?? venueOptions[0].name
                    }
                }
            }
            .onDisappear {
                ChatLocationReader.shared.stop()
            }
            .refreshable { await load() }
            .onChange(of: testMode.useMockCheckIns) { _, _ in
                exitSelectMode()
                Task { await load() }
            }
            .onChange(of: locationAuth.canUseChatLocation) { _, _ in
                startChatLocationIfNeeded()
                Task { await load() }
            }
            .onChange(of: testMode.simulateLocationAllowed) { _, _ in
                Task { await load() }
            }
            .onChange(of: localChat.posts.count) { _, _ in
                if useLocal { posts = localChat.feed(sort: sort) }
            }
            .onChange(of: appModel.resolvedGeography?.id) { _, _ in
                if !localChat.simulatedVenueName.isEmpty
                    && !venueOptions.contains(where: { $0.name == localChat.simulatedVenueName }) {
                    localChat.simulatedVenueName = venueOptions.first?.name ?? ""
                }
                Task { await load() }
            }
        }
    }

    @ViewBuilder
    private func chatRow(_ post: ChatPost) -> some View {
        let isOwn = post.author_id == AnonymousIdentity.userId()
        let avatar = ChatAvatarResolver.selection(
            for: post,
            preference: avatarStore.selection,
            otherPreference: avatarStore.otherSelection
        )
        let bodyColor: Color = isOwn ? .black : .white
        let metaColor: Color = isOwn ? Color.black.opacity(0.45) : Color.secondary
        let rowBg: Color = isOwn ? .white : Color.clear

        HStack(alignment: .top, spacing: 10) {
            if selectMode && useLocal {
                Image(systemName: selectedIds.contains(post.id) ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selectedIds.contains(post.id) ? Color.accentColor : .secondary)
                    .onTapGesture { toggleSelect(post.id) }
            }

            ChatAvatarBadge(selection: avatar, size: 36)

            VStack(alignment: .leading, spacing: 8) {
                Text(post.body)
                    .font(.body)
                    .foregroundStyle(bodyColor)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(alignment: .center, spacing: 8) {
                    HStack(spacing: 6) {
                        let venueLabel = post.venue_name.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !venueLabel.isEmpty {
                            Text(venueLabel)
                                .font(.caption)
                                .foregroundStyle(metaColor)
                        }
                        if post.is_hidden {
                            Text("Hidden")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(isOwn ? Color.black.opacity(0.55) : Color.orange)
                        }
                    }
                    Spacer(minLength: 8)
                    RedditVotePill(
                        score: post.score,
                        myVote: post.my_vote,
                        disabled: isOwn || (selectMode && useLocal),
                        onLightBackground: isOwn,
                        onUp: { Task { await vote(postId: post.id, direction: "up") } },
                        onDown: { Task { await vote(postId: post.id, direction: "down") } }
                    )
                }
            }
            .contentShape(Rectangle())
        }
        .padding(.horizontal, isOwn ? 10 : 0)
        .padding(.vertical, 8)
        .background(rowBg)
        .clipShape(RoundedRectangle(cornerRadius: isOwn ? 12 : 0, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture {
            if selectMode && useLocal { toggleSelect(post.id) }
        }
        .simultaneousIf(canReorder, reorderGesture(for: post.id))
        .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
        .listRowBackground(Color.clear)
        .swipeActions(edge: .trailing, allowsFullSwipe: !(selectMode && useLocal)) {
            if !(selectMode && useLocal) {
                if isOwn {
                    Button(role: .destructive) {
                        Task { await hideOwn(postId: post.id) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } else {
                    Button {
                        Task { await reportPost(postId: post.id) }
                    } label: {
                        Label("Report", systemImage: "flag")
                    }
                    .tint(.orange)
                }
            }
        }
    }

    @ViewBuilder
    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if useLocal && testMode.simulateLocationAllowed {
                HStack(spacing: 8) {
                    Text("Send as")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Picker("Sender", selection: $localChat.sender) {
                        ForEach(TestChatStore.Sender.allCases) { s in
                            Text(s.label).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 200)
                }

                HStack(alignment: .center, spacing: 8) {
                    Text("Bar")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Picker("Bar", selection: $localChat.simulatedVenueName) {
                        if let geography = viewedGeography {
                            Text(geography.name).tag("")
                        }
                        ForEach(venueOptions) { v in
                            Text("\(v.name)").tag(v.name)
                        }
                    }
                    .pickerStyle(.menu)
                    Spacer(minLength: 8)
                    if overCharLimit {
                        Text("150 Character Limit")
                            .font(.caption.bold())
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.trailing)
                    }
                }
            }

            if !canSendInViewedGeography {
                Button {
                    flashRegionWarning()
                } label: {
                    HStack {
                        Text(regionGateMessage)
                            .font(.system(size: 17))
                            .foregroundStyle(regionWarningFlash ? Color.red : Color.secondary)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(10)
                    .background(Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(regionGateMessage)
            } else {
                if !useLocal {
                    HStack(alignment: .center, spacing: 8) {
                        if let venue = sendVenueName {
                            Text("Posting from \(venue)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        if overCharLimit {
                            Text("150 Character Limit")
                                .font(.caption.bold())
                                .foregroundStyle(.red)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }

                HStack(alignment: .bottom, spacing: 8) {
                    TextField(
                        placeholder,
                        text: $draft,
                        axis: .vertical
                    )
                    .lineLimit(1 ... 3)
                    .font(.system(size: 17))
                    .foregroundStyle(overCharLimit ? Color.red : Color.primary)
                    .focused($composerFocused)
                    .padding(10)
                    .background(Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 18))

                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 32))
                    }
                    .disabled(
                        draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || overCharLimit
                    )
                }
            }
        }
        .padding()
    }

    private var placeholder: String {
        if useLocal && localChat.sender == .other {
            return "Message as another user…"
        }
        if let venue = sendVenueName {
            return "What's happening at \(venue)?"
        }
        return "Say something…"
    }

    private func startChatLocationIfNeeded() {
        guard !needLocationGate else { return }
        ChatLocationReader.shared.start { coord in
            appModel.lastKnownCoordinate = coord
        }
    }

    private func flashRegionWarning() {
        guard !canSendInViewedGeography else { return }
        Task { @MainActor in
            for _ in 0 ..< 2 {
                withAnimation(.easeInOut(duration: 0.12)) {
                    regionWarningFlash = true
                }
                try? await Task.sleep(nanoseconds: 120_000_000)
                withAnimation(.easeInOut(duration: 0.12)) {
                    regionWarningFlash = false
                }
                try? await Task.sleep(nanoseconds: 120_000_000)
            }
        }
    }

    private func exitSelectMode() {
        selectMode = false
        selectedIds = []
        showSoftHidden = false
        cancelDrag()
    }

    private func toggleSelect(_ id: UUID) {
        if Date() < suppressSelectUntil { return }
        if selectedIds.contains(id) { selectedIds.remove(id) }
        else { selectedIds.insert(id) }
    }

    private var selectModeList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(displayedPosts) { post in
                    VStack(spacing: 0) {
                        selectModeRow(post)
                        Divider()
                    }
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollDisabled(draggingId != nil)
        .dismissKeyboardOnTap()
        .onPreferenceChange(ChatRowHeightKey.self) { heights in
            if heights != rowHeights {
                rowHeights = heights
            }
        }
    }

    @ViewBuilder
    private func selectModeRow(_ post: ChatPost) -> some View {
        let row = chatRow(post)
            .opacity(post.is_hidden ? 0.55 : 1)
            .padding(.horizontal, 12)
            .background {
                GeometryReader { proxy in
                    Color.clear.preference(
                        key: ChatRowHeightKey.self,
                        value: [post.id: proxy.size.height]
                    )
                }
            }
            .contentShape(Rectangle())
            .offset(y: canReorder ? dragOffset(for: post.id) : 0)
            .zIndex(draggingId == post.id ? 1 : 0)
            .shadow(
                color: draggingId == post.id ? Color.black.opacity(0.28) : .clear,
                radius: draggingId == post.id ? 8 : 0,
                y: draggingId == post.id ? 4 : 0
            )
        row
    }

    private func reorderGesture(for id: UUID) -> some Gesture {
        LongPressGesture(minimumDuration: 0.3)
            .sequenced(before: DragGesture(minimumDistance: 1, coordinateSpace: .global))
            .onChanged { value in
                switch value {
                case .first(true):
                    suppressSelectUntil = Date().addingTimeInterval(0.6)
                    draggingId = id
                    dragTranslation = 0
                case .second(true, let drag?):
                    suppressSelectUntil = Date().addingTimeInterval(0.6)
                    draggingId = id
                    dragTranslation = drag.translation.height
                default:
                    break
                }
            }
            .onEnded { _ in
                commitDrag()
            }
    }

    private func dragOffset(for id: UUID) -> CGFloat {
        guard let draggingId,
              let from = displayedPosts.firstIndex(where: { $0.id == draggingId }) else { return 0 }
        if id == draggingId { return dragTranslation }
        guard let index = displayedPosts.firstIndex(where: { $0.id == id }) else { return 0 }
        let target = dropIndex(from: from, translation: dragTranslation)
        let height = rowHeights[draggingId] ?? 80
        if target > from && index > from && index <= target { return -height }
        if target < from && index < from && index >= target { return height }
        return 0
    }

    private func dropIndex(from: Int, translation: CGFloat) -> Int {
        let items = displayedPosts
        guard from >= 0, from < items.count else { return from }
        var cursor: CGFloat = 0
        var mids: [CGFloat] = []
        mids.reserveCapacity(items.count)
        for post in items {
            let height = rowHeights[post.id] ?? 80
            mids.append(cursor + height / 2)
            cursor += height
        }
        let proposed = mids[from] + translation
        var best = from
        var bestDistance = CGFloat.infinity
        for (index, mid) in mids.enumerated() {
            let distance = abs(mid - proposed)
            if distance < bestDistance {
                bestDistance = distance
                best = index
            }
        }
        return best
    }

    private func commitDrag() {
        guard let originId = draggingId else { return }
        let translation = dragTranslation
        suppressSelectUntil = Date().addingTimeInterval(0.6)
        guard translation != 0,
              let from = displayedPosts.firstIndex(where: { $0.id == originId }) else {
            cancelDrag()
            return
        }
        let target = dropIndex(from: from, translation: translation)
        guard target != from else {
            cancelDrag()
            return
        }
        var ids = displayedPosts.map(\.id)
        let original = ids
        let item = ids.remove(at: from)
        let clamped = min(max(target, 0), ids.count)
        ids.insert(item, at: clamped)
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            draggingId = nil
            dragTranslation = 0
            localChat.applyDisplayedRecentOrder(originalDisplayed: original, reordered: ids)
        }
    }

    private func cancelDrag() {
        draggingId = nil
        dragTranslation = 0
    }

    private func load() async {
        guard !needLocationGate else {
            posts = []
            error = nil
            return
        }
        if useLocal {
            posts = localChat.feed(sort: sort)
            error = nil
            return
        }
        do {
            posts = try await ChatService.fetchFeed(sort: sort)
            error = nil
        } catch {
            self.error = error.localizedDescription
            DiagnosticLog.shared.append(
                category: "chat",
                message: error.localizedDescription,
                level: "error"
            )
        }
    }

    private func vote(postId: UUID, direction: String) async {
        do {
            if useLocal {
                try localChat.setVote(postId: postId, direction: direction)
            } else {
                try await ChatService.setVote(postId: postId, direction: direction)
                await load()
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func hideOwn(postId: UUID) async {
        if useLocal {
            localChat.hide(postIds: [postId])
        } else {
            try? await ChatService.hideOwn(postId: postId)
            await load()
        }
    }

    private func reportPost(postId: UUID) async {
        if useLocal {
            // Local feed has no server report — soft-hide + log for Test Mode parity.
            localChat.hide(postIds: [postId])
            DiagnosticLog.shared.append(
                category: "chat",
                message: "Reported (local) post \(postId.uuidString.prefix(8))…"
            )
        } else {
            do {
                try await ChatService.report(postId: postId, reason: nil)
                DiagnosticLog.shared.append(category: "chat", message: "Reported post")
                await load()
            } catch {
                self.error = error.localizedDescription
                DiagnosticLog.shared.append(
                    category: "chat",
                    message: "Report failed: \(error.localizedDescription)",
                    level: "error"
                )
            }
        }
    }

    private func send() async {
        guard canSendInViewedGeography else {
            flashRegionWarning()
            return
        }
        guard let geo = viewedGeography else { return }
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard trimmed.count <= AppConfig.maxChatChars else {
            error = "150 Character Limit"
            return
        }
        do {
            let avatar =
                (useLocal && localChat.sender == .other)
                ? avatarStore.otherSelection
                : avatarStore.selection
            if useLocal {
                try localChat.createPost(
                    body: trimmed,
                    avatar: avatar,
                    venueName: sendVenueName,
                    geographyId: geo.id
                )
                draft = ""
                composerFocused = false
                let venueLog = sendVenueName ?? "(no bar)"
                DiagnosticLog.shared.append(category: "chat", message: "Local post at \(venueLog)")
            } else {
                guard let coord = appModel.lastKnownCoordinate else {
                    error = regionGateMessage
                    flashRegionWarning()
                    return
                }
                try await ChatService.createPost(
                    body: trimmed,
                    geographyId: geo.id,
                    latitude: coord.latitude,
                    longitude: coord.longitude,
                    venueName: sendVenueName,
                    avatarIcon: avatar.icon.rawValue,
                    avatarColor: avatar.color.rawValue
                )
                draft = ""
                composerFocused = false
                let venueLog = sendVenueName ?? "(no bar)"
                DiagnosticLog.shared.append(category: "chat", message: "Posted at \(venueLog)")
                await load()
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
            DiagnosticLog.shared.append(
                category: "chat",
                message: error.localizedDescription,
                level: "error"
            )
        }
    }
}

private struct ChatRowHeightKey: PreferenceKey {
    static var defaultValue: [UUID: CGFloat] = [:]

    static func reduce(value: inout [UUID: CGFloat], nextValue: () -> [UUID: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { $1 })
    }
}

private extension View {
    @ViewBuilder
    func simultaneousIf<G: Gesture>(_ enabled: Bool, _ gesture: G) -> some View {
        if enabled {
            simultaneousGesture(gesture)
        } else {
            self
        }
    }
}

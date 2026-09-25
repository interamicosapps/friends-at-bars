import Foundation

enum SwitchSearchDifficulty: String, CaseIterable, Identifiable {
    case easy
    case hard
    var id: String { rawValue }
    var label: String { rawValue.capitalized }

    var gridSize: Int { self == .easy ? 7 : 8 }
    var sessionSeconds: Int { self == .easy ? 42 : 56 }
    var puzzleSeconds: Int { self == .easy ? 12 : 16 }
    var bonusFreezeSeconds: Int { self == .easy ? 1 : 3 }
}

struct SwitchSearchCell: Identifiable, Hashable {
    let id: String
    let row: Int
    let col: Int
    var letter: String
    var found: Bool = false
    var unfoundFlash: Bool = false
}

@MainActor
final class SwitchSearchEngine: ObservableObject {
    enum Screen { case home, playing, ended }

    /// Mirrors web: drag through letters, or tap first then tap last.
    enum SelectionMode: Equatable {
        case idle
        /// Finger is down; may become drag if the cell changes.
        case pressing
        case dragging
        /// Waiting for a second tap (point-to-point).
        case awaitingEnd
    }

    @Published var screen: Screen = .home
    @Published var difficulty: SwitchSearchDifficulty = .easy
    @Published var grid: [[SwitchSearchCell]] = []
    @Published var currentWords: [String] = []
    @Published var foundWords: Set<String> = []
    @Published var totalFound = 0
    /// Fractional seconds remaining — updated on a high-frequency tick for smooth bars.
    @Published var sessionLeft: Double = 42
    @Published var puzzleLeft: Double = 12
    @Published var hints: [String] = []
    @Published var isFrozen = false
    /// Lightweight selection path — updated during drag without rewriting cell structs.
    @Published var selectedPath: [(Int, Int)] = []
    @Published var selectionMode: SelectionMode = .idle
    @Published var librarySource: String = "bundled"

    private var library = WordLibrary.loadBundled()
    private var usedWords: [String] = []
    private var wordCells: [String: [(Int, Int)]] = [:]
    private var tickTimer: Timer?
    private var selectionStart: (Int, Int)?
    private var lastHover: (Int, Int)?
    private var gameElapsed: Double = 0
    private let tickInterval: TimeInterval = 1.0 / 30.0
    private var puzzleExpiredPending = false

    func appear() {
        Task { await refreshLibraryFromCatalog() }
    }

    func refreshLibraryFromCatalog() async {
        let cms = await CatalogStore.shared.switchSearchLibrary
        if let cms, !cms.isEmpty {
            library = cms
            librarySource = "cms"
            DiagnosticLog.shared.append(
                category: "system",
                message: "Switch Search words from CMS (\(cms.allWords.count) words)"
            )
        } else {
            library = WordLibrary.loadBundled()
            librarySource = "bundled"
            DiagnosticLog.shared.append(
                category: "system",
                message: "Switch Search words from bundled library (\(library.allWords.count) words)"
            )
        }
    }

    func start() {
        Task {
            await refreshLibraryFromCatalog()
            beginGame()
        }
    }

    private func beginGame() {
        stopTimers()
        usedWords = []
        totalFound = 0
        foundWords = []
        gameElapsed = 0
        sessionLeft = Double(difficulty.sessionSeconds)
        puzzleLeft = Double(difficulty.puzzleSeconds)
        puzzleExpiredPending = false
        isFrozen = false
        resetSelection(clearHighlightsOnly: false)
        screen = .playing
        generatePuzzle()
        startTimers()
    }

    func restart() {
        start()
    }

    func skipPuzzle() {
        guard screen == .playing else { return }
        generatePuzzle()
    }

    func exitToHome() {
        stopTimers()
        screen = .home
        grid = []
        resetSelection(clearHighlightsOnly: false)
    }

    // MARK: - Selection (web parity: drag + tap-first / tap-last)

    /// Touch / drag entered a cell.
    func pointerMoved(toRow row: Int, col: Int) {
        guard screen == .playing else { return }

        // Second tap in point-to-point mode.
        if selectionMode == .awaitingEnd, let start = selectionStart {
            // Same cell again → cancel the pending selection.
            if start.0 == row, start.1 == col {
                resetSelection(clearHighlightsOnly: true)
                return
            }
            let p = path(from: start, to: (row, col))
            selectedPath = p
            checkSelection(p)
            return
        }

        if selectionStart == nil {
            selectionStart = (row, col)
            lastHover = (row, col)
            selectedPath = [(row, col)]
            selectionMode = .pressing
            return
        }

        guard let start = selectionStart else { return }
        if lastHover?.0 == row, lastHover?.1 == col { return }
        lastHover = (row, col)

        if start.0 != row || start.1 != col {
            selectionMode = .dragging
        }
        selectedPath = path(from: start, to: (row, col))
    }

    /// Finger lifted.
    func pointerEnded(atRow row: Int?, col: Int?) {
        guard screen == .playing else { return }

        // Already finished via point-to-point second tap, or idle.
        if selectionMode == .idle { return }

        // Waiting for second tap — keep start highlighted.
        if selectionMode == .awaitingEnd { return }

        let end: (Int, Int)
        if let row, let col {
            end = (row, col)
        } else if let last = selectedPath.last {
            end = last
        } else if let start = selectionStart {
            end = start
        } else {
            resetSelection(clearHighlightsOnly: true)
            return
        }

        guard let start = selectionStart else {
            resetSelection(clearHighlightsOnly: true)
            return
        }

        if selectionMode == .dragging {
            let p = path(from: start, to: end)
            selectedPath = p
            checkSelection(p)
            return
        }

        // Tap with no drag → wait for second letter (point-to-point).
        if start.0 == end.0, start.1 == end.1 {
            selectionMode = .awaitingEnd
            selectedPath = [start]
            lastHover = nil
            return
        }

        // Released on a different cell → finalize as a selection.
        let p = path(from: start, to: end)
        selectedPath = p
        checkSelection(p)
    }

    func isSelected(row: Int, col: Int) -> Bool {
        selectedPath.contains { $0.0 == row && $0.1 == col }
    }

    private func resetSelection(clearHighlightsOnly: Bool) {
        selectionStart = nil
        lastHover = nil
        selectedPath = []
        selectionMode = .idle
        if !clearHighlightsOnly {
            // nothing else
        }
    }

    // MARK: - Timers

    private func startTimers() {
        stopTimers()
        let dt = tickInterval
        let timer = Timer(timeInterval: dt, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick(delta: dt) }
        }
        RunLoop.main.add(timer, forMode: .common)
        tickTimer = timer
    }

    private func stopTimers() {
        tickTimer?.invalidate()
        tickTimer = nil
    }

    private func tick(delta: TimeInterval) {
        guard screen == .playing else { return }

        if !isFrozen {
            sessionLeft = max(0, sessionLeft - delta)
            gameElapsed += delta
            if sessionLeft <= 0 {
                sessionLeft = 0
                stopTimers()
                screen = .ended
                return
            }
        }

        guard !puzzleExpiredPending else { return }
        puzzleLeft = max(0, puzzleLeft - delta)
        if puzzleLeft <= 0 {
            puzzleLeft = 0
            puzzleExpiredPending = true
            flashUnfound()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self, self.screen == .playing else { return }
                self.puzzleExpiredPending = false
                self.generatePuzzle()
            }
        }
    }

    // MARK: - Puzzle

    private func generatePuzzle() {
        let words = selectWords()
        currentWords = words
        foundWords = []
        wordCells = [:]
        puzzleLeft = Double(difficulty.puzzleSeconds)
        puzzleExpiredPending = false
        resetSelection(clearHighlightsOnly: false)

        let size = difficulty.gridSize
        var raw: [[String?]] = Array(
            repeating: Array(repeating: nil, count: size),
            count: size
        )
        for word in words {
            let positions = placeWord(word, in: &raw)
            wordCells[word.lowercased()] = positions
        }
        for r in 0 ..< size {
            for c in 0 ..< size {
                if raw[r][c] == nil {
                    raw[r][c] = String(UnicodeScalar(UInt8(97 + Int.random(in: 0 ..< 26))))
                }
            }
        }
        grid = (0 ..< size).map { r in
            (0 ..< size).map { c in
                SwitchSearchCell(
                    id: "\(r)-\(c)",
                    row: r,
                    col: c,
                    letter: (raw[r][c] ?? "?").uppercased()
                )
            }
        }
        hints = makeHints(words: words)
    }

    private func selectWords() -> [String] {
        var picked: [String] = []
        if difficulty == .easy {
            picked.append(pick(from: library.fourLetter))
            let second = Bool.random() ? library.fiveLetter : library.sixLetter
            picked.append(pick(from: second))
        } else {
            picked.append(pick(from: library.fiveLetter))
            picked.append(pick(from: library.sixLetter))
            picked.append(pick(from: library.sevenLetter))
        }
        return picked
    }

    private func pick(from list: [String]) -> String {
        var attempts = 0
        while attempts < max(list.count * 2, 8) {
            let w = list.randomElement() ?? "bar"
            attempts += 1
            if !usedWords.contains(w) {
                usedWords.append(w)
                return w
            }
            if attempts > list.count {
                usedWords.removeAll { list.contains($0) }
            }
        }
        let w = list.randomElement() ?? "bar"
        usedWords.append(w)
        return w
    }

    private enum Direction { case horizontal, vertical, diagonal }

    private func placeWord(_ word: String, in grid: inout [[String?]]) -> [(Int, Int)] {
        let size = grid.count
        let letters = Array(word.lowercased())
        let dirs: [Direction] = [.horizontal, .vertical, .diagonal]
        for _ in 0 ..< 400 {
            let dir = dirs.randomElement()!
            let startR = Int.random(in: 0 ..< size)
            let startC = Int.random(in: 0 ..< size)
            if canPlace(letters, startR, startC, dir, grid) {
                var positions: [(Int, Int)] = []
                for i in 0 ..< letters.count {
                    let r = startR + ((dir == .vertical || dir == .diagonal) ? i : 0)
                    let c = startC + ((dir == .horizontal || dir == .diagonal) ? i : 0)
                    grid[r][c] = String(letters[i])
                    positions.append((r, c))
                }
                return positions
            }
        }
        var positions: [(Int, Int)] = []
        for i in 0 ..< min(letters.count, size) {
            grid[0][i] = String(letters[i])
            positions.append((0, i))
        }
        return positions
    }

    private func canPlace(
        _ letters: [Character],
        _ startR: Int,
        _ startC: Int,
        _ dir: Direction,
        _ grid: [[String?]]
    ) -> Bool {
        let size = grid.count
        for i in 0 ..< letters.count {
            let r = startR + ((dir == .vertical || dir == .diagonal) ? i : 0)
            let c = startC + ((dir == .horizontal || dir == .diagonal) ? i : 0)
            if r >= size || c >= size { return false }
            if let existing = grid[r][c], existing != String(letters[i]) { return false }
        }
        return true
    }

    private func makeHints(words: [String]) -> [String] {
        if difficulty == .easy {
            return words.map { $0.uppercased() }
        }
        return words.map { word in
            let chars = Array(word.uppercased())
            guard chars.count >= 2 else { return String(chars) }
            var reveal = Set<Int>()
            while reveal.count < 2 {
                reveal.insert(Int.random(in: 0 ..< chars.count))
            }
            return String(chars.enumerated().map { reveal.contains($0.offset) ? $0.element : "_" })
        }
    }

    private func checkSelection(_ path: [(Int, Int)]) {
        defer { resetSelection(clearHighlightsOnly: true) }
        guard path.count >= 2 else { return }

        let forward = path.map { grid[$0.0][$0.1].letter }.joined().lowercased()
        let reverse = String(forward.reversed())
        let candidates = currentWords.map { $0.lowercased() }
        let formed: String?
        if candidates.contains(forward), !foundWords.contains(forward) {
            formed = forward
        } else if candidates.contains(reverse), !foundWords.contains(reverse) {
            formed = reverse
        } else {
            return
        }
        guard let formed else { return }

        foundWords.insert(formed)
        totalFound += 1
        let cells = wordCells[formed] ?? path
        for (r, c) in cells {
            grid[r][c].found = true
            grid[r][c].unfoundFlash = false
        }
        if foundWords.count == currentWords.count {
            isFrozen = true
            let freeze = difficulty.bonusFreezeSeconds
            generatePuzzle()
            DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(freeze)) { [weak self] in
                self?.isFrozen = false
            }
        }
    }

    private func flashUnfound() {
        for word in currentWords where !foundWords.contains(word.lowercased()) {
            if let cells = wordCells[word.lowercased()] {
                for (r, c) in cells {
                    grid[r][c].unfoundFlash = true
                }
            }
        }
    }

    private func path(from start: (Int, Int), to end: (Int, Int)) -> [(Int, Int)] {
        let dr = end.0 - start.0
        let dc = end.1 - start.1
        let steps = max(abs(dr), abs(dc))
        guard steps > 0 else { return [start] }
        if !(dr == 0 || dc == 0 || abs(dr) == abs(dc)) {
            return [start]
        }
        let rowStep = dr == 0 ? 0 : dr / abs(dr)
        let colStep = dc == 0 ? 0 : dc / abs(dc)
        var result: [(Int, Int)] = []
        for i in 0 ... steps {
            let r = start.0 + rowStep * i
            let c = start.1 + colStep * i
            if grid.indices.contains(r), grid[r].indices.contains(c) {
                result.append((r, c))
            }
        }
        return result
    }
}

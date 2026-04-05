(function() {
    // ---------- STATE (letters stored as lowercase) ----------
    let guessRows = []; // each row: array of 6 { letter: string|null (lowercase), state }

    // DOM elements
    const container = document.getElementById('guessesContainer');
    const addRowBtn = document.getElementById('addRowBtn');
    const clearRowsBtn = document.getElementById('clearRowsBtn');
    const solveBtn = document.getElementById('solveButton');
    const wordListTextarea = document.getElementById('wordListInput');
    const extraDupInput = document.getElementById('extraDupConstraints');
    const resultsArea = document.getElementById('resultsArea');

    // Helper: create empty row
    function createEmptyRow() {
        return Array(6).fill().map(() => ({
            letter: null,
            state: 'unknown'
        }));
    }

    // Render all rows
    function renderAllRows() {
        if (!container) return;
        container.innerHTML = '';
        for (let r = 0; r < guessRows.length; r++) {
            const row = guessRows[r];
            const rowDiv = document.createElement('div');
            rowDiv.className = 'guess-row';
            rowDiv.dataset.row = r;

            const idxSpan = document.createElement('div');
            idxSpan.className = 'row-index';
            idxSpan.textContent = `${r+1}`;
            rowDiv.appendChild(idxSpan);

            const cellsDiv = document.createElement('div');
            cellsDiv.className = 'cells-row';

            for (let c = 0; c < 6; c++) {
                const cell = row[c];
                const cellDiv = document.createElement('div');
                cellDiv.className = 'cell-clue';
				
				// Position number (1-6)
                    const numberLabel = document.createElement('div');
                    numberLabel.className = 'cell-number';
                    numberLabel.textContent = `${c+1}`;
                    cellDiv.appendChild(numberLabel);

                const input = document.createElement('input');
                input.type = 'text';
                input.maxLength = 1;
                input.className = 'cell-input';
                input.value = cell.letter ? cell.letter.toUpperCase() : '';
                input.addEventListener('input', (function(rowIdx, colIdx) {
                    return function(e) {
                        let val = e.target.value.trim().toUpperCase();
                        if (val && !/^[A-Z]$/.test(val)) val = '';
                        guessRows[rowIdx][colIdx].letter = val ? val.toLowerCase() : null;
                        renderAllRows();
                    };
                })(r, c));

                const stateGroup = document.createElement('div');
                stateGroup.className = 'state-group';

                const states = [{
                        key: 'unknown',
                        label: '◻️',
                        title: 'No clue'
                    },
                    {
                        key: 'correct',
                        label: '🟩',
                        title: 'Correct position'
                    },
                    {
                        key: 'present',
                        label: '🟨',
                        title: 'In word, wrong pos'
                    },
                    {
                        key: 'absent',
                        label: '⬜',
                        title: 'Not in word'
                    }
                ];

                states.forEach(st => {
                    const btn = document.createElement('button');
                    btn.textContent = st.label;
                    btn.title = st.title;
                    btn.classList.add('state-btn');
                    if (cell.state === st.key) {
                        if (st.key === 'correct') btn.classList.add('active-green');
                        else if (st.key === 'present') btn.classList.add('active-yellow');
                        else if (st.key === 'absent') btn.classList.add('active-gray');
                        else btn.classList.add('active-unknown');
                    }
                    btn.dataset.row = r;
                    btn.dataset.col = c;
                    btn.dataset.newState = st.key;
                    stateGroup.appendChild(btn);
                });

                cellDiv.appendChild(input);
                cellDiv.appendChild(stateGroup);
                cellsDiv.appendChild(cellDiv);
            }

            rowDiv.appendChild(cellsDiv);

            const removeBtn = document.createElement('button');
            removeBtn.textContent = '✖';
            removeBtn.className = 'remove-row-btn';
            removeBtn.dataset.row = r;
            rowDiv.appendChild(removeBtn);
            container.appendChild(rowDiv);
        }
    }

    // Event delegation for buttons
    function handleContainerClick(e) {
        const target = e.target;
        if (target.classList && target.classList.contains('state-btn') && target.dataset.newState !== undefined) {
            const row = parseInt(target.dataset.row);
            const col = parseInt(target.dataset.col);
            const newState = target.dataset.newState;
            if (!isNaN(row) && !isNaN(col) && guessRows[row] && guessRows[row][col]) {
                guessRows[row][col].state = newState;
                renderAllRows();
            }
            e.stopPropagation();
            return;
        }
        if (target.classList && target.classList.contains('remove-row-btn')) {
            const row = parseInt(target.dataset.row);
            if (!isNaN(row) && guessRows.length > 1) {
                guessRows.splice(row, 1);
                renderAllRows();
            } else if (guessRows.length === 1) {
                alert("Keep at least one row. Clear cells manually if needed.");
            }
            e.stopPropagation();
            return;
        }
    }

    function addNewRow() {
        guessRows.push(createEmptyRow());
        renderAllRows();
    }

    function clearAllRows() {
        guessRows = [createEmptyRow()];
        renderAllRows();
    }

    // ---------- SOLVER LOGIC (exact Python translation, case‑safe) ----------
    function parseWordList(raw) {
        const entries = [];
        const lines = raw.split(/\r?\n/);
        const regex = /^\s*([a-zA-Z]{6})\s*\(\s*(\d+)\s*\)\s*$/;
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            const m = line.match(regex);
            if (!m) continue;
            entries.push({
                word: m[1].toLowerCase(),
                freq: parseInt(m[2], 10)
            });
        }
        return entries;
    }

    function buildGlobalConstraints(rows) {
        const correctPos = new Array(6).fill(null);
        const notInPosMap = new Map();
        const forcedPresent = new Set();
        const minCountMap = new Map();
        const absentSet = new Set();

        for (let row of rows) {
            for (let i = 0; i < 6; i++) {
                const {
                    letter,
                    state
                } = row[i];
                if (!letter) continue;
                if (state === 'correct') {
                    if (correctPos[i] !== null && correctPos[i] !== letter) {
                        throw new Error(`Conflict: position ${i+1} fixed as '${correctPos[i]}' and '${letter}'`);
                    }
                    correctPos[i] = letter;
                    forcedPresent.add(letter);
                    minCountMap.set(letter, (minCountMap.get(letter) || 0) + 1);
                } else if (state === 'present') {
                    if (!notInPosMap.has(letter)) notInPosMap.set(letter, new Set());
                    notInPosMap.get(letter).add(i);
                    forcedPresent.add(letter);
                    minCountMap.set(letter, (minCountMap.get(letter) || 0) + 1);
                } else if (state === 'absent') {
                    absentSet.add(letter);
                }
            }
        }

        const finalExcluded = new Set();
        for (let l of absentSet) {
            if (!forcedPresent.has(l)) finalExcluded.add(l);
        }

        return {
            correctPos,
            notInPosMap,
            finalExcluded,
            minCountMap
        };
    }

    function satisfiesConstraints(word, correctPos, notInPosMap, excludedSet, minCountMap) {
        for (let i = 0; i < 6; i++) {
            if (correctPos[i] !== null && word[i] !== correctPos[i]) return false;
        }
        for (let letter of minCountMap.keys()) {
            if (!word.includes(letter)) return false;
        }
        for (let [letter, forbiddenSet] of notInPosMap.entries()) {
            for (let pos of forbiddenSet) {
                if (word[pos] === letter) return false;
            }
        }
        for (let ex of excludedSet) {
            if (word.includes(ex)) return false;
        }
        const wordCount = {};
        for (let ch of word) wordCount[ch] = (wordCount[ch] || 0) + 1;
        for (let [letter, requiredMin] of minCountMap.entries()) {
            if ((wordCount[letter] || 0) < requiredMin) return false;
        }
        return true;
    }

    function parseExtraConstraints(str) {
        const constraints = new Map();
        if (!str.trim()) return constraints;
        const parts = str.split(',').map(p => p.trim());
        const regex = /^([a-zA-Z])\s*(<=|>=|==)\s*(\d+)$/;
        for (let part of parts) {
            if (part === "") continue;
            const m = part.match(regex);
            if (!m) throw new Error(`Invalid extra constraint: "${part}"`);
            const letter = m[1].toLowerCase();
            const op = m[2];
            const val = parseInt(m[3], 10);
            if (val < 0 || val > 6) throw new Error(`Count out of range 0-6`);
            let min = 0,
                max = 6;
            if (constraints.has(letter)) {
                const prev = constraints.get(letter);
                min = prev.min;
                max = prev.max;
            }
            if (op === '>=') min = Math.max(min, val);
            else if (op === '<=') max = Math.min(max, val);
            else if (op === '==') {
                min = val;
                max = val;
            }
            if (min > max) throw new Error(`Contradiction for ${letter}`);
            constraints.set(letter, {
                min,
                max
            });
        }
        return constraints;
    }

    function applyGlobalDuplicates(word, extraMap) {
        const count = {};
        for (let ch of word) count[ch] = (count[ch] || 0) + 1;
        for (let [letter, {
                min,
                max
            }] of extraMap.entries()) {
            const c = count[letter] || 0;
            if (c < min || c > max) return false;
        }
        return true;
    }

    function solve() {
        const rawList = wordListTextarea.value;
        let entries = parseWordList(rawList);
        if (entries.length === 0) {
            resultsArea.innerHTML = `<div class="error-box">❌ No valid 6‑letter words found. Use format: "word (freq)" per line.</div>`;
            return;
        }

        let constraints;
        try {
            constraints = buildGlobalConstraints(guessRows);
        } catch (e) {
            resultsArea.innerHTML = `<div class="error-box">⚠️ Constraint conflict: ${e.message}</div>`;
            return;
        }
        const {
            correctPos,
            notInPosMap,
            finalExcluded,
            minCountMap
        } = constraints;

        let extraDupMap = new Map();
        try {
            extraDupMap = parseExtraConstraints(extraDupInput.value);
        } catch (e) {
            resultsArea.innerHTML = `<div class="error-box">⚠️ Extra constraints error: ${e.message}</div>`;
            return;
        }

        const candidates = [];
        for (let {
                word,
                freq
            }
            of entries) {
            if (satisfiesConstraints(word, correctPos, notInPosMap, finalExcluded, minCountMap)) {
                if (applyGlobalDuplicates(word, extraDupMap)) {
                    candidates.push({
                        word,
                        freq
                    });
                }
            }
        }

        candidates.sort((a, b) => {
            if (a.freq !== b.freq) return b.freq - a.freq;
            return a.word.localeCompare(b.word);
        });
        displayResults(candidates, entries.length);
    }

    function displayResults(candidates, totalWords) {
        if (candidates.length === 0) {
            resultsArea.innerHTML = `<div class="results"><div style="padding:20px; text-align:center; color:#e8e6e3;">No words match all ${guessRows.length} guess row(s).</div></div>`;
            return;
        }
        const top50 = candidates.slice(0, 50);
        const letterMap = new Map();
        for (let {
                word
            }
            of candidates) {
            const seen = new Set(word.split(''));
            for (let ch of seen) letterMap.set(ch, (letterMap.get(ch) || 0) + 1);
        }
        const letterStats = Array.from(letterMap.entries()).sort((a, b) => b[1] - a[1]);

        let html = `<div class="results">
                            <div class="results-header">
                                ${candidates.length} candidate${candidates.length !== 1 ? 's' : ''} (from ${totalWords} dictionary words)
                            </div>
                            <div class="candidate-list">`;
        for (let {
                word,
                freq
            }
            of top50) {
            html += `<div class="candidate-row"><span style="font-weight:700; font-family:monospace;">${word.toUpperCase()}</span><span class="freq-badge">freq ${freq}</span></div>`;
        }
        if (candidates.length > 50) html += `<div class="candidate-row" style="justify-content:center;">+ ${candidates.length-50} more</div>`;
        html += `</div><div class="letter-stats"><strong>Letter frequency among candidates</strong><br/><div style="margin-top:8px;">`;
        for (let [ch, cnt] of letterStats.slice(0, 16)) {
            const pct = Math.round((cnt / candidates.length) * 100);
            html += `<span class="stat-tag">${ch.toUpperCase()} : ${cnt} / ${candidates.length} (${pct}%)</span>`;
        }
        if (letterStats.length > 16) html += `<span class="stat-tag">+${letterStats.length-16} more</span>`;
        html += `</div><div class="hint">* How many candidate words contain this letter at least once.</div></div></div>`;
        resultsArea.innerHTML = html;
    }

    function setDefaultWordList() {
        wordListTextarea.value = `adjoin (120)
beacon (78)
cactus (55)
desert (210)
echoes (43)
forest (187)
guitar (99)
harbor (66)
insect (89)
jungle (41)
knight (210)
locket (32)
magnet (97)
nectar (52)
orchid (33)
puzzle (76)
quarry (28)
ravine (44)
silver (250)
throne (142)
uplift (38)
violet (91)
whisky (67)
xyloid (5)
yearly (102)
zigzag (41)`;
    }

    function init() {
        setDefaultWordList();
        guessRows = [createEmptyRow()];
        renderAllRows();
        if (container) container.addEventListener('click', handleContainerClick);
        if (addRowBtn) addRowBtn.addEventListener('click', addNewRow);
        if (clearRowsBtn) clearRowsBtn.addEventListener('click', clearAllRows);
        if (solveBtn) solveBtn.addEventListener('click', solve);
    }

    init();
})();
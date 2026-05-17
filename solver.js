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
        return Array(6).fill().map(() => ({ letter: null, state: 'absent' }));
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
            idxSpan.textContent = `${r + 1}`;
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
                numberLabel.textContent = `${c + 1}`;
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
                        renderAllRows();  // re-render to reflect

                        // Auto‑advance to next cell if a valid letter was entered
                        if (val && /^[A-Z]$/.test(val) && colIdx < 5) {
                            // find the next input in the same row after re‑render
                            const currentRowDiv = document.querySelector(`.guess-row[data-row='${rowIdx}']`);
                            if (currentRowDiv) {
                                const nextInput = currentRowDiv.querySelectorAll('.cell-input')[colIdx + 1];
                                if (nextInput) nextInput.focus();
                            }
                        }
                    }
                })(r, c));

                const stateGroup = document.createElement('div');
                stateGroup.className = 'state-group';

                const states = [
                    { key: 'correct', label: '🟩', title: 'Correct position' },
                    { key: 'present', label: '🟨', title: 'In word, wrong pos' },
                    { key: 'absent', label: '⬜', title: 'Not in word' }
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
        // Focus the first input of the newly added row
        const newRowDiv = container.lastElementChild;
        if (newRowDiv) {
            const firstInput = newRowDiv.querySelector('.cell-input');
            if (firstInput) firstInput.focus();
        }
    }

    function clearAllRows() {
        guessRows = [createEmptyRow()];
        renderAllRows();
    }

    // ---------- SOLVER LOGIC (exact Python translation, case‑safe) ----------
    function parseWordList(raw) {
        const entries = [];
        const lines = raw.split(/\r?\n/);
        // Format: word freq
        const regex = /^\s*([a-zA-Z]{6})\s+(\d+)\s*$/;
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            const m = line.match(regex);
            if (!m) {
                console.warn("Skipping invalid line (expected 'word number'):", line);
                continue;
            }
            entries.push({ word: m[1].toLowerCase(), freq: parseInt(m[2], 10) });
        }
        return entries;
    }

    // Build constraints: correctPos, notInPosMap, finalExcluded, minCountMap (per letter, max across rows)
    function buildGlobalConstraints(rows) {
        const correctPos = new Array(6).fill(null);
        const notInPosMap = new Map(); // letter -> Set of forbidden positions (union across rows)
        const forcedPresent = new Set(); // letters that must appear at least once
        const absentSet = new Set(); // letters marked absent in any row

        // For each letter, we need the MAXIMUM number of times it appears as correct/present in any single row
        const perRowCounts = []; // will store array of row-wise letter counts

        for (let row of rows) {
            const rowCounts = {};
            for (let i = 0; i < 6; i++) {
                const { letter, state } = row[i];
                if (!letter) continue;
                if (state === 'correct') {
                    if (correctPos[i] !== null && correctPos[i] !== letter) {
                        throw new Error(`Conflict: position ${i + 1} fixed as '${correctPos[i]}' and '${letter}'`);
                    }
                    correctPos[i] = letter;
                    forcedPresent.add(letter);
                    rowCounts[letter] = (rowCounts[letter] || 0) + 1;
                } else if (state === 'present') {
                    if (!notInPosMap.has(letter)) notInPosMap.set(letter, new Set());
                    notInPosMap.get(letter).add(i);
                    forcedPresent.add(letter);
                    rowCounts[letter] = (rowCounts[letter] || 0) + 1;
                } else if (state === 'absent') {
                    absentSet.add(letter);
                }
            }
            perRowCounts.push(rowCounts);
        }

        // Compute global min count per letter: maximum of row counts
        const minCountMap = new Map();
        for (const rowCounts of perRowCounts) {
            for (const [letter, cnt] of Object.entries(rowCounts)) {
                const current = minCountMap.get(letter) || 0;
                minCountMap.set(letter, Math.max(current, cnt));
            }
        }

        // Excluded letters: those in absentSet but not forced present
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
        // 1) exact positions
        for (let i = 0; i < 6; i++) {
            if (correctPos[i] !== null && word[i] !== correctPos[i]) return false;
        }
        // 2) letters that must appear (forcedPresent = keys of minCountMap)
        for (let letter of minCountMap.keys()) {
            if (!word.includes(letter)) return false;
        }
        // 3) forbidden positions for present letters
        for (let [letter, forbiddenSet] of notInPosMap.entries()) {
            for (let pos of forbiddenSet) {
                if (word[pos] === letter) return false;
            }
        }
        // 4) excluded letters
        for (let ex of excludedSet) {
            if (word.includes(ex)) return false;
        }
        // 5) minimum count (max across rows)
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
            let min = 0, max = 6;
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
            constraints.set(letter, { min, max });
        }
        return constraints;
    }

    function applyGlobalDuplicates(word, extraMap) {
        const count = {};
        for (let ch of word) count[ch] = (count[ch] || 0) + 1;
        for (let [letter, { min, max }] of extraMap.entries()) {
            const c = count[letter] || 0;
            if (c < min || c > max) return false;
        }
        return true;
    }

    function solve() {
        const rawList = wordListTextarea.value;
        let entries = parseWordList(rawList);
        if (entries.length === 0) {
            resultsArea.innerHTML = `<div class="error-box">❌ No valid 6-letter words found. Use format: "word (freq)" per line.</div>`;
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
        for (let {word, freq} of entries) {
            if (satisfiesConstraints(word, correctPos, notInPosMap, finalExcluded, minCountMap)) {
                if (applyGlobalDuplicates(word, extraDupMap)) {
                    candidates.push({word, freq});
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
        for (let {word} of candidates) {
            const seen = new Set(word.split(''));
            for (let ch of seen) letterMap.set(ch, (letterMap.get(ch) || 0) + 1);
        }
        const letterStats = Array.from(letterMap.entries()).sort((a, b) => b[1] - a[1]);

        let html = `<div class="results">
                            <div class="results-header">
                                ${candidates.length} candidate${candidates.length !== 1 ? 's' : ''} (from ${totalWords} dictionary words)
                            </div>
                            <div class="candidate-list">`;
        for (let {word, freq} of top50) {
            html += `<div class="candidate-row"><span style="font-weight:700; font-family:monospace;">${word.toUpperCase()}</span><span class="freq-badge">freq ${freq}</span></div>`;
        }
        if (candidates.length > 50) html += `<div class="candidate-row" style="justify-content:center;">+ ${candidates.length - 50} more</div>`;
        html += `</div><div class="letter-stats"><strong>Letter frequency among candidates</strong><br/><div style="margin-top:8px;">`;
        for (let [ch, cnt] of letterStats.slice(0, 16)) {
            const pct = Math.round((cnt / candidates.length) * 100);
            html += `<span class="stat-tag">${ch.toUpperCase()} : ${cnt} / ${candidates.length} (${pct}%)</span>`;
        }
        if (letterStats.length > 16) html += `<span class="stat-tag">+${letterStats.length - 16} more</span>`;
        html += `</div><div class="hint">* How many candidate words contain this letter at least once.</div></div></div>`;
        resultsArea.innerHTML = html;
    }

    function setDefaultWordList() {
        wordListTextarea.value = `shrimp 19
slight 19
hamlet 17
punnet 17
innate 16
mutter 16
signal 16
annual 15
daylit 15
dreamt 15
exotic 15
flaunt 15
garage 15
nectar 15
singer 15
gentle 14
inkjet 14
league 14
manner 14
mayday 14
mother 14
motion 14
myself 14
napkin 14
patrol 14
physic 14
pickup 14
prison 14
rumble 14
smooth 14
wiggle 14
wisely 14
avenge 13
bedbug 13
berate 13
bubbly 13
bullet 13
change 13
costly 13
cuboid 13
eyelid 13
fierce 13
flimsy 13
gamble 13
glaive 13
hauled 13
iconic 13
incept 13
karate 13
morsel 13
noggin 13
police 13
recant 13
refuse 13
runway 13
saddle 13
serial 13
smoker 13
snatch 13
snoopy 13
speech 13
spruce 13
suffer 13
tomcat 13
tonsil 13
umbral 13
unisex 13
unkind 13
volume 13
vulgar 13
yearly 13
acquit 12
adopts 12
advert 12
affair 12
armada 12
atomic 12
bobble 12
bronze 12
bummer 12
caress 12
celery 12
census 12
clever 12
collar 12
column 12
dancer 12
deduct 12
defuse 12
demote 12
derive 12
desist 12
detour 12
devote 12
embody 12
entire 12
expire 12
finger 12
flower 12
forego 12
frozen 12
furrow 12
gutted 12
health 12
heroin 12
horror 12
iodide 12
jojoba 12
kettle 12
kicker 12
lawful 12
malign 12
maroon 12
mirror 12
misuse 12
nephew 12
occupy 12
offset 12
outdid 12
payoff 12
portal 12
prayer 12
pretty 12
purely 12
ramble 12
refuel 12
savour 12
sexism 12
sphere 12
spring 12
tangle 12
teflon 12
thieve 12
tissue 12
toasty 12
upside 12
vandal 12
violin 12
wallow 12
whilst 12
wicket 12
yellow 12
abrupt 11
aerial 11
apathy 11
arabic 11
arcane 11
arctic 11
armpit 11
around 11
backup 11
benign 11
betray 11
blonde 11
bounce 11
bridge 11
bright 11
bucket 11
buzzer 11
cactus 11
canyon 11
casein 11
cicada 11
circus 11
cotton 11
debunk 11
deputy 11
detect 11
dimple 11
dismay 11
eighth 11
elapse 11
embalm 11
enable 11
enigma 11
enough 11
entity 11
eunoia 11
exhale 11
family 11
fixate 11
foodie 11
garlic 11
gopher 11
header 11
hinder 11
ignite 11
injure 11
insist 11
italic 11
jackal 11
jiggle 11
ledger 11
lentil 11
looter 11
measly 11
mellow 11
misery 11
mitten 11
museum 11
naught 11
octopi 11
origin 11
partly 11
pebble 11
picnic 11
pimple 11
plenty 11
racket 11
racoon 11
reform 11
report 11
resend 11
ribbon 11
rotten 11
scheme 11
seethe 11
sickle 11
silent 11
skinny 11
sledge 11
smelly 11
sneaky 11
solace 11
sorbet 11
spoilt 11
spoken 11
sporty 11
squeak 11
stinky 11
stripe 11
sulfur 11
superb 11
survey 11
touchy 11
umpire 11
unease 11
uptime 11
wonton 11
wooden 11
zipper 11
abacus 10
abject 10
aboard 10
admire 10
albino 10
anemia 10
animal 10
answer 10
astray 10
attach 10
august 10
boring 10
bumble 10
bumper 10
canary 10
cancel 10
cannon 10
carton 10
cement 10
chance 10
chorus 10
chosen 10
cipher 10
citrus 10
coddle 10
couple 10
crocus 10
dampen 10
deafen 10
depend 10
direct 10
docile 10
doctor 10
dollar 10
domino 10
dosage 10
dragon 10
eczema 10
edible 10
effect 10
endure 10
enroll 10
entree 10
eulogy 10
evoker 10
excess 10
expend 10
female 10
filler 10
fisher 10
flappy 10
fodder 10
footer 10
formal 10
french 10
gaming 10
gelato 10
gifted 10
gloomy 10
groggy 10
hazard 10
heaven 10
height 10
hijack 10
hockey 10
humane 10
hungry 10
hunter 10
illude 10
inched 10
insane 10
invite 10
jetlag 10
lactic 10
ladies 10
laptop 10
lazuli 10
lesson 10
lethal 10
lizard 10
lodger 10
lonely 10
madman 10
malice 10
manque 10
manure 10
margin 10
marine 10
medium 10
meowed 10
meteor 10
mighty 10
minion 10
moment 10
morale 10
muscle 10
mutton 10
negate 10
ninety 10
occult 10
octave 10
onward 10
oracle 10
outing 10
people 10
person 10
petrol 10
pierce 10
plague 10
polish 10
prefix 10
profit 10
reader 10
recite 10
regain 10
relish 10
reload 10
reopen 10
resent 10
rodent 10
rookie 10
rudder 10
rustic 10
safely 10
savant 10
seesaw 10
sesame 10
shaven 10
shifty 10
soccer 10
sodium 10
solely 10
squint 10
starch 10
strain 10
subtle 10
subway 10
sunken 10
sunset 10
tahini 10
tarzan 10
tattoo 10
throne 10
thrown 10
tinder 10
tossup 10
tripod 10
twitch 10
unborn 10
undone 10
utmost 10
vastly 10
versus 10
vision 10
voyage 10
waffle 10
weasel 10
wobble 10
woeful 10
wombat 10
zealot 10
absent 9
absurd 9
advent 9
aflame 9
anyway 9
apache 9
apollo 9
append 9
artery 9
aspect 9
aspire 9
assure 9
asthma 9
atrium 9
attain 9
avatar 9
awhile 9
bandit 9
banner 9
bazaar 9
beaker 9
beauty 9
become 9
beetle 9
beggar 9
bemuse 9
beyond 9
bikini 9
biotic 9
bisect 9
bloody 9
boxcar 9
breath 9
camera 9
candle 9
canton 9
carrot 9
castle 9
caveat 9
cavern 9
chatty 9
cliche 9
clinch 9
clinic 9
clover 9
coerce 9
collie 9
colony 9
combat 9
comedy 9
corpse 9
cosmic 9
cowboy 9
coyote 9
crowdy 9
crunch 9
cursor 9
cuscus 9
dazzle 9
decade 9
defend 9
detain 9
device 9
dialog 9
diesel 9
divine 9
eldest 9
empire 9
engage 9
escape 9
expand 9
fallen 9
falter 9
father 9
felony 9
finale 9
floral 9
follow 9
forage 9
forbid 9
forest 9
garden 9
gazebo 9
glazed 9
glossy 9
gobble 9
goblin 9
golfer 9
halide 9
hazmat 9
hectic 9
hiccup 9
hither 9
hotdog 9
humbug 9
icebox 9
improv 9
inbred 9
insult 9
intact 9
intent 9
jailed 9
jangle 9
jester 9
jingle 9
jostle 9
junior 9
keeper 9
kitten 9
lambda 9
leeway 9
likely 9
loathe 9
locker 9
loofah 9
maggot 9
mangle 9
market 9
marrow 9
matrix 9
melody 9
member 9
minuet 9
monkey 9
mussel 9
muzzle 9
native 9
nebula 9
neuter 9
nuzzle 9
oboist 9
opaque 9
opioid 9
orphan 9
orpine 9
outbid 9
outlaw 9
outset 9
paddle 9
palace 9
pallet 9
pathos 9
patron 9
payday 9
pearly 9
phobia 9
pigsty 9
pointy 9
poncho 9
poster 9
potion 9
prompt 9
psyche 9
purple 9
queasy 9
quiver 9
racial 9
radium 9
rather 9
recall 9
recept 9
reckon 9
refine 9
refund 9
regard 9
regime 9
relent 9
remain 9
remote 9
repeal 9
rescue 9
rhumba 9
rhythm 9
ruffle 9
safari 9
sailor 9
sallow 9
scampi 9
scream 9
scurvy 9
sender 9
senior 9
setoff 9
shaman 9
sherif 9
shines 9
shoddy 9
sizzle 9
slayer 9
sleeve 9
slider 9
snobby 9
solute 9
soviet 9
squash 9
stable 9
stereo 9
streak 9
stride 9
strive 9
studio 9
subset 9
sunlit 9
surely 9
symbol 9
tavern 9
teepee 9
teethe 9
tender 9
thirst 9
tidbit 9
tilted 9
timber 9
trophy 9
twenty 9
tyrant 9
unlock 9
unruly 9
upkeep 9
uptake 9
valued 9
vanish 9
venter 9
vessel 9
vortex 9
wander 9
wealth 9
wheeze 9
winner 9
wither 9
yogurt 9
zinger 9
zombie 9
accord 8
acidic 8
adhere 8
adjust 8
aether 8
agency 8
airbag 8
airway 8
alight 8
alpaca 8
ambush 8
arcade 8
assert 8
assign 8
attent 8
attire 8
avenue 8
azalea 8
banana 8
banter 8
barber 8
barbie 8
barium 8
basalt 8
beacon 8
beside 8
blurry 8
borrow 8
bouncy 8
burrow 8
cahoot 8
camper 8
cannot 8
careen 8
carpet 8
casual 8
caught 8
censor 8
choose 8
chrome 8
clench 8
clingy 8
coffee 8
cohost 8
convey 8
copout 8
corona 8
crease 8
create 8
crisis 8
crouch 8
cruise 8
damage 8
damsel 8
darker 8
decide 8
decode 8
deepen 8
defame 8
defeat 8
define 8
depict 8
deport 8
devour 8
dilute 8
dimwit 8
doable 8
doodle 8
dorado 8
during 8
egging 8
embryo 8
encore 8
energy 8
entail 8
eponym 8
esteem 8
exceed 8
export 8
extort 8
factor 8
faucet 8
fedora 8
fickle 8
fiddle 8
fidget 8
fizzle 8
foster 8
fridge 8
friend 8
fright 8
fungal 8
gallon 8
galore 8
gambit 8
garner 8
genius 8
giggle 8
giving 8
ground 8
guinea 8
hammer 8
hassle 8
hexane 8
hippie 8
hobnob 8
hollow 8
hoodie 8
horrid 8
hourly 8
humble 8
hummus 8
ignore 8
impale 8
impede 8
impure 8
indent 8
inform 8
intend 8
invent 8
invest 8
jargon 8
jogger 8
jumper 8
jungle 8
justly 8
killer 8
kimchi 8
latent 8
latest 8
lawyer 8
legume 8
limber 8
liquor 8
litter 8
locate 8
logger 8
loosen 8
lotion 8
magnet 8
maniac 8
mantis 8
mantle 8
mascot 8
menace 8
mental 8
methyl 8
mingle 8
mishap 8
module 8
mohawk 8
morgue 8
mousse 8
mullet 8
musket 8
muslin 8
mutual 8
mystic 8
napalm 8
narwal 8
newton 8
nitric 8
nitwit 8
office 8
omelet 8
onside 8
option 8
ordeal 8
orient 8
packet 8
panini 8
parent 8
period 8
phlegm 8
pigeon 8
pillow 8
pirate 8
planar 8
planet 8
plasma 8
plough 8
plunge 8
podium 8
podzol 8
pollen 8
postal 8
preach 8
propel 8
proven 8
python 8
quarry 8
ransom 8
rapids 8
rascal 8
ravine 8
reborn 8
recent 8
redeem 8
reduce 8
reggae 8
rejoin 8
relive 8
remedy 8
rename 8
repair 8
resell 8
reside 8
resort 8
revamp 8
revise 8
revive 8
ringer 8
ripple 8
ruckus 8
salary 8
samosa 8
sample 8
savage 8
scenic 8
school 8
scorch 8
scurry 8
seduce 8
seller 8
septic 8
shelve 8
shiver 8
shovel 8
shrewd 8
shroud 8
silica 8
simmer 8
simple 8
sinner 8
sitcom 8
sketch 8
sleazy 8
sleigh 8
sludge 8
smiley 8
solver 8
sonata 8
spirit 8
splice 8
splint 8
spooky 8
sprain 8
squirm 8
steady 8
stench 8
steric 8
stolen 8
stuffy 8
sturdy 8
suitor 8
sundry 8
suture 8
switch 8
swivel 8
tablet 8
target 8
tarmac 8
taught 8
teaser 8
tennis 8
thrice 8
tinker 8
trench 8
trendy 8
trifle 8
trough 8
tumble 8
tundra 8
tunnel 8
unclip 8
uncool 8
unison 8
unlike 8
unload 8
unplug 8
unreal 8
upbeat 8
usable 8
veneer 8
vertex 8
viewer 8
visage 8
voting 8
weaken 8
weight 8
wicked 8
windup 8
winery 8
winter 8
wizard 8
wraith 8
wreath 8
zircon 8
zoning 8
addict 7
adverb 7
alkali 7
allele 7
alumni 7
analog 7
anchor 7
assist 7
awoken 7
badger 7
bakery 7
barely 7
basket 7
beanie 7
beaver 7
belief 7
bestow 7
binary 7
bistro 7
bitten 7
border 7
bounty 7
brainy 7
breezy 7
browse 7
bubble 7
buddha 7
buffet 7
bungee 7
bureau 7
burial 7
busily 7
butter 7
button 7
bypass 7
cancer 7
canopy 7
carbon 7
catchy 7
cattle 7
caviar 7
chapel 7
cheeky 7
chilly 7
choral 7
church 7
classy 7
clause 7
clergy 7
closet 7
clumsy 7
cobble 7
cocoon 7
corner 7
cosmos 7
county 7
coupon 7
covert 7
cradle 7
credit 7
creole 7
crusty 7
curfew 7
cyborg 7
dagger 7
defect 7
degree 7
deject 7
denote 7
desert 7
desire 7
detach 7
devout 7
disarm 7
dismal 7
dumber 7
duplex 7
earbud 7
editor 7
eggnog 7
elixir 7
elvish 7
encase 7
enlist 7
equate 7
errand 7
escort 7
escrow 7
ethnic 7
evolve 7
excuse 7
exempt 7
farmer 7
feeble 7
ferret 7
fewest 7
figure 7
filter 7
filthy 7
flight 7
fluffy 7
forgot 7
fought 7
freaky 7
frenzy 7
fuming 7
future 7
gather 7
geyser 7
gluten 7
gnarly 7
goatee 7
gossip 7
granny 7
greedy 7
groove 7
grumpy 7
handed 7
hanger 7
hasten 7
having 7
hearty 7
helper 7
herbal 7
heroic 7
hoarse 7
hooter 7
hornet 7
hunger 7
hurdle 7
iguana 7
immune 7
incest 7
incite 7
indeed 7
indict 7
infant 7
inhale 7
invade 7
irrupt 7
issued 7
jacket 7
jailor 7
jammed 7
jasmin 7
jiggly 7
jigsaw 7
kennel 7
kidney 7
larvae 7
lather 7
layout 7
leader 7
learnt 7
litmus 7
lounge 7
lowest 7
magnum 7
mallet 7
mammal 7
marvel 7
masala 7
mayhem 7
meddle 7
median 7
memory 7
merely 7
midget 7
minnow 7
minute 7
mirage 7
monger 7
morbid 7
mortal 7
muesli 7
murmur 7
nettle 7
neuron 7
notify 7
nougat 7
nought 7
novice 7
nozzle 7
object 7
obtain 7
ordain 7
ornate 7
outlet 7
pacify 7
parade 7
parcel 7
parrot 7
patter 7
peruse 7
piracy 7
plaque 7
pledge 7
poodle 7
poppet 7
possum 7
potent 7
pounce 7
prince 7
puddle 7
puffin 7
puzzle 7
quaint 7
quiche 7
quirky 7
qwerty 7
radian 7
radish 7
rancid 7
rarely 7
ration 7
rebook 7
record 7
reflex 7
reheat 7
relate 7
relief 7
renown 7
rental 7
repeat 7
resist 7
resume 7
reverb 7
review 7
revoke 7
riddle 7
riffle 7
salami 7
sandal 7
scalar 7
scared 7
sensor 7
sequel 7
settle 7
sextet 7
shabby 7
shadow 7
shears 7
should 7
shrill 7
silver 7
sinful 7
single 7
slouch 7
smidge 7
social 7
socket 7
soften 7
sonnet 7
sorrow 7
sought 7
speedy 7
sphynx 7
spinal 7
sponge 7
spongy 7
sprawl 7
stanza 7
starve 7
stasis 7
static 7
sticky 7
stigma 7
stingy 7
strand 7
stream 7
strobe 7
strong 7
struck 7
submit 7
suffix 7
summit 7
susses 7
swampy 7
swerve 7
swoosh 7
tailor 7
talcum 7
tamale 7
teensy 7
temper 7
tenure 7
terror 7
thwack 7
tictac 7
tiptoe 7
touche 7
tracer 7
treaty 7
tricep 7
unfold 7
united 7
unpack 7
unsure 7
untold 7
update 7
upmost 7
vacate 7
velvet 7
vermin 7
voodoo 7
waddle 7
warily 7
warmup 7
weirdo 7
whoosh 7
willow 7
within 7
worthy 7
writer 7
absorb 6
accent 6
accept 6
action 6
actual 6
afloat 6
aghast 6
allium 6
allure 6
almost 6
always 6
amount 6
ampere 6
anthem 6
appeal 6
arrest 6
asleep 6
attack 6
attest 6
babble 6
baffle 6
bamboo 6
barren 6
binder 6
bionic 6
bitter 6
blazer 6
blotch 6
blowup 6
bobber 6
bodega 6
boiler 6
bought 6
boxing 6
breeze 6
budget 6
bunker 6
caliph 6
campus 6
canine 6
canvas 6
cardio 6
career 6
cartel 6
cashew 6
casket 6
catnap 6
chisel 6
chunky 6
circle 6
citric 6
clammy 6
clutch 6
coaxal 6
cobweb 6
coffin 6
copter 6
cortex 6
cosine 6
crafty 6
creepy 6
crutch 6
custom 6
cyclic 6
danger 6
dangle 6
debate 6
debris 6
deceit 6
defied 6
deploy 6
derail 6
detail 6
devise 6
diaper 6
dingle 6
disown 6
donate 6
downer 6
drowsy 6
durian 6
earwax 6
easier 6
emerge 6
engine 6
engulf 6
equity 6
ethane 6
expert 6
extend 6
fabric 6
fandom 6
fasten 6
feisty 6
flinch 6
fossil 6
fourth 6
frappe 6
freeze 6
fringe 6
frolic 6
frugal 6
fumble 6
fungus 6
garble 6
gargle 6
gender 6
gerbil 6
glance 6
gospel 6
grades 6
grapes 6
grease 6
grieve 6
grinch 6
guilty 6
gutter 6
hairdo 6
hallow 6
handle 6
healer 6
hermit 6
heroes 6
holdup 6
hostel 6
iambic 6
icicle 6
impair 6
import 6
infamy 6
infect 6
infest 6
influx 6
inmate 6
insect 6
inside 6
intake 6
inward 6
isomer 6
itself 6
jacked 6
jagged 6
jitter 6
joyful 6
juggle 6
kindle 6
knight 6
lament 6
latter 6
launch 6
lavish 6
lender 6
liable 6
lichen 6
lineup 6
liquid 6
listen 6
loafer 6
locket 6
loiter 6
lovely 6
luxury 6
manage 6
manual 6
master 6
mature 6
memoir 6
middle 6
mimosa 6
mobile 6
mosaic 6
mostly 6
motive 6
muffin 6
muffle 6
mutate 6
mutiny 6
mythic 6
namely 6
nation 6
nausea 6
nearby 6
nerves 6
newbie 6
nickel 6
normal 6
notate 6
notice 6
nuance 6
oblige 6
oblong 6
ocelot 6
offend 6
online 6
orange 6
orchid 6
outage 6
outrun 6
overdo 6
overly 6
oyster 6
pamper 6
pantry 6
parody 6
payout 6
peachy 6
peddle 6
permit 6
photon 6
pickle 6
piglet 6
pillar 6
pinkie 6
player 6
please 6
plight 6
plural 6
poetry 6
poison 6
policy 6
polite 6
ponder 6
poorly 6
powder 6
praise 6
pseudo 6
pummel 6
pushup 6
pyrite 6
quartz 6
radius 6
random 6
rarity 6
raunch 6
rebuke 6
recede 6
region 6
regret 6
remake 6
remove 6
resign 6
revert 6
rewind 6
rewire 6
reword 6
rework 6
ridden 6
rotary 6
sachet 6
satire 6
scathe 6
scrape 6
scribe 6
sculpt 6
scythe 6
seabed 6
seldom 6
senate 6
septum 6
series 6
shaker 6
shalom 6
sheesh 6
shield 6
shrine 6
simply 6
sister 6
skewer 6
skylit 6
sleuth 6
slippy 6
sliver 6
sloppy 6
smarty 6
sneeze 6
solemn 6
soothe 6
sorely 6
source 6
splash 6
sprout 6
square 6
squawk 6
statue 6
stifle 6
stormy 6
strict 6
strike 6
string 6
stroke 6
suckle 6
summer 6
supply 6
system 6
talent 6
tamper 6
tariff 6
tenner 6
tether 6
tetris 6
theory 6
though 6
thread 6
thrill 6
tickle 6
tingle 6
tinsel 6
toggle 6
tomato 6
topple 6
torque 6
toucan 6
tragic 6
treble 6
tribal 6
triple 6
trivia 6
tryout 6
turkey 6
turnip 6
turret 6
tussle 6
tuxedo 6
umlaut 6
unable 6
uneasy 6
uneven 6
unfair 6
unless 6
unwrap 6
uphold 6
uptown 6
urchin 6
utopia 6
vacant 6
vanity 6
veggie 6
verify 6
viable 6
vilify 6
waggle 6
walker 6
wanted 6
wasabi 6
webcam 6
weekly 6
worsen 6
wrench 6
wyvern 6
yonder 6
abduct 5
abroad 5
access 5
active 5
adored 5
advice 5
affect 5
afford 5
agenda 5
albeit 5
almond 5
anarch 5
applet 5
ascent 5
assume 5
aurora 5
ballet 5
barrel 5
behind 5
beluga 5
bestie 5
blouse 5
bobcat 5
boomer 5
bottle 5
buffer 5
burger 5
calmly 5
casing 5
cellar 5
cereal 5
cerium 5
cherry 5
client 5
clunky 5
coarse 5
cobalt 5
coding 5
cohere 5
concur 5
convex 5
convoy 5
cookie 5
cougar 5
course 5
cousin 5
coward 5
crayon 5
cuddle 5
cutoff 5
deface 5
dental 5
digest 5
dipole 5
divert 5
donkey 5
double 5
drawer 5
driver 5
earful 5
effort 5
elicit 5
elytra 5
emblem 5
enamel 5
enrich 5
eraser 5
except 5
expect 5
facade 5
fester 5
fiesta 5
finish 5
fleece 5
fluent 5
former 5
frosty 5
fusion 5
futile 5
gaslit 5
glitch 5
global 5
gneiss 5
golden 5
gotcha 5
gothic 5
gravel 5
growth 5
hacker 5
hangar 5
heckle 5
helium 5
helmet 5
hereby 5
herpes 5
hiatus 5
hidden 5
highly 5
hiking 5
hobbit 5
homing 5
horsey 5
ickier 5
idiocy 5
indigo 5
inject 5
injury 5
insert 5
insure 5
jersey 5
jumble 5
keypad 5
kidnap 5
kimono 5
kosher 5
kraken 5
ladder 5
lagoon 5
larynx 5
lassie 5
lately 5
layoff 5
legend 5
letter 5
linear 5
little 5
living 5
loudly 5
lumber 5
makeup 5
marble 5
markup 5
marshy 5
meadow 5
medley 5
micron 5
milage 5
misfit 5
mister 5
modern 5
modify 5
molten 5
mortar 5
mumble 5
nature 5
needle 5
nibble 5
noodle 5
number 5
nutmeg 5
oblate 5
oldest 5
oolong 5
opener 5
panama 5
pastry 5
patchy 5
patent 5
peanut 5
pepper 5
perish 5
pester 5
pizazz 5
pocket 5
porter 5
priest 5
primal 5
proper 5
psycho 5
pulley 5
punish 5
pursue 5
quench 5
racism 5
rapper 5
raptor 5
ratify 5
reboot 5
recess 5
recipe 5
recoil 5
recoup 5
redact 5
render 5
retail 5
reveal 5
revolt 5
reward 5
rioter 5
ripoff 5
risque 5
robust 5
rocket 5
roster 5
rotate 5
router 5
rubber 5
rustle 5
saliva 5
salute 5
scotch 5
season 5
secret 5
sector 5
sedate 5
seeker 5
sensei 5
sentry 5
serene 5
sermon 5
severe 5
shaken 5
shaped 5
sherry 5
shrunk 5
shtick 5
siphon 5
skater 5
slinky 5
slogan 5
smooch 5
smudge 5
snitch 5
snooze 5
sparse 5
spigot 5
spiral 5
sprint 5
spurge 5
squeal 5
squirt 5
steamy 5
stitch 5
strafe 5
stupid 5
stylus 5
sucker 5
sugary 5
sundae 5
supper 5
sweaty 5
tackle 5
tattle 5
taxman 5
tenant 5
tendon 5
tester 5
thirty 5
thrash 5
threat 5
thrift 5
thrive 5
ticker 5
ticket 5
timely 5
tingly 5
toffee 5
toilet 5
toward 5
travel 5
tricky 5
turban 5
tycoon 5
undead 5
unrest 5
urgent 5
useful 5
vacuum 5
violet 5
virtue 5
volley 5
waiter 5
walnut 5
warmth 5
wisdom 5
worker 5
xylene 5
yakuza 5
acacia 4
advise 4
allege 4
alpine 4
appall 4
appear 4
arrive 4
ashore 4
assail 4
baboon 4
beckon 4
bellow 4
beware 4
biopsy 4
birdie 4
bleach 4
bother 4
broker 4
brutal 4
bundle 4
burlap 4
caring 4
casino 4
causal 4
cheese 4
choice 4
cinder 4
clothe 4
coccyx 4
cooler 4
copper 4
cornea 4
cringe 4
critic 4
crypto 4
cymbal 4
dabble 4
deadly 4
deduce 4
demand 4
denial 4
dynamo 4
earthy 4
eleven 4
embark 4
empath 4
eureka 4
exhume 4
falcon 4
faulty 4
feline 4
fiasco 4
forget 4
galaxy 4
german 4
ghetto 4
glider 4
govern 4
gypsum 4
hangul 4
happen 4
hashes 4
hitman 4
homage 4
honest 4
incase 4
indoor 4
infuse 4
intern 4
iodine 4
island 4
jockey 4
kelvin 4
kernel 4
larger 4
legacy 4
legion 4
length 4
lively 4
locale 4
lockup 4
locust 4
lookup 4
lychee 4
magpie 4
maiden 4
marina 4
martyr 4
meanie 4
merger 4
method 4
metric 4
modest 4
muddle 4
muster 4
mutant 4
nearly 4
nestle 4
nimble 4
nobody 4
nugget 4
obtuse 4
octane 4
ocular 4
ordure 4
outfit 4
paella 4
pastel 4
pellet 4
pelvis 4
poetic 4
prance 4
proton 4
public 4
purify 4
rabbit 4
radial 4
raider 4
raisin 4
ravish 4
reaper 4
reason 4
refill 4
refute 4
reject 4
resize 4
resold 4
retake 4
retire 4
ritual 4
sacred 4
salmon 4
secant 4
secede 4
shader 4
shades 4
sheath 4
shorty 4
slowly 4
snarky 4
sniper 4
spouse 4
squire 4
staged 4
staple 4
stress 4
subdue 4
suburb 4
sudden 4
summon 4
syntax 4
tactic 4
teacup 4
teapot 4
techno 4
thesis 4
trance 4
tremor 4
turtle 4
twelve 4
unique 4
unseen 4
untidy 4
untrue 4
unwell 4
unwind 4
urinal 4
vector 4
vendor 4
verbal 4
viking 4
visual 4
waiver 4
wallet 4
warden 4
window 4
wonder 4
yodler 4
ablaze 3
abound 3
affirm 3
alcove 3
amoeba 3
anyhow 3
anyone 3
assess 3
awning 3
behave 3
bishop 3
bodily 3
bottom 3
breast 3
buckle 3
butler 3
cackle 3
candid 3
canola 3
casava 3
charge 3
cleric 3
decant 3
delete 3
demise 3
dinner 3
doofus 3
eighty 3
enrage 3
enzyme 3
exiled 3
famine 3
famous 3
fennel 3
funnel 3
gadget 3
gallop 3
genome 3
gyrate 3
hamper 3
heater 3
hombre 3
hyphen 3
impact 3
income 3
induce 3
ingest 3
invert 3
ionize 3
mainly 3
mentor 3
minima 3
murder 3
myriad 3
narrow 3
nordic 3
oculus 3
oppose 3
oxygen 3
pardon 3
parole 3
pastor 3
picket 3
pistol 3
potato 3
preset 3
puffer 3
purity 3
quinoa 3
rabies 3
raffle 3
ravage 3
remark 3
remind 3
retain 3
retell 3
rubble 3
sadden 3
safety 3
saline 3
salted 3
sanity 3
scarce 3
search 3
secure 3
select 3
shanty 3
shriek 3
sleepy 3
spread 3
sprite 3
squish 3
surfer 3
swatch 3
tassel 3
throat 3
thrust 3
tinkle 3
toupee 3
trader 3
trashy 3
triage 3
unveil 3
valley 3
victim 3
walrus 3
weapon 3
welder 3
widget 3
behold 2
booger 2
caesar 2
cloudy 2
cohort 2
commit 2
depart 2
dimmer 2
dingus 2
domain 2
ensure 2
facial 2
goodie 2
grudge 2
gurgle 2
harass 2
hurtle 2
hybrid 2
invoke 2
midday 2
pencil 2
really 2
repent 2
return 2
saloon 2
saying 2
script 2
senile 2
server 2
sewage 2
shrink 2
stance 2
subpar 2
sullen 2
tartan 2
tartar 2
temple 2
tongue 2
tootle 2
typist 2
unjust 2
unsafe 2
upload 2
velcro 2
whiten 2
zigzag 2
bonnet 1
cinema 1
climax 1
employ 1
papaya 1
second 1
topper 1`;
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

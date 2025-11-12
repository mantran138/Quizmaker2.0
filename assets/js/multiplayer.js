import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    onSnapshot,
    collection,
    query,
    addDoc,
    getDocs,
    deleteDoc,
    runTransaction,
    arrayUnion,
    orderBy,
    limit,
    writeBatch,
    setLogLevel
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

setLogLevel("debug");

async function loadFirebaseConfig() {
    if (typeof window.__firebase_config !== "undefined") {
        return {
            firebaseConfig: JSON.parse(window.__firebase_config),
            initialAuthToken: typeof window.__initial_auth_token !== "undefined" ? window.__initial_auth_token : null
        };
    }

    try {
        return await import("../../config/firebaseConfig.js");
    } catch (error) {
        console.warn("Using example Firebase config. Copy config/firebaseConfig.example.js to config/firebaseConfig.js and fill in your project credentials.");
        return await import("../../config/firebaseConfig.js");
    }
}

const { firebaseConfig, initialAuthToken = null } = await loadFirebaseConfig();

const SCORING = {
    BASE_POINTS: 100,
    SPEED_BONUS_MAX: 50,
    STREAK_MULTIPLIER: 0.2,
    TIME_WINDOW: 10000
};

const ROOMS_COLLECTION = "quizRooms";

let app;
let db;
let auth;
let userId = null;
let userName = "";
let currentRoomId = null;
let currentQuiz = null;
let currentQuestionIndex = 0;
let isHost = false;
let unsubscribeRoom = null;
let unsubscribePlayers = null;
let unsubscribeChat = null;

const elements = {
    authStatus: document.getElementById("auth-status"),
    hostName: document.getElementById("host-name"),
    hostFileInput: document.getElementById("host-file-input"),
    hostFileStatus: document.getElementById("host-file-status"),
    createRoomBtn: document.getElementById("create-room-btn"),
    hostError: document.getElementById("host-error"),
    joinName: document.getElementById("joiner-name"),
    joinRoomCode: document.getElementById("room-code"),
    joinRoomBtn: document.getElementById("join-room-btn"),
    joinError: document.getElementById("joiner-error"),
    multiplayerMode: document.getElementById("multiplayer-mode"),
    multiplayerLobby: document.getElementById("multiplayer-lobby"),
    lobbyRoomCode: document.getElementById("lobby-room-code"),
    hostStartSection: document.getElementById("host-start-section"),
    lobbyPlayersList: document.getElementById("lobby-players-list"),
    playerCount: document.getElementById("player-count"),
    lobbyChatMessages: document.getElementById("lobby-chat-messages"),
    lobbyChatInput: document.getElementById("lobby-chat-input"),
    lobbyChatSend: document.getElementById("lobby-chat-send"),
    startGameBtn: document.getElementById("start-game-btn"),
    leaveRoomBtn: document.getElementById("leave-room-btn"),
    multiplayerGame: document.getElementById("multiplayer-game"),
    scoreboard: document.getElementById("game-scoreboard"),
    gameChatMessages: document.getElementById("chat-messages"),
    gameChatInput: document.getElementById("chat-input"),
    gameChatSend: document.getElementById("game-chat-send"),
    quizCard: document.getElementById("multiplayer-quiz-card"),
    questionNumber: document.getElementById("mp-question-number"),
    questionText: document.getElementById("mp-question-text"),
    answersContainer: document.getElementById("mp-answers-container"),
    feedback: document.getElementById("mp-feedback"),
    actionMessage: document.getElementById("mp-action-message"),
    nextBtn: document.getElementById("mp-next-btn"),
    gameEnd: document.getElementById("mp-game-end")
};

function bindUI() {
    elements.hostFileInput?.addEventListener("change", () => {
        const file = elements.hostFileInput.files?.[0];
        elements.hostFileStatus.textContent = file ? file.name : "No file selected.";
    });

    elements.createRoomBtn?.addEventListener("click", hostRoom);
    elements.joinRoomBtn?.addEventListener("click", joinRoom);
    elements.startGameBtn?.addEventListener("click", startMultiplayerGame);
    elements.leaveRoomBtn?.addEventListener("click", () => leaveRoom(false));

    elements.lobbyChatSend?.addEventListener("click", sendChatMessage);
    elements.gameChatSend?.addEventListener("click", sendChatMessage);

    elements.lobbyChatInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            sendChatMessage();
        }
    });

    elements.gameChatInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            sendChatMessage();
        }
    });

    if (elements.nextBtn) {
        elements.nextBtn.addEventListener("click", advanceQuestion);
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get("room");
    if (code && elements.joinRoomCode) {
        elements.joinRoomCode.value = code.toUpperCase();
        elements.joinName?.focus();
    }
}

bindUI();
initializeFirebase();

async function initializeFirebase() {
    try {
        if (!firebaseConfig || Object.keys(firebaseConfig).length === 0) {
            elements.authStatus.textContent = "⚠️ Firebase config missing";
            return;
        }

        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        elements.authStatus.textContent = "Authenticating...";

        await new Promise((resolve) => {
            const unsubscribe = onAuthStateChanged(auth, async (user) => {
                if (user) {
                    userId = user.uid;
                    elements.authStatus.textContent = `User ID: ${userId}`;
                    unsubscribe();
                    resolve();
                    return;
                }

                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                    userId = auth.currentUser.uid;
                    elements.authStatus.textContent = `User ID: ${userId}`;
                } catch (error) {
                    console.error("Auth error", error);
                    elements.authStatus.textContent = "Auth failed";
                }

                unsubscribe();
                resolve();
            });
        });
    } catch (error) {
        console.error("Firebase init error", error);
        elements.authStatus.textContent = "Firebase init failed";
    }
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function hostRoom() {
    const name = elements.hostName?.value.trim();
    const file = elements.hostFileInput?.files?.[0] ?? null;
    elements.hostError.textContent = "";

    if (!name || !file) {
        elements.hostError.textContent = "Enter your name and upload a quiz JSON.";
        return;
    }
    if (file.type !== "application/json") {
        elements.hostError.textContent = "Please upload a valid JSON file.";
        return;
    }
    if (!userId) {
        elements.hostError.textContent = "Authentication pending. Try again.";
        return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const quizJson = JSON.parse(event.target.result);
            if (!quizJson.questions || !Array.isArray(quizJson.questions) || quizJson.questions.length === 0) {
                throw new Error("Invalid quiz format.");
            }

            quizJson.questions.forEach((question) => {
                if (!Array.isArray(question.options) || question.correct == null) {
                    return;
                }
                const correctAnswer = question.options[question.correct];
                const shuffledIndices = [...Array(question.options.length).keys()];
                for (let i = shuffledIndices.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
                }
                const shuffledOptions = shuffledIndices.map((idx) => question.options[idx]);
                question.options = shuffledOptions;
                question.correct = shuffledOptions.indexOf(correctAnswer);
            });

            const roomId = generateRoomId();
            const roomRef = doc(db, ROOMS_COLLECTION, roomId);
            const roomData = {
                roomId,
                hostId: userId,
                hostName: name,
                quiz: quizJson,
                state: "lobby",
                currentQuestionIndex: 0,
                createdAt: Date.now(),
                questionStartTime: null,
                playersAnswered: []
            };

            await setDoc(roomRef, roomData);

            currentRoomId = roomId;
            isHost = true;
            userName = name;

            await addPlayerToRoom(roomId, name, true);
            setupLobby(roomId);
        } catch (error) {
            console.error("Host error", error);
            elements.hostError.textContent = `Failed to create room: ${error.message}`;
        }
    };

    reader.readAsText(file);
}

async function joinRoom() {
    const name = elements.joinName?.value.trim();
    const roomId = elements.joinRoomCode?.value.trim().toUpperCase();
    elements.joinError.textContent = "";

    if (!name || !roomId) {
        elements.joinError.textContent = "Enter your name and the room code.";
        return;
    }
    if (!userId) {
        elements.joinError.textContent = "Authentication pending. Try again.";
        return;
    }

    try {
        const roomRef = doc(db, ROOMS_COLLECTION, roomId);
        const roomSnap = await getDoc(roomRef);

        if (!roomSnap.exists()) {
            alertModal(`Room code "${roomId}" not found.`);
            elements.joinError.textContent = `Room code "${roomId}" not found.`;
            return;
        }

        const roomData = roomSnap.data();
        if (roomData.state !== "lobby") {
            elements.joinError.textContent = "Game already started or finished.";
            return;
        }

        currentRoomId = roomId;
        isHost = false;
        userName = name;

        await addPlayerToRoom(roomId, name, false);
        setupLobby(roomId);
    } catch (error) {
        console.error("Join error", error);
        elements.joinError.textContent = "Unable to join room. Try again.";
    }
}

async function addPlayerToRoom(roomId, name, host) {
    const playerRef = doc(db, ROOMS_COLLECTION, roomId, "players", userId);
    const playerDoc = {
        id: userId,
        name,
        score: 0,
        killstreak: 0,
        currentQuestionIndex: 0,
        isHost: host,
        lastAnswerTime: 0
    };
    await setDoc(playerRef, playerDoc);
}

function setupLobby(roomId) {
    elements.multiplayerMode.style.display = "none";
    elements.multiplayerLobby.style.display = "block";
    elements.lobbyRoomCode.textContent = roomId;

    if (isHost) {
        elements.hostStartSection.style.display = "block";
    } else {
        elements.hostStartSection.style.display = "none";
    }

    clearChatUI();
    unsubscribeChat = setupChatListener();

    const roomRef = doc(db, ROOMS_COLLECTION, roomId);
    unsubscribeRoom = onSnapshot(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            alertModal("Room closed by host.", () => leaveRoom(false));
            return;
        }

        const roomData = snapshot.data();
        currentQuiz = roomData.quiz;
        currentQuestionIndex = roomData.currentQuestionIndex ?? 0;

        if (roomData.state === "playing") {
            startGameView(roomData);
        } else if (roomData.state === "finished") {
            startGameView(roomData);
            showMultiplayerResults();
        } else if (roomData.state === "lobby") {
            elements.multiplayerLobby.style.display = "block";
            elements.multiplayerGame.style.display = "none";
            if (isHost) {
                elements.hostStartSection.style.display = "block";
            } else {
                elements.hostStartSection.style.display = "none";
            }
            elements.gameEnd.classList.add("hidden");
            elements.gameEnd.innerHTML = `
                <h3 class="text-3xl font-bold text-green-700">Game Over!</h3>
                <p id="mp-final-message" class="text-xl mt-2"></p>
            `;
        }
    });

    const playersRef = collection(db, ROOMS_COLLECTION, roomId, "players");
    unsubscribePlayers = onSnapshot(playersRef, (querySnapshot) => {
        const players = [];
        querySnapshot.forEach((docSnap) => players.push(docSnap.data()));
        updateLobbyPlayers(players);
        updateScoreboard(players);
    });
}

function updateLobbyPlayers(players) {
    if (!elements.lobbyPlayersList) return;

    elements.lobbyPlayersList.innerHTML = "";
    elements.playerCount.textContent = players.length;

    players.sort((a, b) => Number(b.isHost) - Number(a.isHost));

    players.forEach((player) => {
        const card = document.createElement("div");
        card.className = `player-card p-4 rounded-xl text-center flex items-center justify-between ${player.isHost ? "is-host" : "bg-white"} ${player.id === userId ? "current-user" : ""}`;
        const roleBadge = player.isHost
            ? '<span class="text-xs font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">HOST</span>'
            : '<span class="text-xs font-bold text-gray-700 bg-gray-200 px-2 py-0.5 rounded-full">Player</span>';

        card.innerHTML = `
            <div class="flex items-center space-x-3">
                <span class="text-2xl">${player.isHost ? "👑" : "🧑‍💻"}</span>
                <div>
                    <p class="font-semibold text-gray-800">${player.name} ${player.id === userId ? "(You)" : ""}</p>
                    <p class="text-xs text-gray-500">ID: ${player.id.substring(0, 4)}...</p>
                </div>
            </div>
            ${roleBadge}
        `;

        elements.lobbyPlayersList.appendChild(card);
    });
}

async function startMultiplayerGame() {
    if (!isHost || !currentRoomId) return;

    const roomRef = doc(db, ROOMS_COLLECTION, currentRoomId);
    await updateDoc(roomRef, {
        state: "playing",
        currentQuestionIndex: 0,
        questionStartTime: Date.now(),
        playersAnswered: []
    });
}

function startGameView(roomData) {
    elements.multiplayerLobby.style.display = "none";
    elements.multiplayerGame.style.display = "grid";

    currentQuiz = roomData.quiz;
    currentQuestionIndex = roomData.currentQuestionIndex ?? 0;

    if (!currentQuiz || !currentQuiz.questions) {
        elements.actionMessage.textContent = "Quiz data missing.";
        elements.actionMessage.style.display = "block";
        return;
    }

    if (roomData.state === "playing") {
        showMultiplayerQuestion(currentQuestionIndex);
        elements.actionMessage.style.display = "none";
    } else if (roomData.state === "lobby") {
        elements.quizCard.style.display = isHost ? "block" : "none";
        elements.actionMessage.textContent = "Waiting for host to start the quiz...";
        elements.actionMessage.style.display = isHost ? "none" : "block";
    } else if (roomData.state === "finished") {
        showMultiplayerResults();
    }

    if (isHost) {
        elements.nextBtn.style.display = "block";
        updateNextBtnLabel();
    } else {
        elements.nextBtn.style.display = "none";
    }
}

function showMultiplayerQuestion(index) {
    const total = currentQuiz.questions.length;
    if (index >= total) {
        if (isHost) {
            finishMultiplayerGame();
        }
        return;
    }

    currentQuestionIndex = index;
    const question = currentQuiz.questions[index];

    elements.quizCard.style.display = "block";
    elements.gameEnd.classList.add("hidden");
    elements.feedback.style.display = "none";

    elements.questionNumber.textContent = `Question ${index + 1} of ${total}`;
    elements.questionText.textContent = question.question;

    elements.answersContainer.innerHTML = "";
    question.options.forEach((option, optionIndex) => {
        const button = document.createElement("button");
        button.className = "answer-btn w-full p-3 mb-2 bg-gray-100 border border-gray-300 rounded-lg text-left text-gray-700 font-medium hover:bg-gray-200 transition-colors";
        button.textContent = option;
        button.addEventListener("click", () => handleMultiplayerAnswer(index, optionIndex, button));
        elements.answersContainer.appendChild(button);
    });

    if (isHost) {
        updateNextBtnLabel();
    }
}

function updateNextBtnLabel() {
    const total = currentQuiz?.questions?.length ?? 0;
    if (!elements.nextBtn || total === 0) return;
    const isLast = currentQuestionIndex >= total - 1;
    elements.nextBtn.textContent = isLast ? "End Game" : `Advance to Question ${currentQuestionIndex + 2}`;
}

async function handleMultiplayerAnswer(questionIndex, selectedIndex, buttonElement) {
    if (!currentRoomId || !currentQuiz) return;

    const question = currentQuiz.questions[questionIndex];
    const isCorrect = selectedIndex === question.correct;
    const roomRef = doc(db, ROOMS_COLLECTION, currentRoomId);
    const playerRef = doc(db, ROOMS_COLLECTION, currentRoomId, "players", userId);

    document.querySelectorAll("#mp-answers-container .answer-btn").forEach((btn) => {
        btn.classList.add("disabled", "cursor-not-allowed");
        btn.disabled = true;
    });

    buttonElement.classList.remove("bg-gray-100", "border-gray-300");
    buttonElement.classList.add(isCorrect ? "correct" : "incorrect");
    const correctButton = elements.answersContainer.children[question.correct];
    correctButton.classList.add("correct");

    const roomSnap = await getDoc(roomRef);
    const roomData = roomSnap.data();
    const answerTime = Date.now();
    const timeTaken = answerTime - (roomData.questionStartTime ?? answerTime);
    const speedBonus = Math.max(0, Math.floor(SCORING.SPEED_BONUS_MAX * (1 - timeTaken / SCORING.TIME_WINDOW)));

    await updateDoc(roomRef, { playersAnswered: arrayUnion(userId) });

    elements.feedback.className = `feedback p-3 mt-4 rounded-lg font-semibold ${isCorrect ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`;
    elements.feedback.innerHTML = `
        ${isCorrect ? "✅ Correct!" : "❌ Incorrect."}
        <span class="font-normal block mt-1">${question.explanation || ""}</span>
    `;
    elements.feedback.style.display = "block";

    try {
        await runTransaction(db, async (transaction) => {
            const playerSnap = await transaction.get(playerRef);
            if (!playerSnap.exists()) return;

            const playerData = playerSnap.data();
            let newScore = playerData.score;
            let newKillstreak = playerData.killstreak;
            let pointChange = 0;

            if (isCorrect) {
                newKillstreak += 1;
                pointChange = SCORING.BASE_POINTS + speedBonus;
                if (newKillstreak >= 2) {
                    pointChange += Math.floor(pointChange * (newKillstreak * SCORING.STREAK_MULTIPLIER));
                }
                newScore += pointChange;
                elements.feedback.innerHTML += `
                    <p class="mt-2 text-sm">
                        🔥 +${pointChange} points
                        ${speedBonus > 0 ? `(Speed bonus +${speedBonus})` : ""}
                        (Killstreak ${newKillstreak}x)
                    </p>`;
            } else {
                newKillstreak = 0;
                elements.feedback.innerHTML += '<p class="mt-2 text-sm">💥 Killstreak broken.</p>';
            }

            transaction.update(playerRef, {
                score: newScore,
                killstreak: newKillstreak,
                currentQuestionIndex: questionIndex + 1,
                lastAnswerTime: answerTime
            });
        });

        const updatedRoomSnap = await getDoc(roomRef);
        const updatedRoomData = updatedRoomSnap.data();
        const playersSnap = await getDocs(collection(db, ROOMS_COLLECTION, currentRoomId, "players"));
        const totalPlayers = playersSnap.size;

        if ((updatedRoomData.playersAnswered?.length ?? 0) >= totalPlayers) {
            if (questionIndex < currentQuiz.questions.length - 1) {
                await updateDoc(roomRef, {
                    currentQuestionIndex: questionIndex + 1,
                    questionStartTime: Date.now(),
                    playersAnswered: []
                });
            } else {
                await updateDoc(roomRef, { state: "finished" });
            }
        }
    } catch (error) {
        console.error("Score transaction failed", error);
    }
}

async function advanceQuestion() {
    if (!isHost || !currentRoomId || !currentQuiz) return;

    const total = currentQuiz.questions.length;
    if (currentQuestionIndex >= total - 1) {
        await finishMultiplayerGame();
        return;
    }

    const roomRef = doc(db, ROOMS_COLLECTION, currentRoomId);
    await updateDoc(roomRef, {
        currentQuestionIndex: currentQuestionIndex + 1,
        questionStartTime: Date.now(),
        playersAnswered: []
    });
    showMultiplayerQuestion(currentQuestionIndex + 1);
}

async function finishMultiplayerGame() {
    if (!isHost || !currentRoomId) return;
    const roomRef = doc(db, ROOMS_COLLECTION, currentRoomId);
    await updateDoc(roomRef, { state: "finished" });
}

function showMultiplayerResults() {
    elements.quizCard.style.display = "none";
    elements.nextBtn.style.display = "none";
    elements.gameEnd.classList.remove("hidden");
    elements.gameEnd.innerHTML = "";

    const scoreboardRows = Array.from(elements.scoreboard.children).map((row) => {
        const nameEl = row.querySelector(".font-semibold");
        const scoreEl = row.querySelector(".font-extrabold, .font-bold, .text-2xl");
        const baseName = nameEl?.textContent?.replace(" (You)", "") ?? "";
        const scoreValue = parseInt(scoreEl?.textContent ?? "0", 10);
        return { name: baseName, score: scoreValue };
    }).sort((a, b) => b.score - a.score);

    const winner = scoreboardRows[0] ?? { name: "No players", score: 0 };

    const message = document.createElement("div");
    message.id = "mp-final-message";
    message.innerHTML = `
        🎉 Game Over!<br>
        Winner: <span class="text-indigo-600 font-bold">${winner.name}</span> with ${winner.score} points!
    `;
    elements.gameEnd.appendChild(message);

    const actionButtons = document.createElement("div");
    actionButtons.className = "flex gap-4 justify-center mt-6";
    actionButtons.innerHTML = `
        ${isHost ? `
            <button onclick="startRebattle()" class="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                🔄 Start Rebattle
            </button>
        ` : `
            <button disabled class="px-6 py-3 bg-gray-400 text-white rounded-lg cursor-not-allowed">
                Waiting for host...
            </button>
        `}
        <button onclick="exitRoom()" class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors">
            🚪 Exit Room
        </button>
    `;
    elements.gameEnd.appendChild(actionButtons);
}

async function startRebattle() {
    if (!isHost || !currentRoomId) return;

    if (document.getElementById("rebattle-dialog")) return;

    const dialog = document.createElement("div");
    dialog.id = "rebattle-dialog";
    dialog.className = "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50";
    dialog.innerHTML = `
        <div class="bg-white p-6 rounded-xl max-w-md w-full">
            <h3 class="text-xl font-bold mb-4">Choose Rebattle Option</h3>
            <div class="space-y-4">
                <button id="reuse-quiz-btn" class="w-full p-4 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors text-left">
                    <span class="block font-bold">♻️ Reuse Current Quiz</span>
                    <span class="text-sm text-indigo-600">Start a new battle with the same questions</span>
                </button>
                <button id="upload-new-quiz-btn" class="w-full p-4 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors text-left">
                    <span class="block font-bold">📤 Upload New Quiz</span>
                    <span class="text-sm text-purple-600">Start a new battle with different questions</span>
                </button>
            </div>
            <div class="mt-4 text-right">
                <button id="rebattle-cancel-btn" class="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);

    document.getElementById("reuse-quiz-btn")?.addEventListener("click", reuseQuiz);
    document.getElementById("upload-new-quiz-btn")?.addEventListener("click", showNewQuizUpload);
    document.getElementById("rebattle-cancel-btn")?.addEventListener("click", () => dialog.remove());
}

async function reuseQuiz() {
    document.getElementById("rebattle-dialog")?.remove();
    if (!isHost || !currentRoomId) return;

    try {
        const roomRef = doc(db, ROOMS_COLLECTION, currentRoomId);
        await updateDoc(roomRef, {
            state: "lobby",
            currentQuestionIndex: 0,
            questionStartTime: null,
            playersAnswered: []
        });

        const playersRef = collection(db, ROOMS_COLLECTION, currentRoomId, "players");
        const players = await getDocs(playersRef);
        const batch = writeBatch(db);
        players.forEach((player) => {
            batch.update(player.ref, {
                score: 0,
                killstreak: 0,
                currentQuestionIndex: 0,
                lastAnswerTime: 0
            });
        });
        await batch.commit();

        elements.gameEnd.classList.add("hidden");
        elements.multiplayerGame.style.display = "none";
        elements.multiplayerLobby.style.display = "block";
    } catch (error) {
        console.error("Rebattle error", error);
        alert("Failed to start rebattle.");
    }
}

function showNewQuizUpload() {
    document.getElementById("rebattle-dialog")?.remove();
    if (document.getElementById("rebattle-upload-dialog")) return;

    const uploadDialog = document.createElement("div");
    uploadDialog.id = "rebattle-upload-dialog";
    uploadDialog.className = "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50";
    uploadDialog.innerHTML = `
        <div class="bg-white p-6 rounded-xl max-w-md w-full">
            <h3 class="text-xl font-bold mb-4">Upload New Quiz for Rebattle</h3>
            <input type="file" id="rebattle-file" accept=".json" class="w-full mb-4">
            <div class="flex justify-end gap-4">
                <button id="rebattle-upload-cancel" class="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
                <button id="rebattle-upload-confirm" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Start New Battle</button>
            </div>
        </div>
    `;
    document.body.appendChild(uploadDialog);

    document.getElementById("rebattle-upload-cancel")?.addEventListener("click", () => uploadDialog.remove());
    document.getElementById("rebattle-upload-confirm")?.addEventListener("click", confirmRebattle);
}

async function confirmRebattle() {
    const fileInput = document.getElementById("rebattle-file");
    const file = fileInput?.files?.[0] ?? null;
    if (!file) {
        alert("Select a quiz file before continuing.");
        return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const quizJson = JSON.parse(event.target.result);
            if (!quizJson.questions || !Array.isArray(quizJson.questions) || quizJson.questions.length === 0) {
                throw new Error("Invalid quiz format");
            }

            const roomRef = doc(db, ROOMS_COLLECTION, currentRoomId);
            await updateDoc(roomRef, {
                quiz: quizJson,
                state: "lobby",
                currentQuestionIndex: 0,
                questionStartTime: null,
                playersAnswered: []
            });

            const playersRef = collection(db, ROOMS_COLLECTION, currentRoomId, "players");
            const players = await getDocs(playersRef);
            const batch = writeBatch(db);
            players.forEach((player) => {
                batch.update(player.ref, {
                    score: 0,
                    killstreak: 0,
                    currentQuestionIndex: 0,
                    lastAnswerTime: 0
                });
            });
            await batch.commit();

            document.getElementById("rebattle-upload-dialog")?.remove();
        } catch (error) {
            console.error("Rebattle upload error", error);
            alert("Failed to start rebattle: " + error.message);
        }
    };

    reader.readAsText(file);
}

async function exitRoom() {
    await leaveRoom(false);
    elements.multiplayerMode.style.display = "block";
}

function updateScoreboard(players) {
    if (!elements.scoreboard) return;
    elements.scoreboard.innerHTML = "";

    players.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.killstreak !== a.killstreak) return b.killstreak - a.killstreak;
        return (a.lastAnswerTime ?? 0) - (b.lastAnswerTime ?? 0);
    });

    players.forEach((player, index) => {
        const isCurrent = player.id === userId;
        const rankIcon = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "";
        const killstreakBadge = player.killstreak >= 2 ? `<span class="killstreak-badge text-sm font-extrabold text-red-600 ml-2 bg-red-100 px-2 rounded-full">${player.killstreak}x 🔥</span>` : "";

        const row = document.createElement("div");
        row.className = `p-3 flex justify-between items-center rounded-lg ${isCurrent ? "bg-indigo-100 border-2 border-indigo-500" : player.isHost ? "bg-gray-50" : "bg-white"}`;
        row.innerHTML = `
            <div class="flex items-center space-x-2">
                <span class="font-bold text-lg w-5 text-center">${rankIcon || index + 1}</span>
                <div class="truncate">
                    <span class="font-semibold text-gray-800 truncate">${player.name}${isCurrent ? " (You)" : ""}</span>
                    <div class="text-xs text-gray-500 flex items-center space-x-1">
                        <span>Q: ${player.currentQuestionIndex}</span>
                        ${killstreakBadge}
                    </div>
                </div>
            </div>
            <div class="font-extrabold text-2xl text-indigo-700">${player.score}</div>
        `;
        elements.scoreboard.appendChild(row);
    });
}

async function sendChatMessage() {
    if (!currentRoomId || !userId || !userName) return;

    let input = elements.gameChatInput;
    let message = input?.value?.trim();

    if (!message && elements.lobbyChatInput) {
        input = elements.lobbyChatInput;
        message = input?.value?.trim();
    }

    if (!message) return;

    input.disabled = true;
    try {
        const chatRef = collection(db, ROOMS_COLLECTION, currentRoomId, "chat");
        await addDoc(chatRef, {
            userId,
            userName,
            message,
            timestamp: Date.now()
        });
        input.value = "";
    } catch (error) {
        console.error("Chat send error", error);
        showChatError("Failed to send message. Check Firebase rules.");
    } finally {
        input.disabled = false;
        input.focus();
    }
}

function setupChatListener() {
    if (!currentRoomId) return null;

    try {
        const chatRef = collection(db, ROOMS_COLLECTION, currentRoomId, "chat");
        const chatQuery = query(chatRef, orderBy("timestamp", "asc"), limit(50));

        return onSnapshot(chatQuery, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type !== "added") return;
                const data = change.doc.data();
                renderChatMessage(data);
            });
        }, (error) => {
            console.error("Chat listener error", error);
            showChatError("Chat connection error. Please refresh.");
        });
    } catch (error) {
        console.error("Chat setup error", error);
        return null;
    }
}

function renderChatMessage(message) {
    const containers = [elements.gameChatMessages, elements.lobbyChatMessages].filter(Boolean);
    containers.forEach((container) => {
        const msgElement = document.createElement("div");
        msgElement.className = `p-2 rounded-lg ${message.userId === userId ? "bg-indigo-100 ml-8" : "bg-gray-100 mr-8"} mb-2`;
        msgElement.innerHTML = `
            <div class="text-xs text-gray-600">${message.userName}</div>
            <div class="text-gray-800">${message.message}</div>
        `;
        container.appendChild(msgElement);
        container.scrollTop = container.scrollHeight;
    });
}

function showChatError(text) {
    const containers = [elements.gameChatMessages, elements.lobbyChatMessages].filter(Boolean);
    containers.forEach((container) => {
        const msg = document.createElement("div");
        msg.className = "p-2 rounded-lg bg-red-100 text-red-700 text-sm";
        msg.textContent = text;
        container.appendChild(msg);
    });
}

function clearChatUI() {
    if (elements.gameChatMessages) elements.gameChatMessages.innerHTML = "";
    if (elements.lobbyChatMessages) elements.lobbyChatMessages.innerHTML = "";
}

async function leaveRoom(doDelete = false) {
    if (!currentRoomId || !userId) return;

    if (unsubscribeRoom) {
        unsubscribeRoom();
        unsubscribeRoom = null;
    }
    if (unsubscribePlayers) {
        unsubscribePlayers();
        unsubscribePlayers = null;
    }
    if (unsubscribeChat) {
        unsubscribeChat();
        unsubscribeChat = null;
    }

    const playerRef = doc(db, ROOMS_COLLECTION, currentRoomId, "players", userId);
    await deleteDoc(playerRef).catch((error) => console.error("Player cleanup failed", error));

    if (isHost && doDelete) {
        const roomRef = doc(db, ROOMS_COLLECTION, currentRoomId);
        await deleteDoc(roomRef).catch((error) => console.error("Room delete failed", error));
    }

    currentRoomId = null;
    isHost = false;
    userName = "";
    currentQuiz = null;
    currentQuestionIndex = 0;

    elements.multiplayerLobby.style.display = "none";
    elements.multiplayerGame.style.display = "none";
    elements.multiplayerMode.style.display = "block";

    elements.hostError.textContent = "";
    elements.joinError.textContent = "";
    clearChatUI();
}

function alertModal(message, callback) {
    const modalId = "custom-alert-modal";
    document.getElementById(modalId)?.remove();

    const modal = document.createElement("div");
    modal.id = modalId;
    modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50";
    modal.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-2xl max-w-sm w-full">
            <h4 class="text-xl font-bold text-gray-800 mb-4">Notification</h4>
            <p class="text-gray-600 mb-6">${message}</p>
            <button class="primary-btn w-full py-2 text-white rounded-lg font-semibold">OK</button>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector("button")?.addEventListener("click", () => {
        modal.remove();
        if (callback) callback();
    });
}

window.startRebattle = startRebattle;
window.reuseQuiz = reuseQuiz;
window.showNewQuizUpload = showNewQuizUpload;
window.confirmRebattle = confirmRebattle;
window.exitRoom = exitRoom;

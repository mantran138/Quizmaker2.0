document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const triggerFileButton = document.getElementById('trigger-file-input');
    const uploadSection = document.getElementById('upload-section');
    const quizSection = document.getElementById('quiz-section');
    const resultsSection = document.getElementById('results-section');
    const answersContainer = document.getElementById('answers-container');
    const feedback = document.getElementById('feedback');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const restartBtn = document.getElementById('restart-quiz');
    const reviewWrongBtn = document.getElementById('review-wrong');
    const newQuizBtn = document.getElementById('new-quiz');

    let originalQuizData = null;
    let quizData = null;
    let currentQuestion = 0;
    let totalQuestions = 0;
    let answered = false;
    let score = 0;
    let wrongAnswersMode = false;
    let wrongQuestionIndices = [];

    const stats = {
        totalCorrect: 0,
        totalWrong: 0,
        totalAttempts: 0,
    };

    triggerFileButton.addEventListener('click', () => fileInput.click());

    uploadSection.addEventListener('click', (event) => {
        const interactive = event.target.closest('button, input, pre, code');
        if (interactive && interactive.id !== 'trigger-file-input') {
            return;
        }
        fileInput.click();
    });

    uploadSection.addEventListener('dragover', (event) => {
        event.preventDefault();
        uploadSection.classList.add('dragover');
    });

    uploadSection.addEventListener('dragleave', () => {
        uploadSection.classList.remove('dragover');
    });

    uploadSection.addEventListener('drop', (event) => {
        event.preventDefault();
        uploadSection.classList.remove('dragover');
        const [file] = event.dataTransfer.files;
        if (file) {
            processFile(file);
        }
    });

    fileInput.addEventListener('change', (event) => {
        const [file] = event.target.files;
        if (file) {
            processFile(file);
        }
    });

    prevBtn.addEventListener('click', () => {
        if (currentQuestion > 0) {
            currentQuestion -= 1;
            showQuestion();
        }
    });

    nextBtn.addEventListener('click', () => {
        if (currentQuestion < totalQuestions - 1) {
            currentQuestion += 1;
            showQuestion();
        } else {
            showResults();
        }
    });

    restartBtn.addEventListener('click', () => {
        wrongAnswersMode = false;
        startQuiz();
    });

    reviewWrongBtn.addEventListener('click', () => {
        wrongAnswersMode = true;
        startQuiz();
    });

    newQuizBtn.addEventListener('click', () => {
        resetToUpload();
    });

    function resetToUpload() {
        uploadSection.style.display = 'block';
        quizSection.style.display = 'none';
        resultsSection.style.display = 'none';
        feedback.style.display = 'none';
        fileInput.value = '';
        originalQuizData = null;
        quizData = null;
        wrongAnswersMode = false;
        wrongQuestionIndices = [];
        answered = false;
        currentQuestion = 0;
        totalQuestions = 0;
        score = 0;
    }

    function processFile(file) {
        if (file.type !== 'application/json') {
            alertModal('Please upload a JSON file.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsed = JSON.parse(event.target.result);
                if (!parsed.questions || !Array.isArray(parsed.questions)) {
                    throw new Error('Invalid JSON format.');
                }
                originalQuizData = parsed;
                wrongAnswersMode = false;
                wrongQuestionIndices = [];
                stats.totalAttempts = 0;
                stats.totalCorrect = 0;
                stats.totalWrong = 0;
                startQuiz();
            } catch (error) {
                alertModal('Invalid JSON file. Please check the structure.');
            }
        };
        reader.readAsText(file);
    }

    function startQuiz() {
        if (!originalQuizData) {
            alertModal('Please load a quiz first.');
            return;
        }

        const baseQuestions = wrongAnswersMode
            ? wrongQuestionIndices.map((idx) => originalQuizData.questions[idx])
            : originalQuizData.questions;

        if (!baseQuestions.length) {
            alertModal('No questions available for this mode.');
            return;
        }

        uploadSection.style.display = 'none';
        resultsSection.style.display = 'none';
        quizSection.style.display = 'block';

        currentQuestion = 0;
        score = 0;
        answered = false;
        quizData = { questions: shuffleArray(JSON.parse(JSON.stringify(baseQuestions))) };
        totalQuestions = quizData.questions.length;

        shuffleQuizOptions();
        showQuestion();
    }

    function shuffleQuizOptions() {
        quizData.questions.forEach((question) => {
            const correctAnswer = question.options[question.correct];
            const indices = [...Array(question.options.length).keys()];
            for (let i = indices.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [indices[i], indices[j]] = [indices[j], indices[i]];
            }
            const shuffledOptions = indices.map((index) => question.options[index]);
            question.options = shuffledOptions;
            question.correct = shuffledOptions.indexOf(correctAnswer);
        });
    }

    function showQuestion() {
        if (!quizData) {
            return;
        }

        answered = false;
        const question = quizData.questions[currentQuestion];
        document.getElementById('question-number').textContent = `Question ${currentQuestion + 1} of ${totalQuestions}`;
        document.getElementById('question-text').textContent = question.question;
        document.getElementById('progress-fill').style.width = `${(currentQuestion / totalQuestions) * 100}%`;

        answersContainer.innerHTML = '';
        question.options.forEach((option, index) => {
            const button = document.createElement('button');
            button.className = 'answer-btn w-full p-3 mb-2 bg-gray-100 border border-gray-300 rounded-lg text-left text-gray-700 font-medium hover:bg-gray-200 transition-colors';
            button.textContent = option;
            button.addEventListener('click', () => selectAnswer(index));
            answersContainer.appendChild(button);
        });

        feedback.style.display = 'none';
        updateNavButtons();
    }

    function updateNavButtons() {
        prevBtn.style.display = currentQuestion > 0 ? 'block' : 'none';
        prevBtn.disabled = answered;

        nextBtn.style.display = totalQuestions > 0 ? 'block' : 'none';
        if (currentQuestion < totalQuestions - 1) {
            nextBtn.textContent = 'Next Question';
        } else {
            nextBtn.textContent = 'Finish Quiz';
        }
        nextBtn.disabled = !answered;
    }

    function selectAnswer(selectedIndex) {
        if (answered) {
            return;
        }

        answered = true;
        const question = quizData.questions[currentQuestion];
        const buttons = answersContainer.querySelectorAll('.answer-btn');
        buttons.forEach((button) => button.classList.add('disabled'));

        const isCorrect = selectedIndex === question.correct;
        if (isCorrect) {
            buttons[selectedIndex].classList.add('correct', 'bg-green-500', 'border-green-500');
            score += 1;
            stats.totalCorrect += 1;
        } else {
            buttons[selectedIndex].classList.add('incorrect', 'bg-red-500', 'border-red-500');
            buttons[question.correct].classList.add('correct', 'bg-green-500', 'border-green-500');
            stats.totalWrong += 1;
            if (!wrongAnswersMode) {
                const originalIndex = originalQuizData.questions.findIndex((q) => q.question === question.question);
                if (originalIndex !== -1 && !wrongQuestionIndices.includes(originalIndex)) {
                    wrongQuestionIndices.push(originalIndex);
                }
            }
        }

        stats.totalAttempts += 1;
        showFeedback(isCorrect, question.explanation);
        updateNavButtons();
    }

    function showFeedback(isCorrect, explanation) {
        feedback.style.display = 'block';
        feedback.className = `feedback p-3 mt-4 rounded-lg font-semibold ${isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`;
        feedback.innerHTML = `
            ${isCorrect ? '✅ Correct!' : '❌ Incorrect.'}
            <span class="font-normal block mt-1">${explanation || ''}</span>
        `;
        nextBtn.disabled = false;
    }

    function showResults() {
        quizSection.style.display = 'none';
        resultsSection.style.display = 'block';

        const percentage = Math.round((score / totalQuestions) * 100);
        const overallAccuracy = stats.totalAttempts > 0
            ? Math.round((stats.totalCorrect / stats.totalAttempts) * 100)
            : 0;

        document.getElementById('final-score').textContent = `${percentage}%`;
        document.getElementById('correct-count').textContent = score;
        document.getElementById('wrong-count').textContent = totalQuestions - score;
        document.getElementById('total-questions').textContent = totalQuestions;
        document.getElementById('accuracy').textContent = `${overallAccuracy}%`;

        if (wrongQuestionIndices.length > 0 && !wrongAnswersMode) {
            reviewWrongBtn.style.display = 'inline-block';
        } else {
            reviewWrongBtn.style.display = 'none';
        }
    }

    function shuffleArray(array) {
        const clone = [...array];
        for (let i = clone.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [clone[i], clone[j]] = [clone[j], clone[i]];
        }
        return clone;
    }

    function alertModal(message, callback) {
        const modalId = 'custom-alert-modal';
        let modal = document.getElementById(modalId);

        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 hidden';
            modal.innerHTML = `
                <div class="bg-white p-6 rounded-lg shadow-2xl max-w-sm w-full">
                    <h4 class="text-xl font-bold text-gray-800 mb-4">Notification</h4>
                    <p id="alert-message" class="text-gray-600 mb-6"></p>
                    <button id="alert-ok-btn" class="primary-btn w-full py-2 text-white rounded-lg font-semibold">OK</button>
                </div>
            `;
            document.body.appendChild(modal);

            modal.querySelector('#alert-ok-btn').addEventListener('click', () => {
                modal.classList.add('hidden');
                if (callback) {
                    callback();
                }
            });
        }

        modal.querySelector('#alert-message').textContent = message;
        modal.classList.remove('hidden');
    }
});

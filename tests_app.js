// ==========================================================================
// YDS PRACTICE TESTS - JAVASCRIPT LOGIC
// ==========================================================================

// Global state variables
let questionsPool = [];
let isLocalStorageMode = false;

// State synced with backend database or LocalStorage
let state = {
  correct: 0,
  incorrect: 0,
  solvedIds: [],
  correctIds: [],
  incorrectIds: [],
  currentIndex: 0,
  hintedIds: []
};

// DOM Elements
const loaderEl = document.getElementById('loader');
const testCardEl = document.getElementById('test-card');
const testSectionEl = document.getElementById('test-section');
const testTypeEl = document.getElementById('test-type');
const testDifficultyEl = document.getElementById('test-difficulty');
const questionNumberBadgeEl = document.getElementById('question-number-badge');
const passageContainerEl = document.getElementById('passage-container');
const passageTextEl = document.getElementById('passage-text');
const questionTextEl = document.getElementById('question-text');
const questionTranslationEl = document.getElementById('question-translation');
const optionsContainerEl = document.getElementById('options-container');
const hintButtonEl = document.getElementById('hint-button');

// Stats DOM Elements
const correctCountEl = document.getElementById('correct-count');
const incorrectCountEl = document.getElementById('incorrect-count');
const accuracyRateEl = document.getElementById('accuracy-rate');
const progressTextEl = document.getElementById('progress-text');
const totalQuestionsBadgeEl = document.getElementById('total-questions-badge');

// Modal DOM Elements
const modalEl = document.getElementById('explanation-modal');
const modalResultIconEl = document.getElementById('modal-result-icon');
const modalResultTitleEl = document.getElementById('modal-result-title');
const modalCorrectLabelEl = document.getElementById('modal-correct-label');
const modalCorrectTextEnEl = document.getElementById('modal-correct-text-en');
const modalCorrectTextTrEl = document.getElementById('modal-correct-text-tr');
const modalExplanationTextEl = document.getElementById('modal-explanation-text');
const modalDistractorsSectionEl = document.getElementById('modal-distractors-section');
const modalDistractorsListEl = document.getElementById('modal-distractors-list');
const modalCloseBtnEl = document.getElementById('modal-close-btn');
const modalSentenceEnEl = document.getElementById('modal-sentence-en');
const modalSentenceTrEl = document.getElementById('modal-sentence-tr');

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  showLoader(true);
  await fetchQuestions();
  await loadState();
  applyHintedQuestionsToPool();
  updateStatsUI();
  setupEventListeners();
  renderQuestion();
  showLoader(false);
}

// Setup Event Listeners
function setupEventListeners() {
  modalCloseBtnEl.addEventListener('click', () => {
    closeExplanationModal();
    advanceQuestion();
  });
  
  if (hintButtonEl) {
    hintButtonEl.addEventListener('click', handleHintClick);
  }
}

// Apply Spaced Repetition for hinted questions on load
function applyHintedQuestionsToPool() {
  if (state.hintedIds && state.hintedIds.length > 0 && questionsPool.length > 0) {
    const originalQuestions = [...questionsPool];
    state.hintedIds.forEach(id => {
      const q = originalQuestions.find(item => item.id === id);
      if (q) {
        questionsPool.push(q);
      }
    });
    if (totalQuestionsBadgeEl) {
      totalQuestionsBadgeEl.textContent = questionsPool.length;
    }
  }
}

// Show/Hide Loader Shimmer
function showLoader(show) {
  if (show) {
    loaderEl.classList.remove('hidden');
  } else {
    loaderEl.classList.add('hidden');
  }
}

// Fetch questions from Flask API or fallback to static JSON
async function fetchQuestions() {
  try {
    const response = await fetch('/api/tests');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    questionsPool = await response.json();
    console.log(`Loaded ${questionsPool.length} questions from database.`);
  } catch (error) {
    console.warn("Backend API offline or error. Falling back to local static JSON file.", error);
    try {
      const fallbackResponse = await fetch('/yds_ogretici_soru_bankasi_detayli.json');
      if (!fallbackResponse.ok) {
        throw new Error("Local fallback JSON also failed.");
      }
      const data = await fallbackResponse.json();
      questionsPool = data.questions || [];
      console.log(`Loaded ${questionsPool.length} questions from fallback JSON.`);
    } catch (fallbackError) {
      console.error("Failed to load questions from all sources.", fallbackError);
      alert("Soru bankası verileri yüklenemedi! Lütfen dosya yollarını ve sunucu bağlantısını kontrol edin.");
    }
  }
  
  if (totalQuestionsBadgeEl) {
    totalQuestionsBadgeEl.textContent = questionsPool.length;
  }
}

// Load test state from Flask API or fallback to LocalStorage
async function loadState() {
  try {
    const response = await fetch('/api/tests/state');
    if (!response.ok) {
      throw new Error("State API response not OK");
    }
    const data = await response.json();
    if (data && typeof data === 'object' && ('currentIndex' in data || 'correct' in data)) {
      state.correct = data.correct || 0;
      state.incorrect = data.incorrect || 0;
      state.solvedIds = data.solvedIds || [];
      state.correctIds = data.correctIds || [];
      state.incorrectIds = data.incorrectIds || [];
      state.currentIndex = data.currentIndex !== undefined ? data.currentIndex : 0;
      state.hintedIds = data.hintedIds || [];
      isLocalStorageMode = false;
      console.log("State successfully loaded from SQLite database.");
    } else {
      // Empty or invalid state from DB, load fallback or initialize
      loadLocalStorageState();
    }
  } catch (error) {
    console.warn("Could not load state from backend database, falling back to LocalStorage.", error);
    loadLocalStorageState();
  }
}

function loadLocalStorageState() {
  isLocalStorageMode = true;
  const localData = localStorage.getItem('yds_tests_state');
  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      state.correct = parsed.correct || 0;
      state.incorrect = parsed.incorrect || 0;
      state.solvedIds = parsed.solvedIds || [];
      state.correctIds = parsed.correctIds || [];
      state.incorrectIds = parsed.incorrectIds || [];
      state.currentIndex = parsed.currentIndex !== undefined ? parsed.currentIndex : 0;
      state.hintedIds = parsed.hintedIds || [];
      console.log("State loaded from LocalStorage.");
    } catch (e) {
      console.error("Error parsing LocalStorage state, initializing new state.", e);
      resetStateObject();
    }
  } else {
    resetStateObject();
  }
}

function resetStateObject() {
  state.correct = 0;
  state.incorrect = 0;
  state.solvedIds = [];
  state.correctIds = [];
  state.incorrectIds = [];
  state.currentIndex = 0;
  state.hintedIds = [];
}

// Save state to Flask API or fallback to LocalStorage
async function saveState() {
  if (isLocalStorageMode) {
    saveLocalStorageState();
    return;
  }
  
  try {
    const response = await fetch('/api/tests/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(state)
    });
    if (!response.ok) {
      throw new Error("Failed to save state to server");
    }
    console.log("State saved to server database.");
  } catch (error) {
    console.error("Failed to save state to server, falling back to LocalStorage.", error);
    isLocalStorageMode = true;
    saveLocalStorageState();
  }
}

function saveLocalStorageState() {
  localStorage.setItem('yds_tests_state', JSON.stringify(state));
  console.log("State saved to LocalStorage.");
}

// Update stats panels in Header
function updateStatsUI() {
  if (correctCountEl) correctCountEl.textContent = state.correct;
  if (incorrectCountEl) incorrectCountEl.textContent = state.incorrect;
  
  const totalSolved = state.correct + state.incorrect;
  let accuracy = 0;
  if (totalSolved > 0) {
    accuracy = Math.round((state.correct / totalSolved) * 100);
  }
  if (accuracyRateEl) accuracyRateEl.textContent = `${accuracy}%`;
  
  if (progressTextEl && questionsPool.length > 0) {
    progressTextEl.textContent = `${state.currentIndex}/${questionsPool.length}`;
  }
}

// Render the active question
function renderQuestion() {
  if (questionsPool.length === 0) return;
  
  // Check if we finished all questions
  if (state.currentIndex >= questionsPool.length) {
    renderCompletionScreen();
    return;
  }
  
  const question = questionsPool[state.currentIndex];
  
  // 1. Meta tags
  if (testSectionEl) testSectionEl.textContent = question.section || "Bölüm";
  if (testTypeEl) testTypeEl.textContent = question.question_type || "Soru Tipi";
  if (testDifficultyEl) {
    testDifficultyEl.textContent = question.difficulty || "Orta";
    // Adjust colors depending on difficulty
    testDifficultyEl.className = "badge-tag level-tag";
    const diff = (question.difficulty || "").toLowerCase();
    if (diff === 'zor') {
      testDifficultyEl.classList.add('badge-tag-danger');
    } else if (diff === 'orta') {
      testDifficultyEl.classList.add('badge-tag-warning');
    } else {
      testDifficultyEl.classList.add('badge-tag-success');
    }
  }
  if (questionNumberBadgeEl) {
    questionNumberBadgeEl.textContent = `Soru ${state.currentIndex + 1}/${questionsPool.length}`;
  }
  
  // 2. Reading Passage (if present)
  if (question.passage_en) {
    passageContainerEl.classList.remove('d-none');
    passageTextEl.innerHTML = `<strong>${question.passage_en}</strong><br><br><span style="font-size: 0.95rem; color: var(--color-text-secondary);">${question.passage_tr || ""}</span>`;
  } else {
    passageContainerEl.classList.add('d-none');
    passageTextEl.innerHTML = "";
  }
  
  // 3. Question English & Turkish translation (translation hidden by default)
  if (questionTextEl) {
    // Format blank lines nicely
    let qText = question.question_en || "";
    questionTextEl.innerHTML = qText.replace(/____/g, '<span class="sentence-blank">_______</span>');
  }
  if (questionTranslationEl) {
    questionTranslationEl.textContent = question.question_tr || "";
    questionTranslationEl.classList.add('d-none'); // Hide by default until hint button is clicked
  }
  
  // Reset Hint Button style
  if (hintButtonEl) {
    hintButtonEl.classList.remove('active-gold');
    hintButtonEl.style.borderColor = '#e2e8f0';
    hintButtonEl.style.backgroundColor = '#ffffff';
    const svg = hintButtonEl.querySelector('svg');
    if (svg) svg.style.color = 'var(--color-text-secondary)';
    hintButtonEl.disabled = false;
    hintButtonEl.title = "İpucu Al (Türkçe Çeviri)";
  }
  
  // 4. Options
  optionsContainerEl.innerHTML = "";
  if (question.options && Array.isArray(question.options)) {
    question.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '14px';
      btn.style.padding = '14px 20px';
      btn.style.marginBottom = '0'; // stack gap takes care of space
      btn.style.borderRadius = 'var(--radius-md)';
      btn.style.border = '1px solid #e2e8f0';
      btn.style.backgroundColor = '#ffffff';
      btn.style.fontFamily = 'Inter, sans-serif';
      btn.style.cursor = 'pointer';
      btn.style.transition = 'all var(--transition-fast)';
      btn.dataset.label = opt.label;
      
      btn.innerHTML = `
        <span class="option-label" style="
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background-color: var(--color-bg-alt);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-family: 'Outfit', sans-serif;
          color: var(--color-text-primary);
          flex-shrink: 0;
          font-size: 0.9rem;
          border: 1px solid #cbd5e1;
        ">${opt.label}</span>
        <div class="option-text-wrapper" style="display: flex; flex-direction: column; gap: 2px;">
          <span class="option-text-en" style="font-weight: 500; font-size: 0.95rem; color: var(--color-text-primary);">${opt.text_en}</span>
          <span class="option-text-tr d-none" style="font-size: 0.85rem; color: var(--color-text-secondary);">${opt.text_tr}</span>
        </div>
      `;
      
      // Hover effects
      btn.addEventListener('mouseenter', () => {
        if (!btn.disabled) {
          btn.style.borderColor = 'var(--color-brand)';
          btn.style.backgroundColor = 'var(--color-brand-light)';
          const lbl = btn.querySelector('.option-label');
          if (lbl) {
            lbl.style.borderColor = 'var(--color-brand)';
            lbl.style.backgroundColor = 'var(--color-brand)';
            lbl.style.color = '#ffffff';
          }
        }
      });
      btn.addEventListener('mouseleave', () => {
        if (!btn.disabled && !btn.classList.contains('selected')) {
          btn.style.borderColor = '#e2e8f0';
          btn.style.backgroundColor = '#ffffff';
          const lbl = btn.querySelector('.option-label');
          if (lbl) {
            lbl.style.borderColor = '#cbd5e1';
            lbl.style.backgroundColor = 'var(--color-bg-alt)';
            lbl.style.color = '#1e293b';
          }
        }
      });
      
      btn.addEventListener('click', () => handleOptionClick(btn, opt, question));
      optionsContainerEl.appendChild(btn);
    });
  }
}

// Handle option selection
function handleOptionClick(selectedBtn, selectedOpt, question) {
  const optionButtons = optionsContainerEl.querySelectorAll('.option-btn');
  optionButtons.forEach(btn => btn.disabled = true); // Disable further clicks
  
  const correctLabel = question.answer.label;
  const isCorrect = selectedOpt.label === correctLabel;
  
  // Style chosen and correct options
  optionButtons.forEach(btn => {
    const lbl = btn.querySelector('.option-label');
    if (btn.dataset.label === correctLabel) {
      // Highlight correct answer in green
      btn.style.borderColor = 'var(--color-success)';
      btn.style.backgroundColor = 'var(--color-success-bg)';
      if (lbl) {
        lbl.style.borderColor = 'var(--color-success)';
        lbl.style.backgroundColor = 'var(--color-success)';
        lbl.style.color = '#ffffff';
      }
    } else if (btn.dataset.label === selectedOpt.label && !isCorrect) {
      // Highlight wrong chosen answer in red
      btn.style.borderColor = 'var(--color-danger)';
      btn.style.backgroundColor = 'var(--color-danger-bg)';
      if (lbl) {
        lbl.style.borderColor = 'var(--color-danger)';
        lbl.style.backgroundColor = 'var(--color-danger)';
        lbl.style.color = '#ffffff';
      }
    }
  });
  
  // Update score & save state
  if (isCorrect) {
    state.correct++;
    if (!state.correctIds.includes(question.id)) {
      state.correctIds.push(question.id);
    }
  } else {
    state.incorrect++;
    if (!state.incorrectIds.includes(question.id)) {
      state.incorrectIds.push(question.id);
    }
  }
  
  if (!state.solvedIds.includes(question.id)) {
    state.solvedIds.push(question.id);
  }
  
  saveState();
  updateStatsUI();
  
  // Open explanation modal after a short delay to let the user see the option color change
  setTimeout(() => {
    openExplanationModal(isCorrect, question, selectedOpt);
  }, 800);
}

// Open detailed explanation modal
function openExplanationModal(isCorrect, question, selectedOpt) {
  // Clear previous distractors
  modalDistractorsListEl.innerHTML = "";
  
  // Set result icon and header title
  if (isCorrect) {
    modalResultIconEl.className = "warning-icon-badge";
    modalResultIconEl.style.backgroundColor = 'var(--color-success-bg)';
    modalResultIconEl.style.color = 'var(--color-success)';
    modalResultIconEl.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px;">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
    modalResultTitleEl.textContent = "Harika! Doğru Cevap";
    modalResultTitleEl.style.color = 'var(--color-success)';
  } else {
    modalResultIconEl.className = "warning-icon-badge";
    modalResultIconEl.style.backgroundColor = 'var(--color-danger-bg)';
    modalResultIconEl.style.color = 'var(--color-danger)';
    modalResultIconEl.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px;">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    modalResultTitleEl.textContent = `Yanlış Cevap (Siz: ${selectedOpt.label})`;
    modalResultTitleEl.style.color = 'var(--color-danger)';
  }
  
  // Populate correct answer section
  if (modalCorrectLabelEl) modalCorrectLabelEl.textContent = question.answer.label;
  if (modalCorrectTextEnEl) modalCorrectTextEnEl.textContent = question.answer.text_en;
  if (modalCorrectTextTrEl) modalCorrectTextTrEl.textContent = question.answer.text_tr;
  
  // Populate sentence and translation section
  if (modalSentenceEnEl) {
    const fullEn = question.question_en ? question.question_en.replace(/____/g, `[ ${question.answer.text_en} ]`) : "";
    modalSentenceEnEl.textContent = fullEn;
  }
  if (modalSentenceTrEl) {
    const fullTr = question.question_tr ? question.question_tr.replace(/____/g, `[ ${question.answer.text_tr} ]`) : "";
    modalSentenceTrEl.textContent = fullTr;
  }
  
  // Set explanation text
  if (modalExplanationTextEl) {
    modalExplanationTextEl.textContent = question.explanation_tr || "Bu sorunun çözümü için detaylı açıklama bulunmuyor.";
  }
  
  // Populate options meanings section in modal
  if (question.options && Array.isArray(question.options) && question.options.length > 0) {
    modalDistractorsSectionEl.classList.remove('hidden');
    const titleEl = modalDistractorsSectionEl.querySelector('.explain-label');
    if (titleEl) titleEl.textContent = "Seçeneklerin Türkçe Anlamları";
    
    question.options.forEach(opt => {
      const itemEl = document.createElement('div');
      itemEl.className = 'distractor-note-item';
      itemEl.style.display = 'flex';
      itemEl.style.alignItems = 'flex-start';
      itemEl.style.gap = '8px';
      itemEl.style.marginTop = '8px';
      
      let labelStyle = "font-weight: 700; color: var(--color-text-primary); background-color: var(--color-bg-alt); padding: 1px 6px; border-radius: 4px; font-size: 0.8rem; border: 1px solid #cbd5e1;";
      if (opt.label === question.answer.label) {
        labelStyle = "font-weight: 700; color: #ffffff; background-color: var(--color-success); padding: 1px 6px; border-radius: 4px; font-size: 0.8rem; border: 1px solid var(--color-success);";
      } else if (opt.label === selectedOpt.label && !isCorrect) {
        labelStyle = "font-weight: 700; color: #ffffff; background-color: var(--color-danger); padding: 1px 6px; border-radius: 4px; font-size: 0.8rem; border: 1px solid var(--color-danger);";
      }
      
      itemEl.innerHTML = `
        <span style="${labelStyle}">${opt.label}</span>
        <span style="font-size: 0.95rem; color: var(--color-text-primary); line-height: 1.5;">
          <strong>${opt.text_en}</strong>: <span style="color: var(--color-text-secondary); font-style: italic;">${opt.text_tr}</span>
        </span>
      `;
      modalDistractorsListEl.appendChild(itemEl);
    });
  } else {
    modalDistractorsSectionEl.classList.add('hidden');
  }
  
  // Show modal
  modalEl.classList.remove('hidden');
}

// Close detailed explanation modal
function closeExplanationModal() {
  modalEl.classList.add('hidden');
}

// Advance to the next question
function advanceQuestion() {
  state.currentIndex++;
  saveState();
  updateStatsUI();
  renderQuestion();
}

// Render Completion / Congratulation Screen
function renderCompletionScreen() {
  testSectionEl.textContent = "Bitti";
  testTypeEl.textContent = "Tamamlandı";
  testDifficultyEl.textContent = "-";
  testDifficultyEl.className = "badge-tag level-tag";
  questionNumberBadgeEl.textContent = `Soru ${questionsPool.length}/${questionsPool.length}`;
  
  passageContainerEl.classList.add('hidden');
  questionTranslationEl.textContent = "";
  
  const totalSolved = state.correct + state.incorrect;
  let accuracy = 0;
  if (totalSolved > 0) {
    accuracy = Math.round((state.correct / totalSolved) * 100);
  }
  
  questionTextEl.innerHTML = `
    <div style="text-align: center; padding: 20px 0;">
      <span style="font-size: 3rem; display: block; margin-bottom: 15px;">🎉</span>
      <h2 style="font-family: 'Outfit', sans-serif; font-size: 1.6rem; color: var(--color-text-primary); margin-bottom: 8px;">Tebrikler! Testi Tamamladınız.</h2>
      <p style="font-size: 0.95rem; color: var(--color-text-secondary); margin-bottom: 24px;">Tüm öğretici test sorularını başarıyla çözdünüz.</p>
      
      <div style="
        display: flex;
        justify-content: center;
        gap: 20px;
        margin-bottom: 30px;
        flex-wrap: wrap;
      ">
        <div style="background-color: var(--color-bg-alt); padding: 12px 20px; border-radius: var(--radius-md); border: 1px solid #e2e8f0; min-width: 100px;">
          <span style="font-size: 0.8rem; color: var(--color-text-secondary); display: block;">Doğru</span>
          <span style="font-size: 1.5rem; font-weight: 700; color: var(--color-success);">${state.correct}</span>
        </div>
        <div style="background-color: var(--color-bg-alt); padding: 12px 20px; border-radius: var(--radius-md); border: 1px solid #e2e8f0; min-width: 100px;">
          <span style="font-size: 0.8rem; color: var(--color-text-secondary); display: block;">Yanlış</span>
          <span style="font-size: 1.5rem; font-weight: 700; color: var(--color-danger);">${state.incorrect}</span>
        </div>
        <div style="background-color: var(--color-bg-alt); padding: 12px 20px; border-radius: var(--radius-md); border: 1px solid #e2e8f0; min-width: 100px;">
          <span style="font-size: 0.8rem; color: var(--color-text-secondary); display: block;">Başarı Oranı</span>
          <span style="font-size: 1.5rem; font-weight: 700; color: var(--color-brand);">${accuracy}%</span>
        </div>
      </div>
      
      <button id="btn-restart-tests" class="btn-primary" style="margin: 0 auto; display: inline-flex; align-items: center; gap: 8px;">
        <span>İlerlemeyi Sıfırla ve Baştan Başla</span>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
      </button>
    </div>
  `;
  
  optionsContainerEl.innerHTML = "";
  
  // Set up restart listener
  const restartBtn = document.getElementById('btn-restart-tests');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      if (confirm("Test ilerlemenizi sıfırlamak istediğinizden emin misiniz? Doğru ve yanlış sayılarınız sıfırlanacaktır.")) {
        resetStateObject();
        saveState();
        updateStatsUI();
        renderQuestion();
      }
    });
  }
}

// Handle Hint Click on Practice Tests (displays translation and adds penalty)
function handleHintClick() {
  if (questionsPool.length === 0) return;
  const question = questionsPool[state.currentIndex];
  if (!question) return;
  
  // 1. Türkçe çeviriyi göster ve seçeneklerin Türkçe anlamlarını aç
  if (questionTranslationEl) {
    questionTranslationEl.classList.remove('d-none');
  }
  const trTexts = optionsContainerEl.querySelectorAll('.option-text-tr');
  trTexts.forEach(el => el.classList.remove('d-none'));
  
  // 2. Butonu aktif/gold yap
  if (hintButtonEl) {
    hintButtonEl.classList.add('active-gold');
    hintButtonEl.style.borderColor = 'var(--color-warning)';
    hintButtonEl.style.backgroundColor = 'var(--color-brand-light)';
    const svg = hintButtonEl.querySelector('svg');
    if (svg) svg.style.color = 'var(--color-warning)';
    hintButtonEl.disabled = true;
    hintButtonEl.title = "İpucu Kullanıldı";
  }
  
  // 3. Negatif etki: Soruyu en sona ekle ve state.hintedIds listesine kaydet
  if (!state.hintedIds.includes(question.id)) {
    state.hintedIds.push(question.id);
    
    // Soru havuzuna da ekle
    questionsPool.push(question);
    
    // İstatistik ve badge güncellemeleri
    if (totalQuestionsBadgeEl) {
      totalQuestionsBadgeEl.textContent = questionsPool.length;
    }
    if (questionNumberBadgeEl) {
      questionNumberBadgeEl.textContent = `Soru ${state.currentIndex + 1}/${questionsPool.length}`;
    }
    if (progressTextEl) {
      progressTextEl.textContent = `${state.currentIndex}/${questionsPool.length}`;
    }
    
    saveState();
    console.log(`Hint penalty: Question ${question.id} appended to the end of tests queue.`);
  }
}

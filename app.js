// ==========================================================================
// YDS WORDMASTER - JAVASCRIPT LOGIC (SQLITE BACKEND INTEGRATION)
// ==========================================================================

// Global state variables
let wordPool = [];
let currentQuestion = null;
let currentMode = 'sentence'; // 'sentence' | 'word' | 'mistake' | 'analytics'
let wordDirection = 'en-tr'; // 'en-tr' | 'tr-en'
let currentHintStep = 0; // Tracks hint clicks for current word
let isLocalStorageMode = false; // Runs completely client-side if SQLite backend is offline

// State synced with backend database
let state = {
  stats: {
    correct: 0,
    incorrect: 0
  },
  mistakeIds: [],     // Array of word IDs in the mistake list
  askMoreIds: [],     // Array of word IDs with "Daha Sık Sor" selected
  wordWeights: {},    // Map of word ID -> weight value for Spaced Repetition
  dailyGoal: 30,      // Daily question target
  dailyProgress: {
    date: "",
    count: 0
  }
};

// DOM Elements
const loaderEl = document.getElementById('loader');
const sentenceContainerEl = document.getElementById('sentence-container');
const sentenceTextEl = document.getElementById('sentence-text');
const wordContainerEl = document.getElementById('word-container');
const wordQuestionTextEl = document.getElementById('word-question-text');
const optionsContainerEl = document.getElementById('options-container');
const wordPosEl = document.getElementById('word-pos');
const wordLevelEl = document.getElementById('word-level');
const ttsButtonEl = document.getElementById('tts-button');
const askFrequentlyBtnEl = document.getElementById('ask-frequently-btn');
const hintButtonEl = document.getElementById('hint-button');
const hintBoxEl = document.getElementById('hint-box');
const hintTextEl = document.getElementById('hint-text');
const totalWordsBadgeEl = document.getElementById('total-words-badge');

// Mode & Direction Selector Elements
const modeSentenceBtn = document.getElementById('mode-sentence');
const modeWordBtn = document.getElementById('mode-word');
const modeMistakeBtn = document.getElementById('mode-mistake');
const modeAnalyticsBtn = document.getElementById('mode-analytics');
const quizCardEl = document.getElementById('quiz-card');
const analyticsContainerEl = document.getElementById('analytics-container');
const directionSelectorContainer = document.getElementById('direction-selector-container');
const dirEnTrBtn = document.getElementById('dir-en-tr');
const dirTrEnBtn = document.getElementById('dir-tr-en');

// Stats DOM Elements
const correctCountEl = document.getElementById('correct-count');
const incorrectCountEl = document.getElementById('incorrect-count');
const accuracyRateEl = document.getElementById('accuracy-rate');

// Daily Goal DOM Elements
const goalWrapperEl = document.getElementById('goal-wrapper');
const goalTextEl = document.getElementById('goal-text');
const goalProgressCircleEl = document.getElementById('goal-progress-circle');

// Backup/Restore DOM Elements
const btnExportEl = document.getElementById('btn-export');
const btnImportTriggerEl = document.getElementById('btn-import-trigger');
const importFileEl = document.getElementById('import-file');

// Modal DOM Elements
const modalEl = document.getElementById('explanation-modal');
const modalCorrectWordEl = document.getElementById('modal-correct-word');
const modalWordPosEl = document.getElementById('modal-word-pos');
const modalWordMeaningsEl = document.getElementById('modal-word-meanings');
const modalSentenceEnEl = document.getElementById('modal-sentence-en');
const modalSentenceTrEl = document.getElementById('modal-sentence-tr');
const modalExplanationTextEl = document.getElementById('modal-explanation-text');
const modalCloseBtnEl = document.getElementById('modal-close-btn');

// Speech synthesis config
let synth = window.speechSynthesis;
let speechUtterance = null;

// ==========================================================================
// INITIALIZATION
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  await fetchWordPool();
  await loadState(); // Load state from database
  setupEventListeners();
}

// Setup click/action listeners
function setupEventListeners() {
  // TTS (Text-to-Speech) listener
  ttsButtonEl.addEventListener('click', playAudio);
  
  // Ask Frequently listener
  askFrequentlyBtnEl.addEventListener('click', toggleAskFrequently);
  
  // Hint listener
  hintButtonEl.addEventListener('click', toggleHint);
  
  // Modal Close Button
  modalCloseBtnEl.addEventListener('click', () => {
    closeModal();
    loadNextQuestion();
  });
  
  // Modal close when clicking overlay
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) {
      closeModal();
      loadNextQuestion();
    }
  });

  // Keyboard accessibility: Escape on Modal Close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) {
      closeModal();
      loadNextQuestion();
    }
  });

  // Mode Selection Listeners
  modeSentenceBtn.addEventListener('click', () => switchMode('sentence'));
  modeWordBtn.addEventListener('click', () => switchMode('word'));
  modeMistakeBtn.addEventListener('click', () => switchMode('mistake'));
  modeAnalyticsBtn.addEventListener('click', () => switchMode('analytics'));

  // Direction Selection Listeners
  dirEnTrBtn.addEventListener('click', () => switchDirection('en-tr'));
  dirTrEnBtn.addEventListener('click', () => switchDirection('tr-en'));

  // Daily Goal Selector
  goalWrapperEl.addEventListener('click', changeDailyGoalPrompt);

  // Backup & Restore listeners
  btnExportEl.addEventListener('click', exportBackup);
  btnImportTriggerEl.addEventListener('click', () => importFileEl.click());
  importFileEl.addEventListener('change', importBackup);
}

// ==========================================================================
// API CLIENT / STATE SYNCHRONIZATION
// ==========================================================================

// Load state from SQLite veritabanı
async function loadState() {
  if (isLocalStorageMode) {
    try {
      const localStateStr = localStorage.getItem('yds_study_state');
      if (localStateStr) {
        const dbState = JSON.parse(localStateStr);
        state.stats = dbState.stats || state.stats;
        state.dailyGoal = dbState.dailyGoal || state.dailyGoal;
        state.dailyProgress = dbState.dailyProgress || state.dailyProgress;
      }
      
      // posStats kontrolü ve varsayılan atama
      if (!state.stats.posStats) {
        state.stats.posStats = {
          verb: { correct: 0, total: 0 },
          noun: { correct: 0, total: 0 },
          adjective: { correct: 0, total: 0 },
          adverb: { correct: 0, total: 0 },
          conjunction: { correct: 0, total: 0 },
          preposition: { correct: 0, total: 0 }
        };
      }
      
      const localWordDetailsStr = localStorage.getItem('yds_word_details');
      const localWordDetails = localWordDetailsStr ? JSON.parse(localWordDetailsStr) : {};
      
      wordPool.forEach(w => {
        const details = localWordDetails[w.id] || {};
        w.weight = details.weight !== undefined ? details.weight : 1.0;
        w.is_mistake = details.is_mistake !== undefined ? details.is_mistake : 0;
        w.ask_more = details.ask_more !== undefined ? details.ask_more : 0;
        w.correct_count = details.correct_count !== undefined ? details.correct_count : 0;
      });
      
      state.mistakeIds = wordPool.filter(w => w.is_mistake === 1).map(w => w.id);
      state.askMoreIds = wordPool.filter(w => w.ask_more === 1).map(w => w.id);
      wordPool.forEach(w => {
        state.wordWeights[w.id] = w.weight;
      });
    } catch (err) {
      console.error("LocalStorage state yüklenemedi:", err);
    }
    checkDailyReset();
    updateStatsUI();
    updateDailyGoalUI();
    return;
  }

  try {
    const response = await fetch('/api/state');
    if (response.ok) {
      const dbState = await response.json();
      
      // Verileri state'e yedir
      state.stats = dbState.stats || state.stats;
      state.dailyGoal = dbState.dailyGoal || state.dailyGoal;
      state.dailyProgress = dbState.dailyProgress || state.dailyProgress;
      
      // posStats kontrolü ve varsayılan atama
      if (!state.stats.posStats) {
        state.stats.posStats = {
          verb: { correct: 0, total: 0 },
          noun: { correct: 0, total: 0 },
          adjective: { correct: 0, total: 0 },
          adverb: { correct: 0, total: 0 },
          conjunction: { correct: 0, total: 0 },
          preposition: { correct: 0, total: 0 }
        };
      }
      
      // Hata listesini, daha sık sor listesini ve Spaced Repetition ağırlıklarını kelime havuzundan çekip eşle
      state.mistakeIds = wordPool.filter(w => w.is_mistake === 1).map(w => w.id);
      state.askMoreIds = wordPool.filter(w => w.ask_more === 1).map(w => w.id);
      wordPool.forEach(w => {
        state.wordWeights[w.id] = w.weight || 1.0;
        w.ask_more = w.ask_more || 0;
        w.correct_count = w.correct_count || 0;
      });
    }
  } catch (err) {
    console.error("Backend state yüklenemedi, yerel fallback:", err);
  }
  
  checkDailyReset();
  updateStatsUI();
  updateDailyGoalUI();
}

// State'i veritabanına kaydet (Optimistic asenkron post)
async function saveState() {
  if (isLocalStorageMode) {
    try {
      localStorage.setItem('yds_study_state', JSON.stringify({
        stats: state.stats,
        dailyGoal: state.dailyGoal,
        dailyProgress: state.dailyProgress
      }));
    } catch (err) {
      console.error("State LocalStorage'a kaydedilemedi:", err);
    }
    return;
  }

  try {
    await fetch('/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        stats: state.stats,
        dailyGoal: state.dailyGoal,
        dailyProgress: state.dailyProgress
      })
    });
  } catch (err) {
    console.error("State backend'e kaydedilemedi:", err);
  }
}

// Kelime Ağırlığını, Hata durumunu, Sık Sor durumunu ve Doğru Bilinme Sayısını veritabanına kaydet (Asenkron post)
async function saveWordWeightToDb(wordId, weight, isMistake, askMore, correctCount) {
  if (isLocalStorageMode) {
    try {
      const localWordDetailsStr = localStorage.getItem('yds_word_details');
      const localWordDetails = localWordDetailsStr ? JSON.parse(localWordDetailsStr) : {};
      
      if (!localWordDetails[wordId]) {
        localWordDetails[wordId] = {};
      }
      
      if (weight !== undefined) localWordDetails[wordId].weight = weight;
      if (isMistake !== undefined) localWordDetails[wordId].is_mistake = isMistake;
      if (askMore !== undefined) localWordDetails[wordId].ask_more = askMore;
      if (correctCount !== undefined) localWordDetails[wordId].correct_count = correctCount;
      
      localStorage.setItem('yds_word_details', JSON.stringify(localWordDetails));
    } catch (err) {
      console.warn(`Kelime ${wordId} LocalStorage'a kaydedilemedi:`, err);
    }
    return;
  }

  try {
    const payload = {
      weight: weight,
      is_mistake: isMistake
    };
    if (askMore !== undefined) {
      payload.ask_more = askMore;
    }
    if (correctCount !== undefined) {
      payload.correct_count = correctCount;
    }
    await fetch(`/api/words/${wordId}/weight`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn(`Kelime ${wordId} backend'e kaydedilemedi:`, err);
  }
}

// Reset daily progress if the day has changed
function checkDailyReset() {
  const today = new Date().toISOString().split('T')[0];
  if (state.dailyProgress.date !== today) {
    state.dailyProgress.date = today;
    state.dailyProgress.count = 0;
    saveState();
  }
}

function incrementDailyProgress() {
  checkDailyReset();
  state.dailyProgress.count++;
  saveState();
  updateDailyGoalUI();
}

function updateDailyGoalUI() {
  checkDailyReset();
  const count = state.dailyProgress.count;
  const goal = state.dailyGoal;
  
  goalTextEl.textContent = `${count}/${goal}`;
  
  if (goalProgressCircleEl) {
    const radius = 11;
    const circumference = 2 * Math.PI * radius; // 69.11
    
    const percent = Math.min((count / goal) * 100, 100);
    const offset = circumference - (percent / 100) * circumference;
    
    goalProgressCircleEl.style.strokeDasharray = `${circumference} ${circumference}`;
    goalProgressCircleEl.style.strokeDashoffset = offset;
    
    if (percent >= 100) {
      goalProgressCircleEl.style.stroke = "var(--color-success)";
    } else {
      goalProgressCircleEl.style.stroke = "var(--color-brand)";
    }
  }
}

function changeDailyGoalPrompt() {
  const newGoal = prompt("Yeni günlük çalışma hedefiniz nedir? (Çözülecek soru sayısı):", state.dailyGoal);
  if (newGoal) {
    const goalVal = parseInt(newGoal, 10);
    if (!isNaN(goalVal) && goalVal > 0) {
      state.dailyGoal = goalVal;
      saveState();
      updateDailyGoalUI();
    } else {
      alert("Lütfen geçerli bir sayı girin.");
    }
  }
}

// Update stats header panel
function updateStatsUI() {
  correctCountEl.textContent = state.stats.correct;
  incorrectCountEl.textContent = state.stats.incorrect;
  
  const total = state.stats.correct + state.stats.incorrect;
  if (total === 0) {
    accuracyRateEl.textContent = '0%';
  } else {
    const rate = Math.round((state.stats.correct / total) * 100);
    accuracyRateEl.textContent = `${rate}%`;
  }
}

// Fetch vocabulary JSON from SQLite API
async function fetchWordPool() {
  try {
    const response = await fetch('/api/words');
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }
    wordPool = await response.json();
    
    // Set total word count badge
    if (totalWordsBadgeEl) {
      totalWordsBadgeEl.textContent = wordPool.length;
    }
    
    // Hide loader
    setTimeout(() => {
      loaderEl.style.opacity = '0';
      setTimeout(() => loaderEl.style.display = 'none', 400);
      
      // Load first question
      loadNextQuestion();
    }, 600);
  } catch (error) {
    console.warn('Backend API connection failed, trying client-side fallback:', error);
    try {
      // Fallback to static JSON file in client-side / LocalStorage mode
      const response = await fetch('/ydskelimehavuzu.json');
      if (!response.ok) {
        throw new Error(`Static File HTTP Error: ${response.status}`);
      }
      const data = await response.json();
      wordPool = data.words || [];
      isLocalStorageMode = true;
      console.log('Client-side LocalStorage mode initialized successfully with static JSON.');

      // Set total word count badge
      if (totalWordsBadgeEl) {
        totalWordsBadgeEl.textContent = wordPool.length;
      }
      
      // Hide loader
      setTimeout(() => {
        loaderEl.style.opacity = '0';
        setTimeout(() => loaderEl.style.display = 'none', 400);
        
        // Load first question
        loadNextQuestion();
      }, 600);
    } catch (fallbackError) {
      console.error('All data loading attempts failed:', fallbackError);
      loaderEl.innerHTML = `<p style="color: var(--color-danger); text-align:center; padding:20px;">SQLite API veya statik JSON dosyasına bağlanılamadı! Lütfen "app_server.py" sunucusunun çalıştığından veya "ydskelimehavuzu.json" dosyasının mevcut olduğundan emin olun.</p>`;
    }
  }
}

// ==========================================================================
// BACKUP & RESTORE UTILITIES (CLIENT-SIDE BACKUP SYNC)
// ==========================================================================
function exportBackup() {
  try {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    
    const dateStr = new Date().toISOString().split('T')[0];
    downloadAnchor.setAttribute("download", `yds_wordmaster_db_yedek_${dateStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  } catch (err) {
    alert("Yedek dışa aktarılırken bir hata oluştu.");
    console.error(err);
  }
}

async function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      
      if (imported && typeof imported === 'object' && imported.stats && Array.isArray(imported.mistakeIds) && imported.wordWeights) {
        // 1. Local state nesnesini güncelle
        state = {
          stats: imported.stats,
          mistakeIds: imported.mistakeIds,
          askMoreIds: imported.askMoreIds || [],
          wordWeights: imported.wordWeights,
          dailyGoal: imported.dailyGoal || state.dailyGoal,
          dailyProgress: imported.dailyProgress || state.dailyProgress
        };
        
        // 2. Sunucuya genel durumu kaydet
        await saveState();
        
        // 3. Sunucudaki kelime ağırlıklarını ve hata listelerini SQLite veritabanına tek tek post et (migration)
        // Kullanıcıya bir bilgi ekranı verip asenkron yükleyelim
        let updatedCount = 0;
        
        // Loader'ı geçici olarak gösterelim
        loaderEl.style.display = 'flex';
        loaderEl.style.opacity = '1';
        loaderEl.querySelector('p').textContent = "Veritabanı ağırlıkları güncelleniyor...";
        
        for (const w of wordPool) {
          const weight = state.wordWeights[w.id] || 1.0;
          const isMistake = state.mistakeIds.includes(w.id) ? 1 : 0;
          const askMore = state.askMoreIds.includes(w.id) ? 1 : 0;
          const correctCount = w.correct_count || 0;
          
          // API güncellemesini yap
          await saveWordWeightToDb(w.id, weight, isMistake, askMore, correctCount);
          
          // Havuzdaki local veriyi de güncelle
          w.weight = weight;
          w.is_mistake = isMistake;
          w.ask_more = askMore;
          w.correct_count = correctCount;
          updatedCount++;
        }
        
        // Loader'ı gizle
        loaderEl.style.opacity = '0';
        setTimeout(() => loaderEl.style.display = 'none', 400);
        
        alert("Yedek veritabanı başarıyla içe aktarıldı ve SQLite ile senkronize edildi!");
        
        updateStatsUI();
        updateDailyGoalUI();
        loadNextQuestion();
      } else {
        alert("Hatalı dosya formatı! Lütfen geçerli bir YDS WordMaster yedek dosyası yükleyin.");
      }
    } catch (err) {
      alert("Yedek geri yüklenirken hata oluştu.");
      console.error(err);
    }
  };
  reader.readAsText(file);
  importFileEl.value = '';
}

// ==========================================================================
// MODE & DIRECTION CONTROLLERS
// ==========================================================================
function switchMode(mode) {
  if (currentMode === mode) return;
  currentMode = mode;
  
  modeSentenceBtn.classList.remove('active');
  modeWordBtn.classList.remove('active');
  modeMistakeBtn.classList.remove('active');
  modeAnalyticsBtn.classList.remove('active');
  
  // Her mod değişiminde ipucunu kapat
  resetHint();
  
  if (mode === 'analytics') {
    modeAnalyticsBtn.classList.add('active');
    quizCardEl.classList.add('d-none');
    analyticsContainerEl.classList.remove('d-none');
    renderAnalytics();
    return;
  }
  
  quizCardEl.classList.remove('d-none');
  analyticsContainerEl.classList.add('d-none');
  
  if (mode === 'sentence') {
    modeSentenceBtn.classList.add('active');
    sentenceContainerEl.classList.remove('hidden');
    wordContainerEl.classList.add('hidden');
    directionSelectorContainer.classList.add('hidden');
  } else if (mode === 'word') {
    modeWordBtn.classList.add('active');
    sentenceContainerEl.classList.add('hidden');
    wordContainerEl.classList.remove('hidden');
    directionSelectorContainer.classList.remove('hidden');
  } else if (mode === 'mistake') {
    modeMistakeBtn.classList.add('active');
    sentenceContainerEl.classList.add('hidden');
    wordContainerEl.classList.add('hidden');
    directionSelectorContainer.classList.add('hidden');
  }
  
  loadNextQuestion();
}

function switchDirection(dir) {
  if (wordDirection === dir) return;
  wordDirection = dir;
  
  if (dir === 'en-tr') {
    dirEnTrBtn.classList.add('active');
    dirTrEnBtn.classList.remove('active');
  } else {
    dirEnTrBtn.classList.remove('active');
    dirTrEnBtn.classList.add('active');
  }
  
  loadNextQuestion();
}

// ==========================================================================
// SPACED REPETITION & QUESTION SELECTION
// ==========================================================================
function getWeightedRandomWord(pool) {
  if (pool.length === 0) return null;
  
  let totalWeight = 0;
  const weights = pool.map(word => {
    let w = state.wordWeights[word.id] || 1;
    const localWord = wordPool.find(item => item.id === word.id);
    if (localWord) {
      // Doğru bilinme sayısına göre sıklık katsayılarını uygula
      const cc = localWord.correct_count || 0;
      if (cc < 0) {
        w *= 8.0; // Öğrenilmesi gereken (sürekli hata yapılan) kelimeleri ekstra sürekli sor
      } else if (cc > 0 && cc < 10) {
        w *= 4.0; // Öğrenilen aşamasındaki kelimeleri sürekli sor
      } else if (cc >= 10) {
        w *= 0.1; // Ustalaşılan kelimelerin sıklığını 10 kat düşür
      }
      
      // Eğer kelime "Daha Sık Sor" olarak işaretlendiyse, ağırlığını 10 kat artıralım
      if (localWord.ask_more === 1) {
        w *= 10.0;
      }
    }
    totalWeight += w;
    return w;
  });
  
  let randVal = Math.random() * totalWeight;
  for (let i = 0; i < pool.length; i++) {
    randVal -= weights[i];
    if (randVal <= 0) {
      return pool[i];
    }
  }
  return pool[pool.length - 1];
}

// Ağırlık Güncelleme: SQLite POST entegrasyonuyla
function adjustWordWeight(wordId, isCorrect) {
  let weight = state.wordWeights[wordId] || 1;
  
  // Sık sor seçeneği aktifse doğru cevaplansa dahi ağırlık artmaya devam etsin
  const localWordObj = wordPool.find(w => w.id === wordId);
  const isAskMore = localWordObj && localWordObj.ask_more === 1;
  
  if (isCorrect && !isAskMore) {
    weight = Math.max(0.2, weight - 0.3);
  } else {
    weight = Math.min(10, weight + 2.0);
  }
  
  weight = parseFloat(weight.toFixed(2));
  state.wordWeights[wordId] = weight;
  
  // Bulunduğu yerel havuz nesnesini de güncelle
  if (localWordObj) localWordObj.weight = weight;
  
  // correct_count güncellemesi: Doğru cevapta +1, yanlışta -2 (min -10)
  let correctCount = localWordObj ? (localWordObj.correct_count || 0) : 0;
  if (isCorrect) {
    correctCount++;
  } else {
    correctCount = Math.max(-10, correctCount - 2);
  }
  if (localWordObj) localWordObj.correct_count = correctCount;
  
  // Hata Defteri durumunu hazırla
  const isMistake = state.mistakeIds.includes(wordId) ? 1 : 0;
  const askMoreVal = isAskMore ? 1 : 0;
  
  // SQLite Veritabanına asenkron kaydet
  saveWordWeightToDb(wordId, weight, isMistake, askMoreVal, correctCount);
}

// Hata Listesini Güncelleme: SQLite POST entegrasyonuyla
function recordMistake(wordId, isCorrect) {
  let isMistakeVal = 0;
  
  if (!isCorrect) {
    if (!state.mistakeIds.includes(wordId)) {
      state.mistakeIds.push(wordId);
      isMistakeVal = 1;
    } else {
      isMistakeVal = 1;
    }
  } else {
    if (currentMode === 'mistake') {
      state.mistakeIds = state.mistakeIds.filter(id => id !== wordId);
      isMistakeVal = 0;
    } else {
      isMistakeVal = state.mistakeIds.includes(wordId) ? 1 : 0;
    }
  }
  
  // Bulunduğu yerel havuz nesnesini de güncelle
  const localWordObj = wordPool.find(w => w.id === wordId);
  if (localWordObj) localWordObj.is_mistake = isMistakeVal;
  
  const currentWeight = state.wordWeights[wordId] || 1.0;
  const askMoreVal = localWordObj ? localWordObj.ask_more : 0;
  const correctCountVal = localWordObj ? (localWordObj.correct_count || 0) : 0;
  
  // SQLite Veritabanına asenkron kaydet
  saveWordWeightToDb(wordId, currentWeight, isMistakeVal, askMoreVal, correctCountVal);
}

// ==========================================================================
// QUESTION LOADING AND DISPLAY
// ==========================================================================
function loadNextQuestion() {
  if (wordPool.length === 0) return;
  
  // Her yeni soruda ipucunu kapat ve sıfırla
  resetHint();
  
  if (synth && synth.speaking) {
    synth.cancel();
  }

  if (currentMode === 'sentence') {
    loadSentenceQuestion();
  } else if (currentMode === 'word') {
    loadWordQuestion();
  } else if (currentMode === 'mistake') {
    loadMistakeQuestion();
  }
}

function loadSentenceQuestion() {
  const targetWordData = getWeightedRandomWord(wordPool);
  
  if (!targetWordData || !targetWordData.examples || targetWordData.examples.length === 0) {
    loadNextQuestion();
    return;
  }
  
  const selectedExample = targetWordData.examples[Math.floor(Math.random() * targetWordData.examples.length)];
  const maskedSentenceHtml = maskWordInSentence(selectedExample.en, targetWordData.word);
  const options = generateOptions(targetWordData);
  
  currentQuestion = {
    wordData: targetWordData,
    example: selectedExample,
    options: options,
    correctAnswer: targetWordData.word
  };
  
  renderQuestion(maskedSentenceHtml, options);
}

function loadWordQuestion() {
  const targetWordData = getWeightedRandomWord(wordPool);
  
  if (!targetWordData || !targetWordData.examples || targetWordData.examples.length === 0) {
    loadNextQuestion();
    return;
  }
  
  const selectedExample = targetWordData.examples[Math.floor(Math.random() * targetWordData.examples.length)];
  
  let questionText = '';
  let correctAnswer = '';
  let options = [];
  
  if (wordDirection === 'en-tr') {
    questionText = targetWordData.word;
    correctAnswer = targetWordData.turkish_meanings[0];
    options = generateWordOptionsEnTr(targetWordData);
  } else {
    questionText = targetWordData.turkish_meanings.join(', ');
    correctAnswer = targetWordData.word;
    options = generateWordOptionsTrEn(targetWordData);
  }
  
  currentQuestion = {
    wordData: targetWordData,
    example: selectedExample,
    options: options,
    correctAnswer: correctAnswer
  };
  
  renderWordQuestion(questionText, options);
}

function loadMistakeQuestion() {
  if (state.mistakeIds.length === 0) {
    renderEmptyMistakePlaceholder();
    return;
  }
  
  const mistakePool = wordPool.filter(w => state.mistakeIds.includes(w.id));
  if (mistakePool.length === 0) {
    state.mistakeIds = [];
    saveState();
    renderEmptyMistakePlaceholder();
    return;
  }
  
  const targetWordData = getWeightedRandomWord(mistakePool);
  const selectedExample = targetWordData.examples[Math.floor(Math.random() * targetWordData.examples.length)];
  
  const isSentenceMode = Math.random() > 0.5;
  let options = [];
  
  if (isSentenceMode) {
    sentenceContainerEl.classList.remove('hidden');
    wordContainerEl.classList.add('hidden');
    
    const maskedSentenceHtml = maskWordInSentence(selectedExample.en, targetWordData.word);
    options = generateOptions(targetWordData);
    
    currentQuestion = {
      wordData: targetWordData,
      example: selectedExample,
      options: options,
      correctAnswer: targetWordData.word,
      mistakeSubMode: 'sentence'
    };
    
    renderQuestion(maskedSentenceHtml, options);
  } else {
    sentenceContainerEl.classList.add('hidden');
    wordContainerEl.classList.remove('hidden');
    
    const isEnTr = Math.random() > 0.5;
    let questionText = '';
    let correctAnswer = '';
    
    if (isEnTr) {
      questionText = targetWordData.word;
      correctAnswer = targetWordData.turkish_meanings[0];
      options = generateWordOptionsEnTr(targetWordData);
    } else {
      questionText = targetWordData.turkish_meanings.join(', ');
      correctAnswer = targetWordData.word;
      options = generateWordOptionsTrEn(targetWordData);
    }
    
    currentQuestion = {
      wordData: targetWordData,
      example: selectedExample,
      options: options,
      correctAnswer: correctAnswer,
      mistakeSubMode: 'word',
      mistakeSubDir: isEnTr ? 'en-tr' : 'tr-en'
    };
    
    renderWordQuestion(questionText, options);
  }
}

function renderEmptyMistakePlaceholder() {
  sentenceContainerEl.classList.remove('hidden');
  wordContainerEl.classList.add('hidden');
  directionSelectorContainer.classList.add('hidden');
  
  wordPosEl.textContent = "BİLGİ";
  wordLevelEl.textContent = "YÖNLENDİRME";
  
  sentenceTextEl.innerHTML = `
    <div style="text-align: center; padding: 20px 10px;">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:14px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 8 12 12 14 14"></polyline></svg>
      <h3 style="font-size:1.15rem; margin-bottom:8px; color:var(--color-text-primary)">Hata Defteriniz Şu An Boş!</h3>
      <p style="font-size:0.9rem; color:var(--color-text-secondary); line-height:1.5;">
        Cümle veya Kelime modunda çalışırken yanlış cevapladığınız kelimeler otomatik olarak buraya eklenir. 
        Yanlışlarınızı pekiştirmek için o modları oynamaya başlayabilirsiniz.
      </p>
    </div>
  `;
  
  optionsContainerEl.innerHTML = '';
  if (askFrequentlyBtnEl) askFrequentlyBtnEl.classList.add('hidden');
}

// Helper to escape regex special characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Akıllı Maskeleme
function maskWordInSentence(sentence, word) {
  const escapedWord = escapeRegExp(word);
  const regex = new RegExp(`\\b${escapedWord}(?:ed|ing|s|es|d|ly)?\\b`, 'gi');
  
  let masked = sentence.replace(regex, `<span class="word-blank" id="blank-space">________</span>`);
  
  if (!masked.includes('word-blank')) {
    const simpleRegex = new RegExp(escapedWord, 'gi');
    masked = sentence.replace(simpleRegex, `<span class="word-blank" id="blank-space">________</span>`);
  }
  
  return masked;
}

// Seçenekleri oluşturma: İngilizce kelimeler için
function generateOptions(targetWordData) {
  const correctOption = targetWordData.word.trim().toLowerCase();
  
  // 1. Aynı pos olan adaylar (tam normalizasyon yapılmış ve benzersiz kelimeler)
  const samePosCandidates = Array.from(new Set(
    wordPool
      .filter(w => w.pos === targetWordData.pos)
      .map(w => w.word.trim().toLowerCase())
      .filter(wordVal => wordVal !== correctOption && wordVal !== "")
  ));
  
  // Adayları karıştır
  shuffleArray(samePosCandidates);
  
  const incorrectOptions = new Set();
  
  // Önce aynı pos adaylarını ekle
  for (const val of samePosCandidates) {
    if (incorrectOptions.size >= 3) break;
    incorrectOptions.add(val);
  }
  
  // Eğer hala 3 tane olmadıysa, genel havuzdan adaylar
  if (incorrectOptions.size < 3) {
    const generalCandidates = Array.from(new Set(
      wordPool
        .map(w => w.word.trim().toLowerCase())
        .filter(wordVal => wordVal !== correctOption && wordVal !== "" && !incorrectOptions.has(wordVal))
    ));
    shuffleArray(generalCandidates);
    for (const val of generalCandidates) {
      if (incorrectOptions.size >= 3) break;
      incorrectOptions.add(val);
    }
  }
  
  const finalOptions = [correctOption, ...incorrectOptions];
  return shuffleArray(finalOptions);
}

// Kelime modunda EN->TR için Türkçe şıklar üretir (aynı pos korumalı)
function generateWordOptionsEnTr(targetWordData) {
  const correctOption = targetWordData.turkish_meanings[0].trim().toLowerCase();
  
  // Aynı pos olan adayların Türkçe anlamları
  const samePosCandidates = Array.from(new Set(
    wordPool
      .filter(w => w.pos === targetWordData.pos && w.word.trim().toLowerCase() !== targetWordData.word.trim().toLowerCase())
      .flatMap(w => w.turkish_meanings || [])
      .map(m => m.trim().toLowerCase())
      .filter(meaning => meaning !== correctOption && meaning !== "")
  ));
  
  shuffleArray(samePosCandidates);
  
  const incorrectOptions = new Set();
  
  for (const val of samePosCandidates) {
    if (incorrectOptions.size >= 3) break;
    incorrectOptions.add(val);
  }
  
  if (incorrectOptions.size < 3) {
    const generalCandidates = Array.from(new Set(
      wordPool
        .flatMap(w => w.turkish_meanings || [])
        .map(m => m.trim().toLowerCase())
        .filter(meaning => meaning !== correctOption && meaning !== "" && !incorrectOptions.has(meaning))
    ));
    shuffleArray(generalCandidates);
    for (const val of generalCandidates) {
      if (incorrectOptions.size >= 3) break;
      incorrectOptions.add(val);
    }
  }
  
  const finalOptions = [correctOption, ...incorrectOptions];
  return shuffleArray(finalOptions);
}

function generateWordOptionsTrEn(targetWordData) {
  return generateOptions(targetWordData);
}

// Fisher-Yates Shuffle Algorithm
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Cümle Modu Arayüz Güncelleme
function renderQuestion(sentenceHtml, options) {
  sentenceTextEl.innerHTML = sentenceHtml;
  wordPosEl.textContent = currentQuestion.wordData.pos;
  wordLevelEl.textContent = currentQuestion.wordData.level || 'B2-C1 / YDS';
  
  renderOptions(options);
  updateAskFrequentlyUI();
}

// Kelime Modu Arayüz Güncelleme
function renderWordQuestion(questionText, options) {
  wordQuestionTextEl.textContent = questionText;
  wordPosEl.textContent = currentQuestion.wordData.pos;
  wordLevelEl.textContent = currentQuestion.wordData.level || 'B2-C1 / YDS';
  
  renderOptions(options);
  updateAskFrequentlyUI();
}

// Ortak Şık Çizme
function renderOptions(options) {
  optionsContainerEl.innerHTML = '';
  const letters = ['a', 'b', 'c', 'd'];
  
  options.forEach((option, index) => {
    const button = document.createElement('button');
    button.className = 'option-btn';
    button.innerHTML = `
      <span class="option-indicator">${letters[index]}</span>
      <span class="option-text">${option}</span>
    `;
    button.addEventListener('click', () => handleOptionClick(option, button));
    optionsContainerEl.appendChild(button);
  });
}

// ==========================================================================
// GAMEPLAY LOGIC & EVENT HANDLERS
// ==========================================================================
function handleOptionClick(selectedOption, clickedButton) {
  const correctOption = currentQuestion.correctAnswer;
  const isCorrect = (selectedOption === correctOption);
  const wordId = currentQuestion.wordData.id;
  
  const allButtons = optionsContainerEl.querySelectorAll('.option-btn');
  allButtons.forEach(btn => btn.classList.add('disabled'));
  
  // 1. Önce hata listesini yerel olarak güncelle (Optimistic)
  if (!isCorrect) {
    if (!state.mistakeIds.includes(wordId)) {
      state.mistakeIds.push(wordId);
    }
  } else {
    if (currentMode === 'mistake') {
      state.mistakeIds = state.mistakeIds.filter(id => id !== wordId);
    }
  }
  
  // 2. Ağırlığı ve hata durumunu veritabanına post et (Asenkron)
  adjustWordWeight(wordId, isCorrect);
  recordMistake(wordId, isCorrect);
  
  // 3. Sözcük türü istatistiklerini güncelle (posStats)
  if (currentQuestion && currentQuestion.wordData) {
    const rawPos = currentQuestion.wordData.pos ? currentQuestion.wordData.pos.toLowerCase().trim() : '';
    let posKey = '';
    if (rawPos.includes('verb') || rawPos.includes('fiil')) posKey = 'verb';
    else if (rawPos.includes('noun') || rawPos.includes('isim')) posKey = 'noun';
    else if (rawPos.includes('adjective') || rawPos.includes('sıfat')) posKey = 'adjective';
    else if (rawPos.includes('adverb') || rawPos.includes('zarf')) posKey = 'adverb';
    else if (rawPos.includes('conjunction') || rawPos.includes('bağlaç')) posKey = 'conjunction';
    else if (rawPos.includes('preposition') || rawPos.includes('edat')) posKey = 'preposition';

    if (posKey) {
      if (!state.stats.posStats) {
        state.stats.posStats = {
          verb: { correct: 0, total: 0 },
          noun: { correct: 0, total: 0 },
          adjective: { correct: 0, total: 0 },
          adverb: { correct: 0, total: 0 },
          conjunction: { correct: 0, total: 0 },
          preposition: { correct: 0, total: 0 }
        };
      }
      state.stats.posStats[posKey].total++;
      if (isCorrect) {
        state.stats.posStats[posKey].correct++;
      }
    }
  }
  
  if (isCorrect) {
    clickedButton.classList.add('correct');
    
    const isSentence = currentMode === 'sentence' || (currentMode === 'mistake' && currentQuestion.mistakeSubMode === 'sentence');
    if (isSentence) {
      const blankSpace = document.getElementById('blank-space');
      if (blankSpace) {
        blankSpace.textContent = currentQuestion.wordData.word;
        blankSpace.classList.add('correct');
      }
    } else {
      wordQuestionTextEl.style.color = 'var(--color-success)';
      setTimeout(() => {
        wordQuestionTextEl.style.color = '';
      }, 900);
    }
    
    // Update stats and daily progress (Optimistic)
    state.stats.correct++;
    incrementDailyProgress();
    saveState();
    updateStatsUI();
    
    setTimeout(loadNextQuestion, 900);
  } else {
    clickedButton.classList.add('incorrect');
    
    allButtons.forEach(btn => {
      const textSpan = btn.querySelector('.option-text');
      if (textSpan && textSpan.textContent === correctOption) {
        btn.classList.add('correct');
      }
    });
    
    // Update stats
    state.stats.incorrect++;
    saveState();
    updateStatsUI();
    
    setTimeout(openExplanationModal, 450);
  }
}

// ==========================================================================
// EXPLANATION POPUP (MODAL)
// ==========================================================================
function openExplanationModal() {
  const { wordData, example } = currentQuestion;
  
  modalCorrectWordEl.textContent = wordData.word;
  modalWordPosEl.textContent = wordData.pos;
  modalWordMeaningsEl.textContent = wordData.turkish_meanings.join(', ');
  
  const escapedWord = escapeRegExp(wordData.word);
  const regex = new RegExp(`\\b(${escapedWord}(?:ed|ing|s|es|d|ly)?)\\b`, 'gi');
  const highlightedEn = example.en.replace(regex, '<strong>$1</strong>');
  
  modalSentenceEnEl.innerHTML = highlightedEn;
  modalSentenceTrEl.textContent = example.tr;
  
  const meaningsJoined = wordData.turkish_meanings.slice(0, 3).join(', ');
  const wordPosTurkish = translatePos(wordData.pos);
  
  // Dinamik dil bilgisi ipucunu üret
  const grammarTipHtml = generateGrammarTip(wordData.pos, wordData.word);
  
  let explanationHtml = '';
  const isSentenceMode = currentMode === 'sentence' || (currentMode === 'mistake' && currentQuestion.mistakeSubMode === 'sentence');
  
  if (isSentenceMode) {
    explanationHtml = `
      Boş bırakılan yere İngilizce'de <strong>"${wordData.word}"</strong> (${wordPosTurkish}) kelimesi gelmelidir. 
      Bu kelime <strong>"${meaningsJoined}"</strong> anlamlarına gelir. 
      Cümle bu kelimeyle tamamlandığında şu anlama kavuşur: 
      <br><em style="display:block; margin-top:6px; color:#0f172a;">"${example.tr}"</em>
      ${grammarTipHtml}
    `;
  } else {
    explanationHtml = `
      Doğru eşleşme: <strong>"${wordData.word}"</strong> (${wordPosTurkish}) = <strong>"${meaningsJoined}"</strong>.
      <br><br>
      <strong>Örnek Cümle Kullanımı:</strong>
      <br><span style="font-style:italic; color:#334155; display:block; margin-top:4px;">"${example.en}"</span>
      <span style="color:#64748b; font-size:0.85rem; display:block; margin-bottom:8px;">(${example.tr})</span>
      ${grammarTipHtml}
    `;
  }
  
  modalExplanationTextEl.innerHTML = explanationHtml;
  
  // Show Modal
  modalEl.classList.remove('hidden');
  modalCloseBtnEl.focus(); // Focus button for accessibility
}

// Sözcük türlerine göre dinamik gramer ipuçları üreten yardımcı fonksiyon
function generateGrammarTip(pos, word) {
  const cleanPos = pos.trim().toLowerCase();
  
  if (cleanPos === 'verb' || cleanPos === 'fiil') {
    return `
      <div style="margin-top: 10px; border-top: 1px solid rgba(0,0,0,0.06); padding-top: 8px;">
        <span style="font-weight: 700; color: #1d4ed8; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">Gramer İpucu (Fiil - Verb):</span>
        <p style="font-size: 0.8rem; color: #1e40af; line-height: 1.4; margin: 0;">
          YDS kelime sorularında boşluktan önce gelen özneye veya yardımcı fiillere (<em>to, can, will, should</em> vb.) dikkat edilmelidir. Boşluk bir eylemi nitelediği için şıklar arasından bu eylemi en doğru şekilde karşılayan <strong>"${word}"</strong> fiil yapısı doğru yanıttır.
        </p>
      </div>
    `;
  } else if (cleanPos === 'adjective' || cleanPos === 'sıfat') {
    return `
      <div style="margin-top: 10px; border-top: 1px solid rgba(0,0,0,0.06); padding-top: 8px;">
        <span style="font-weight: 700; color: #047857; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">Gramer İpucu (Sıfat - Adjective):</span>
        <p style="font-size: 0.8rem; color: #065f46; line-height: 1.4; margin: 0;">
          YDS'de boşluktan hemen sonra doğrudan bir <strong>isim</strong> geliyorsa, oraya büyük ihtimalle o ismi tanımlayacak bir sıfat gelir. Cümledeki ismi nitelik olarak en doğru tamamlayan sıfat seçeneğimiz <strong>"${word}"</strong> kelimesidir.
        </p>
      </div>
    `;
  } else if (cleanPos === 'noun' || cleanPos === 'isim') {
    return `
      <div style="margin-top: 10px; border-top: 1px solid rgba(0,0,0,0.06); padding-top: 8px;">
        <span style="font-weight: 700; color: #b45309; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">Gramer İpucu (İsim - Noun):</span>
        <p style="font-size: 0.8rem; color: #78350f; line-height: 1.4; margin: 0;">
          Boşluktan önce gelen belirteçler (<em>the, a/an, their, its</em> vb.) veya sıfatlar, bu boşluğa bir isim gelmesi gerektiğinin en büyük kanıtıdır. Cümlenin özne veya nesne konumundaki anlam boşluğunu <strong>"${word}"</strong> ismi tamamlar.
        </p>
      </div>
    `;
  } else if (cleanPos === 'adverb' || cleanPos === 'zarf') {
    return `
      <div style="margin-top: 10px; border-top: 1px solid rgba(0,0,0,0.06); padding-top: 8px;">
        <span style="font-weight: 700; color: #6d28d9; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">Gramer İpucu (Zarf - Adverb):</span>
        <p style="font-size: 0.8rem; color: #5b21b6; line-height: 1.4; margin: 0;">
          YDS'de fiilleri, sıfatları veya diğer zarfları nitelemek için zarf yapıları kullanılır (genellikle <em>-ly</em> takısıyla biter). Cümledeki eylemin derecesini veya yapılma biçimini anlamca en iyi niteleyen zarf <strong>"${word}"</strong> seçeneğidir.
        </p>
      </div>
    `;
  }
  
  return `
    <div style="margin-top: 10px; border-top: 1px solid rgba(0,0,0,0.06); padding-top: 8px;">
      <span style="font-weight: 700; color: #374151; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">Çözüm Analizi:</span>
      <p style="font-size: 0.8rem; color: #4b5563; line-height: 1.4; margin: 0;">
        Boş bırakılan yere kelime türü kurallarına göre <strong>"${word}"</strong> kelimesi gelerek cümlenin anlam bütünlüğünü ve gramer yapısını doğru şekilde tamamlamaktadır.
      </p>
    </div>
  `;
}

function closeModal() {
  modalEl.classList.add('hidden');
}

function resetHint() {
  currentHintStep = 0;
  if (hintBoxEl) hintBoxEl.classList.add('hidden');
  if (hintButtonEl) {
    hintButtonEl.classList.remove('active-gold');
    hintButtonEl.title = "İpucu Al";
  }
}

function toggleHint() {
  if (!currentQuestion || !currentQuestion.wordData) return;
  
  currentHintStep++;
  
  let hintText = '';
  const wordData = currentQuestion.wordData;
  const example = currentQuestion.example;
  
  // Modlara göre ipucu tiplerini seç
  const isSentenceMode = currentMode === 'sentence' || (currentMode === 'mistake' && currentQuestion.mistakeSubMode === 'sentence');
  
  if (isSentenceMode) {
    // Cümle Pratiği Modu İpuçları
    if (currentHintStep === 1) {
      const posTurkish = translatePos(wordData.pos);
      const firstLetter = wordData.word.trim().charAt(0).toUpperCase();
      hintText = `<strong>1. İpucu:</strong> Bu kelime bir <strong>${posTurkish}</strong> ve <strong>"${firstLetter}"</strong> harfi ile başlıyor.`;
      hintButtonEl.classList.add('active-gold');
    } else if (currentHintStep === 2) {
      const meanings = wordData.turkish_meanings.slice(0, 3).join(', ');
      hintText = `<strong>2. İpucu (Anlamı):</strong> Kelimenin Türkçe karşılıkları: <strong>"${meanings}"</strong>`;
      hintButtonEl.title = "İpuçları Tükendi";
    } else {
      resetHint();
      return;
    }
  } else {
    // Kelime Öğrenme Modu İpuçları
    const isEnTr = (currentMode === 'word' && wordDirection === 'en-tr') || 
                   (currentMode === 'mistake' && currentQuestion.mistakeSubMode === 'word' && currentQuestion.mistakeSubDir === 'en-tr');
    
    if (isEnTr) {
      // EN -> TR Modu İpuçları
      if (currentHintStep === 1) {
        // Örnek cümle ipucu (kelimeyi maskeleyelim)
        const maskedSentence = maskWordInSentence(example.en, wordData.word);
        hintText = `<strong>1. İpucu (Örnek Cümle):</strong> <br><em style="color: #374151;">"${maskedSentence}"</em>`;
        hintButtonEl.classList.add('active-gold');
      } else if (currentHintStep === 2) {
        const posTurkish = translatePos(wordData.pos);
        hintText = `<strong>2. İpucu:</strong> Sözcük türü: <strong>${posTurkish}</strong>`;
        hintButtonEl.title = "İpuçları Tükendi";
      } else {
        resetHint();
        return;
      }
    } else {
      // TR -> EN Modu İpuçları
      if (currentHintStep === 1) {
        const firstLetter = wordData.word.trim().charAt(0).toUpperCase();
        hintText = `<strong>1. İpucu:</strong> İngilizce kelime <strong>"${firstLetter}"</strong> harfi ile başlıyor.`;
        hintButtonEl.classList.add('active-gold');
      } else if (currentHintStep === 2) {
        // Örnek cümlenin Türkçesi ipucu
        hintText = `<strong>2. İpucu (Kullanım Cümlesi):</strong> <br><em style="color: #374151;">"${example.tr}"</em>`;
        hintButtonEl.title = "İpuçları Tükendi";
      } else {
        resetHint();
        return;
      }
    }
  }
  
  hintTextEl.innerHTML = hintText;
  hintBoxEl.classList.remove('hidden');
}

function renderAnalytics() {
  // 1. Genel verileri topla
  const totalCorrect = state.stats.correct || 0;
  const totalIncorrect = state.stats.incorrect || 0;
  const grandTotal = totalCorrect + totalIncorrect;
  const accuracy = grandTotal === 0 ? 0 : Math.round((totalCorrect / grandTotal) * 100);
  
  // 2. Kelime havuzu durumunu sınıflandır (Ustalaşılan >= 10, Öğrenilen 1-9, Yeni 0, Öğrenilmesi Gereken < 0)
  let masteredCount = 0;
  let learnedCount = 0;
  let newCount = 0;
  let strugglingCount = 0;
  const totalWords = wordPool.length;
  
  wordPool.forEach(w => {
    const cc = w.correct_count || 0;
    if (cc >= 10) masteredCount++;
    else if (cc > 0) learnedCount++;
    else if (cc === 0) newCount++;
    else strugglingCount++;
  });
  
  const masteredPct = Math.round((masteredCount / totalWords) * 100);
  const learnedPct = Math.round((learnedCount / totalWords) * 100);
  const newPct = Math.round((newCount / totalWords) * 100);
  const strugglingPct = Math.max(0, 100 - masteredPct - learnedPct - newPct); // Kalanı verelim
  
  // 3. En çok hata yapılan ilk 5 kelime
  const mistakeWords = wordPool.filter(w => state.mistakeIds.includes(w.id));
  mistakeWords.sort((a, b) => {
    const wA = state.wordWeights[a.id] || 1.0;
    const wB = state.wordWeights[b.id] || 1.0;
    return wB - wA;
  });
  const topMistakes = mistakeWords.slice(0, 5);
  
  // 4. POS (Sözcük Türü) bazlı başarı hesaplama
  const posStats = state.stats.posStats || {
    verb: { correct: 0, total: 0 },
    noun: { correct: 0, total: 0 },
    adjective: { correct: 0, total: 0 },
    adverb: { correct: 0, total: 0 },
    conjunction: { correct: 0, total: 0 },
    preposition: { correct: 0, total: 0 }
  };
  
  const posList = [
    { key: 'verb', label: 'Fiil (Verb)' },
    { key: 'noun', label: 'İsim (Noun)' },
    { key: 'adjective', label: 'Sıfat (Adjective)' },
    { key: 'adverb', label: 'Zarf (Adverb)' },
    { key: 'conjunction', label: 'Bağlaç (Conjunction)' },
    { key: 'preposition', label: 'Edat (Preposition)' }
  ];
  
  const posScores = posList.map(pos => {
    const stat = posStats[pos.key] || { correct: 0, total: 0 };
    let accuracyRate = 0;
    let detailsText = 'Soru çözülmedi';
    
    if (stat.total > 0) {
      accuracyRate = Math.round((stat.correct / stat.total) * 100);
      detailsText = `${stat.correct} / ${stat.total} Soru`;
    } else {
      // Tahmini başarıyı kelime ağırlıklarından hesapla
      const wordsInPos = wordPool.filter(w => {
        const rawPos = w.pos.toLowerCase().trim();
        return rawPos.includes(pos.key) || (pos.key === 'verb' && rawPos.includes('fiil')) || 
               (pos.key === 'noun' && rawPos.includes('isim')) || (pos.key === 'adjective' && rawPos.includes('sıfat')) ||
               (pos.key === 'adverb' && rawPos.includes('zarf')) || (pos.key === 'conjunction' && rawPos.includes('bağlaç')) ||
               (pos.key === 'preposition' && rawPos.includes('edat'));
      });
      
      if (wordsInPos.length > 0) {
        const learnedOrMastered = wordsInPos.filter(w => (w.correct_count || 0) > 0).length;
        accuracyRate = Math.round((learnedOrMastered / wordsInPos.length) * 100);
        accuracyRate = Math.max(50, accuracyRate); // Min %50 başlangıç
        detailsText = `${wordsInPos.length} Kelime`;
      } else {
        accuracyRate = 100;
        detailsText = 'Veri yok';
      }
    }
    
    return {
      label: pos.label,
      key: pos.key,
      score: accuracyRate,
      details: detailsText
    };
  });
  
  // 5. Akıllı Tavsiye Motoru
  let lowestPos = posScores[0];
  posScores.forEach(pos => {
    if (pos.score < lowestPos.score) {
      lowestPos = pos;
    }
  });
  
  let recommendationHtml = '';
  if (grandTotal < 5) {
    recommendationHtml = `
      <strong>💡 Analiz Hazırlanıyor:</strong> İstatistiklerinizin birikmesi ve zayıf nokta analizi alabilmek için lütfen test modlarında en az 5 soru çözün.
    `;
  } else if (lowestPos.score < 70) {
    recommendationHtml = `
      <strong>🎯 Zayıf Nokta Analizi & Tavsiye:</strong> İstatistiklerinize göre en çok zorlandığınız alan <strong>${lowestPos.label}</strong> (Başarı Oranı: %${lowestPos.score}). 
      Bu kelime türünde ${lowestPos.details} verisine sahipsiniz. Kelime Öğrenme moduna geçip, zayıf olduğunuz bu kelime gruplarını <strong>"Daha Sık Sor"</strong> olarak işaretleyerek pekiştirmenizi öneririz.
    `;
  } else {
    recommendationHtml = `
      <strong>🏆 Harika Gidiyorsunuz!</strong> Tüm sözcük türlerinde başarı oranınız %70'in üzerinde. Mevcut çalışma temponuzu koruyarak Spaced Repetition (aralıklı tekrar) sisteminin karşınıza getirdiği kelimeleri pratik yapmaya devam edin!
    `;
  }
  
  // Zorlanılan kelimeler listesi HTML
  let weakWordsHtml = '';
  if (topMistakes.length > 0) {
    weakWordsHtml = `
      <div class="weak-words-list">
        ${topMistakes.map(w => `
          <div class="weak-word-item">
            <div>
              <span class="weak-word-name">${w.word}</span>
              <span class="word-pos-tag" style="margin-left: 8px;">${translatePos(w.pos)}</span>
            </div>
            <span class="weak-word-meaning">${w.turkish_meanings.slice(0, 2).join(', ')}</span>
            <span class="weak-word-weight-badge" title="Ağırlık: ${state.wordWeights[w.id]}">Hata: ${Math.round((state.wordWeights[w.id] || 1.0) * 10)}</span>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    weakWordsHtml = `
      <p style="font-size: 0.9rem; color: var(--color-text-secondary); text-align: center; padding: 12px 0;">
        Hata defteriniz boş olduğu için zorlandığınız kelime bulunmuyor. Tebrikler!
      </p>
    `;
  }
  
  analyticsContainerEl.innerHTML = `
    <div class="analytics-header">
      <h2>Performans Analizi</h2>
      <p>YDS WordMaster çalışma verileriniz ve zayıf nokta analizleriniz.</p>
    </div>
    
    <div class="analytics-grid">
      <div class="analytics-stat-card">
        <span class="stat-label">Toplam Soru</span>
        <span class="stat-value text-primary">${grandTotal}</span>
      </div>
      <div class="analytics-stat-card">
        <span class="stat-label">Doğruluk</span>
        <span class="stat-value text-success">${accuracy}%</span>
      </div>
      <div class="analytics-stat-card">
        <span class="stat-label">Hata Defteri</span>
        <span class="stat-value" style="color: var(--color-danger);">${state.mistakeIds.length} Kelime</span>
      </div>
    </div>
    
    <div class="pos-analysis-section">
      <h3 class="section-title">Kelime Havuzu Dağılımı</h3>
      <div class="distribution-bar">
        <div class="dist-fill mastered" style="width: ${masteredPct}%;" title="Ustalaşılan: %${masteredPct}"></div>
        <div class="dist-fill learned" style="width: ${learnedPct}%;" title="Öğrenilen: %${learnedPct}"></div>
        <div class="dist-fill studying" style="width: ${newPct}%;" title="Yeni/Çalışılan: %${newPct}"></div>
        <div class="dist-fill struggling" style="width: ${strugglingPct}%;" title="Öğrenilmesi Gereken: %${strugglingPct}"></div>
      </div>
      <div class="dist-legend">
        <div class="legend-item"><span class="legend-dot mastered"></span> Ustalaşılan (10+ Doğru): ${masteredCount} kelime (%${masteredPct})</div>
        <div class="legend-item"><span class="legend-dot learned"></span> Öğrenilen (1-9 Doğru): ${learnedCount} kelime (%${learnedPct})</div>
        <div class="legend-item"><span class="legend-dot studying"></span> Yeni/Çalışılan (0 Doğru): ${newCount} kelime (%${newPct})</div>
        <div class="legend-item"><span class="legend-dot struggling"></span> Öğrenilmesi Gereken (<0 Doğru): ${strugglingCount} kelime (%${strugglingPct})</div>
      </div>
    </div>
    
    <div class="pos-analysis-section">
      <h3 class="section-title">Sözcük Türlerine Göre Başarı</h3>
      <div class="pos-bars-container">
        ${posScores.map(p => `
          <div class="pos-bar-row">
            <div class="pos-bar-meta">
              <span class="pos-bar-title">${p.label}</span>
              <span class="pos-bar-score">%${p.score} <span style="font-weight: normal; color: var(--color-text-muted); font-size: 0.75rem;">(${p.details})</span></span>
            </div>
            <div class="pos-progress-track">
              <div class="pos-progress-fill" style="width: ${p.score}%;"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="pos-analysis-section">
      <h3 class="section-title">Zorlanılan Kelimeler (Zayıf Noktalar)</h3>
      ${weakWordsHtml}
    </div>
    
    <div class="ai-recommendation-box">
      ${recommendationHtml}
    </div>
  `;
}

function toggleAskFrequently() {
  if (!currentQuestion || !currentQuestion.wordData) return;
  
  const wordId = currentQuestion.wordData.id;
  const localWordObj = wordPool.find(w => w.id === wordId);
  if (!localWordObj) return;
  
  const newStatus = localWordObj.ask_more === 1 ? 0 : 1;
  localWordObj.ask_more = newStatus;
  
  if (newStatus === 1) {
    if (!state.askMoreIds.includes(wordId)) {
      state.askMoreIds.push(wordId);
    }
  } else {
    state.askMoreIds = state.askMoreIds.filter(id => id !== wordId);
  }
  
  // Asenkron kaydet
  const weight = state.wordWeights[wordId] || 1.0;
  const isMistake = state.mistakeIds.includes(wordId) ? 1 : 0;
  const correctCount = localWordObj.correct_count || 0;
  saveWordWeightToDb(wordId, weight, isMistake, newStatus, correctCount);
  
  updateAskFrequentlyUI();
}

function updateAskFrequentlyUI() {
  if (!currentQuestion || !currentQuestion.wordData) {
    askFrequentlyBtnEl.classList.add('hidden');
    return;
  }
  
  if (currentMode === 'mistake' && state.mistakeIds.length === 0) {
    askFrequentlyBtnEl.classList.add('hidden');
    return;
  }
  
  askFrequentlyBtnEl.classList.remove('hidden');
  
  const wordId = currentQuestion.wordData.id;
  const localWordObj = wordPool.find(w => w.id === wordId);
  
  if (localWordObj && localWordObj.ask_more === 1) {
    askFrequentlyBtnEl.classList.add('active-blue');
    askFrequentlyBtnEl.title = "Sık Soruluyor (Kapatmak için tıkla)";
  } else {
    askFrequentlyBtnEl.classList.remove('active-blue');
    askFrequentlyBtnEl.title = "Daha Sık Sor";
  }
}

function translatePos(pos) {
  const mapping = {
    'verb': 'fiil',
    'noun': 'isim',
    'adjective': 'sıfat',
    'adverb': 'zarf',
    'conjunction': 'bağlaç',
    'preposition': 'edat'
  };
  return mapping[pos.toLowerCase()] || pos;
}

// ==========================================================================
// AUDIO SYNTHESIS (TTS)
// ==========================================================================
function playAudio() {
  if (!currentQuestion || !synth) return;
  
  if (synth.speaking) {
    synth.cancel();
    ttsButtonEl.classList.remove('speaking');
    return;
  }
  
  const isSentenceMode = currentMode === 'sentence' || (currentMode === 'mistake' && currentQuestion.mistakeSubMode === 'sentence');
  const textToSpeak = isSentenceMode ? currentQuestion.example.en : currentQuestion.wordData.word;
  speechUtterance = new SpeechSynthesisUtterance(textToSpeak);
  
  const voices = synth.getVoices();
  const enVoice = voices.find(voice => voice.lang.startsWith('en-US') || voice.lang.startsWith('en-GB')) || voices[0];
  
  if (enVoice) {
    speechUtterance.voice = enVoice;
  }
  
  speechUtterance.rate = isSentenceMode ? 0.85 : 0.95;
  
  speechUtterance.onstart = () => {
    ttsButtonEl.classList.add('speaking');
  };
  
  speechUtterance.onend = () => {
    ttsButtonEl.classList.remove('speaking');
  };
  
  speechUtterance.onerror = () => {
    ttsButtonEl.classList.remove('speaking');
  };
  
  synth.speak(speechUtterance);
}

if (synth && synth.onvoiceschanged !== undefined) {
  synth.onvoiceschanged = () => {
    // Voices loaded
  };
}

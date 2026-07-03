'use strict';

/* ============================================================
 * 일본어 단어장 앱 (Japanese Vocabulary App)
 *
 * 아빠용 일본어→한국어 관광/회화 단어장.
 * 채원 영어 단어장을 베이스로 일본어에 맞게 수정.
 *
 * 주요 차이점:
 *  - A-Z 알파벳 → あ행~わ행 + 漢(한자) 오십음도 분류
 *  - 히라가나/가타카나 → 같은 행으로 분류 (カ → か행)
 *  - 한자로 시작하는 단어 → '漢' 카테고리
 *  - Firebase 같은 프로젝트, 다른 collection (jp_users)
 *  - localStorage 별도 키 (jp_flashcard_*)
 *
 * 화면 구조:
 *  #1  홈 (랜딩)      - 앱 제목 + "단어장" / "단어추가" / "낱말카드"
 *  #2  오십음 그리드   - あ~わ + 漢 + ★즐겨찾기
 *  #3  단어 목록       - 행별 단어 리스트
 *  #4  단어 추가       - 하나씩 / 대량 입력
 *  #5  학습 모드       - 낱말카드 플립 + 스와이프
 * ============================================================ */

// ============================================================
// 1. 유틸리티
// ============================================================

// HTML 본문에 넣을 텍스트의 특수문자 이스케이프 (XSS 방지)
function escapeHtml(text) {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}

// HTML 속성값(value="...")에 넣을 때 사용
function escapeAttr(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// UUID 생성 (HTTPS에서는 crypto, HTTP에서는 폴백)
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Fisher-Yates 셔플 (원본 변경 없이 새 배열 반환)
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// 콤마로 구분된 정의를 배열로 파싱
function parseDefinitions(text) {
  return text.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

// 낱말카드용: 뜻이 여러 개면 번호 매겨서 세로 표시
function formatDefinitionCard(text) {
  const defs = parseDefinitions(text);
  if (defs.length <= 1) return escapeHtml(text);
  return '<div class="def-list">'
    + defs.map((d, i) =>
        `<div class="def-item"><span class="def-number">${i + 1}.</span> ${escapeHtml(d)}</div>`
      ).join('')
    + '</div>';
}

// 단어 목록용: 콤마+공백으로 정규화해서 인라인 표시
function formatDefinitionInline(text) {
  const defs = parseDefinitions(text);
  return defs.map(d => escapeHtml(d)).join(', ');
}

// ---- 오십음도 분류 ----

// 그리드에 표시할 행 목록
const KANA_ROWS = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', '漢'];

// 행 표시 라벨 (헤더 등에서 사용)
const KANA_ROW_LABELS = {
  'あ': 'あ행', 'か': 'か행', 'さ': 'さ행', 'た': 'た행', 'な': 'な행',
  'は': 'は행', 'ま': 'ま행', 'や': 'や행', 'ら': 'ら행', 'わ': 'わ행',
  '漢': '漢字',
};

// 히라가나 → 행 매핑 테이블 (프로그램 시작 시 자동 생성)
const HIRAGANA_ROW_MAP = {};
const KATAKANA_ROW_MAP = {};

// 각 행에 속하는 히라가나(h)/가타카나(k) 문자들
// 탁음(が→か행), 반탁음(ぱ→は행), 작은 글자(っ→た행) 모두 해당 행에 포함
const ROW_CHARS = {
  'あ': { h: 'あいうえおぁぃぅぇぉゔ', k: 'アイウエオァィゥェォヴ' },
  'か': { h: 'かきくけこがぎぐげご', k: 'カキクケコガギグゲゴ' },
  'さ': { h: 'さしすせそざじずぜぞ', k: 'サシスセソザジズゼゾ' },
  'た': { h: 'たちつてとだぢづでどっ', k: 'タチツテトダヂヅデドッ' },
  'な': { h: 'なにぬねの', k: 'ナニヌネノ' },
  'は': { h: 'はひふへほばびぶべぼぱぴぷぺぽ', k: 'ハヒフヘホバビブベボパピプペポ' },
  'ま': { h: 'まみむめも', k: 'マミムメモ' },
  'や': { h: 'やゆよゃゅょ', k: 'ヤユヨャュョ' },
  'ら': { h: 'らりるれろ', k: 'ラリルレロ' },
  'わ': { h: 'わをんゎ', k: 'ワヲンヮー' },
};

// 매핑 테이블 초기화: 각 문자가 어느 행에 속하는지 역방향 매핑 생성
Object.entries(ROW_CHARS).forEach(([row, chars]) => {
  [...chars.h].forEach(c => { HIRAGANA_ROW_MAP[c] = row; });
  [...chars.k].forEach(c => { KATAKANA_ROW_MAP[c] = row; });
});

// 한 글자 → 오십음 행 판별
// 히라가나/가타카나 → 해당 행, 한자 → '漢', 그 외 → null
function getKanaRow(char) {
  if (!char) return null;
  if (HIRAGANA_ROW_MAP[char]) return HIRAGANA_ROW_MAP[char];
  if (KATAKANA_ROW_MAP[char]) return KATAKANA_ROW_MAP[char];
  const code = char.charCodeAt(0);
  // CJK 한자 범위
  if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF)) {
    return '漢';
  }
  return null;
}

// 단어의 첫 글자로 행 판별
function getWordRow(term) {
  if (!term) return null;
  return getKanaRow(term.charAt(0));
}

// ---- 파싱 유틸리티 ----

// 한국어 문자 감지
const hasKorean = (text) => /[\uAC00-\uD7AF\u3131-\u318E]/.test(text);

// "일본어 — 한국어 뜻" 형식의 텍스트를 카드 배열로 변환
function parseBulkWords(text) {
  // 한글 끝 + 공백 + 일본어 시작 지점에서 자동 줄바꿈
  // 예: "먹다 のむ — 마시다" → "먹다\nのむ — 마시다"
  text = text.replace(
    /([\uAC00-\uD7AF\u3131-\u318E)~])\s+([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])/g,
    '$1\n$2'
  );

  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      // 1) em dash 구분자: "たべる — 먹다"
      let idx = line.indexOf(' — ');
      if (idx > 0) {
        return { term: line.slice(0, idx).trim(), definition: line.slice(idx + 3).trim() };
      }
      // 2) 공백 있는 hyphen 구분자: "たべる - 먹다"
      idx = line.indexOf(' - ');
      if (idx > 0) {
        return { term: line.slice(0, idx).trim(), definition: line.slice(idx + 3).trim() };
      }
      // 3) 구분자 없이 공백만: 일본어 뒤에 한글이 오는 지점에서 분리
      //    "たべる 먹다" → term: "たべる", definition: "먹다"
      const spaceMatch = line.match(/^(.+?)\s+([\uAC00-\uD7AF\u3131-\u318E~(].*)$/);
      if (spaceMatch) {
        return { term: spaceMatch[1].trim(), definition: spaceMatch[2].trim() };
      }
      return null;
    })
    .filter(Boolean);
}

// 동기화/중복 제거 기준. 일본어는 대소문자가 없으므로 toLowerCase 불필요.
function normalizeTerm(text) {
  return String(text || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');
}

function mergeDefinitionText(a, b) {
  const merged = parseDefinitions(a || '');
  parseDefinitions(b || '').forEach(def => {
    if (!merged.includes(def)) merged.push(def);
  });
  return merged.join(', ');
}

// ============================================================
// 2. Storage - 단일 단어장 관리
//
// 영어 단어장(flashcard_cards)과 충돌하지 않도록
// jp_flashcard_cards / jp_flashcard_trash 키 사용
// ============================================================

const Storage = {
  KEY: 'jp_flashcard_cards',

  getAll() {
    const data = localStorage.getItem(this.KEY);
    return data ? JSON.parse(data) : [];
  },

  addCards(newCards) {
    const cards = this.getAll();
    let mergedCount = 0;

    newCards.forEach(newCard => {
      newCard.term = normalizeTerm(newCard.term);
      const existing = cards.find(
        c => normalizeTerm(c.term) === newCard.term
      );

      if (existing) {
        existing.definition = mergeDefinitionText(existing.definition, newCard.definition);
        existing.count = (existing.count || 1) + 1;
        mergedCount++;
      } else {
        cards.push({
          id: generateId(),
          term: newCard.term,
          definition: newCard.definition,
          count: 1,
          updatedAt: 0,
        });
      }
    });

    this._save(cards);
    return { cards, mergedCount };
  },

  updateCard(id, data) {
    const cards = this.getAll();
    const card = cards.find(c => c.id === id);
    if (!card) return null;
    Object.assign(card, data);
    this._save(cards);
    return card;
  },

  toggleFavorite(id) {
    const cards = this.getAll();
    const card = cards.find(c => c.id === id);
    if (!card) return null;
    card.favorite = !card.favorite;
    this._save(cards);
    return card;
  },

  deleteCard(id) {
    const cards = this.getAll();
    const card = cards.find(c => c.id === id);
    if (card) {
      const trash = this.getTrash();
      card.deletedAt = Date.now();
      card.updatedAt = card.deletedAt;
      trash.unshift(card);
      this._saveTrash(trash);
    }
    this._save(cards.filter(c => c.id !== id));
    return cards.filter(c => c.id !== id);
  },

  TRASH_KEY: 'jp_flashcard_trash',

  getTrash() {
    const data = localStorage.getItem(this.TRASH_KEY);
    return data ? JSON.parse(data) : [];
  },

  restoreCard(id) {
    const trash = this.getTrash();
    const card = trash.find(c => c.id === id);
    if (!card) return;
    delete card.deletedAt;
    const cards = this.getAll();
    cards.push(card);
    this._save(cards);
    this._saveTrash(trash.filter(c => c.id !== id));
  },

  permanentDelete(id) {
    this._saveTrash(this.getTrash().filter(c => c.id !== id));
  },

  emptyTrash() {
    this._saveTrash([]);
  },

  _saveTrash(trash) {
    localStorage.setItem(this.TRASH_KEY, JSON.stringify(trash));
  },

  replaceAll(newCards) {
    const cards = newCards.map(c => ({
      id: generateId(),
      term: c.term,
      definition: c.definition,
      count: 1,
      favorite: false,
      updatedAt: 0,
    }));
    this._save(cards);
    return cards;
  },

  dedup() {
    const cards = this.getAll();
    const map = new Map();
    cards.forEach(c => {
      const key = normalizeTerm(c.term);
      const existing = map.get(key);
      if (existing) {
        existing.definition = mergeDefinitionText(existing.definition, c.definition);
        existing.count = Math.max(existing.count || 1, c.count || 1);
        if (c.favorite) existing.favorite = true;
        if (c.updatedAt > (existing.updatedAt || 0)) existing.updatedAt = c.updatedAt;
      } else {
        map.set(key, { ...c, term: key, updatedAt: c.updatedAt || 0 });
      }
    });
    const deduped = Array.from(map.values());
    const removed = cards.length - deduped.length;
    if (removed > 0) this._save(deduped);
    return removed;
  },

  _save(cards) {
    localStorage.setItem(this.KEY, JSON.stringify(cards));
  },
};

// ============================================================
// 2-1. Firebase 동기화
//
// 같은 Firebase 프로젝트(chaewon-word)를 사용하되,
// collection을 'jp_users'로 분리해서 영어 단어장과 섞이지 않게 함
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyBmAkRDbNgE1VZ8Zj2vizklM4imMTbECKw",
  authDomain: "chaewon-word.firebaseapp.com",
  projectId: "chaewon-word",
  storageBucket: "chaewon-word.firebasestorage.app",
  messagingSenderId: "574276438801",
  appId: "1:574276438801:web:0caf9da02a48caf1219ab0",
};

let fbAuth = null;
let fbDb = null;

if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
  fbAuth = firebase.auth();
  fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
  fbDb = firebase.firestore();
  fbDb.enablePersistence().catch(() => {});
}

const Sync = {
  // 영어 단어장은 'users', 일본어 단어장은 'jp_users' collection 사용
  COLLECTION: 'jp_users',

  getUserId() {
    return fbAuth && fbAuth.currentUser ? fbAuth.currentUser.uid : null;
  },

  isSignedIn() {
    return !!this.getUserId();
  },

  signIn() {
    if (!fbAuth) { alert('Firebase가 로드되지 않았어요'); return; }
    const provider = new firebase.auth.GoogleAuthProvider();
    fbAuth.signInWithPopup(provider)
      .then(() => this.syncFromCloud())
      .then(() => renderHome())
      .catch(err => {
        if (err.code === 'auth/popup-blocked') {
          alert('팝업이 차단되었어요.\n\niPhone: 설정 → Safari → 팝업 차단 해제\nChrome: 팝업 허용 설정\n\n해제 후 다시 시도해주세요.');
        } else if (err.code !== 'auth/popup-closed-by-user') {
          alert('로그인 오류: ' + (err.message || err.code));
        }
      });
  },

  async signOut() {
    if (!fbAuth) return;
    await fbAuth.signOut();
  },

  async syncToCloud(options = {}) {
    const { mergeCloud = true } = options;
    const uid = this.getUserId();
    if (!uid || !fbDb) return;

    try {
      let cloudCards = [];
      let cloudTrash = [];

      if (mergeCloud) {
        const doc = await fbDb.collection(this.COLLECTION).doc(uid).get();
        if (doc.exists) {
          const cloudData = doc.data();
          cloudCards = this._safeParseCards(cloudData.cards);
          cloudTrash = this._safeParseCards(cloudData.trash);
        }
      }

      const cleaned = this._reconcileData(Storage.getAll(), cloudCards, Storage.getTrash(), cloudTrash);
      Storage._save(cleaned.cards);
      Storage._saveTrash(cleaned.trash);

      await fbDb.collection(this.COLLECTION).doc(uid).set({
        cards: JSON.stringify(cleaned.cards),
        trash: JSON.stringify(cleaned.trash),
        schemaVersion: 1,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      localStorage.setItem('jp_lastSyncAt', Date.now().toString());
    } catch (err) {
      console.error('동기화 업로드 실패:', err);
    }
  },

  async syncFromCloud() {
    const uid = this.getUserId();
    if (!uid || !fbDb) return;

    try {
      const doc = await fbDb.collection(this.COLLECTION).doc(uid).get();
      if (!doc.exists) {
        await this.syncToCloud({ mergeCloud: false });
        return;
      }

      const cloudData = doc.data();
      const cloudCards = this._safeParseCards(cloudData.cards);
      const cloudTrash = this._safeParseCards(cloudData.trash);
      const localCards = Storage.getAll();
      const localTrash = Storage.getTrash();

      const mergedData = this._reconcileData(localCards, cloudCards, localTrash, cloudTrash);
      Storage._save(mergedData.cards);
      Storage._saveTrash(mergedData.trash);
      localStorage.setItem('jp_lastSyncAt', Date.now().toString());

      await this.syncToCloud({ mergeCloud: false });
    } catch (err) {
      console.error('동기화 다운로드 실패:', err);
    }
  },

  _mergeCards(localCards, cloudCards) {
    const map = new Map();

    function addCard(c) {
      c.updatedAt = c.updatedAt || 0;
      const key = normalizeTerm(c.term);
      const existing = map.get(key);
      if (existing) {
        const eDefs = parseDefinitions(existing.definition);
        const nDefs = parseDefinitions(c.definition);
        nDefs.forEach(d => { if (!eDefs.includes(d)) eDefs.push(d); });
        existing.definition = eDefs.join(', ');
        if (c.favorite) existing.favorite = true;
        existing.count = Math.max(existing.count || 1, c.count || 1);
        if (c.updatedAt > existing.updatedAt) existing.updatedAt = c.updatedAt;
      } else {
        map.set(key, { ...c });
      }
    }

    localCards.forEach(addCard);
    cloudCards.forEach(addCard);
    return Array.from(map.values());
  },

  _safeParseCards(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  _reconcileData(localCards, cloudCards, localTrash, cloudTrash) {
    const records = new Map();

    const add = (card, source) => {
      if (!card || !card.term) return;
      const key = normalizeTerm(card.term);
      if (!key) return;

      const updatedAt = Number(card.updatedAt || 0);
      const deletedAt = Number(card.deletedAt || 0);
      const isTrash = source === 'trash' || deletedAt > 0;
      const existing = records.get(key) || {
        id: card.id || generateId(),
        term: key,
        definition: '',
        count: 1,
        favorite: false,
        activeUpdatedAt: 0,
        deletedAt: 0,
        updatedAt: 0,
      };

      existing.definition = mergeDefinitionText(existing.definition, card.definition || '');
      existing.count = Math.max(existing.count || 1, card.count || 1);
      existing.favorite = !!existing.favorite || !!card.favorite;
      existing.updatedAt = Math.max(existing.updatedAt || 0, updatedAt);

      if (isTrash) {
        existing.deletedAt = Math.max(existing.deletedAt || 0, deletedAt || updatedAt || 0);
        existing.trashId = existing.trashId || card.id;
      } else {
        existing.activeUpdatedAt = Math.max(existing.activeUpdatedAt || 0, updatedAt || 0);
        existing.activeId = existing.activeId || card.id;
      }

      records.set(key, existing);
    };

    localCards.forEach(card => add(card, 'active'));
    cloudCards.forEach(card => add(card, 'active'));
    localTrash.forEach(card => add(card, 'trash'));
    cloudTrash.forEach(card => add(card, 'trash'));

    const cards = [];
    const trash = [];

    records.forEach(record => {
      const latest = Math.max(record.updatedAt || 0, record.activeUpdatedAt || 0, record.deletedAt || 0);
      const base = {
        id: record.activeId || record.trashId || record.id || generateId(),
        term: record.term,
        definition: record.definition,
        count: record.count || 1,
        favorite: !!record.favorite,
        updatedAt: latest,
      };

      if (record.deletedAt > record.activeUpdatedAt) {
        trash.push({ ...base, id: record.trashId || base.id, deletedAt: record.deletedAt });
      } else {
        cards.push(base);
      }
    });

    cards.sort((a, b) => a.term.localeCompare(b.term, 'ja'));
    trash.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    return { cards, trash };
  },

  getStatusText() {
    if (!fbAuth) return '';
    if (!this.isSignedIn()) return '로그인하면 기기 간 동기화';
    const lastSync = localStorage.getItem('jp_lastSyncAt');
    if (lastSync) {
      const ago = Math.round((Date.now() - parseInt(lastSync)) / 60000);
      return ago < 1 ? '방금 동기화됨' : `${ago}분 전 동기화`;
    }
    return '동기화 대기 중';
  },
};

// Storage 함수에 updatedAt 자동 추가 + 변경 시 자동 동기화
const originalAddCards = Storage.addCards.bind(Storage);
Storage.addCards = function(newCards) {
  const now = Date.now();
  const touchedTerms = new Set(newCards.map(c => normalizeTerm(c.term)));
  const result = originalAddCards(newCards);

  const cards = this.getAll();
  cards.forEach(c => {
    if (touchedTerms.has(normalizeTerm(c.term))) c.updatedAt = now;
    else if (c.updatedAt === undefined) c.updatedAt = 0;
  });
  this._save(cards);
  if (Sync.isSignedIn()) Sync.syncToCloud();
  return result;
};

const originalUpdateCard = Storage.updateCard.bind(Storage);
Storage.updateCard = function(id, data) {
  if (data.term !== undefined) data.term = normalizeTerm(data.term);
  data.updatedAt = Date.now();
  const result = originalUpdateCard(id, data);
  if (Sync.isSignedIn()) Sync.syncToCloud();
  return result;
};

const originalToggleFav = Storage.toggleFavorite.bind(Storage);
Storage.toggleFavorite = function(id) {
  const result = originalToggleFav(id);
  if (result) {
    const cards = this.getAll();
    const card = cards.find(c => c.id === id);
    if (card) { card.updatedAt = Date.now(); this._save(cards); }
  }
  if (Sync.isSignedIn()) Sync.syncToCloud();
  return result;
};

const originalDeleteCard = Storage.deleteCard.bind(Storage);
Storage.deleteCard = function(id) {
  const result = originalDeleteCard(id);
  if (Sync.isSignedIn()) Sync.syncToCloud();
  return result;
};

const originalRestoreCard = Storage.restoreCard.bind(Storage);
Storage.restoreCard = function(id) {
  const result = originalRestoreCard(id);
  const cards = this.getAll();
  const card = cards.find(c => c.id === id);
  if (card) {
    card.term = normalizeTerm(card.term);
    card.updatedAt = Date.now();
    this._save(cards);
  }
  if (Sync.isSignedIn()) Sync.syncToCloud();
  return result;
};

const originalPermanentDelete = Storage.permanentDelete.bind(Storage);
Storage.permanentDelete = function(id) {
  const result = originalPermanentDelete(id);
  if (Sync.isSignedIn()) Sync.syncToCloud();
  return result;
};

const originalEmptyTrash = Storage.emptyTrash.bind(Storage);
Storage.emptyTrash = function() {
  const result = originalEmptyTrash();
  if (Sync.isSignedIn()) Sync.syncToCloud();
  return result;
};

// ============================================================
// 3. Router - 해시(#) 기반 페이지 전환
//
// #/            → 홈
// #/kana        → 오십음 그리드
// #/words/あ    → あ행 단어 목록
// #/words/漢    → 한자 단어 목록
// #/add         → 단어 추가
// #/search      → 검색
// #/trash       → 휴지통
// #/study       → 전체 학습
// #/study/あ    → あ행 학습
// ============================================================

const $app = document.getElementById('app');
let cleanupFn = null;

function setCleanup(fn) {
  if (cleanupFn) cleanupFn();
  cleanupFn = fn || null;
}

const Router = {
  init() {
    window.addEventListener('hashchange', () => this.handle());
    this.handle();
  },

  handle() {
    const hash = location.hash.slice(1) || '/';
    setCleanup(null);

    if (hash === '/') renderHome();
    else if (hash === '/kana') renderKanaGrid();
    else if (hash === '/search') renderSearch();
    else if (hash === '/trash') renderTrash();
    else if (hash.startsWith('/words/')) renderWords(decodeURIComponent(hash.split('/')[2]));
    else if (hash === '/add') renderAdd();
    else if (hash.startsWith('/study/')) renderStudy(decodeURIComponent(hash.split('/')[2]));
    else if (hash === '/study') renderStudy();
    else location.hash = '#/';
  },

  go(path) {
    location.hash = '#' + path;
  },
};

// ============================================================
// 4. Views
// ============================================================

// ---- 홈 ----

function renderHome() {
  const cardCount = Storage.getAll().length;
  const hasWords = cardCount > 0;

  const syncStatus = Sync.getStatusText();
  const signedIn = Sync.isSignedIn();
  const userName = fbAuth && fbAuth.currentUser ? fbAuth.currentUser.displayName : '';

  $app.innerHTML = `
    <header class="home-header">
      <h1 class="home-title">일본어 단어장</h1>
      ${hasWords ? `<p class="home-sub">${cardCount}개 단어 · v1</p>` : '<p class="home-sub">v1</p>'}
      <div class="sync-bar">
        ${signedIn
          ? `<span class="sync-status">${escapeHtml(userName)} · ${syncStatus}</span>
             <button class="sync-btn" data-action="sync">동기화</button>
             <button class="sync-btn" data-action="signout">로그아웃</button>`
          : `<button class="sync-btn sync-btn-login" data-action="signin">Google 로그인으로 기기 동기화</button>`
        }
      </div>
    </header>
    <div class="home-cards">
      ${hasWords ? `
        <button class="home-card" data-action="words">
          <span class="home-card-icon home-card-icon-light">あ</span>
          <div>
            <span class="home-card-title">단어장</span>
            <span class="home-card-desc">오십음별 단어 보기</span>
          </div>
        </button>
      ` : ''}
      <button class="home-card home-card-primary" data-action="add">
        <span class="home-card-icon">+</span>
        <div>
          <span class="home-card-title">${hasWords ? '단어추가' : '첫 단어 추가하기'}</span>
          <span class="home-card-desc home-card-desc-light">하나씩 또는 대량으로 추가</span>
        </div>
      </button>
      ${hasWords ? `
        <button class="home-card" data-action="study">
          <span class="home-card-icon home-card-icon-light">学</span>
          <div>
            <span class="home-card-title">낱말카드</span>
            <span class="home-card-desc">전체 단어 학습</span>
          </div>
        </button>
      ` : `
        <p class="home-empty">아직 단어가 없어요.<br>위 버튼을 눌러 단어를 추가해보세요!</p>
      `}
    </div>
  `;

  const handler = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'words') Router.go('/kana');
    else if (el.dataset.action === 'add') Router.go('/add');
    else if (el.dataset.action === 'study') Router.go('/study');
    else if (el.dataset.action === 'signin') Sync.signIn();
    else if (el.dataset.action === 'sync') {
      el.textContent = '동기화 중...';
      Sync.syncFromCloud().then(() => renderHome());
    }
    else if (el.dataset.action === 'signout') {
      Sync.signOut().then(() => renderHome());
    }
  };

  $app.addEventListener('click', handler);
  setCleanup(() => $app.removeEventListener('click', handler));
}

// ---- 오십음 그리드 (영어 버전의 알파벳 그리드에 해당) ----

function renderKanaGrid() {
  const cards = Storage.getAll();

  // 행별 단어 수 세기
  const counts = {};
  KANA_ROWS.forEach(r => { counts[r] = 0; });
  let favCount = 0;
  cards.forEach(c => {
    const row = getWordRow(c.term);
    if (row && counts[row] !== undefined) counts[row]++;
    if (c.favorite) favCount++;
  });

  $app.innerHTML = `
    <header class="header">
      <button class="btn-back" data-action="home" type="button">\u2190</button>
      <h1>단어장</h1>
      <span class="header-count">${cards.length}개</span>
      <button class="btn-search" data-action="trash" type="button">\u{1F5D1}</button>
      <button class="btn-search" data-action="search" type="button">\u{1F50D}</button>
    </header>
    <div class="kana-page">
      <div class="kana-grid">
        <button class="kana-btn kana-btn-fav ${favCount === 0 ? 'kana-btn-empty' : ''}"
          data-action="select-row" data-row="FAV"
          ${favCount === 0 ? 'disabled' : ''}>
          <span class="kana-letter">\u2605</span>
          <span class="kana-count">${favCount}</span>
        </button>
        ${KANA_ROWS.map(row => `
          <button class="kana-btn ${counts[row] === 0 ? 'kana-btn-empty' : ''}"
            data-action="select-row" data-row="${row}"
            ${counts[row] === 0 ? 'disabled' : ''}>
            <span class="kana-letter">${row}</span>
            <span class="kana-count">${counts[row]}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  const handler = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    if (el.dataset.action === 'home') Router.go('/');
    else if (el.dataset.action === 'search') Router.go('/search');
    else if (el.dataset.action === 'trash') Router.go('/trash');
    else if (el.dataset.action === 'select-row') Router.go('/words/' + encodeURIComponent(el.dataset.row));
  };

  $app.addEventListener('click', handler);
  setCleanup(() => $app.removeEventListener('click', handler));
}

// ---- 검색 ----

function renderSearch() {
  let allCards = Storage.getAll();

  $app.innerHTML = `
    <header class="header">
      <button class="btn-back" data-action="back" type="button">\u2190</button>
      <input type="text" id="search-input" class="search-input"
        placeholder="일본어 또는 한국어로 검색" autofocus />
    </header>
    <div class="search-page">
      <div id="search-results" class="word-list"></div>
    </div>
  `;

  const input = document.getElementById('search-input');
  const resultsEl = document.getElementById('search-results');

  function doSearch() {
    const query = input.value.trim().toLowerCase();
    if (!query) {
      resultsEl.innerHTML = '<p class="search-hint">단어 또는 뜻을 입력하세요</p>';
      return;
    }

    const matches = allCards.filter(c =>
      c.term.toLowerCase().includes(query) ||
      c.definition.toLowerCase().includes(query)
    );

    if (matches.length === 0) {
      resultsEl.innerHTML = '<p class="search-hint">검색 결과가 없어요</p>';
      return;
    }

    resultsEl.innerHTML = `<p class="words-count">${matches.length}개 결과</p>`
      + matches.map(c => `
        <div class="word-item" data-id="${c.id}">
          <button class="btn-fav ${c.favorite ? 'btn-fav-on' : ''}"
            data-action="toggle-fav" data-id="${c.id}"
            type="button">${c.favorite ? '\u2605' : '\u2606'}</button>
          <div class="word-body" data-action="dbl-word" data-id="${c.id}">
            <span class="word-term">${highlightMatch(escapeHtml(c.term), query)}${c.count > 1 ? ` <span class="word-hit">\u00D7${c.count}</span>` : ''}</span>
            <span class="word-definition">${highlightMatch(formatDefinitionInline(c.definition), query)}</span>
          </div>
          <button class="btn-word-more" data-action="edit-word" data-id="${c.id}"
            type="button">\u22EF</button>
        </div>
      `).join('');
  }

  input.addEventListener('input', doSearch);

  let searchLastTapId = null;
  let searchLastTapTime = 0;

  const handler = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'back') Router.go('/kana');
    else if (el.dataset.action === 'toggle-fav') {
      Storage.toggleFavorite(el.dataset.id);
      allCards = Storage.getAll();
      doSearch();
    } else if (el.dataset.action === 'edit-word') {
      showEditModal(el.dataset.id, null);
    } else if (el.dataset.action === 'dbl-word') {
      const id = el.dataset.id;
      const now = Date.now();
      if (searchLastTapId === id && now - searchLastTapTime < 400) {
        Storage.toggleFavorite(id);
        allCards = Storage.getAll();
        doSearch();
        searchLastTapId = null;
        return;
      }
      searchLastTapId = id;
      searchLastTapTime = now;
    }
  };

  $app.addEventListener('click', handler);
  setCleanup(() => $app.removeEventListener('click', handler));
}

function highlightMatch(html, query) {
  if (!query) return html;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return html.replace(regex, '<mark>$1</mark>');
}

// ---- 휴지통 ----

function renderTrash() {
  const trash = Storage.getTrash();

  $app.innerHTML = `
    <header class="header">
      <button class="btn-back" data-action="back" type="button">\u2190</button>
      <h1>휴지통</h1>
      <span class="header-count">${trash.length}개</span>
    </header>
    <div class="words-page">
      ${trash.length > 0 ? `
        <div class="words-actions">
          <button class="btn-study" data-action="empty-trash"
            style="background:var(--danger)">전체 삭제</button>
        </div>
      ` : ''}
      <div class="word-list">
        ${trash.length === 0
          ? '<p class="empty">휴지통이 비어있어요.</p>'
          : trash.map(c => `
            <div class="word-item trash-item" data-id="${c.id}">
              <div class="word-body">
                <span class="word-term">${escapeHtml(c.term)}</span>
                <span class="word-definition">${formatDefinitionInline(c.definition)}</span>
              </div>
              <button class="btn-restore" data-action="restore" data-id="${c.id}"
                type="button">복원</button>
              <button class="btn-word-more" data-action="perm-delete" data-id="${c.id}"
                type="button">\u00D7</button>
            </div>
          `).join('')}
      </div>
    </div>
  `;

  const handler = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'back': Router.go('/kana'); break;
      case 'restore':
        Storage.restoreCard(el.dataset.id);
        renderTrash();
        break;
      case 'perm-delete':
        Storage.permanentDelete(el.dataset.id);
        renderTrash();
        break;
      case 'empty-trash':
        if (el.textContent === '전체 삭제') {
          el.textContent = '정말 전체 삭제?';
          setTimeout(() => { el.textContent = '전체 삭제'; }, 3000);
        } else {
          Storage.emptyTrash();
          renderTrash();
        }
        break;
    }
  };

  $app.addEventListener('click', handler);
  setCleanup(() => $app.removeEventListener('click', handler));
}

// ---- 단어 목록 (행별) ----

function renderWords(row) {
  const allCards = Storage.getAll();
  const isFav = row && row.toUpperCase() === 'FAV';

  // FAV이면 즐겨찾기, 행 이름이면 해당 행, 없으면 전체
  const cards = isFav
    ? allCards.filter(c => c.favorite)
    : row
      ? allCards.filter(c => getWordRow(c.term) === row)
      : allCards;

  const displayLabel = isFav ? '\u2605' : (KANA_ROW_LABELS[row] || row || '');

  $app.innerHTML = `
    <header class="header">
      <button class="btn-back" data-action="back" type="button">\u2190</button>
      <h1>${displayLabel}</h1>
      <span class="header-count">${cards.length}개</span>
      <button class="btn-search" data-action="search" type="button">\u{1F50D}</button>
    </header>
    <div class="words-page">
      <div class="words-actions">
        <button class="btn-study" data-action="study"
          ${cards.length === 0 ? 'disabled' : ''}>
          낱말카드
        </button>
        <button class="btn-add-small" data-action="add">+ 추가</button>
        <button class="btn-hide-def" data-action="toggle-hide" id="btn-hide-def">뜻 숨기기</button>
      </div>
      <p class="words-hint">두 번 터치: 별표 | \u22EF 버튼: 수정/삭제</p>
      <div class="word-list">
        ${cards.length === 0
          ? '<p class="empty">이 행에 단어가 없어요.</p>'
          : cards.map(c => `
            <div class="word-item" data-id="${c.id}">
              <button class="btn-fav ${c.favorite ? 'btn-fav-on' : ''}"
                data-action="toggle-fav" data-id="${c.id}"
                type="button">${c.favorite ? '\u2605' : '\u2606'}</button>
              <div class="word-body" data-action="dbl-word" data-id="${c.id}">
                <span class="word-term">${escapeHtml(c.term)}${c.count > 1 ? ` <span class="word-hit">\u00D7${c.count}</span>` : ''}</span>
                <span class="word-definition">${formatDefinitionInline(c.definition)}</span>
              </div>
              <button class="btn-word-more" data-action="edit-word" data-id="${c.id}"
                type="button">\u22EF</button>
            </div>
          `).join('')}
      </div>
    </div>
  `;

  let lastTapId = null;
  let lastTapTime = 0;

  const handler = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;

    switch (el.dataset.action) {
      case 'back': Router.go('/kana'); break;
      case 'search': Router.go('/search'); break;
      case 'study': Router.go('/study/' + encodeURIComponent(isFav ? 'FAV' : row)); break;
      case 'add': Router.go('/add'); break;
      case 'toggle-hide': {
        const wordList = document.querySelector('.word-list');
        const btn = document.getElementById('btn-hide-def');
        wordList.classList.toggle('hide-defs');
        const hidden = wordList.classList.contains('hide-defs');
        btn.textContent = hidden ? '뜻 보기' : '뜻 숨기기';
        btn.classList.toggle('btn-hide-active', hidden);
        break;
      }
      case 'toggle-fav':
        e.stopPropagation();
        Storage.toggleFavorite(el.dataset.id);
        renderWords(row);
        break;
      case 'dbl-word': {
        const id = el.dataset.id;
        const now = Date.now();
        if (lastTapId === id && now - lastTapTime < 400) {
          Storage.toggleFavorite(id);
          renderWords(row);
          lastTapId = null;
          return;
        }
        lastTapId = id;
        lastTapTime = now;
        break;
      }
      case 'edit-word':
        showEditModal(el.dataset.id, row);
        break;
    }
  };

  function onDefClick(e) {
    const def = e.target.closest('.word-definition');
    if (def && def.closest('.hide-defs')) {
      def.classList.toggle('def-revealed');
    }
  }

  $app.addEventListener('click', onDefClick);
  $app.addEventListener('click', handler);
  setCleanup(() => {
    $app.removeEventListener('click', handler);
    $app.removeEventListener('click', onDefClick);
  });
}

// 단어 수정 모달
function showEditModal(id, row) {
  if (document.querySelector('.modal-overlay')) return;
  const card = Storage.getAll().find(c => c.id === id);
  if (!card) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-edit">
      <h3>단어 수정</h3>
      <div class="modal-field">
        <label>단어</label>
        <input type="text" id="edit-term" value="${escapeAttr(card.term)}" />
      </div>
      <div class="modal-field">
        <label>뜻</label>
        <input type="text" id="edit-def" value="${escapeAttr(card.definition)}" />
      </div>
      <div class="modal-row">
        <button class="btn-fav-modal ${card.favorite ? 'btn-fav-on' : ''}"
          id="edit-fav">${card.favorite ? '\u2605 즐겨찾기' : '\u2606 즐겨찾기'}</button>
        <button class="btn-modal-delete" id="edit-delete">삭제</button>
      </div>
      <div class="modal-actions">
        <button class="btn-modal-cancel" id="edit-cancel">취소</button>
        <button class="btn-modal-save" id="edit-save">저장</button>
      </div>
    </div>
  `;

  overlay.querySelectorAll('input[type="text"]').forEach(input => {
    input.addEventListener('focus', () => {
      const len = input.value.length;
      setTimeout(() => input.setSelectionRange(len, len), 0);
    });
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#edit-cancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#edit-save').addEventListener('click', () => {
    const term = overlay.querySelector('#edit-term').value.trim();
    const def = overlay.querySelector('#edit-def').value.trim();
    if (!term || !def) return;
    Storage.updateCard(id, { term, definition: def });
    overlay.remove();
    renderWords(row);
  });

  overlay.querySelector('#edit-fav').addEventListener('click', () => {
    const updated = Storage.toggleFavorite(id);
    const btn = overlay.querySelector('#edit-fav');
    btn.classList.toggle('btn-fav-on', updated.favorite);
    btn.textContent = updated.favorite ? '\u2605 즐겨찾기' : '\u2606 즐겨찾기';
  });

  const deleteBtn = overlay.querySelector('#edit-delete');
  let deleteConfirm = false;
  deleteBtn.addEventListener('click', () => {
    if (deleteConfirm) {
      Storage.deleteCard(id);
      overlay.querySelector('.modal-edit').innerHTML =
        '<p style="text-align:center;padding:32px;font-size:16px;color:var(--text-secondary)">삭제되었습니다</p>';
      setTimeout(() => {
        overlay.remove();
        if (row) renderWords(row);
      }, 600);
    } else {
      deleteConfirm = true;
      deleteBtn.textContent = '정말 삭제?';
      deleteBtn.style.background = 'var(--danger)';
      deleteBtn.style.color = 'white';
      setTimeout(() => {
        deleteConfirm = false;
        deleteBtn.textContent = '삭제';
        deleteBtn.style.background = '';
        deleteBtn.style.color = '';
      }, 3000);
    }
  });

  document.body.appendChild(overlay);
}

// ---- 단어 추가 ----

function renderAdd() {
  $app.innerHTML = `
    <header class="header">
      <button class="btn-back" data-action="back" type="button">\u2190</button>
      <h1>단어추가</h1>
    </header>
    <div class="add-page">
      <div class="add-tabs">
        <button class="add-tab add-tab-active" data-action="tab-single">하나씩</button>
        <button class="add-tab" data-action="tab-bulk">대량 입력</button>
      </div>
      <div id="add-content"></div>
    </div>
  `;

  showSingleInput();

  const handler = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'back') Router.go('/');
    else if (el.dataset.action === 'save') saveNewWords();
    else if (el.dataset.action === 'tab-single') {
      setActiveTab(0);
      showSingleInput();
    } else if (el.dataset.action === 'tab-bulk') {
      setActiveTab(1);
      showBulkInput();
    }
  };

  function setActiveTab(idx) {
    document.querySelectorAll('.add-tab').forEach((t, i) => {
      t.classList.toggle('add-tab-active', i === idx);
    });
  }

  $app.addEventListener('click', handler);
  setCleanup(() => $app.removeEventListener('click', handler));
}

// 하나씩 입력 모드
function showSingleInput() {
  const content = document.getElementById('add-content');
  content.innerHTML = `
    <div class="single-input">
      <div class="single-row" id="term-row">
        <input type="text" id="single-term" class="single-field"
          placeholder="일본어 단어" autocomplete="off" />
        <button type="button" class="single-btn" id="btn-next-step">다음</button>
      </div>
      <p class="input-warn" id="term-warn"></p>
      <div class="single-row" id="def-row" style="display:none">
        <input type="text" id="single-def" class="single-field"
          placeholder="뜻 (콤마로 여러 뜻 구분)" autocomplete="off" />
        <button type="button" class="single-btn single-btn-primary" id="btn-add-word">추가</button>
      </div>
    </div>
    <div id="single-added" class="single-added"></div>
  `;

  const termInput = document.getElementById('single-term');
  const defInput = document.getElementById('single-def');
  const termWarn = document.getElementById('term-warn');
  const termRow = document.getElementById('term-row');
  const defRow = document.getElementById('def-row');
  const addedList = document.getElementById('single-added');
  let sessionWords = [];

  termInput.focus();

  // 일본어 입력칸에 한글이 들어가면 경고
  termInput.addEventListener('input', () => {
    if (hasKorean(termInput.value)) {
      termInput.classList.add('input-error');
      termWarn.textContent = '일본어 단어를 입력하세요 (한글이 감지됨)';
    } else {
      termInput.classList.remove('input-error');
      termWarn.textContent = '';
    }
  });

  function goToDefInput() {
    const val = termInput.value.trim();
    if (!val) return;
    if (hasKorean(val)) {
      termInput.classList.add('input-error');
      termWarn.textContent = '일본어 단어를 입력하세요 (한글이 감지됨)';
      return;
    }
    termRow.style.display = 'none';
    termWarn.style.display = 'none';
    defRow.style.display = '';
    defInput.focus();
  }

  termInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); goToDefInput(); }
  });
  document.getElementById('btn-next-step').addEventListener('click', goToDefInput);

  function addWord() {
    const term = termInput.value.trim();
    const def = defInput.value.trim();
    if (!term || !def) return;

    const result = Storage.addCards([{ term, definition: def }]);
    sessionWords.push({ term, definition: def, merged: result.mergedCount > 0 });

    addedList.innerHTML = `<p class="single-added-count">${sessionWords.length}개 추가됨</p>`
      + sessionWords.map(w =>
        `<div class="single-added-item${w.merged ? ' merged' : ''}">${escapeHtml(w.term)} — ${escapeHtml(w.definition)}</div>`
      ).join('');

    termInput.value = '';
    defInput.value = '';
    defRow.style.display = 'none';
    termRow.style.display = '';
    termWarn.style.display = '';
    termWarn.textContent = '';
    termInput.classList.remove('input-error');
    termInput.focus();
    addedList.scrollTop = addedList.scrollHeight;
  }

  defInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addWord(); }
    else if (e.key === 'Escape') {
      defRow.style.display = 'none';
      termRow.style.display = '';
      termInput.focus();
    }
  });
  document.getElementById('btn-add-word').addEventListener('click', addWord);
}

// 대량 입력 모드
function showBulkInput() {
  const content = document.getElementById('add-content');
  content.innerHTML = `
    <div class="add-help">
      <strong>일본어 — 뜻</strong> 형식으로 한 줄에 하나씩 입력하세요.
    </div>
    <div class="bulk-actions">
      <div class="add-status" id="add-status"></div>
      <button class="btn-save" data-action="save" type="button">저장</button>
    </div>
    <textarea id="bulk-input" class="bulk-input" rows="8"
      placeholder="たべる — 먹다&#10;のむ — 마시다&#10;おいしい — 맛있다"></textarea>
    <div id="bulk-preview" class="bulk-preview"></div>
  `;

  document.getElementById('bulk-input').addEventListener('input', updateAddStatus);
  document.getElementById('bulk-input').focus();
}

function updateAddStatus() {
  const text = document.getElementById('bulk-input').value;
  const parsed = parseBulkWords(text);
  const status = document.getElementById('add-status');
  const lineCount = text.split('\n').filter(l => l.trim().length > 0).length;
  const failCount = lineCount - parsed.length;

  const preview = document.getElementById('bulk-preview');

  if (text.trim().length === 0) {
    status.textContent = '';
    if (preview) preview.innerHTML = '';
  } else {
    if (failCount > 0) {
      status.innerHTML = `<span class="status-ok">${parsed.length}개 인식</span> · <span class="status-warn">${failCount}개 실패</span>`;
    } else {
      status.innerHTML = `<span class="status-ok">${parsed.length}개 인식</span>`;
    }
    if (preview) {
      preview.innerHTML = parsed.map(c =>
        `<div class="bulk-preview-item">
          <span class="bulk-preview-term">${escapeHtml(c.term)}</span>
          <span class="bulk-preview-def">${escapeHtml(c.definition)}</span>
        </div>`
      ).join('');
    }
  }
}

function saveNewWords() {
  const textarea = document.getElementById('bulk-input');
  const text = textarea.value.trim();

  if (!text) {
    textarea.focus();
    return;
  }

  const cards = parseBulkWords(text);
  if (cards.length === 0) {
    const status = document.getElementById('add-status');
    status.innerHTML = '<span class="status-warn">인식된 단어가 없어요. 형식을 확인해주세요.</span>';
    textarea.focus();
    return;
  }

  const result = Storage.addCards(cards);
  const newCount = cards.length - result.mergedCount;

  const status = document.getElementById('add-status');
  if (result.mergedCount > 0) {
    status.innerHTML = `<span class="status-ok">${newCount}개 새 단어 추가, ${result.mergedCount}개 기존 단어 병합</span>`;
  } else {
    status.innerHTML = `<span class="status-ok">${newCount}개 단어 추가 완료</span>`;
  }
  setTimeout(() => Router.go('/kana'), 800);
}

// ---- 학습 모드 (낱말카드) ----

let suppressClickUntil = 0;

const study = {
  row: null,
  cards: [],
  originalCards: [],
  index: 0,
  flipped: false,
  shuffled: false,
  unknowns: new Set(),
  knowns: new Set(),
  answered: new Set(),
};

function renderStudy(row) {
  const allCards = Storage.getAll();
  const isFav = row && row.toUpperCase() === 'FAV';
  const cards = isFav
    ? allCards.filter(c => c.favorite)
    : row
      ? allCards.filter(c => getWordRow(c.term) === row)
      : allCards;

  if (cards.length === 0) {
    Router.go(row ? '/words/' + encodeURIComponent(row) : '/');
    return;
  }

  study.row = row || null;
  study.originalCards = [...cards];
  study.cards = [...cards];
  study.index = 0;
  study.flipped = false;
  study.shuffled = false;
  study.unknowns = new Set(cards.map(c => c.id));
  study.knowns = new Set();
  study.answered = new Set();

  renderStudyUI();

  const keyHandler = (e) => {
    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault();
        flipCard();
        break;
      case 'ArrowLeft':
        prevCard();
        break;
      case 'ArrowRight':
        nextCard();
        break;
    }
  };

  document.addEventListener('keydown', keyHandler);
  setCleanup(() => document.removeEventListener('keydown', keyHandler));
}

function renderStudyUI(slideDirection) {
  const card = study.cards[study.index];
  const progress = ((study.index + 1) / study.cards.length) * 100;

  const rowLabel = !study.row ? '전체 낱말카드'
    : study.row.toUpperCase() === 'FAV' ? '\u2605 낱말카드'
    : (KANA_ROW_LABELS[study.row] || study.row) + ' 낱말카드';

  $app.innerHTML = `
    <div class="study-container">
      <div class="study-header">
        <button class="btn-back" id="btn-exit">\u00D7</button>
        <span class="study-letter">${rowLabel}</span>
        <div class="study-progress">
          <div class="study-progress-bar" style="width: ${progress}%"></div>
        </div>
        <span class="study-counter">
          ${study.index + 1} / ${study.cards.length}
        </span>
      </div>
      <div class="study-score">
        <span class="score-unknown">\u2717 ${study.unknowns.size}</span>
        <span class="score-known">\u2713 ${study.knowns.size}</span>
      </div>
      <div class="study-body" id="study-body">
        <div class="flashcard-container ${slideDirection || ''}" id="flashcard-tap">
          <div class="flashcard ${study.flipped ? 'flipped' : ''}" id="flashcard">
            <div class="flashcard-face flashcard-front">
              <div class="flashcard-label">단어</div>
              <div class="flashcard-text">${escapeHtml(card.term)}${card.count > 1 ? ` <span class="word-hit">\u00D7${card.count}</span>` : ''}</div>
              <button class="btn-fav-card ${card.favorite ? 'btn-fav-on' : ''}"
                id="btn-fav-front">${card.favorite ? '\u2605' : '\u2606'}</button>
              <div class="flashcard-hint">탭하여 뒤집기</div>
            </div>
            <div class="flashcard-face flashcard-back">
              <div class="flashcard-label">뜻</div>
              <div class="flashcard-text">${formatDefinitionCard(card.definition)}</div>
              <div class="flashcard-hint">탭하여 뒤집기</div>
            </div>
          </div>
        </div>
      </div>
      <div class="study-answer">
        <button class="btn-answer btn-answer-no ${study.answered.has(card.id) && study.unknowns.has(card.id) ? 'btn-answer-pressed' : ''}"
          id="btn-unknown">몰라요</button>
        <button class="btn-answer btn-answer-yes ${study.answered.has(card.id) && study.knowns.has(card.id) ? 'btn-answer-pressed' : ''}"
          id="btn-known">알아요</button>
      </div>
      <p class="study-swipe-hint">좌우로 밀어서 넘기기</p>
      <div class="study-nav">
        <button class="btn-nav" id="btn-prev"
          ${study.index === 0 ? 'disabled' : ''}>\u25C0</button>
        <button class="btn-shuffle ${study.shuffled ? 'active' : ''}"
          id="btn-shuffle" title="셔플">\u{1F500}</button>
        <button class="btn-nav" id="btn-next"
          ${study.index === study.cards.length - 1 ? 'disabled' : ''}>\u25B6</button>
      </div>
    </div>
  `;

  // 카드 터치/클릭 로직
  const flashcardTap = document.getElementById('flashcard-tap');
  let cardLastTouch = 0;
  let isDoubleTap = false;

  flashcardTap.addEventListener('touchstart', (e) => {
    if (e.target.closest('.btn-fav-card')) return;
    const now = Date.now();
    if (now - cardLastTouch < 400) {
      isDoubleTap = true;
      flipCard();
      const updated = Storage.toggleFavorite(study.cards[study.index].id);
      study.cards[study.index].favorite = updated.favorite;
      const favBtn = document.getElementById('btn-fav-front');
      if (favBtn) {
        favBtn.classList.toggle('btn-fav-on', updated.favorite);
        favBtn.textContent = updated.favorite ? '\u2605' : '\u2606';
      }
      cardLastTouch = 0;
    } else {
      isDoubleTap = false;
      cardLastTouch = now;
    }
  }, { passive: true });

  flashcardTap.addEventListener('click', (e) => {
    if (e.target.closest('.btn-fav-card')) return;
    if (Date.now() < suppressClickUntil) return;
    if (isDoubleTap) { isDoubleTap = false; return; }
    flipCard();
  });

  const favBtn = document.getElementById('btn-fav-front');
  if (favBtn) {
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const updated = Storage.toggleFavorite(study.cards[study.index].id);
      study.cards[study.index].favorite = updated.favorite;
      favBtn.classList.toggle('btn-fav-on', updated.favorite);
      favBtn.textContent = updated.favorite ? '\u2605' : '\u2606';
    });
  }

  document.getElementById('btn-exit').addEventListener('click', () =>
    Router.go(study.row ? '/words/' + encodeURIComponent(study.row) : '/kana')
  );
  document.getElementById('btn-prev').addEventListener('click', prevCard);
  document.getElementById('btn-next').addEventListener('click', nextCard);
  document.getElementById('btn-shuffle').addEventListener('click', toggleShuffle);

  const btnKnown = document.getElementById('btn-known');
  const btnUnknown = document.getElementById('btn-unknown');
  function lockAnswerBtns() {
    btnKnown.disabled = true;
    btnUnknown.disabled = true;
  }
  btnKnown.addEventListener('click', () => {
    const id = study.cards[study.index].id;
    study.unknowns.delete(id);
    study.knowns.add(id);
    study.answered.add(id);
    btnKnown.classList.add('btn-answer-pressed');
    lockAnswerBtns();
    setTimeout(() => goNextOrFinish(), 200);
  });
  btnUnknown.addEventListener('click', () => {
    const id = study.cards[study.index].id;
    study.knowns.delete(id);
    study.unknowns.add(id);
    study.answered.add(id);
    btnUnknown.classList.add('btn-answer-pressed');
    lockAnswerBtns();
    setTimeout(() => goNextOrFinish(), 200);
  });

  initSwipe(document.getElementById('study-body'));
}

function flipCard() {
  if (Date.now() < suppressClickUntil) return;
  study.flipped = !study.flipped;
  const flashcard = document.getElementById('flashcard');
  if (flashcard) flashcard.classList.toggle('flipped', study.flipped);
}

function prevCard() {
  if (study.index <= 0) return;
  study.index--;
  study.flipped = false;
  renderStudyUI('slide-in-left');
}

function nextCard() {
  if (study.index >= study.cards.length - 1) return;
  study.index++;
  study.flipped = false;
  renderStudyUI('slide-in-right');
}

function goNextOrFinish() {
  if (study.index < study.cards.length - 1) {
    study.index++;
    study.flipped = false;
    renderStudyUI('slide-in-right');
  } else {
    showStudyComplete();
  }
}

function showStudyComplete() {
  const unknownCards = study.cards.filter(c => study.unknowns.has(c.id));
  const knownCount = study.knowns.size;
  const rowLabel = !study.row ? '전체'
    : study.row.toUpperCase() === 'FAV' ? '\u2605'
    : (KANA_ROW_LABELS[study.row] || study.row);

  $app.innerHTML = `
    <div class="study-container">
      <div class="study-complete">
        <h2>학습 완료!</h2>
        <div class="complete-stats">
          <div class="complete-stat">
            <span class="complete-stat-num">${study.cards.length}</span>
            <span class="complete-stat-label">전체</span>
          </div>
          <div class="complete-stat complete-stat-known">
            <span class="complete-stat-num">${knownCount}</span>
            <span class="complete-stat-label">알아요</span>
          </div>
          <div class="complete-stat complete-stat-unknown">
            <span class="complete-stat-num">${unknownCards.length}</span>
            <span class="complete-stat-label">몰라요</span>
          </div>
        </div>
        ${unknownCards.length > 0 ? `
          <button class="btn-study-again" id="btn-retry-unknown">
            몰라요 ${unknownCards.length}개만 다시 학습
          </button>
        ` : `
          <p class="complete-msg">모든 단어를 다 알아요!</p>
        `}
        <div class="complete-actions">
          <button class="btn-restart" id="btn-restart">처음부터 다시</button>
          <button class="btn-go-back" id="btn-go-back">돌아가기</button>
        </div>
      </div>
    </div>
  `;

  if (unknownCards.length > 0) {
    document.getElementById('btn-retry-unknown').addEventListener('click', () => {
      study.cards = shuffleArray(unknownCards);
      study.originalCards = [...study.cards];
      study.index = 0;
      study.flipped = false;
      study.shuffled = false;
      study.unknowns = new Set(study.cards.map(c => c.id));
      study.knowns = new Set();
      study.answered = new Set();
      renderStudyUI();
    });
  }

  document.getElementById('btn-restart').addEventListener('click', () => {
    renderStudy(study.row);
  });

  document.getElementById('btn-go-back').addEventListener('click', () => {
    Router.go(study.row ? '/words/' + encodeURIComponent(study.row) : '/kana');
  });
}

function toggleShuffle() {
  study.shuffled = !study.shuffled;
  study.cards = study.shuffled
    ? shuffleArray(study.originalCards)
    : [...study.originalCards];
  study.index = 0;
  study.flipped = false;
  renderStudyUI();
}

function initSwipe(element) {
  let startX = 0;
  let startY = 0;

  element.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  element.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;

    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      suppressClickUntil = Date.now() + 350;
      if (dx < 0) nextCard();
      else prevCard();
    }
  }, { passive: true });
}

// ============================================================
// 5. 시드 데이터 + 초기화
//
// 관광/회화용 일본어 기본 단어 약 100개
// ============================================================

const SEED_WORDS = `
こんにちは — 안녕하세요
こんばんは — 안녕하세요 (저녁)
おはようございます — 안녕하세요 (아침)
さようなら — 안녕히 가세요
ありがとうございます — 감사합니다
すみません — 실례합니다, 죄송합니다
ごめんなさい — 죄송합니다
おねがいします — 부탁합니다
はい — 네
いいえ — 아니요
だいじょうぶ — 괜찮아요
わかりました — 알겠습니다
わかりません — 모르겠습니다
いただきます — 잘 먹겠습니다
ごちそうさまでした — 잘 먹었습니다
おはよう — 안녕 (아침, 반말)
ありがとう — 고마워 (반말)
たべる — 먹다
のむ — 마시다
いく — 가다
くる — 오다
みる — 보다
かう — 사다
かえる — 돌아가다
はなす — 말하다
きく — 듣다, 묻다
わかる — 알다, 이해하다
まつ — 기다리다
あるく — 걷다
はしる — 뛰다
すわる — 앉다
たつ — 서다
ねる — 자다
おきる — 일어나다
つくる — 만들다
おいしい — 맛있다
たかい — 비싸다, 높다
やすい — 싸다
おおきい — 크다
ちいさい — 작다
あつい — 덥다, 뜨겁다
さむい — 춥다
あたらしい — 새롭다
ふるい — 오래되다
いい — 좋다
わるい — 나쁘다
たのしい — 즐겁다
きれい — 예쁘다, 깨끗하다
ちかい — 가깝다
とおい — 멀다
はやい — 빠르다, 이르다
おそい — 느리다, 늦다
ひろい — 넓다
せまい — 좁다
みず — 물
おちゃ — 차
ごはん — 밥, 식사
にく — 고기
さかな — 생선
やさい — 채소
くだもの — 과일
たまご — 달걀
パン — 빵
コーヒー — 커피
ビール — 맥주
ジュース — 주스
ラーメン — 라면
すし — 초밥
うどん — 우동
てんぷら — 튀김
えき — 역
でんしゃ — 전철
ちかてつ — 지하철
バス — 버스
タクシー — 택시
くうこう — 공항
きっぷ — 표, 티켓
のりかえ — 환승
ホテル — 호텔
よやく — 예약
へや — 방
かぎ — 열쇠
トイレ — 화장실
おかね — 돈
いくら — 얼마
メニュー — 메뉴
おすすめ — 추천
おかいけい — 계산
これ — 이것
それ — 그것
あれ — 저것
ここ — 여기
そこ — 거기
あそこ — 저기
どこ — 어디
いつ — 언제
なに — 무엇, 뭐
だれ — 누구
なぜ — 왜
どう — 어떻게
ひだり — 왼쪽
みぎ — 오른쪽
まっすぐ — 직진
うえ — 위
した — 아래
なか — 안
そと — 밖
いま — 지금
きょう — 오늘
あした — 내일
きのう — 어제
あさ — 아침
ひる — 낮
よる — 밤
たすけて — 도와주세요
びょういん — 병원
けいさつ — 경찰
くすり — 약
パスポート — 여권
にほんご — 일본어
かんこうきゃく — 관광객
`.trim();

// 데이터 마이그레이션 & 시드
function migrateAndSeed() {
  const DATA_VERSION = 'jp_flashcard_data_v1';

  if (localStorage.getItem(DATA_VERSION)) {
    const cards = Storage.getAll();
    let needsSave = false;
    cards.forEach(c => {
      if (c.count === undefined) { c.count = 1; needsSave = true; }
      if (c.favorite === undefined) { c.favorite = false; needsSave = true; }
    });
    if (needsSave) Storage._save(cards);
    return;
  }

  const existing = Storage.getAll();

  if (existing.length > 0) {
    existing.forEach(c => {
      if (c.count === undefined) c.count = 1;
      if (c.favorite === undefined) c.favorite = false;
    });
    Storage._save(existing);
  } else {
    Storage.replaceAll(parseBulkWords(SEED_WORDS));
  }

  localStorage.setItem(DATA_VERSION, 'true');
}

// Service Worker 등록
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

migrateAndSeed();
Storage.dedup();

// 강제 1회 정리
if (!localStorage.getItem('jp_cleanup_sync_v1')) {
  localStorage.setItem('jp_cleanup_sync_v1', 'true');
  const cleaned = Sync._reconcileData(Storage.getAll(), [], Storage.getTrash(), []);
  Storage._save(cleaned.cards);
  Storage._saveTrash(cleaned.trash);
  if (Sync.isSignedIn()) {
    Sync.syncToCloud();
  }
}

// 로그인 상태 변화 감지
if (fbAuth) {
  fbAuth.onAuthStateChanged(user => {
    if (user) {
      Sync.syncFromCloud().then(() => Router.handle());
    }
  });
}

Router.init();

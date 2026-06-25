import os
import json
import sqlite3
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder='.', static_url_path='')
DATABASE = 'yds_study.db'

# ==========================================================================
# DATABASE HELPER FUNCTIONS & SCHEMA INITIALIZATION
# ==========================================================================
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Veritabanı tablolarını oluşturur ve gerekirse JSON'dan verileri göç ettirir (migration)."""
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. Tabloları oluştur
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY,
            word TEXT NOT NULL,
            pos TEXT NOT NULL,
            level TEXT,
            weight REAL DEFAULT 1.0,
            is_mistake INTEGER DEFAULT 0,
            ask_more INTEGER DEFAULT 0,
            correct_count INTEGER DEFAULT 0
        )
    ''')
    
    # Var olan tabloya yeni sütunları ekle (eğer yoksa)
    try:
        cursor.execute('ALTER TABLE words ADD COLUMN ask_more INTEGER DEFAULT 0')
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute('ALTER TABLE words ADD COLUMN correct_count INTEGER DEFAULT 0')
        conn.commit()
    except sqlite3.OperationalError:
        pass
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS meanings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word_id INTEGER,
            meaning TEXT NOT NULL,
            FOREIGN KEY (word_id) REFERENCES words (id) ON DELETE CASCADE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS examples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word_id INTEGER,
            en_sentence TEXT NOT NULL,
            tr_sentence TEXT NOT NULL,
            FOREIGN KEY (word_id) REFERENCES words (id) ON DELETE CASCADE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS test_questions (
            id TEXT PRIMARY KEY,
            section TEXT NOT NULL,
            question_type TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            question_en TEXT NOT NULL,
            question_tr TEXT,
            passage_en TEXT,
            passage_tr TEXT,
            options_json TEXT NOT NULL,
            correct_label TEXT NOT NULL,
            correct_text_en TEXT NOT NULL,
            correct_text_tr TEXT,
            explanation_tr TEXT,
            why_not_others_json TEXT,
            solved INTEGER DEFAULT 0,
            is_correct INTEGER DEFAULT 0,
            hinted INTEGER DEFAULT 0
        )
    ''')
    
    conn.commit()

    # 2. Eğer veritabanı boşsa JSON dosyasından verileri aktar (Migration)
    cursor.execute('SELECT COUNT(*) FROM words')
    count = cursor.fetchone()[0]
    
    if count == 0:
        json_path = 'ydskelimehavuzu.json'
        if os.path.exists(json_path):
            print("Veritabanı boş, JSON dosyasından veriler SQLite'a aktarılıyor...")
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    words_list = data.get('words', [])
                    
                    for w in words_list:
                        # Ana kelimeyi ekle
                        cursor.execute('''
                            INSERT INTO words (id, word, pos, level, weight, is_mistake)
                            VALUES (?, ?, ?, ?, ?, ?)
                        ''', (w['id'], w['word'].strip(), w['pos'].strip(), w.get('level', 'B2-C1 / YDS'), 1.0, 0))
                        
                        # Türkçe anlamları ekle
                        for meaning in w.get('turkish_meanings', []):
                            cursor.execute('''
                                INSERT INTO meanings (word_id, meaning)
                                VALUES (?, ?)
                            ''', (w['id'], meaning.strip()))
                            
                        # Örnek cümleleri ekle
                        for ex in w.get('examples', []):
                            cursor.execute('''
                                INSERT INTO examples (word_id, en_sentence, tr_sentence)
                                VALUES (?, ?, ?)
                            ''', (w['id'], ex['en'].strip(), ex['tr'].strip()))
                            
                conn.commit()
                print(f"Başarıyla {len(words_list)} kelime ve ilişkili verileri veritabanına aktarıldı.")
            except Exception as e:
                print("JSON göçü sırasında hata oluştu:", e)
                conn.rollback()
        else:
            print(f"Hata: {json_path} dosyası bulunamadı, migration yapılamadı.")
    # 3. Eski veriler için correct_count değerlerini ağırlık ve hata durumuna göre hesapla/kurtar
    try:
        cursor.execute("SELECT COUNT(*) FROM words WHERE correct_count != 0")
        non_zero = cursor.fetchone()[0]
        
        if non_zero == 0:
            cursor.execute("SELECT COUNT(*) FROM words WHERE weight != 1.0 OR is_mistake = 1")
            answered = cursor.fetchone()[0]
            
            if answered > 0:
                print("Eski çalışma verileri için correct_count değerleri hesaplanıyor...")
                words = cursor.execute("SELECT id, weight, is_mistake FROM words").fetchall()
                for w in words:
                    w_id = w['id']
                    weight = w['weight']
                    is_mistake = w['is_mistake']
                    
                    cc = 0
                    if weight < 1.0:
                        cc = int(round((1.0 - weight) / 0.3))
                    elif weight > 1.0:
                        cc = -int(round((weight - 1.0) / 2.0)) * 2
                    elif is_mistake == 1:
                        cc = -2
                    
                    cc = max(-10, min(20, cc))
                    
                    if cc != 0:
                        cursor.execute("UPDATE words SET correct_count = ? WHERE id = ?", (cc, w_id))
                conn.commit()
                print("Eski çalışma verileri başarıyla migrate edildi ve doğru sayıları atandı!")
    except Exception as e:
        print("Eski verileri kurtarma sırasında hata oluştu:", e)

    # 4. Eğer test soruları tablosu boşsa JSON'dan SQLite'a aktar (Migration)
    try:
        cursor.execute('SELECT COUNT(*) FROM test_questions')
        test_count = cursor.fetchone()[0]
        if test_count == 0:
            json_path = 'yds_ogretici_soru_bankasi_detayli.json'
            if os.path.exists(json_path):
                print("Veritabanı boş, test soruları SQLite'a aktarılıyor...")
                with open(json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    questions_list = data.get('questions', [])
                    for q in questions_list:
                        options_json = json.dumps(q.get('options', []), ensure_ascii=False)
                        why_not_others_json = json.dumps(q.get('why_not_others_tr', []), ensure_ascii=False)
                        
                        cursor.execute('''
                            INSERT INTO test_questions (
                                id, section, question_type, difficulty, question_en, question_tr,
                                passage_en, passage_tr, options_json, correct_label,
                                correct_text_en, correct_text_tr, explanation_tr, why_not_others_json
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (
                            q['id'], q['section'], q['question_type'], q['difficulty'], q['question_en'], q.get('question_tr'),
                            q.get('passage_en'), q.get('passage_tr'), options_json, q['answer']['label'],
                            q['answer']['text_en'], q['answer']['text_tr'], q.get('explanation_tr'), why_not_others_json
                        ))
                conn.commit()
                print(f"Başarıyla {len(questions_list)} test sorusu veritabanına aktarıldı.")
    except Exception as e:
        print("Test soruları SQLite migration hatası:", e)
        conn.rollback()

    conn.close()

# Initialize database on server start
init_db()

# ==========================================================================
# CACHE CONTROL FOR API ENDPOINTS
# ==========================================================================
@app.after_request
def add_header(response):
    # API endpoints are not cached to ensure real-time update in browser
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '-1'
    return response

# ==========================================================================
# STATIC FILE SERVING
# ==========================================================================
@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

# ==========================================================================
# API ENDPOINTS
# ==========================================================================

@app.route('/api/words', methods=['GET'])
def get_words():
    """Tüm kelimeleri, anlamları ve örnek cümleleriyle birlikte ilişkisel olarak döner."""
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. Tüm kelimeleri çek
    words_rows = cursor.execute('SELECT * FROM words').fetchall()
    
    # 2. Tüm anlamları ve örnek cümleleri çekip hafızada indeksle (performans için)
    meanings_rows = cursor.execute('SELECT * FROM meanings').fetchall()
    examples_rows = cursor.execute('SELECT * FROM examples').fetchall()
    
    meanings_map = {}
    for row in meanings_rows:
        w_id = row['word_id']
        if w_id not in meanings_map:
            meanings_map[w_id] = []
        meanings_map[w_id].append(row['meaning'])
        
    examples_map = {}
    for row in examples_rows:
        w_id = row['word_id']
        if w_id not in examples_map:
            examples_map[w_id] = []
        examples_map[w_id].append({
            'en': row['en_sentence'],
            'tr': row['tr_sentence']
        })
    
    # 3. JSON formatına dönüştür
    result = []
    for row in words_rows:
        w_id = row['id']
        result.append({
            'id': w_id,
            'word': row['word'],
            'pos': row['pos'],
            'level': row['level'],
            'weight': row['weight'],
            'is_mistake': row['is_mistake'],
            'ask_more': row['ask_more'] if 'ask_more' in row.keys() else 0,
            'correct_count': row['correct_count'] if 'correct_count' in row.keys() else 0,
            'turkish_meanings': meanings_map.get(w_id, []),
            'examples': examples_map.get(w_id, [])
        })
        
    conn.close()
    return jsonify(result)


@app.route('/api/words/<int:word_id>/weight', methods=['POST'])
def update_word_weight(word_id):
    """Belirli bir kelimenin Spaced Repetition ağırlığını, hata defteri durumunu, sık sorma durumunu ve doğru bilinme sayısını günceller."""
    data = request.json or {}
    weight = data.get('weight')
    is_mistake = data.get('is_mistake')
    ask_more = data.get('ask_more')
    correct_count = data.get('correct_count')
    
    if weight is None and is_mistake is None and ask_more is None and correct_count is None:
        return jsonify({'error': 'Eksik parametre! weight, is_mistake, ask_more veya correct_count gönderilmelidir.'}), 400
        
    conn = get_db()
    cursor = conn.cursor()
    
    # Kelimenin varlığını kontrol et
    word_exists = cursor.execute('SELECT id FROM words WHERE id = ?', (word_id,)).fetchone()
    if not word_exists:
        conn.close()
        return jsonify({'error': f'ID {word_id} olan kelime bulunamadı.'}), 404
        
    # Güncellemeleri uygula
    if weight is not None:
        cursor.execute('UPDATE words SET weight = ? WHERE id = ?', (float(weight), word_id))
    if is_mistake is not None:
        cursor.execute('UPDATE words SET is_mistake = ? WHERE id = ?', (int(is_mistake), word_id))
    if ask_more is not None:
        cursor.execute('UPDATE words SET ask_more = ? WHERE id = ?', (int(ask_more), word_id))
    if correct_count is not None:
        cursor.execute('UPDATE words SET correct_count = ? WHERE id = ?', (int(correct_count), word_id))
        
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'word_id': word_id})


@app.route('/api/state', methods=['GET'])
def get_user_state():
    """Kullanıcının skor, günlük ilerleme gibi genel durumunu döner."""
    conn = get_db()
    cursor = conn.cursor()
    
    rows = cursor.execute('SELECT * FROM user_state').fetchall()
    conn.close()
    
    # Key-Value eşleşmesini çöz
    state_dict = {}
    for row in rows:
        try:
            state_dict[row['key']] = json.loads(row['value'])
        except Exception:
            state_dict[row['key']] = row['value']
            
    return jsonify(state_dict)


@app.route('/api/state', methods=['POST'])
def save_user_state():
    """Kullanıcının durumunu (skor, hedefler) veritabanına kaydeder."""
    data = request.json or {}
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        for key, value in data.items():
            serialized_value = json.dumps(value)
            cursor.execute('''
                INSERT INTO user_state (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ''', (key, serialized_value))
            
        conn.commit()
        success = True
    except Exception as e:
        print("State kaydedilirken hata oluştu:", e)
        conn.rollback()
        success = False
        
    conn.close()
    
    if success:
        return jsonify({'success': True})
    else:
        return jsonify({'error': 'Veriler kaydedilemedi.'}), 500


@app.route('/api/tests', methods=['GET'])
def get_tests():
    """Öğretici test soru bankasını veritabanından çekerek döner."""
    conn = get_db()
    cursor = conn.cursor()
    try:
        rows = cursor.execute('SELECT * FROM test_questions').fetchall()
        conn.close()
        
        result = []
        for r in rows:
            result.append({
                'id': r['id'],
                'section': r['section'],
                'question_type': r['question_type'],
                'difficulty': r['difficulty'],
                'question_en': r['question_en'],
                'question_tr': r['question_tr'],
                'passage_en': r['passage_en'],
                'passage_tr': r['passage_tr'],
                'options': json.loads(r['options_json']),
                'answer': {
                    'label': r['correct_label'],
                    'text_en': r['correct_text_en'],
                    'text_tr': r['correct_text_tr']
                },
                'explanation_tr': r['explanation_tr'],
                'why_not_others_tr': json.loads(r['why_not_others_json']) if r['why_not_others_json'] else [],
                'solved': r['solved'],
                'is_correct': r['is_correct'],
                'hinted': r['hinted']
            })
        return jsonify(result)
    except Exception as e:
        conn.close()
        return jsonify({'error': f'Veritabanı okunurken hata oluştu: {str(e)}'}), 500


@app.route('/api/tests/state', methods=['GET'])
def get_tests_state():
    """Kullanıcının test ilerleme durumunu veritabanı tablosundan sorgulayarak dinamik döner."""
    conn = get_db()
    cursor = conn.cursor()
    try:
        correct_count = cursor.execute('SELECT COUNT(*) FROM test_questions WHERE solved = 1 AND is_correct = 1').fetchone()[0]
        incorrect_count = cursor.execute('SELECT COUNT(*) FROM test_questions WHERE solved = 1 AND is_correct = 0').fetchone()[0]
        
        solved_rows = cursor.execute('SELECT id FROM test_questions WHERE solved = 1').fetchall()
        solved_ids = [r['id'] for r in solved_rows]
        
        correct_rows = cursor.execute('SELECT id FROM test_questions WHERE solved = 1 AND is_correct = 1').fetchall()
        correct_ids = [r['id'] for r in correct_rows]
        
        incorrect_rows = cursor.execute('SELECT id FROM test_questions WHERE solved = 1 AND is_correct = 0').fetchall()
        incorrect_ids = [r['id'] for r in incorrect_rows]
        
        hinted_rows = cursor.execute('SELECT id FROM test_questions WHERE hinted = 1').fetchall()
        hinted_ids = [r['id'] for r in hinted_rows]
        
        row_idx = cursor.execute('SELECT value FROM user_state WHERE key = ?', ('tests_current_index',)).fetchone()
        current_index = 0
        if row_idx:
            try:
                current_index = json.loads(row_idx['value'])
            except Exception:
                current_index = int(row_idx['value'])
                
        conn.close()
        return jsonify({
            'correct': correct_count,
            'incorrect': incorrect_count,
            'solvedIds': solved_ids,
            'correctIds': correct_ids,
            'incorrectIds': incorrect_ids,
            'currentIndex': current_index,
            'hintedIds': hinted_ids
        })
    except Exception as e:
        conn.close()
        return jsonify({'error': f'State sorgulanırken hata oluştu: {str(e)}'}), 500


@app.route('/api/tests/state', methods=['POST'])
def save_tests_state():
    """Kullanıcının test durumunu ilişkisel olarak veritabanına kaydeder."""
    data = request.json or {}
    correct_ids = data.get('correctIds', [])
    incorrect_ids = data.get('incorrectIds', [])
    hinted_ids = data.get('hintedIds', [])
    current_index = data.get('currentIndex', 0)
    
    conn = get_db()
    cursor = conn.cursor()
    success = False
    try:
        # 1. Önce tüm durumları sıfırla
        cursor.execute('UPDATE test_questions SET solved = 0, is_correct = 0, hinted = 0')
        
        # 2. Doğru çözülenleri işaretle
        for q_id in correct_ids:
            cursor.execute('UPDATE test_questions SET solved = 1, is_correct = 1 WHERE id = ?', (q_id,))
            
        # 3. Yanlış çözülenleri işaretle
        for q_id in incorrect_ids:
            cursor.execute('UPDATE test_questions SET solved = 1, is_correct = 0 WHERE id = ?', (q_id,))
            
        # 4. İpuçlarını işaretle
        for q_id in hinted_ids:
            cursor.execute('UPDATE test_questions SET hinted = 1 WHERE id = ?', (q_id,))
            
        # 5. currentIndex kaydet
        cursor.execute('''
            INSERT INTO user_state (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        ''', ('tests_current_index', json.dumps(current_index)))
        
        conn.commit()
        success = True
    except Exception as e:
        print("Test durumu kaydedilirken hata oluştu:", e)
        conn.rollback()
    finally:
        conn.close()
        
    if success:
        return jsonify({'success': True})
    return jsonify({'error': 'Veriler kaydedilemedi.'}), 500


# ==========================================================================
# SERVER RUNNER
# ==========================================================================
if __name__ == '__main__':
    # 8000 portunda yerel Flask sunucusunu başlat
    print("YDS WordMaster sunucusu başlatılıyor...")
    print("Tarayıcınızdan http://localhost:8000 adresine giderek çalışmaya başlayabilirsiniz.")
    app.run(host='0.0.0.0', port=8000, debug=True)

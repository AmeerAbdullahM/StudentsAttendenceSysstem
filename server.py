"""
SmartAttend – Flask Backend
Dual Portal Attendance System with SQLite Storage
"""

import os, uuid, json, sqlite3
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, 'data', 'attendance.db')

app = Flask(__name__, static_folder=BASE_DIR, static_url_path='')
app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024  # 200 MB for photo payloads

# ─── DB HELPERS ──────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    os.makedirs(os.path.join(BASE_DIR, 'data'), exist_ok=True)
    conn = get_db()
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS students (
            id        TEXT PRIMARY KEY,
            name      TEXT NOT NULL,
            roll      TEXT UNIQUE NOT NULL,
            cls       TEXT,
            contact   TEXT,
            password  TEXT DEFAULT "student123",
            created_at TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS attendance_records (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id        TEXT NOT NULL,
            date              TEXT NOT NULL,
            status            TEXT DEFAULT "pending",
            reason            TEXT,
            location_lat      TEXT,
            location_lng      TEXT,
            location_accuracy TEXT,
            location_address  TEXT,
            submitted_at      TEXT,
            verified          INTEGER DEFAULT 0,
            UNIQUE(student_id, date)
        )
    ''')

    try:
        c.execute('ALTER TABLE attendance_records ADD COLUMN location_address TEXT')
    except Exception:
        pass
        
    try:
        c.execute('ALTER TABLE attendance_records ADD COLUMN document_data TEXT')
    except Exception:
        pass

    try:
        c.execute('ALTER TABLE attendance_records ADD COLUMN document_name TEXT')
    except Exception:
        pass

    c.execute('''
        CREATE TABLE IF NOT EXISTS photos (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            record_id         INTEGER NOT NULL,
            photo_data        TEXT NOT NULL,
            location_lat      TEXT,
            location_lng      TEXT,
            location_accuracy TEXT,
            location_address  TEXT,
            captured_at       TEXT,
            photo_order       INTEGER,
            FOREIGN KEY (record_id) REFERENCES attendance_records(id)
        )
    ''')

    try:
        c.execute('ALTER TABLE photos ADD COLUMN location_address TEXT')
    except Exception:
        pass

    # Seed default students if empty
    c.execute('SELECT COUNT(*) FROM students')
    if c.fetchone()[0] == 0:
        _seed(c)

    conn.commit()
    conn.close()
    print(f"[DB] Initialized at {DB_PATH}")


def _seed(c):
    defaults = [
        ('Priya Sharma',  'CS2024001', 'CSE-A', 'priya@email.com'),
        ('Arjun Mehta',   'CS2024002', 'CSE-A', 'arjun@email.com'),
        ('Neha Patel',    'CS2024003', 'CSE-B', 'neha@email.com'),
        ('Rohan Gupta',   'CS2024004', 'IT-A',  'rohan@email.com'),
        ('Sneha Reddy',   'CS2024005', 'IT-B',  'sneha@email.com'),
        ('Vikram Singh',  'CS2024006', 'CSE-B', 'vikram@email.com'),
        ('Kavya Nair',    'CS2024007', 'ECE',   'kavya@email.com'),
        ('Aditya Kumar',  'CS2024008', 'CSE-A', 'aditya@email.com'),
        ('Diya Joshi',    'CS2024009', 'IT-A',  'diya@email.com'),
        ('Rahul Verma',   'CS2024010', 'ECE',   'rahul@email.com'),
        ('Tanvi Kapoor',  'CS2024011', 'CSE-B', 'tanvi@email.com'),
        ('Siddharth Roy', 'CS2024012', 'IT-B',  'siddharth@email.com'),
    ]
    now = datetime.now().isoformat()
    for name, roll, cls, contact in defaults:
        c.execute(
            'INSERT INTO students (id, name, roll, cls, contact, password, created_at) VALUES (?,?,?,?,?,?,?)',
            (str(uuid.uuid4()), name, roll, cls, contact, 'student123', now)
        )
    print("[DB] Seeded 12 default students")


# ─── SERVE FRONTEND ──────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory(BASE_DIR, filename)


# ─── AUTH ────────────────────────────────────────────────────
@app.route('/api/auth/student', methods=['POST'])
def auth_student():
    data = request.get_json()
    roll = (data.get('roll') or '').strip().upper()
    pwd  = data.get('password', '')
    conn = get_db()
    row  = conn.execute(
        'SELECT id, name, roll, cls, contact FROM students WHERE UPPER(roll)=? AND password=?',
        (roll, pwd)
    ).fetchone()
    conn.close()
    if not row:
        return jsonify(ok=False, error='Invalid roll number or password'), 401
    return jsonify(ok=True, student=dict(row))


@app.route('/api/auth/staff', methods=['POST'])
def auth_staff():
    data = request.get_json()
    user = (data.get('username') or '').strip()
    pwd  = data.get('password', '')
    STAFF = {'admin': 'admin123', 'teacher01': 'admin123'}
    if STAFF.get(user) == pwd:
        return jsonify(ok=True)
    return jsonify(ok=False, error='Invalid credentials'), 401


# ─── STUDENTS ────────────────────────────────────────────────
@app.route('/api/students', methods=['GET'])
def list_students():
    conn = get_db()
    students = conn.execute(
        'SELECT id, name, roll, cls, contact, password, created_at FROM students ORDER BY roll'
    ).fetchall()
    result = []
    for s in students:
        s = dict(s)
        # Count attendance
        rows = conn.execute(
            "SELECT status FROM attendance_records WHERE student_id=?", (s['id'],)
        ).fetchall()
        s['totalPresent'] = sum(1 for r in rows if r['status'] == 'present')
        s['totalAbsent']  = sum(1 for r in rows if r['status'] == 'absent')
        result.append(s)
    conn.close()
    return jsonify(result)


@app.route('/api/students', methods=['POST'])
def add_student():
    data = request.get_json()
    name    = (data.get('name') or '').strip()
    roll    = (data.get('roll') or '').strip().upper()
    cls     = data.get('cls',     'CSE-A')
    contact = data.get('contact', '')
    pwd     = data.get('password', 'student123')
    if not name or not roll:
        return jsonify(ok=False, error='Name and Roll are required'), 400
    sid = str(uuid.uuid4())
    try:
        conn = get_db()
        conn.execute(
            'INSERT INTO students (id, name, roll, cls, contact, password, created_at) VALUES (?,?,?,?,?,?,?)',
            (sid, name, roll, cls, contact, pwd, datetime.now().isoformat())
        )
        conn.commit()
        conn.close()
    except sqlite3.IntegrityError:
        return jsonify(ok=False, error='Roll number already exists'), 409
    return jsonify(ok=True, id=sid, name=name, roll=roll, cls=cls, contact=contact)


@app.route('/api/students/<sid>', methods=['DELETE'])
def delete_student(sid):
    conn = get_db()
    conn.execute('DELETE FROM students WHERE id=?', (sid,))
    conn.commit()
    conn.close()
    return jsonify(ok=True)


@app.route('/api/students/<sid>', methods=['PUT'])
def update_student(sid):
    data = request.get_json()
    name    = (data.get('name') or '').strip()
    roll    = (data.get('roll') or '').strip().upper()
    cls     = data.get('cls',     'CSE-A')
    contact = data.get('contact', '')
    pwd     = data.get('password', '')
    if not name or not roll:
        return jsonify(ok=False, error='Name and Roll are required'), 400
    conn = get_db()
    try:
        if pwd:
            conn.execute(
                'UPDATE students SET name=?, roll=?, cls=?, contact=?, password=? WHERE id=?',
                (name, roll, cls, contact, pwd, sid)
            )
        else:
            conn.execute(
                'UPDATE students SET name=?, roll=?, cls=?, contact=? WHERE id=?',
                (name, roll, cls, contact, sid)
            )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify(ok=False, error='Roll number already exists'), 409
    conn.close()
    return jsonify(ok=True)


# ─── ATTENDANCE ───────────────────────────────────────────────
@app.route('/api/attendance/submit', methods=['POST'])
def submit_attendance():
    data       = request.get_json()
    student_id = data.get('student_id')
    photos     = data.get('photos', [])       # [{dataUrl, location, ts}]
    location   = data.get('location') or {}
    reason     = data.get('reason', '')
    date       = data.get('date') or datetime.now().strftime('%Y-%m-%d')
    status     = data.get('status', 'present')
    doc_data   = data.get('document_data')
    doc_name   = data.get('document_name')

    if not student_id:
        return jsonify(ok=False, error='student_id required'), 400
    if status == 'present' and len(photos) < 1:
        return jsonify(ok=False, error='At least one photo required'), 400

    conn = get_db()

    # Upsert attendance record
    existing = conn.execute(
        'SELECT id FROM attendance_records WHERE student_id=? AND date=?',
        (student_id, date)
    ).fetchone()

    if existing:
        conn.close()
        return jsonify(ok=False, error='Attendance already submitted for today'), 409

    conn.execute(
        '''INSERT INTO attendance_records
           (student_id, date, status, reason, location_lat, location_lng,
            location_accuracy, location_address, submitted_at, verified, document_data, document_name)
           VALUES (?,?,?,?,?,?,?,?,?,0,?,?)''',
        (
            student_id, date, status, reason,
            str(location.get('lat', '')), str(location.get('lng', '')),
            str(location.get('accuracy', '')),
            location.get('address', ''),
            datetime.now().isoformat(),
            doc_data, doc_name
        )
    )
    record_id = conn.execute(
        'SELECT id FROM attendance_records WHERE student_id=? AND date=?',
        (student_id, date)
    ).fetchone()['id']

    for i, photo in enumerate(photos):
        loc = photo.get('location') or {}
        conn.execute(
            '''INSERT INTO photos
               (record_id, photo_data, location_lat, location_lng,
                location_accuracy, location_address, captured_at, photo_order)
               VALUES (?,?,?,?,?,?,?,?)''',
            (
                record_id,
                photo.get('dataUrl', ''),
                str(loc.get('lat', '')), str(loc.get('lng', '')),
                str(loc.get('accuracy', '')),
                loc.get('address', ''),
                photo.get('ts', datetime.now().isoformat()),
                i + 1
            )
        )

    conn.commit()
    conn.close()
    return jsonify(ok=True, record_id=record_id)


@app.route('/api/attendance/<date>', methods=['GET'])
def get_attendance(date):
    conn = get_db()
    rows = conn.execute(
        '''SELECT ar.student_id, ar.status, ar.reason, ar.location_lat,
                  ar.location_lng, ar.location_accuracy, ar.location_address,
                  ar.submitted_at, ar.verified, ar.id as record_id,
                  ar.document_data, ar.document_name,
                  COUNT(p.id) as photos_count
           FROM attendance_records ar
           LEFT JOIN photos p ON p.record_id = ar.id
           WHERE ar.date=?
           GROUP BY ar.id''',
        (date,)
    ).fetchall()
    conn.close()
    result = {}
    for r in rows:
        r = dict(r)
        result[r['student_id']] = r
    return jsonify(result)


@app.route('/api/attendance/<date>/<student_id>/photos', methods=['GET'])
def get_student_photos(date, student_id):
    conn = get_db()
    rec = conn.execute(
        'SELECT id FROM attendance_records WHERE date=? AND student_id=?',
        (date, student_id)
    ).fetchone()
    if not rec:
        conn.close()
        return jsonify([])
    photos = conn.execute(
        '''SELECT photo_data, location_lat, location_lng, location_accuracy,
                  location_address, captured_at, photo_order
           FROM photos WHERE record_id=? ORDER BY photo_order''',
        (rec['id'],)
    ).fetchall()
    conn.close()
    return jsonify([dict(p) for p in photos])


@app.route('/api/attendance/<date>/<student_id>/approve', methods=['PUT'])
def approve_attendance(date, student_id):
    data = request.get_json() or {}
    status = data.get('status', 'present')
    conn = get_db()
    conn.execute(
        "UPDATE attendance_records SET status=?, verified=1 WHERE date=? AND student_id=?",
        (status, date, student_id)
    )
    conn.commit()
    conn.close()
    return jsonify(ok=True)


@app.route('/api/attendance/<date>/<student_id>/verify', methods=['PUT'])
def verify_attendance(date, student_id):
    conn = get_db()
    conn.execute(
        "UPDATE attendance_records SET status='present', verified=1 WHERE date=? AND student_id=?",
        (date, student_id)
    )
    conn.commit()
    conn.close()
    return jsonify(ok=True)


@app.route('/api/attendance/<date>/<student_id>/absent', methods=['PUT'])
def mark_absent(date, student_id):
    data   = request.get_json() or {}
    reason = data.get('reason', '')
    conn   = get_db()
    # Upsert — create record if doesn't exist
    existing = conn.execute(
        'SELECT id FROM attendance_records WHERE date=? AND student_id=?',
        (date, student_id)
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE attendance_records SET status='absent', verified=1, reason=? WHERE date=? AND student_id=?",
            (reason, date, student_id)
        )
    else:
        conn.execute(
            '''INSERT INTO attendance_records
               (student_id, date, status, reason, submitted_at, verified)
               VALUES (?,?,?,?,?,1)''',
            (student_id, date, 'absent', reason, datetime.now().isoformat())
        )
    conn.commit()
    conn.close()
    return jsonify(ok=True)


@app.route('/api/students/<sid>/history', methods=['GET'])
def student_history(sid):
    conn = get_db()
    rows = conn.execute(
        '''SELECT ar.date, ar.status, ar.verified, ar.reason,
                  ar.submitted_at, COUNT(p.id) as photos_count,
                  ar.document_data, ar.document_name
           FROM attendance_records ar
           LEFT JOIN photos p ON p.record_id = ar.id
           WHERE ar.student_id=?
           GROUP BY ar.id
           ORDER BY ar.date DESC''',
        (sid,)
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


if __name__ == '__main__':
    init_db()
    print("\n[SmartAttend] Server running at http://localhost:5000\n")
    app.run(debug=True, port=5000)

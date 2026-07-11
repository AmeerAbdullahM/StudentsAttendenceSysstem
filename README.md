# SmartAttend – Student Attendance System

A lightweight, dual-portal attendance tracking web app built with **Flask** (backend) and **HTML/CSS/JavaScript** (frontend), using **SQLite** for storage. Students submit attendance with photo proof and geolocation; staff review, verify, and manage records from a separate portal.

## Features

- **Student portal** – log in with roll number and password, submit daily attendance with one or more photos, capture geolocation (lat/lng/accuracy/address), attach a supporting document, and view personal attendance history.
- **Staff portal** – log in with a staff/admin username, view attendance for any date, approve or reject submissions, mark students absent (with reason), and review submitted photos and locations.
- **Student management** – add, edit, and delete student records (name, roll number, class, contact, password) via REST endpoints.
- **Duplicate-submission protection** – a student can only submit attendance once per day; the record can then only be updated by staff.
- **SQLite persistence** – all data (students, attendance records, photos) is stored locally in a single `data/attendance.db` file, auto-created and seeded with 12 sample students on first run.

## Tech Stack

| Layer      | Technology                     |
|------------|---------------------------------|
| Backend    | Python, Flask                   |
| Database   | SQLite                          |
| Frontend   | HTML, CSS, JavaScript           |

## Project Structure

```
StudentsAttendenceSysstem/
├── app.js              # Frontend application logic
├── index.html          # Single-page frontend (student + staff portals)
├── style.css            # Styling
├── server.py            # Flask backend (API + static file server)
├── requirements.txt     # Python dependencies
└── data/                # SQLite database (auto-created at runtime)
```

## Getting Started

### Prerequisites
- Python 3.8+

### Installation

```bash
git clone https://github.com/AmeerAbdullahM/StudentsAttendenceSysstem.git
cd StudentsAttendenceSysstem
pip install -r requirements.txt
```

### Run the server

```bash
python server.py
```

The app initializes the database (creating `data/attendance.db` and seeding 12 default students on first launch) and starts at:

```
http://localhost:5000
```

Open that URL in your browser to access the frontend, served directly by Flask.

### Default Login Credentials

**Students** (seeded automatically — password for all: `student123`)

| Name          | Roll Number | Class  |
|---------------|-------------|--------|
| Priya Sharma  | CS2024001   | CSE-A  |
| Arjun Mehta   | CS2024002   | CSE-A  |
| Neha Patel    | CS2024003   | CSE-B  |
| ...           | ...         | ...    |

**Staff**

| Username    | Password  |
|-------------|-----------|
| `admin`     | `admin123`|
| `teacher01` | `admin123`|

> ⚠️ These are default demo credentials hardcoded for local testing. Change them before deploying anywhere public.

## API Overview

| Method | Endpoint                                              | Description                          |
|--------|--------------------------------------------------------|---------------------------------------|
| POST   | `/api/auth/student`                                    | Student login                        |
| POST   | `/api/auth/staff`                                       | Staff login                          |
| GET    | `/api/students`                                         | List all students with attendance totals |
| POST   | `/api/students`                                         | Add a new student                    |
| PUT    | `/api/students/<id>`                                    | Update a student                     |
| DELETE | `/api/students/<id>`                                    | Delete a student                     |
| POST   | `/api/attendance/submit`                                | Submit attendance (photos + location)|
| GET    | `/api/attendance/<date>`                                | Get attendance for a given date      |
| GET    | `/api/attendance/<date>/<student_id>/photos`            | Get photos for a submission          |
| PUT    | `/api/attendance/<date>/<student_id>/approve`           | Approve/set status for a submission  |
| PUT    | `/api/attendance/<date>/<student_id>/verify`            | Mark present & verified              |
| PUT    | `/api/attendance/<date>/<student_id>/absent`            | Mark absent with a reason            |
| GET    | `/api/students/<id>/history`                            | Get a student's full attendance history |

## Notes

- Photo payloads are accepted as base64 data URLs, with a max request size of 200 MB to accommodate multiple images.
- The database schema is created/migrated automatically on startup (`init_db()` in `server.py`), so no manual setup is required beyond installing dependencies.

## License

No license file is currently included in this repository — add one (e.g., MIT) if you intend for others to reuse this code.

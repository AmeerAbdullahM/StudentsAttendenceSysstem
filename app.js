/* ============================================================
   SmartAttend – app.js  (Flask Backend Edition)
   All data persisted via REST API → SQLite
   ============================================================ */

const API_BASE = '';   // same origin as Flask server

// ─── API LAYER ────────────────────────────────────────────────
const api = {
  async req(url, method = 'GET', body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + url, opts);
    const json = await res.json();
    if (!res.ok && typeof json.error === 'string') throw new Error(json.error);
    return json;
  },

  // Auth
  loginStudent: (roll, password) => api.req('/api/auth/student', 'POST', { roll, password }),
  loginStaff: (username, password) => api.req('/api/auth/staff', 'POST', { username, password }),

  // Students
  getStudents: () => api.req('/api/students'),
  addStudent: (data) => api.req('/api/students', 'POST', data),
  updateStudent: (id, data) => api.req(`/api/students/${id}`, 'PUT', data),
  deleteStudent: (id) => api.req(`/api/students/${id}`, 'DELETE'),
  getHistory: (id) => api.req(`/api/students/${id}/history`),

  // Attendance
  submitAttendance: (data) => api.req('/api/attendance/submit', 'POST', data),
  getAttendance: (date) => api.req(`/api/attendance/${date}`),
  getPhotos: (date, studentId) => api.req(`/api/attendance/${date}/${studentId}/photos`),
  verify: (date, studentId) => api.req(`/api/attendance/${date}/${studentId}/verify`, 'PUT'),
  approve: (date, studentId, status) => api.req(`/api/attendance/${date}/${studentId}/approve`, 'PUT', { status }),
  markAbsent: (date, studentId, reason) =>
    api.req(`/api/attendance/${date}/${studentId}/absent`, 'PUT', { reason }),
};

// ─── APP STATE ────────────────────────────────────────────────
const State = {
  currentUser: null,   // { type, id?, name?, roll?, cls? }
  students: [],
  attendance: {},     // date → { studentId → record }
  gpsLocation: null,
  mediaStream: null,
  capturedPhotos: [],
  viewingStudentId: null,
  odFile: null,
  absentFile: null,
};

// ─── CONSTANTS ────────────────────────────────────────────────
const REQUIRED_PHOTOS = 2;
const COLORS = [
  ['#6c63ff', '#9b93ff'], ['#0284c7', '#38bdf8'], ['#d97706', '#fbbf24'],
  ['#db2777', '#f472b6'], ['#059669', '#34d399'], ['#7c3aed', '#a78bfa'],
  ['#0891b2', '#22d3ee'], ['#dc2626', '#f87171'],
];

// ─── UTILS ────────────────────────────────────────────────────
function todayKey() { return new Date().toISOString().split('T')[0]; }
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtTime(ts) {
  if (!ts) return '—';
  const d = (typeof ts === 'number') ? new Date(ts) : new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtDateShort(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function ini(name) { return (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(); }
function color(idx) { return COLORS[Math.abs(idx) % COLORS.length]; }
function loadingBtn(id, loading, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.disabled = loading;
  el.textContent = loading ? '⏳ Please wait…' : text;
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// ─── THEME HANDLING ───────────────────────────────────────────
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeIcons(isDark);
}

function updateThemeIcons(isDark) {
  document.querySelectorAll('.sun-icon').forEach(el => el.classList.toggle('hidden', isDark));
  document.querySelectorAll('.moon-icon').forEach(el => el.classList.toggle('hidden', !isDark));
}

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  // Default to light theme; only go dark if user explicitly saved 'dark'
  const isDark = savedTheme === 'dark';
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  updateThemeIcons(isDark);
}
initTheme();

// ─── PORTAL SELECTION ─────────────────────────────────────────
function selectPortal(type) {
  showPage(`page-${type}-login`);
}
function goLanding() {
  stopCamera();
  showPage('page-landing');
}
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── STUDENT LOGIN ────────────────────────────────────────────
async function loginStudent(e) {
  e.preventDefault();
  const roll = document.getElementById('s-roll').value.trim();
  const pass = document.getElementById('s-pass').value;
  const errEl = document.getElementById('s-err');
  loadingBtn('s-submit-btn', true, '');
  try {
    const res = await api.loginStudent(roll, pass);
    errEl.classList.add('hidden');
    State.currentUser = { type: 'student', ...res.student };
    await initStudentDashboard();
    showPage('page-student');
  } catch (err) {
    errEl.textContent = err.message || 'Invalid credentials';
    errEl.classList.remove('hidden');
  } finally {
    loadingBtn('s-submit-btn', false, 'Sign In as Student →');
  }
}

async function initStudentDashboard() {
  const s = State.currentUser;
  const idx = State.students.findIndex(x => x.id === s.id);
  const [c1, c2] = color(idx >= 0 ? idx : 0);
  document.getElementById('s-avatar').textContent = ini(s.name);
  document.getElementById('s-avatar').style.background = `linear-gradient(135deg,${c1},${c2})`;
  document.getElementById('s-display-name').textContent = s.name;
  document.getElementById('s-display-roll').textContent = `${s.roll} · ${s.cls}`;
  document.getElementById('s-topbar-date').textContent = fmtDate(new Date());
  resetStudentCapture();
  startGPS();
  await refreshTodayStatus();
  renderStudentHistory();
  renderStudentProfile();
  switchTab('present');
}

// ─── STAFF LOGIN ──────────────────────────────────────────────
async function loginStaff(e) {
  e.preventDefault();
  const user = document.getElementById('t-user').value.trim();
  const pass = document.getElementById('t-pass').value;
  const errEl = document.getElementById('t-err');
  loadingBtn('t-submit-btn', true, '');
  try {
    await api.loginStaff(user, pass);
    errEl.classList.add('hidden');
    State.currentUser = { type: 'staff', username: user };
    await initStaffDashboard();
    showPage('page-staff');
  } catch (err) {
    errEl.textContent = err.message || 'Invalid credentials';
    errEl.classList.remove('hidden');
  } finally {
    loadingBtn('t-submit-btn', false, 'Sign In as Staff →');
  }
}

async function initStaffDashboard() {
  document.getElementById('t-topbar-date').textContent = fmtDate(new Date());
  document.getElementById('t-date-filter').value = todayKey();
  await loadStudents();
  await staffRefresh();
}

async function loadStudents() {
  State.students = await api.getStudents();
}

// ─── LOGOUT ───────────────────────────────────────────────────
function logoutPortal() {
  stopCamera();
  State.currentUser = null;
  State.capturedPhotos = [];
  State.students = [];
  State.attendance = {};
  showPage('page-landing');
}

// ─── SIDEBAR ──────────────────────────────────────────────────
function toggleSidebar(sidebarId, mainId) {
  const sb = document.getElementById(sidebarId);
  sb.classList.toggle('collapsed');
  const main = document.getElementById(mainId);
  if (main) main.style.marginLeft = sb.classList.contains('collapsed') ? '64px' : '230px';
}

// ─── SECTIONS ─────────────────────────────────────────────────
async function studentSection(name) {
  document.querySelectorAll('#page-student .dash-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('#page-student .sb-navbtn').forEach(b => b.classList.remove('active'));
  document.getElementById(`s-section-${name}`).classList.add('active');
  document.getElementById(`snav-${name}`).classList.add('active');
  const titles = { mark: 'Mark Attendance', history: 'My History', profile: 'My Profile' };
  document.getElementById('s-topbar-title').textContent = titles[name] || '';
  if (name === 'history') await renderStudentHistory();
  if (name === 'profile') await renderStudentProfile();
}

async function staffSection(name) {
  document.querySelectorAll('#page-staff .dash-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('#page-staff .sb-navbtn').forEach(b => b.classList.remove('active'));
  document.getElementById(`t-section-${name}`).classList.add('active');
  document.getElementById(`tnav-${name}`).classList.add('active');
  const titles = { overview: 'Overview', photos: 'Student Photos', records: 'Attendance Records', students: 'Manage Students' };
  document.getElementById('t-topbar-title').textContent = titles[name] || '';
  await staffRefresh();
}

async function staffRefresh() {
  const date = getSelectedDate();
  try {
    State.attendance[date] = await api.getAttendance(date);
  } catch (e) {
    State.attendance[date] = {};
  }
  renderStatsGrid();
  renderOverviewTable();
  renderPhotosSection();
  renderRecords();
  await renderManageStudents();
}

// ═══════════════════════════════════════════
//   STUDENT PORTAL
// ═══════════════════════════════════════════

// ─── REVERSE GEOCODING (Multi-source) ────────────────────────

// Source 1: OpenStreetMap Nominatim at zoom=18 (street level)
async function _nominatim(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { 'Accept-Language': 'en-IN,en', 'User-Agent': 'SmartAttend/1.0' } }
    );
    if (!res.ok) return '';
    const text = await res.json();
    const a = data.address || {};
    const road = a.road || a.street || a.pedestrian || a.footway || a.path || a.highway || a.residential;
    const hno = a.house_number ? `No.${a.house_number}` : null;
    const area = a.neighbourhood || a.suburb || a.quarter || a.village || a.hamlet || a.locality;
    const city = a.city || a.town || a.municipality || a.county || a.district;
    const parts = [hno, road, area, city, a.state, a.postcode].filter(Boolean);
    return (parts.length >= 3) ? parts.join(', ') : (data.display_name || '');
  } catch { return ''; }
}

// Source 2: BigDataCloud (free, no key, uses different dataset)
async function _bigdatacloud(lat, lng) {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
    );
    if (!res.ok) return '';
    const d = await res.json();
    const admins = (d.localityInfo && d.localityInfo.administrative) || [];
    admins.sort((a, b) => b.order - a.order);
    const specific = (admins.find(a => a.adminLevel >= 7) || {}).name;
    const district = (admins.find(a => a.adminLevel === 6) || {}).name;
    const parts = [
      d.locality || specific,
      district,
      d.city || d.principalSubdivision,
      d.postcode
    ].filter(Boolean);
    return parts.join(', ') || '';
  } catch { return ''; }
}

// Run both sources, return the more specific (more comma-parts) result
async function reverseGeocode(lat, lng) {
  const [r1, r2] = await Promise.allSettled([_nominatim(lat, lng), _bigdatacloud(lat, lng)]);
  const a1 = (r1.status === 'fulfilled') ? r1.value : '';
  const a2 = (r2.status === 'fulfilled') ? r2.value : '';
  const candidates = [a1, a2].filter(Boolean);
  if (!candidates.length) return '';
  // Pick the one with more address parts (more specific)
  return candidates.sort((a, b) => b.split(',').length - a.split(',').length || b.length - a.length)[0];
}

// Track last geocoded position to avoid redundant calls
let _lastGeocodeKey = '';

function startGPS() {
  if (!navigator.geolocation) {
    document.getElementById('s-loc-text').textContent = 'GPS not supported';
    const addr = document.getElementById('s-address');
    if (addr) addr.textContent = 'GPS not supported on this device';
    return;
  }
  const addrEl = document.getElementById('s-address');
  if (addrEl) addrEl.textContent = 'Acquiring GPS signal…';

  navigator.geolocation.watchPosition(
    async pos => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      const acc = Math.round(pos.coords.accuracy);

      // Update coordinates immediately
      if (!State.gpsLocation) State.gpsLocation = {};
      State.gpsLocation.lat = lat;
      State.gpsLocation.lng = lng;
      State.gpsLocation.accuracy = acc;
      State.gpsLocation.ts = Date.now();
      updateGPSUI();

      // Show live accuracy while resolving address
      if (addrEl && !State.gpsLocation.address) {
        addrEl.textContent = `Resolving address… (GPS accuracy ±${acc}m)`;
      }

      // Only geocode when accuracy is reasonable and coords changed
      const geoKey = `${lat},${lng}`;
      if (geoKey !== _lastGeocodeKey && acc < 1500) {
        _lastGeocodeKey = geoKey;
        const address = await reverseGeocode(lat, lng);
        if (address) {
          State.gpsLocation.address = address;
          updateGPSUI();
          // Populate manual-address placeholder so user sees the detected one
          const manual = document.getElementById('s-manual-addr');
          if (manual && !manual.value) manual.placeholder = address;
        } else if (addrEl) {
          addrEl.textContent = `No address found. Coords: ${lat}, ${lng}`;
        }
      }
    },
    err => {
      const msg = err.code === 1 ? 'Location permission denied'
        : err.code === 2 ? 'GPS signal unavailable (try moving outside)'
          : 'GPS timeout — retrying…';
      document.getElementById('s-loc-text').textContent = 'GPS unavailable';
      if (addrEl) addrEl.textContent = msg;
    },
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
  );
}

function updateGPSUI() {
  const loc = State.gpsLocation;
  if (!loc) return;

  // Topbar chip: show short address or fall back to coords
  const chipText = loc.address
    ? loc.address.split(',').slice(0, 2).join(',').trim()
    : `${loc.lat}, ${loc.lng}`;
  document.getElementById('s-loc-text').textContent = chipText;

  // Address row (prominent)
  const addrEl = document.getElementById('s-address');
  if (addrEl) addrEl.textContent = loc.address || 'Resolving address…';

  // Coordinates row
  document.getElementById('s-coords').textContent = `${loc.lat}° N,  ${loc.lng}° E`;
  document.getElementById('s-accuracy').textContent = `±${loc.accuracy}m`;
  document.getElementById('s-timestamp').textContent = fmtTime(loc.ts);

  const dot = document.querySelector('#s-loc-chip .loc-pulse');
  if (dot) dot.classList.add('gps-ready');
  const pill = document.getElementById('loc-pill-dot');
  if (pill) { pill.classList.remove('yellow-dot'); pill.classList.add('green-dot'); pill.style.animation = 'none'; }
  document.getElementById('sp-loc-txt').textContent = 'GPS confirmed';
}

// ─── CAMERA ───────────────────────────────
async function startStudentCamera() {
  if (await isAlreadyMarked()) {
    toast('You have already submitted attendance today', 'info'); return;
  }
  try {
    stopCamera();
    State.mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 640, height: 480 }, audio: false
    });
    document.getElementById('s-video').srcObject = State.mediaStream;
    document.getElementById('sp-cam-txt').textContent = 'Camera active';
    const dot = document.getElementById('sp-camera').querySelector('.pill-dot');
    dot.classList.remove('red-dot'); dot.classList.add('green-dot');
    toast('📷 Camera ready — capture 2 photos!', 'info');
  } catch (err) {
    toast('Camera access denied: ' + err.message, 'error');
  }
}

function stopCamera() {
  if (State.mediaStream) { State.mediaStream.getTracks().forEach(t => t.stop()); State.mediaStream = null; }
}

function captureStudentPhoto() {
  if (State.capturedPhotos.length >= REQUIRED_PHOTOS) {
    toast(`Already captured ${REQUIRED_PHOTOS} photos`, 'warning'); return;
  }
  const video = document.getElementById('s-video');
  if (!video.srcObject) { toast('Start camera first!', 'warning'); return; }
  const canvas = document.getElementById('s-canvas');
  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

  const overrideAddress = document.getElementById('s-manual-addr')?.value.trim();
  const currentLoc = State.gpsLocation ? { ...State.gpsLocation } : null;
  if (currentLoc && overrideAddress) currentLoc.address = overrideAddress;

  State.capturedPhotos.push({
    dataUrl,
    location: currentLoc,
    ts: Date.now()
  });
  updateCameraUI();

  // Flash
  const vp = document.querySelector('.cam-viewport');
  vp.style.outline = '3px solid #22c55e';
  setTimeout(() => vp.style.outline = '', 350);

  toast(`📸 Photo ${State.capturedPhotos.length}/${REQUIRED_PHOTOS} captured!`, 'success');
  if (State.capturedPhotos.length >= REQUIRED_PHOTOS) {
    document.getElementById('btn-submit').disabled = false;
    toast('✅ All photos done! Click "Submit Attendance".', 'info');
  }
}

function deleteStudentPhoto(idx) {
  State.capturedPhotos.splice(idx, 1);
  updateCameraUI();
  document.getElementById('btn-submit').disabled = State.capturedPhotos.length < REQUIRED_PHOTOS;
}

function updateCameraUI() {
  const count = State.capturedPhotos.length;
  const pct = Math.round(count / REQUIRED_PHOTOS * 100);
  document.getElementById('cam-badge').textContent = `${count}/${REQUIRED_PHOTOS}`;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `${count} of ${REQUIRED_PHOTOS} photos captured`;
  const strip = document.getElementById('s-photo-strip');
  let html = State.capturedPhotos.map((p, i) => `
    <div class="photo-thumb">
      <img src="${p.dataUrl}" alt="Photo ${i + 1}" />
      <span class="pt-num">${i + 1}</span>
      <button class="pt-del" onclick="deleteStudentPhoto(${i})">✕</button>
    </div>`).join('');
  for (let i = count; i < REQUIRED_PHOTOS; i++) html += `<div class="photo-slot">📷</div>`;
  strip.innerHTML = html;
}

async function isAlreadyMarked() {
  const date = todayKey();
  try {
    const att = await api.getAttendance(date);
    return !!(att[State.currentUser?.id]);
  } catch { return false; }
}

async function refreshTodayStatus() {
  const date = todayKey();
  let rec = null;
  try {
    const att = await api.getAttendance(date);
    rec = att[State.currentUser?.id] || null;
  } catch { }
  updateTodayBanner(rec);
  if (rec) {
    document.getElementById('btn-submit').disabled = true;
    document.getElementById('btn-start-cam').disabled = true;
    document.getElementById('s-capture-btn').disabled = true;
  }
}

function updateTodayBanner(rec) {
  const banner = document.getElementById('today-banner');
  const icon = document.getElementById('banner-icon');
  const title = document.getElementById('banner-title');
  const sub = document.getElementById('banner-sub');
  
  const tabs = document.getElementById('attendance-tabs');
  if (tabs) tabs.style.display = rec ? 'none' : 'flex';

  if (!rec) {
    banner.className = 'today-status-banner';
    icon.textContent = '📸';
    title.textContent = "Ready to Mark Today's Attendance";
    sub.textContent = `Capture ${REQUIRED_PHOTOS} photos from different angles with GPS location`;
  } else if (rec.status === 'present') {
    banner.className = 'today-status-banner banner-done';
    icon.textContent = '✅';
    title.textContent = 'Attendance Submitted — Present';
    sub.textContent = `${rec.photos_count || 0} photos submitted. ${rec.verified ? '🔵 Verified by staff.' : '⏳ Pending staff verification.'}`;
  } else if (rec.status === 'od') {
    banner.className = 'today-status-banner banner-od';
    icon.textContent = '📄';
    title.textContent = 'On Duty Request Submitted';
    sub.textContent = `Reason: ${rec.reason}. ${rec.verified ? '🔵 Verified by staff.' : '⏳ Pending staff review.'}`;
  } else {
    banner.className = 'today-status-banner banner-absent';
    icon.textContent = '❌';
    title.textContent = 'Marked as Absent';
    sub.textContent = rec.reason ? `Reason: ${rec.reason}` : 'No reason provided.';
  }
}

function resetStudentCapture() {
  State.capturedPhotos = [];
  updateCameraUI();
  document.getElementById('btn-submit').disabled = true;
  document.getElementById('btn-start-cam').disabled = false;
  document.getElementById('s-capture-btn').disabled = false;
}

// ─── TABS HANDLING ────────────────────────────────────────────
function switchTab(tabId) {
  const btns = document.querySelectorAll('.seg-btn');
  const tabs = document.querySelectorAll('.tab-content');
  if (!btns.length) return;

  btns.forEach(btn => btn.classList.remove('active'));
  tabs.forEach(tab => tab.classList.add('hidden'));
  
  const targetBtn = document.getElementById(`tab-btn-${tabId}`);
  const targetTab = document.getElementById(`tab-${tabId}`);
  
  if (targetBtn) targetBtn.classList.add('active');
  if (targetTab) targetTab.classList.remove('hidden');

  const banner = document.getElementById('today-banner');
  // Only hide banner if user HASN'T submitted (no banner-done/banner-od/banner-absent classes)
  if (banner && !banner.classList.contains('banner-done') && !banner.classList.contains('banner-od') && !banner.classList.contains('banner-absent')) {
      banner.style.display = (tabId === 'present') ? 'flex' : 'none';
  }
}

// ─── FILE UPLOAD HANDLING ─────────────────────────────────────
function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('dragover');
}
function handleDragLeave(e) {
  e.currentTarget.classList.remove('dragover');
}
function handleDrop(e, type) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  processFile(file, type);
}
function handleFileSelect(e, type) {
  const file = e.target.files[0];
  processFile(file, type);
}
function processFile(file, type) {
  const errorEl = document.getElementById(`${type}-file-error`);
  const nameEl = document.getElementById(`${type}-file-name`);
  
  if (!file) return;
  
  errorEl.classList.add('hidden');
  
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
  if (!allowedTypes.includes(file.type)) {
    errorEl.textContent = 'Invalid file type. Only PDF, JPG, and PNG are allowed.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    errorEl.textContent = 'File too large. Maximum size is 2MB.';
    errorEl.classList.remove('hidden');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    State[`${type}File`] = { name: file.name, dataUrl: e.target.result };
    nameEl.innerHTML = `📄 ${file.name} <button class="remove-file" onclick="removeFile('${type}')">✕</button>`;
    nameEl.classList.remove('hidden');
    if (type === 'od') validateODForm();
    if (type === 'absent') validateAbsentForm();
  };
  reader.readAsDataURL(file);
}
function removeFile(type) {
  State[`${type}File`] = null;
  document.getElementById(`${type}-file`).value = '';
  document.getElementById(`${type}-file-name`).classList.add('hidden');
  if (type === 'od') validateODForm();
  if (type === 'absent') validateAbsentForm();
}
function validateODForm() {
  const reason = document.getElementById('od-reason').value.trim();
  const file = State.odFile;
  document.getElementById('btn-submit-od').disabled = !(reason.length >= 5 && file);
}
function validateAbsentForm() {
  const reason = document.getElementById('absent-reason').value.trim();
  const file = State.absentFile;
  document.getElementById('btn-submit-absent').disabled = !(reason.length >= 5 && file);
}

// ─── SUBMIT ───────────────────────────────
async function submitOD(e) {
  e.preventDefault();
  const fileInput = document.getElementById('od-file');
  const reasonInput = document.getElementById('od-reason');
  const file = fileInput.files[0];
  const reason = reasonInput.value.trim();

  if (!file || !reason) {
    toast('Please provide both the OD letter and a reason.', 'warning');
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    toast('File size must be less than 2MB.', 'error');
    return;
  }

  loadingBtn('btn-submit-od', true, 'Submitting...');
  try {
    const docData = await fileToBase64(file);
    await api.submitAttendance({
      student_id: State.currentUser.id,
      date: todayKey(),
      status: 'od',
      reason: reason,
      document_data: docData,
      document_name: file.name,
      location: State.gpsLocation
    });
    toast('On Duty application submitted!', 'success');
    await initStudentDashboard();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    loadingBtn('btn-submit-od', false, '✅ Submit On Duty');
  }
}

async function submitAbsent(e) {
  e.preventDefault();
  const fileInput = document.getElementById('absent-file');
  const reasonInput = document.getElementById('absent-reason');
  const file = fileInput.files[0];
  const reason = reasonInput.value.trim();

  if (!file || !reason) {
    toast('Please provide both the leave letter and a reason.', 'warning');
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    toast('File size must be less than 2MB.', 'error');
    return;
  }

  loadingBtn('btn-submit-absent', true, 'Submitting...');
  try {
    const docData = await fileToBase64(file);
    await api.submitAttendance({
      student_id: State.currentUser.id,
      date: todayKey(),
      status: 'absent',
      reason: reason,
      document_data: docData,
      document_name: file.name,
      location: State.gpsLocation
    });
    toast('Absent application submitted!', 'success');
    await initStudentDashboard();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    loadingBtn('btn-submit-absent', false, '✅ Submit Absent');
  }
}

async function submitAttendance() {
  if (State.capturedPhotos.length < REQUIRED_PHOTOS) {
    toast(`Capture all ${REQUIRED_PHOTOS} photos first`, 'warning'); return;
  }
  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = '⏳ Submitting…';

  try {
    const photos = State.capturedPhotos.map(p => ({
      dataUrl: p.dataUrl,
      location: p.location,
      ts: p.ts
    }));
    await api.submitAttendance({
      student_id: State.currentUser.id,
      date: todayKey(),
      status: 'present',
      photos: photos,
      location: State.gpsLocation
    });
    toast('Attendance submitted! Awaiting verification.', 'success');
    await initStudentDashboard();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = '✅ Submit Present';
  }
}

// ─── STUDENT HISTORY ──────────────────────
async function renderStudentHistory() {
  const el = document.getElementById('s-history-content');
  el.innerHTML = '<div class="empty-state"><div class="es-icon">⏳</div>Loading…</div>';
  try {
    const history = await api.getHistory(State.currentUser.id);
    if (!history.length) {
      el.innerHTML = '<div class="empty-state"><div class="es-icon">📭</div>No attendance records yet.</div>';
      return;
    }
    el.innerHTML = history.map(rec => {
      const badge =
        rec.status === 'present' ? `<span class="badge badge-present">✅ Present</span>`
        : rec.status === 'od'    ? `<span class="badge badge-od">📄 On Duty</span>`
        : rec.status === 'absent'? `<span class="badge badge-absent">❌ Absent</span>`
        :                          `<span class="badge badge-pending">⏳ Pending</span>`;
      const verBadge = rec.verified
        ? `<span class="badge badge-verified">🔵 Verified</span>`
        : `<span class="badge badge-review">⏳ Pending Review</span>`;
      return `
        <div class="history-card">
          <div class="hist-date">${fmtDateShort(rec.date)}</div>
          <div class="hist-status">${badge} ${verBadge}</div>
          <div class="hist-photos">📸 ${rec.photos_count || 0} photos</div>
          ${rec.reason ? `<div class="hist-reason">📝 ${rec.reason}</div>` : ''}
        </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><div class="es-icon">⚠️</div>${err.message}</div>`;
  }
}

// ─── STUDENT PROFILE ──────────────────────
async function renderStudentProfile() {
  const el = document.getElementById('s-profile-content');
  el.innerHTML = '<div class="empty-state"><div class="es-icon">⏳</div>Loading…</div>';
  try {
    const s = State.currentUser;
    const idx = State.students.findIndex(x => x.id === s.id);
    const [c1, c2] = color(idx >= 0 ? idx : 0);
    const history = await api.getHistory(s.id);
    const present = history.filter(r => r.status === 'present').length;
    const absent = history.filter(r => r.status === 'absent').length;
    const total = present + absent;
    const pct = total ? Math.round(present / total * 100) : 0;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:1.2rem;margin-bottom:1.5rem">
        <div style="width:70px;height:70px;border-radius:50%;background:linear-gradient(135deg,${c1},${c2});
          display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:800;color:#fff">
          ${ini(s.name)}
        </div>
        <div>
          <h3 style="font-size:1.2rem;font-weight:700">${s.name}</h3>
          <p style="color:var(--text2);font-size:.87rem;margin-top:.2rem">${s.roll} · ${s.cls}</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem">
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:1rem;text-align:center">
          <div style="font-size:1.6rem;font-weight:800;color:#22c55e">${present}</div>
          <div style="font-size:.77rem;color:var(--text2);margin-top:.2rem">Days Present</div>
        </div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:1rem;text-align:center">
          <div style="font-size:1.6rem;font-weight:800;color:#ef4444">${absent}</div>
          <div style="font-size:.77rem;color:var(--text2);margin-top:.2rem">Days Absent</div>
        </div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:1rem;text-align:center">
          <div style="font-size:1.6rem;font-weight:800;color:#6c63ff">${pct}%</div>
          <div style="font-size:.77rem;color:var(--text2);margin-top:.2rem">Attendance %</div>
        </div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><div class="es-icon">⚠️</div>${err.message}</div>`;
  }
}

// ═══════════════════════════════════════════
//   STAFF PORTAL
// ═══════════════════════════════════════════

function getSelectedDate() {
  return document.getElementById('t-date-filter')?.value || todayKey();
}

function getAtt(date) { return State.attendance[date] || {}; }

// ─── STATS GRID ───────────────────────────
function renderStatsGrid() {
  const att = getAtt(getSelectedDate());
  const vals = Object.values(att);
  const present = vals.filter(a => a.status === 'present').length;
  const od = vals.filter(a => a.status === 'od').length;
  const absent = vals.filter(a => a.status === 'absent').length;
  const pending = Math.max(0, State.students.length - present - od - absent);
  const photos = vals.reduce((s, a) => s + (a.photos_count || 0), 0);
  document.getElementById('t-stats-grid').innerHTML = `
    <div class="stat-card" style="--accent:#22c55e"><div class="stat-icon">✅</div><div class="stat-body"><span class="stat-num">${present}</span><span class="stat-lbl">Present</span></div></div>
    <div class="stat-card" style="--accent:var(--primary)"><div class="stat-icon">💼</div><div class="stat-body"><span class="stat-num">${od}</span><span class="stat-lbl">On Duty</span></div></div>
    <div class="stat-card" style="--accent:#ef4444"><div class="stat-icon">❌</div><div class="stat-body"><span class="stat-num">${absent}</span><span class="stat-lbl">Absent</span></div></div>
    <div class="stat-card" style="--accent:#f59e0b"><div class="stat-icon">⏳</div><div class="stat-body"><span class="stat-num">${pending}</span><span class="stat-lbl">Pending</span></div></div>`;
}

// ─── OVERVIEW TABLE ────────────────────────
function renderOverviewTable() {
  const date = getSelectedDate();
  const att = getAtt(date);
  const q = (document.getElementById('t-search-overview')?.value || '').toLowerCase();
  const tbody = document.getElementById('t-overview-body');
  const rows = State.students
    .filter(s => !q || s.name.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q))
    .map((s, i) => {
      const rec = att[s.id];
      const status = rec?.status || 'pending';
      const badge = {
        present: `<span class="badge badge-present">✅ Present</span>`,
        od: `<span class="badge badge-od">📄 On Duty</span>`,
        absent: `<span class="badge badge-absent">❌ Absent</span>`,
        pending: `<span class="badge badge-pending">⏳ Pending</span>`
      }[status];
      const verBadge = rec?.status && rec?.status !== 'pending' 
        ? (rec?.verified ? `<span class="badge badge-verified">🔵 Verified</span>` : `<span class="badge badge-review">⏳ Pending Review</span>`) 
        : '';
      const [c1, c2] = color(i);
      return `<tr>
        <td>
          <div style="display:flex;align-items:center;gap:.6rem">
            <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${c1},${c2});
              display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:800;color:#fff;flex-shrink:0">
              ${ini(s.name)}
            </div>${s.name}
          </div>
        </td>
        <td><span class="badge" style="background:rgba(108,99,255,.1);color:var(--student2)">${s.roll}</span></td>
        <td>${s.cls}</td>
        <td>${badge} ${verBadge}</td>
        <td>${rec?.photos_count || 0} / ${REQUIRED_PHOTOS}</td>
        <td style="color:var(--text2)">${rec?.submitted_at ? fmtTime(rec.submitted_at) : '—'}</td>
        <td>
          ${rec?.photos_count > 0
          ? `<button class="btn-view-photos" onclick="openViewPhotos('${s.id}')">🖼 View Photos</button>`
          : (rec?.document_data ? `<button class="btn-view-photos" onclick="downloadDocument('${s.id}')">📄 View Doc</button>` : '<span style="color:var(--text3);font-size:.8rem">No photos/docs</span>')}
        </td>
      </tr>`;
    });
  tbody.innerHTML = rows.join('') || `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text3)">No students found</td></tr>`;
}

// ─── PHOTOS SECTION ────────────────────────
function renderPhotosSection() {
  const date = getSelectedDate();
  const att = getAtt(date);
  const q = (document.getElementById('t-search-photos')?.value || '').toLowerCase();
  const cls = document.getElementById('t-filter-class')?.value || '';
  const el = document.getElementById('t-photos-content');

  const withPhotosOrDocs = State.students.filter(s => {
    const hasP = (att[s.id]?.photos_count || 0) > 0 || att[s.id]?.document_data;
    const matchQ = !q || s.name.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q);
    const matchC = !cls || s.cls === cls;
    return hasP && matchQ && matchC;
  });

  if (!withPhotosOrDocs.length) {
    el.innerHTML = `<div class="empty-state"><div class="es-icon">📭</div>
      No photos or documents submitted yet for ${date}.<br>Students need to log in and submit attendance.</div>`;
    return;
  }

  el.innerHTML = withPhotosOrDocs.map((s, i) => {
    const rec = att[s.id];
    const [c1, c2] = color(State.students.indexOf(s));
    const badge = rec.status === 'present'
      ? `<span class="badge badge-present">✅ Present</span>`
      : (rec.status === 'od' ? `<span class="badge badge-od">📄 On Duty</span>` : `<span class="badge badge-absent">❌ Absent</span>`);
    const verBadge = rec.verified
      ? `<span class="badge badge-verified">🔵 Verified</span>`
      : `<span class="badge badge-review">⏳ Pending Review</span>`;
    const locStr = (rec.location_lat && rec.location_lat !== 'None')
      ? `<div class="spb-loc-item">${rec.location_address ? `📍 <strong>${rec.location_address}</strong>` : ''}</div>
         <div class="spb-loc-item">🌐 <strong>${rec.location_lat}, ${rec.location_lng}</strong> (\u00b1${rec.location_accuracy}m)</div>
         <div class="spb-loc-item">🕐 <strong>${fmtTime(rec.submitted_at)}</strong></div>`
      : `<div class="spb-loc-item">📍 Location not captured</div>`;

    return `
    <div class="student-photo-block">
      <div class="spb-header">
        <div class="spb-info">
          <div class="spb-avatar" style="background:linear-gradient(135deg,${c1},${c2})">${ini(s.name)}</div>
          <div>
            <div class="spb-name">${s.name}</div>
            <div class="spb-meta">${s.roll} · ${s.cls} · ${badge} ${verBadge}</div>
          </div>
        </div>
        <div class="spb-actions">
          ${rec.photos_count > 0 ? `<button class="btn-view-photos" onclick="openViewPhotos('${s.id}')">🖼 View All ${rec.photos_count}</button>` : ''}
          ${rec.document_data ? `<button class="btn-view-photos" onclick="downloadDocument('${s.id}')">📄 View Document</button>` : ''}
          ${!rec.verified ? `<button class="btn-verify" onclick="doVerify('${s.id}')">✅ Verify</button>` : ''}
          <button class="btn-reject" onclick="doAbsent('${s.id}')">❌ Absent</button>
        </div>
      </div>
      <div class="spb-photo-row" id="thumb-${s.id}">
        <div style="color:var(--text3);font-size:.82rem;padding:.4rem">${rec.photos_count > 0 ? 'Click "View All" to load photos' : (rec.document_data ? 'Document submitted: ' + rec.document_name : 'No media')}</div>
      </div>
      <div class="spb-loc-row">${locStr}</div>
    </div>`;
  }).join('');
}

// ─── VIEW PHOTOS MODAL ────────────────────
async function openViewPhotos(studentId) {
  const date = getSelectedDate();
  const s = State.students.find(x => x.id === studentId);
  const rec = getAtt(date)[studentId];
  if (!s || !rec) { toast('No record found', 'warning'); return; }

  State.viewingStudentId = studentId;
  document.getElementById('vp-title').textContent = `📄 ${s.name} — Application Review`;
  document.getElementById('vp-sub').textContent = `${s.roll} · ${s.cls} · ${fmtDateShort(date)}`;
  
  const grid = document.getElementById('vp-photos-grid');
  const timeline = document.getElementById('vp-location-timeline');
  const docViewer = document.getElementById('vp-document-viewer');
  
  grid.innerHTML = '';
  timeline.innerHTML = '';
  docViewer.style.display = 'none';
  
  document.getElementById('view-photos-modal').classList.remove('hidden');

  const badge = {
    present: `<span class="badge badge-present">✅ Present</span>`,
    od: `<span class="badge badge-od">💼 On Duty</span>`,
    absent: `<span class="badge badge-absent">❌ Absent</span>`
  }[rec.status] || `<span class="badge badge-pending">⏳ Pending</span>`;

  const verBadge = rec.verified
    ? `<span class="badge badge-verified">🔵 Verified</span>`
    : `<span class="badge badge-review">⏳ Awaiting Review</span>`;

  document.getElementById('vp-meta').innerHTML = `${badge} ${verBadge}
    <span style="color:var(--text2)">🕐 ${fmtTime(rec.submitted_at)}</span>
    ${rec.reason ? `<div style="margin-top:0.5rem; color:var(--text); font-weight:500;">Reason: <span style="font-weight:400; color:var(--text2);">${rec.reason}</span></div>` : ''}`;

  // Button handling
  document.getElementById('vp-verify-btn').style.display = (rec.status === 'present' && !rec.verified) ? '' : 'none';
  document.getElementById('vp-od-btn').style.display = (rec.status === 'od' && !rec.verified) ? '' : 'none';
  document.getElementById('vp-absent-btn').style.display = (rec.status === 'absent' && !rec.verified) ? '' : 'none';
  document.getElementById('vp-reject-btn').style.display = !rec.verified ? '' : 'none';

  // Content display
  if (rec.document_data) {
    docViewer.style.display = 'block';
    document.getElementById('vp-doc-name').textContent = rec.document_name || 'Attached Letter';
    const content = document.getElementById('vp-doc-content');
    if (rec.document_data.startsWith('data:application/pdf')) {
      content.innerHTML = `<a href="${rec.document_data}" target="_blank" class="btn-portal staff-btn" style="display:inline-flex; width:auto;">📂 Open PDF in New Tab</a>`;
    } else {
      content.innerHTML = `<img src="${rec.document_data}" style="max-width:100%; border-radius:8px; box-shadow:var(--shadow);" />`;
    }
  }

  if (rec.photos_count > 0) {
    grid.innerHTML = '<div style="color:var(--text2);padding:1rem">⏳ Loading photos…</div>';
    try {
      const photos = await api.getPhotos(date, studentId);
      grid.innerHTML = photos.map((p, i) => `
        <div class="pv-item">
          <img src="${p.photo_data}" alt="Photo ${i + 1}" />
          <div class="pv-info">
            <strong>Photo ${i + 1}</strong> \u00b7 ${fmtTime(p.captured_at)}
            ${p.location_address ? `<div class="pv-loc" style="color:var(--text);font-weight:600">📍 ${p.location_address}</div>` : ''}
            <div class="pv-loc">${(p.location_lat && p.location_lat !== 'None')
          ? `🌐 ${p.location_lat}, ${p.location_lng} (\u00b1${p.location_accuracy}m)`
          : '📍 Location not available'}</div>
          </div>
        </div>`).join('');

      timeline.innerHTML = `
        <h4 style="font-size:.85rem;font-weight:600;color:var(--text2);margin-bottom:.4rem">📍 Location per Photo</h4>
        ${photos.map((p, i) => `
          <div class="lt-item">
            <div class="lt-num">${i + 1}</div>
            <div class="lt-body">
              ${p.location_address ? `<div class="lt-coords">📍 ${p.location_address}</div>` : ''}
              <div class="lt-coords" style="font-size:.74rem;color:var(--text2)">${(p.location_lat && p.location_lat !== 'None')
          ? `🌐 ${p.location_lat}\u00b0 N, ${p.location_lng}\u00b0 E (\u00b1${p.location_accuracy}m)`
          : 'Location unavailable'}</div>
              <div class="lt-time">Captured at ${fmtTime(p.captured_at)}</div>
            </div>
          </div>`).join('')}`;
    } catch (err) {
      grid.innerHTML = `<div style="color:var(--danger);padding:1rem">Error: ${err.message}</div>`;
    }
  }
}

// ─── VERIFY / ABSENT (staff actions) ───────────────────────────
async function doVerify(studentId) {
  const date = getSelectedDate();
  try {
    await api.verify(date, studentId);
    toast(`✅ Attendance verified`, 'success');
    await staffRefresh();
  } catch (err) { toast(err.message, 'error'); }
}
async function doApprove(studentId, status) {
  const date = getSelectedDate();
  try {
    await api.approve(date, studentId, status);
    toast(`✅ Application approved as ${status.toUpperCase()}`, 'success');
    await staffRefresh();
  } catch (err) { toast(err.message, 'error'); }
}
async function doAbsent(studentId) {
  const date = getSelectedDate();
  try {
    await api.markAbsent(date, studentId, '');
    toast(`❌ Marked absent`, 'error');
    await staffRefresh();
  } catch (err) { toast(err.message, 'error'); }
}
async function verifyOD() {
  if (State.viewingStudentId) await doApprove(State.viewingStudentId, 'od');
  closeModal('view-photos-modal');
}
async function verifyAbsent() {
  if (State.viewingStudentId) await doApprove(State.viewingStudentId, 'absent');
  closeModal('view-photos-modal');
}
function downloadDocument(studentId) {
  const date = getSelectedDate();
  const rec = State.attendance[date] && State.attendance[date][studentId];
  if (rec && rec.document_data) {
    const a = document.createElement('a');
    a.href = rec.document_data;
    a.download = rec.document_name || 'document';
    a.click();
  } else {
    toast('No document available', 'warning');
  }
}
async function verifyAttendance() {
  if (State.viewingStudentId) await doVerify(State.viewingStudentId);
  closeModal('view-photos-modal');
}
async function rejectAttendance() {
  if (State.viewingStudentId) await doAbsent(State.viewingStudentId);
  closeModal('view-photos-modal');
}

// ─── RECORDS TABLE ────────────────────────
function renderRecords() {
  const date = getSelectedDate();
  const att = getAtt(date);
  const filter = document.getElementById('t-filter-status')?.value || '';
  const tbody = document.getElementById('t-records-body');
  const rows = State.students.map((s, i) => {
    const rec = att[s.id];
    const status = rec?.status || 'pending';
    if (filter && status !== filter) return '';
    const [c1, c2] = color(i);
    const badge = {
      present: `<span class="badge badge-present">✅ Present</span>`,
      od:      `<span class="badge badge-od">📄 On Duty</span>`,
      absent:  `<span class="badge badge-absent">❌ Absent</span>`,
      pending: `<span class="badge badge-pending">⏳ Pending</span>`
    }[status] || `<span class="badge badge-pending">⏳ Pending</span>`;
    const loc = (rec?.location_lat && rec.location_lat !== 'None')
      ? (rec.location_address
        ? `<span title="${rec.location_lat}, ${rec.location_lng}">${rec.location_address.split(',').slice(0, 2).join(',')}</span>`
        : `${rec.location_lat}, ${rec.location_lng}`)
      : '\u2014';
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:.5rem">
          <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,${c1},${c2});
            display:flex;align-items:center;justify-content:center;font-size:.66rem;font-weight:800;color:#fff;flex-shrink:0">
            ${ini(s.name)}
          </div>${s.name}
        </div>
      </td>
      <td>${s.roll}</td><td>${s.cls}</td>
      <td>${badge}</td>
      <td>${rec?.photos_count || 0}/${REQUIRED_PHOTOS}</td>
      <td style="font-size:.77rem;color:var(--text2)">${loc}</td>
      <td style="color:var(--text2)">${rec?.reason || '—'}</td>
      <td style="color:var(--text2)">${rec?.submitted_at ? fmtTime(rec.submitted_at) : '—'}</td>
      <td>${rec?.verified ? `<span class="badge badge-verified">🔵 Yes</span>` : '<span style="color:var(--text3);font-size:.78rem">No</span>'}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join('') || `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text3)">No records</td></tr>`;
}

// ─── MANAGE STUDENTS ──────────────────────
async function renderManageStudents() {
  const q = (document.getElementById('t-search-students')?.value || '').toLowerCase();
  const tbody = document.getElementById('t-students-body');
  const list = State.students.filter(s => !q || s.name.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q));
  tbody.innerHTML = list.map((s, i) => {
    const [c1, c2] = color(i);
    return `<tr>
      <td><span class="badge" style="background:rgba(108,99,255,.1);color:var(--student2)">${s.roll}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:.55rem">
          <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,${c1},${c2});
            display:flex;align-items:center;justify-content:center;font-size:.66rem;font-weight:800;color:#fff;flex-shrink:0">
            ${ini(s.name)}
          </div>${s.name}
        </div>
      </td>
      <td>${s.cls}</td>
      <td style="color:var(--text2)">${s.contact || '—'}</td>
      <td style="color:var(--text3);font-size:.8rem">${s.password}</td>
      <td style="color:#22c55e;font-weight:700">${s.totalPresent || 0}</td>
      <td style="color:#ef4444;font-weight:700">${s.totalAbsent || 0}</td>
      <td>
        <button class="action-icon" title="Edit" onclick="openEditModal('${s.id}')">✏️</button>
        <button class="action-icon" title="Delete" onclick="deleteStudent('${s.id}')">🗑️</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text3)">No students</td></tr>`;
}

function openAddModal() { document.getElementById('add-student-modal').classList.remove('hidden'); }

async function addStudent() {
  const name = document.getElementById('a-name').value.trim();
  const roll = document.getElementById('a-roll').value.trim();
  const cls = document.getElementById('a-class').value;
  const contact = document.getElementById('a-contact').value.trim();
  const pass = document.getElementById('a-pass').value || 'student123';
  if (!name || !roll) { toast('Name and Roll Number are required', 'warning'); return; }
  try {
    await api.addStudent({ name, roll, cls, contact, password: pass });
    await loadStudents();
    closeModal('add-student-modal');
    ['a-name', 'a-roll', 'a-contact', 'a-pass'].forEach(id => document.getElementById(id).value = '');
    await renderManageStudents();
    toast(`${name} added!`, 'success');
  } catch (err) { toast(err.message || 'Failed to add student', 'error'); }
}

function openEditModal(id) {
  const s = State.students.find(x => x.id === id);
  if (!s) return;
  document.getElementById('e-id').value = s.id;
  document.getElementById('e-name').value = s.name;
  document.getElementById('e-roll').value = s.roll;
  document.getElementById('e-class').value = s.cls || 'CSE-A';
  document.getElementById('e-contact').value = s.contact || '';
  document.getElementById('e-pass').value = '';
  document.getElementById('edit-student-modal').classList.remove('hidden');
}

async function saveStudentEdit() {
  const id = document.getElementById('e-id').value;
  const name = document.getElementById('e-name').value.trim();
  const roll = document.getElementById('e-roll').value.trim();
  const cls = document.getElementById('e-class').value;
  const contact = document.getElementById('e-contact').value.trim();
  const pass = document.getElementById('e-pass').value;
  if (!name || !roll) { toast('Name and Roll Number are required', 'warning'); return; }
  try {
    await api.updateStudent(id, { name, roll, cls, contact, password: pass });
    await loadStudents();
    closeModal('edit-student-modal');
    await renderManageStudents();
    toast(`${name} updated!`, 'success');
  } catch (err) { toast(err.message || 'Failed to update student', 'error'); }
}

async function deleteStudent(id) {
  if (!confirm('Remove this student? All their attendance records will remain.')) return;
  try {
    await api.deleteStudent(id);
    await loadStudents();
    await renderManageStudents();
    toast('Student removed', 'info');
  } catch (err) { toast(err.message, 'error'); }
}

// ─── EXPORT CSV ───────────────────────────
async function exportCSV() {
  const date = getSelectedDate();
  const att = getAtt(date);
  const rows = [['Roll No.', 'Name', 'Class', 'Status', 'Photos', 'Location', 'Reason', 'Time', 'Verified']];
  State.students.forEach(s => {
    const rec = att[s.id];
    const loc = (rec?.location_lat && rec.location_lat !== 'None')
      ? `${rec.location_lat}, ${rec.location_lng}` : '';
    rows.push([
      s.roll, s.name, s.cls,
      rec?.status || 'pending',
      rec?.photos_count || 0,
      loc,
      rec?.reason || '',
      rec?.submitted_at ? fmtTime(rec.submitted_at) : '',
      rec?.verified ? 'Yes' : 'No'
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `attendance_${date}.csv`;
  a.click();
  toast('CSV exported!', 'success');
}

// ─── MODALS ───────────────────────────────
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
});

// ─── KEYBOARD ─────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
  }
  if (e.key === ' ' && State.currentUser?.type === 'student' && !e.target.matches('input,textarea,button')) {
    e.preventDefault(); captureStudentPhoto();
  }
});

// ─── TOAST ────────────────────────────────
function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.animation = 'toastIn .3s ease reverse'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ─── Add button IDs to login forms ────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  // patch submit button IDs for loadingBtn()
  const sf = document.querySelector('#page-student-login button[type=submit]');
  if (sf) sf.id = 's-submit-btn';
  const tf = document.querySelector('#page-staff-login button[type=submit]');
  if (tf) tf.id = 't-submit-btn';
});

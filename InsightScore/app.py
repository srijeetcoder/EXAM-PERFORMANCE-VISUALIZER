import os
import json
import random
import string
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.utils import secure_filename
from fpdf import FPDF
from flask_mail import Mail, Message
# --- NEW IMPORT ---
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.secret_key = 'dev_secret_key_123'

# --- EMAIL CONFIG ---
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 465
app.config['MAIL_USE_SSL'] = True
app.config['MAIL_USE_TLS'] = False
app.config['MAIL_USERNAME'] = 'insightscore2025@gmail.com'  # <--- YOUR EMAIL
app.config['MAIL_PASSWORD'] = 'ofrw kecz wert slfx'     # <--- YOUR APP PASSWORD

mail = Mail(app)

# --- PATH CONFIGURATION ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
DATA_FILE = os.path.join(BASE_DIR, 'exams_data.json') # We still use this for exams

# --- NEW DATABASE CONFIG ---
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{os.path.join(BASE_DIR, "users.db")}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- ADD THIS LINE ---
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER  # Register the path with the Flask app

# --- NEW USER MODEL (Replaces users.xlsx structure) ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)
    phone = db.Column(db.String(20))
    name = db.Column(db.String(120))
    profile_pic = db.Column(db.String(255))

# --- JSON/EXAM HELPERS (Unchanged) ---
def load_exams():
    if not os.path.exists(DATA_FILE): return []
    try:
        with open(DATA_FILE, 'r') as f: return json.load(f)
    except: return []

def save_exams(data):
    with open(DATA_FILE, 'w') as f: json.dump(data, f, indent=4)

def generate_otp():
    return ''.join(random.choices(string.digits, k=6))

# --- ROUTES (Modified for SQL) ---
@app.route('/')
def home():
    if 'user' in session: return redirect(url_for('dashboard'))
    return render_template('login.html')

@app.route('/dashboard')
def dashboard():
    if 'user' not in session: return redirect(url_for('home'))

    user_email = str(session['user']).strip().lower()
    user = User.query.filter_by(email=user_email).first()

    if not user:
        session.pop('user', None)
        return redirect(url_for('home'))

    pic = str(user.profile_pic)
    import time
    timestamp = int(time.time())

    if pic and pic != 'nan' and pic != 'None' and pic != '':
        pic_url = url_for('static', filename='uploads/' + pic) + f"?t={timestamp}"
    else:
        pic_url = f"https://ui-avatars.com/api/?name={user.name}&background=random"

    return render_template('index.html', user={
        'name': user.name,
        'email': user.email,
        'pic_url': pic_url
    })

# --- AUTH APIs (Modified for SQL) ---
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    email = str(data['email']).strip().lower()

    existing_user = User.query.filter_by(email=email).first()
    if existing_user:
        return jsonify({'status': 'error', 'message': 'Email already registered'})

    new_user = User(
        email=email,
        password=str(data['password']),
        phone=str(data['phone']),
        name=str(data['name']),
        profile_pic=''
    )

    db.session.add(new_user)
    db.session.commit()

    return jsonify({'status': 'success'})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    email = str(data['email']).strip().lower()
    password = str(data['password'])

    user = User.query.filter_by(email=email).first()

    if user and user.password == password:
        session['user'] = user.email
        return jsonify({'status': 'success'})

    return jsonify({'status': 'error', 'message': 'Invalid credentials'})

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    email = str(request.json.get('email')).strip().lower()
    user = User.query.filter_by(email=email).first()

    if user:
        otp = generate_otp()
        session['otp'] = otp
        session['otp_email'] = user.email
        try:
            msg = Message("InsightScore Password Reset", sender=app.config['MAIL_USERNAME'], recipients=[email])
            msg.body = f"Your OTP is: {otp}"
            mail.send(msg)
            return jsonify({'status': 'success', 'message': 'OTP sent!'})
        except Exception as e:
            return jsonify({'status': 'error', 'message': 'Email failed'})

    return jsonify({'status': 'error', 'message': 'Email not found'})

@app.route('/api/verify-otp', methods=['POST'])
def verify_otp():
    data = request.json
    if 'otp' in session and str(data['otp']).strip() == str(session['otp']):
        session['user'] = session['otp_email']
        session.pop('otp', None)
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error', 'message': 'Invalid OTP'})

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('home'))

# --- APP APIs (Modified for SQL) ---
@app.route('/api/upload-pic', methods=['POST'])
def upload_pic():
    if 'user' not in session: return jsonify({'status': 'error', 'message': 'Login required'}), 403

    file = request.files.get('file')
    if not file or file.filename == '':
        return jsonify({'status': 'error', 'message': 'No file selected'})

    try:
        if not os.path.exists(app.config['UPLOAD_FOLDER']):
            os.makedirs(app.config['UPLOAD_FOLDER'])

        filename = secure_filename(f"{session['user']}_{file.filename}")
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        user_email = session['user'].strip().lower()
        user = User.query.filter_by(email=user_email).first()

        if user:
            user.profile_pic = filename
            db.session.commit()
            return jsonify({'status': 'success', 'filename': filename})
        else:
            return jsonify({'status': 'error', 'message': 'User not found in DB'})

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

# --- EXAM APIs (Unchanged, still uses JSON) ---
@app.route('/api/exams', methods=['GET', 'POST'])
def handle_exams():
    if 'user' not in session: return jsonify([]), 403
    all_exams = load_exams()
    user_email = str(session['user']).strip().lower()
    if request.method == 'GET': return jsonify([e for e in all_exams if str(e.get('user_email')) == user_email])
    if request.method == 'POST':
        new_data = request.json
        other_exams = [e for e in all_exams if str(e.get('user_email')) != user_email]
        for exam in new_data: exam['user_email'] = user_email
        save_exams(other_exams + new_data)
        return jsonify({"status": "success"})

@app.route('/api/send-report', methods=['POST'])
def send_report():
    if 'user' not in session: return jsonify({'status': 'error'}), 403
    data = request.json
    target_email = data.get('email', session['user'])

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=16)
    pdf.cell(200, 10, txt=f"Report: {session['user']}", ln=1, align='C')
    pdf.ln(10)
    pdf.set_font("Arial", size=12)
    pdf.cell(0, 10, f"Total Exams: {data.get('totalExams')}", ln=1)
    pdf.cell(0, 10, f"Avg Score: {data.get('avgScore')}", ln=1)
    pdf.ln(10)
    pdf.set_font("Arial", 'B', size=12)
    pdf.cell(0, 10, "Weak Topics:", ln=1)
    pdf.set_font("Arial", size=11)
    for w in data.get('weaknesses', []):
        pdf.cell(0, 10, f"- {w['topic']} ({w['errorPercentage']}%)", ln=1)

    filename = f"report_{session['user']}.pdf"
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    pdf.output(file_path)

    try:
        msg = Message("InsightScore Report", sender=app.config['MAIL_USERNAME'], recipients=[target_email])
        msg.body = "Attached is your report."
        with open(file_path, 'rb') as fp:
            msg.attach(filename, "application/pdf", fp.read())
        mail.send(msg)
        return jsonify({'status': 'success', 'message': f'Sent to {target_email}'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

# --- This block creates the DB automatically ---
def setup_database(app):
    """Creates database tables if they don't exist."""
    with app.app_context():
        db.create_all()

# --- This runs when you type 'python app.py' ---
if __name__ == '__main__':
    setup_database(app) # Create DB tables
    app.run(debug=True, port=5000)

# --- This runs on PythonAnywhere ---
else:
    setup_database(app) # Create DB tables

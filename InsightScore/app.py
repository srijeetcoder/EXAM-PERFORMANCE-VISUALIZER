import os
import json
import pandas as pd
import random
import string
import sys
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.utils import secure_filename
from fpdf import FPDF
from flask_mail import Mail, Message

app = Flask(__name__)
app.secret_key = 'dev_secret_key_123'

# --- EMAIL CONFIG ---
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 465
app.config['MAIL_USE_SSL'] = True
app.config['MAIL_USE_TLS'] = False
app.config['MAIL_USERNAME'] = 'srijeetchatterjee2008@gmail.com'
app.config['MAIL_PASSWORD'] = 'dpmm excj cftt webe' # <--- RE-PASTE YOUR PASSWORD

mail = Mail(app)

# --- PATH CONFIGURATION ---
# We use absolute paths to ensure the server never gets lost
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
DATA_FILE = os.path.join(BASE_DIR, 'exams_data.json')
USER_DB_FILE = os.path.join(BASE_DIR, 'users.xlsx')

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Ensure upload folder exists immediately
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# --- HELPERS ---
def get_users_df():
    if not os.path.exists(USER_DB_FILE):
        df = pd.DataFrame(columns=['email', 'password', 'phone', 'name', 'profile_pic'])
        df.to_excel(USER_DB_FILE, index=False)

    df = pd.read_excel(USER_DB_FILE)
    # Standardize email to avoid mismatches
    df['email'] = df['email'].astype(str).str.strip().str.lower()
    return df

def save_users_df(df):
    df.to_excel(USER_DB_FILE, index=False)

def load_exams():
    if not os.path.exists(DATA_FILE): return []
    try:
        with open(DATA_FILE, 'r') as f: return json.load(f)
    except: return []

def save_exams(data):
    with open(DATA_FILE, 'w') as f: json.dump(data, f, indent=4)

def generate_otp():
    return ''.join(random.choices(string.digits, k=6))

# --- NEW DIAGNOSTIC ROUTE ---
@app.route('/debug')
def debug_page():
    """Shows the internal state of the server to help fix issues."""
    try:
        files_in_upload = os.listdir(UPLOAD_FOLDER)
    except Exception as e:
        files_in_upload = f"Error accessing folder: {e}"

    df = get_users_df()
    users_html = df.to_html(classes='table', index=False)

    current_user = session.get('user', 'Not Logged In')

    folder_status = "Writable" if os.access(UPLOAD_FOLDER, os.W_OK) else "NOT WRITABLE (Permission Error)"

    return f"""
    <html>
    <head><title>InsightScore Debugger</title></head>
    <body style="font-family: monospace; padding: 20px; background: #f0f0f0;">
        <h1>🔧 System Diagnostics</h1>
        <hr>
        <h3>1. Paths</h3>
        <p><b>Base Directory:</b> {BASE_DIR}</p>
        <p><b>Uploads Folder:</b> {UPLOAD_FOLDER} <span style="color:blue">[{folder_status}]</span></p>
        <p><b>Files in Uploads:</b> {files_in_upload}</p>
        <hr>
        <h3>2. Session Info</h3>
        <p><b>Logged in as:</b> {current_user}</p>
        <hr>
        <h3>3. Database Content (users.xlsx)</h3>
        {users_html}
        <br>
        <a href="/dashboard">Go Back to Dashboard</a>
    </body>
    </html>
    """

# --- ROUTES ---
@app.route('/')
def home():
    if 'user' in session: return redirect(url_for('dashboard'))
    return render_template('login.html')

@app.route('/dashboard')
def dashboard():
    if 'user' not in session: return redirect(url_for('home'))

    df = get_users_df()
    user_email = str(session['user']).strip().lower()
    user_row = df[df['email'] == user_email]

    if user_row.empty:
        session.pop('user', None)
        return redirect(url_for('home'))

    user_row = user_row.iloc[0]

    pic = str(user_row['profile_pic'])

    # Force browser to ignore cache by adding a timestamp
    import time
    timestamp = int(time.time())

    if pic and pic != 'nan' and pic != 'None' and pic != '':
        pic_url = url_for('static', filename='uploads/' + pic) + f"?t={timestamp}"
    else:
        pic_url = f"https://ui-avatars.com/api/?name={user_row['name']}&background=random"

    return render_template('index.html', user={
        'name': user_row['name'],
        'email': user_row['email'],
        'pic_url': pic_url
    })

# --- AUTH APIs ---
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    df = get_users_df()
    email = str(data['email']).strip().lower()

    if email in df['email'].values:
        return jsonify({'status': 'error', 'message': 'Email already registered'})

    new_user = pd.DataFrame([{
        'email': email,
        'password': str(data['password']),
        'phone': str(data['phone']),
        'name': str(data['name']),
        'profile_pic': ''
    }])

    df = pd.concat([df, new_user], ignore_index=True)
    save_users_df(df)
    return jsonify({'status': 'success'})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    df = get_users_df()
    email = str(data['email']).strip().lower()
    user = df[(df['email'] == email) & (df['password'].astype(str) == str(data['password']))]

    if not user.empty:
        session['user'] = email
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error', 'message': 'Invalid credentials'})

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    email = str(request.json.get('email')).strip().lower()
    df = get_users_df()
    if email in df['email'].values:
        otp = generate_otp()
        session['otp'] = otp
        session['otp_email'] = email
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

# --- UPLOAD API (ROBUST) ---
@app.route('/api/upload-pic', methods=['POST'])
def upload_pic():
    if 'user' not in session: return jsonify({'status': 'error', 'message': 'Login required'}), 403

    file = request.files.get('file')
    if not file or file.filename == '':
        return jsonify({'status': 'error', 'message': 'No file selected'})

    try:
        # 1. Save File
        filename = secure_filename(f"{session['user']}_{file.filename}")
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        # 2. Update DB
        df = get_users_df()
        user_email = session['user']

        if user_email in df['email'].values:
            df.loc[df['email'] == user_email, 'profile_pic'] = filename
            save_users_df(df)
            return jsonify({'status': 'success', 'filename': filename})
        else:
            return jsonify({'status': 'error', 'message': 'User not found in DB'})

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/exams', methods=['GET', 'POST'])
def handle_exams():
    if 'user' not in session: return jsonify([]), 403
    all_exams = load_exams()
    user_email = str(session['user'])
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

if __name__ == '__main__':
    app.run(debug=True, port=5000)

import os
import json
import pandas as pd
import random
import string
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.utils import secure_filename
from fpdf import FPDF
# 1. Import Flask-Mail
from flask_mail import Mail, Message 

app = Flask(__name__)
app.secret_key = 'dev_secret_key_123'

# ========================================================
#  EMAIL CONFIGURATION (GMAIL EXAMPLE)
# ========================================================
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 465
app.config['MAIL_USE_SSL'] = True
app.config['MAIL_USE_TLS'] = False

# ---> ENTER YOUR DETAILS HERE <---
app.config['MAIL_USERNAME'] = 'srijeetchatterjee2008@gmail.com' 
app.config['MAIL_PASSWORD'] = 'dpmm excj cftt webe'     
# ========================================================

mail = Mail(app)

# --- CONFIG ---
UPLOAD_FOLDER = 'static/uploads'
DATA_FILE = 'exams_data.json'
USER_DB_FILE = 'users.xlsx'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# --- EXCEL DATABASE HELPERS ---
def get_users_df():
    if not os.path.exists(USER_DB_FILE):
        df = pd.DataFrame(columns=['email', 'password', 'phone', 'name', 'profile_pic'])
        df.to_excel(USER_DB_FILE, index=False)
    return pd.read_excel(USER_DB_FILE).astype(str)

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

# --- ROUTES ---
@app.route('/')
def home():
    if 'user' in session: return redirect(url_for('dashboard'))
    return render_template('login.html')

@app.route('/dashboard')
def dashboard():
    if 'user' not in session: return redirect(url_for('home'))
    
    df = get_users_df()
    user_row = df[df['email'] == str(session['user'])]
    
    if user_row.empty:
        session.pop('user', None)
        return redirect(url_for('home'))
        
    user_row = user_row.iloc[0]
    pic = user_row['profile_pic']
    # Fix for handling NaN/None profile pic strings from pandas
    pic_url = url_for('static', filename='uploads/' + pic) if pic and pic != 'nan' else f"https://ui-avatars.com/api/?name={user_row['name']}&background=random"

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
    
    if str(data['email']) in df['email'].values:
        return jsonify({'status': 'error', 'message': 'Email already registered'})
    
    new_user = pd.DataFrame([{
        'email': str(data['email']),
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
    user = df[(df['email'] == str(data['email'])) & (df['password'] == str(data['password']))]
    
    if not user.empty:
        session['user'] = str(data['email'])
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error', 'message': 'Invalid credentials'})

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    email = str(request.json.get('email'))
    df = get_users_df()
    
    if email in df['email'].values:
        otp = generate_otp()
        session['otp'] = otp
        session['otp_email'] = email
        
        try:
            msg = Message("InsightScore Password Reset",
                          sender=app.config['MAIL_USERNAME'],
                          recipients=[email])
            msg.body = f"Your OTP is: {otp}"
            mail.send(msg)
            return jsonify({'status': 'success', 'message': 'OTP sent to your email!'})
        except Exception as e:
            print(f"Email Error: {e}")
            return jsonify({'status': 'error', 'message': 'Failed to send email. Check console.'})
            
    return jsonify({'status': 'error', 'message': 'Email not found'})

@app.route('/api/verify-otp', methods=['POST'])
def verify_otp():
    data = request.json
    if 'otp' in session and str(data['otp']) == str(session['otp']):
        session['user'] = session['otp_email']
        session.pop('otp', None)
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error', 'message': 'Invalid OTP'})

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('home'))

# --- APP APIs ---
@app.route('/api/upload-pic', methods=['POST'])
def upload_pic():
    if 'user' not in session: return jsonify({'status': 'error'}), 403
    file = request.files['file']
    if file:
        filename = secure_filename(f"{session['user']}_{file.filename}")
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        
        df = get_users_df()
        df.loc[df['email'] == str(session['user']), 'profile_pic'] = filename
        save_users_df(df)
        return jsonify({'status': 'success', 'filename': filename})
    return jsonify({'status': 'error'})

@app.route('/api/exams', methods=['GET', 'POST'])
def handle_exams():
    if 'user' not in session: return jsonify([]), 403
    all_exams = load_exams()
    user_email = str(session['user'])
    
    if request.method == 'GET':
        return jsonify([e for e in all_exams if e.get('user_email') == user_email])
        
    if request.method == 'POST':
        new_data = request.json
        other_exams = [e for e in all_exams if e.get('user_email') != user_email]
        for exam in new_data: exam['user_email'] = user_email
        save_exams(other_exams + new_data)
        return jsonify({"status": "success"})

@app.route('/api/send-report', methods=['POST'])
def send_report():
    if 'user' not in session: return jsonify({'status': 'error'}), 403
    data = request.json
    
    # 1. Get the email from the frontend request (or default to session email)
    target_email = data.get('email', session['user'])
    
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=16)
    pdf.cell(200, 10, txt=f"Performance Overview: {session['user']}", ln=1, align='C')
    pdf.ln(10)
    
    pdf.set_font("Arial", size=12)
    pdf.cell(0, 10, f"Total Exams: {data.get('totalExams')}", ln=1)
    pdf.cell(0, 10, f"Average Score: {data.get('avgScore')}", ln=1)
    pdf.ln(10)
    
    pdf.set_font("Arial", 'B', size=12)
    pdf.cell(0, 10, "Weak Topics:", ln=1)
    pdf.set_font("Arial", size=11)
    for w in data.get('weaknesses', []):
        pdf.cell(0, 10, f"- {w['topic']} ({w['errorPercentage']}%)", ln=1)
        
    filename = f"report_{session['user']}.pdf"
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    pdf.output(file_path)
    
    # 2. Send the Email
    try:
        msg = Message("Your InsightScore Report",
                      sender=app.config['MAIL_USERNAME'],
                      recipients=[target_email])
        msg.body = f"Hello,\n\nPlease find attached your performance report for account: {session['user']}.\n\nBest,\nInsightScore Team"
        
        with app.open_resource(file_path) as fp:
            msg.attach(filename, "application/pdf", fp.read())
            
        mail.send(msg)
        return jsonify({'status': 'success', 'message': f'Report sent successfully to {target_email}'})
    
    except Exception as e:
        print(f"Mail Error: {e}")
        return jsonify({'status': 'error', 'message': f'Failed to send email: {str(e)}'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)

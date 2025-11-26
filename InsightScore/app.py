import os
import json
import random
import string
import time # For unique chart filenames
import shutil # For deleting temp chart folder
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.utils import secure_filename
from fpdf import FPDF
from flask_mail import Mail, Message 

# --- DATABASE IMPORTS ---
from flask_sqlalchemy import SQLAlchemy

# --- CHARTING IMPORTS ---
import matplotlib
matplotlib.use('Agg') # CRITICAL: Use non-interactive backend for server
import matplotlib.pyplot as plt

app = Flask(__name__)
app.secret_key = 'dev_secret_key_123'

# --- EMAIL CONFIGURATION (ENTER YOUR DETAILS HERE) ---
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 465
app.config['MAIL_USE_SSL'] = True
app.config['MAIL_USE_TLS'] = False
app.config['MAIL_USERNAME'] = 'insightscore2025@gmail.com'  # <--- YOUR EMAIL
app.config['MAIL_PASSWORD'] = 'ofrw kecz wert slfx'     # <--- YOUR APP PASSWORD
# -----------------------------------------------------

mail = Mail(app)

# --- PATH CONFIGURATION ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
DATA_FILE = os.path.join(BASE_DIR, 'exams_data.json') # For exams
CHART_FOLDER = os.path.join(BASE_DIR, 'static', 'charts') # For temp charts

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(CHART_FOLDER, exist_ok=True)

# --- NEW SQLITE DATABASE CONFIG ---
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{os.path.join(BASE_DIR, "users.db")}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- NEW USER DATABASE MODEL ---
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


# -----------------------------------------------
# --- UPDATED PDF CLASS FOR "WEBSITE MIRROR" ---
# -----------------------------------------------
class PDF(FPDF):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # --- DARK MODE COLORS (RGB) ---
        self.page_bg = (15, 23, 42) # slate-900
        self.cell_bg = (30, 41, 59) # slate-800
        self.border_color = (51, 65, 85) # slate-700
        self.text_color_primary = (226, 232, 240) # slate-200
        self.text_color_secondary = (148, 163, 184) # slate-400
        
        # Chart colors (for matplotlib)
        self.chart_colors_hex = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899']
        self.red_color_hex = '#ef4444'
        self.green_color_hex = '#22c55e'
        self.blue_color_hex = '#3b82f6'
        self.purple_color_hex = '#a855f7'
        
        # FPDF text colors (for tables)
        self.red_text = (248, 113, 113) # red-400
        self.green_text = (74, 222, 128) # green-400
        self.amber_text = (251, 191, 36) # amber-400
        self.purple_text = (168, 85, 247) # purple-500

    def add_page(self, orientation=''):
        super().add_page(orientation)
        # --- ADD DARK BACKGROUND ---
        self.set_fill_color(*self.page_bg)
        self.rect(0, 0, self.w, self.h, 'F')
        self.set_text_color(*self.text_color_primary)

    def header(self):
        self.set_font('Arial', 'B', 12)
        self.set_text_color(*self.text_color_primary)
        self.cell(0, 10, 'InsightScore Performance Report', 0, 0, 'C')
        self.ln(10)

    def footer(self):
        self.set_y(-15)
        self.set_font('Arial', 'I', 8)
        self.set_text_color(*self.text_color_secondary)
        self.cell(0, 10, 'Page ' + str(self.page_no()) + '/{nb}', 0, 0, 'C')

    def chapter_title(self, title):
        self.set_font('Arial', 'B', 16)
        self.set_fill_color(*self.cell_bg)
        self.set_text_color(255, 255, 255) # White
        self.set_draw_color(*self.border_color)
        self.cell(0, 12, title, 1, 1, 'L', True)
        self.ln(5)

    def section_title(self, title):
        self.set_font('Arial', 'B', 12)
        self.set_text_color(*self.purple_text) # Purple
        self.cell(0, 8, title, 0, 1, 'L')
        self.set_text_color(*self.text_color_primary)
        self.ln(2)

    def draw_table(self, header, data, col_widths):
        self.set_font('Arial', 'B', 9)
        self.set_fill_color(51, 65, 85) # slate-700
        self.set_draw_color(*self.border_color)
        self.set_text_color(*self.text_color_primary)
        for i, header_title in enumerate(header):
            self.cell(col_widths[i], 7, header_title, 1, 0, 'C', True)
        self.ln()
        
        self.set_font('Arial', '', 9)
        self.set_fill_color(*self.cell_bg)
        
        fill = False
        for row in data:
            self.set_text_color(*self.text_color_secondary)
            for i, item in enumerate(row):
                # Set text color for percentages
                if '%' in str(item):
                    try:
                        val = float(str(item).replace('%',''))
                        if 'Error' in header[i] or 'Weak' in header[i]:
                            if val > 40: self.set_text_color(*self.red_text)
                            elif val > 15: self.set_text_color(*self.amber_text)
                            else: self.set_text_color(*self.green_text)
                        else: # Score percentage
                            if val < 50: self.set_text_color(*self.red_text)
                            elif val < 75: self.set_text_color(*self.amber_text)
                            else: self.set_text_color(*self.green_text)
                    except ValueError:
                        pass
                
                align = 'C' if i > 0 else 'L'
                self.cell(col_widths[i], 6, str(item), 1, 0, align, fill)
                
                self.set_text_color(*self.text_color_secondary) # Reset color
            
            self.ln()
            fill = not fill # alternate row color
        self.ln(5)

# --- MATPLOTLIB CHARTING FUNCTIONS ---
# These functions create charts and save them as images

plt.style.use('dark_background') # This is perfect, it makes text white
CHART_DPI = 150

def create_line_chart(labels, data, title, file_path, color):
    try:
        if not labels or not data: return
        fig, ax = plt.subplots(figsize=(8, 4), dpi=CHART_DPI)
        ax.plot(labels, data, color=color, marker='o', linewidth=2, markersize=5)
        ax.set_title(title, color='white', fontsize=12, pad=15)
        ax.set_ylabel('Score %', color='white')
        ax.set_ylim(0, 105)
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.tick_params(axis='x', colors='white', labelrotation=15, labelsize='small')
        ax.tick_params(axis='y', colors='white')
        ax.grid(color='#404040', linestyle='--', linewidth=0.5, axis='y')
        # --- KEY CHANGE: SAVE WITH TRANSPARENT BACKGROUND ---
        fig.savefig(file_path, transparent=True, bbox_inches='tight')
        plt.close(fig)
    except Exception as e:
        print(f"Error creating line chart: {e}")

def create_doughnut_chart(labels, sizes, title, file_path, colors):
    try:
        if not any(s > 0 for s in sizes): return # Don't plot if all data is zero
        fig, ax = plt.subplots(figsize=(5, 4), dpi=CHART_DPI)
        wedges, texts, autotexts = ax.pie(
            sizes, labels=None, autopct='%1.1f%%', startangle=90,
            colors=colors, pctdistance=0.85,
            # This 'width' creates the doughnut hole
            wedgeprops=dict(width=0.4, edgecolor='none') 
        )
        plt.setp(autotexts, size=8, weight="bold", color="white")
        ax.set_title(title, color='white', fontsize=12, pad=15)
        
        ax.legend(wedges, labels,
                  title="Legend",
                  loc="center left",
                  bbox_to_anchor=(1.1, 0, 0.5, 1),
                  labelcolor='white',
                  fontsize='small')
        
        # --- KEY CHANGE: SAVE WITH TRANSPARENT BACKGROUND ---
        fig.savefig(file_path, transparent=True, bbox_inches='tight')
        plt.close(fig)
    except Exception as e:
        print(f"Error creating pie chart: {e}")

def create_bar_chart(labels, values, title, file_path, color):
    try:
        if not labels or not values: return
        fig, ax = plt.subplots(figsize=(8, 4), dpi=CHART_DPI)
        ax.bar(labels, values, color=color, width=0.6,
               edgecolor='none',
               linewidth=0)
        ax.set_title(title, color='white', fontsize=12, pad=15)
        ax.set_ylabel('Score %' if '%' in title else 'Count', color='white')
        if '%' in title:
            ax.set_ylim(0, 105)
        
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.tick_params(axis='x', colors='white', labelrotation=15, labelsize='small')
        ax.tick_params(axis='y', colors='white')
        ax.grid(color='#404040', linestyle='--', linewidth=0.5, axis='y')
        # --- KEY CHANGE: SAVE WITH TRANSPARENT BACKGROUND ---
        fig.savefig(file_path, transparent=True, bbox_inches='tight')
        plt.close(fig)
    except Exception as e:
        print(f"Error creating bar chart: {e}")

# --- PYTHON HELPER FUNCTIONS (Re-implementing JS logic) ---

def get_subjects(exams):
    return sorted(list(set(e['subject'] for e in exams if e.get('subject'))))

def get_stats(exams):
    total_exams = len(exams)
    if total_exams == 0:
        return {'total_exams': 0, 'avg_score': 0.0, 'all_topics': [], 'weaknesses': []}
    
    avg_score = (sum((float(e['marksScored']) / float(e['totalMarks'])) for e in exams if float(e['totalMarks']) > 0) / total_exams * 100)
    
    all_topics = []
    for e in exams:
        if e.get('topics'):
            for t in e['topics']:
                total = int(t.get('totalQuestions', 0))
                incorrect = int(t.get('incorrectQuestions', 0))
                if total > 0:
                    all_topics.append({
                        'topic': t.get('name', 'Unknown'),
                        'error_percentage': (incorrect / total * 100),
                        'exam': e.get('name', 'Unknown')
                    })
    
    weaknesses = sorted([t for t in all_topics if t['error_percentage'] > 0], 
                        key=lambda x: x['error_percentage'], 
                        reverse=True)[:5]
    
    return {
        'total_exams': total_exams,
        'avg_score': round(avg_score, 1),
        'all_topics': all_topics,
        'weaknesses': weaknesses
    }

def get_topic_stats(sub_exams):
    topic_stats = {}
    for e in sub_exams:
        if e.get('topics'):
            for t in e['topics']:
                name = t.get('name', 'Unknown')
                if name not in topic_stats:
                    topic_stats[name] = {'total': 0, 'incorrect': 0}
                topic_stats[name]['total'] += int(t.get('totalQuestions', 0))
                topic_stats[name]['incorrect'] += int(t.get('incorrectQuestions', 0))
    
    table_data = []
    for name, stats in topic_stats.items():
        total = stats['total']
        incorrect = stats['incorrect']
        err_rate = (incorrect / total * 100) if total > 0 else 0
        table_data.append([name, total, incorrect, f"{err_rate:.1f}%"])
        
    return topic_stats, table_data


# --- ROUTES ---
@app.route('/')
def home():
    if 'user' in session: return redirect(url_for('dashboard'))
    return render_template('login.html')

@app.route('/dashboard')
def dashboard():
    if 'user' not in session: return redirect(url_for('home'))
    
    # --- SQLITE LOGIC ---
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

# --- AUTH APIs (USING SQLITE) ---
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    email = str(data['email']).strip().lower()
    
    # --- SQLITE LOGIC ---
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
    
    # --- SQLITE LOGIC ---
    user = User.query.filter_by(email=email).first()
    
    if user and user.password == password:
        session['user'] = user.email
        return jsonify({'status': 'success'})
        
    return jsonify({'status': 'error', 'message': 'Invalid credentials'})

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    email = str(request.json.get('email')).strip().lower()
    
    # --- SQLITE LOGIC ---
    user = User.query.filter_by(email=email).first()
    
    if user:
        otp = generate_otp()
        session['otp'] = otp
        session['otp_email'] = user.email
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
    if 'otp' in session and str(data['otp']).strip() == str(session['otp']):
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
        
        # --- SQLITE LOGIC ---
        user = User.query.filter_by(email=str(session['user'])).first()
        if user:
            user.profile_pic = filename
            db.session.commit()
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


# -----------------------------------------------
# --- "WEBSITE MIRROR" PDF ROUTE (Unchanged) ---
# -----------------------------------------------
@app.route('/api/send-report', methods=['POST'])
def send_report():
    if 'user' not in session: return jsonify({'status': 'error'}), 403
    
    data = request.json
    target_email = data.get('email', session['user'])
    user_name = data.get('userName', 'User')
    exams = data.get('exams', [])
    
    if not exams:
        return jsonify({'status': 'error', 'message': 'No exam data to report.'})

    # --- 1. Setup Chart Directory ---
    chart_dir = os.path.join(CHART_FOLDER, f"temp_{session['user'].split('@')[0]}_{int(time.time())}")
    if os.path.exists(chart_dir):
        shutil.rmtree(chart_dir)
    os.makedirs(chart_dir)
    
    pdf = PDF('P', 'mm', 'A4')
    pdf.alias_nb_pages()
    
    try:
        # --- 2. OVERVIEW PAGE ---
        pdf.add_page()
        pdf.chapter_title(f"Overall Performance Overview for {user_name}")
        
        stats = get_stats(exams)
        subjects = get_subjects(exams)
        
        pdf.set_font('Arial', '', 11)
        pdf.set_text_color(*pdf.text_color_primary)
        pdf.cell(0, 7, f"Total Exams Logged: {stats['total_exams']}", 0, 1)
        pdf.cell(0, 7, f"Average Score: {stats['avg_score']}%", 0, 1)
        pdf.cell(0, 7, f"Active Subjects: {len(subjects)}", 0, 1)
        pdf.ln(5)

        # --- Weakest Topics Table ---
        if stats['weaknesses']:
            pdf.section_title("Top Weakest Topics")
            weak_header = ['Topic', 'Exam', 'Error Rate']
            weak_data = [[w['topic'], w['exam'], f"{w['error_percentage']:.1f}%"] for w in stats['weaknesses']]
            pdf.draw_table(weak_header, weak_data, [90, 50, 40])
        
        # --- Overview Charts ---
        pdf.section_title("Performance Trend (All Exams)")
        line_path = os.path.join(chart_dir, 'overview_line.png')
        create_line_chart(
            labels=[e['name'] for e in exams],
            data=[(float(e['marksScored']) / float(e['totalMarks']) * 100) for e in exams if float(e['totalMarks']) > 0],
            title='Overall Score Trend',
            file_path=line_path,
            color=pdf.blue_color_hex
        )
        if os.path.exists(line_path): pdf.image(line_path, w=180)
        
        # --- Average Score by Subject Bar Chart ---
        pdf.ln(5)
        pdf.section_title("Average Score by Subject")
        bar_avg_path = os.path.join(chart_dir, 'overview_bar_avg.png')
        subject_avg_scores = []
        for s in subjects:
            sub_exams = [e for e in exams if e['subject'] == s]
            if sub_exams:
                avg = (sum((float(e['marksScored']) / float(e['totalMarks'])) for e in sub_exams if float(e['totalMarks']) > 0) / len(sub_exams) * 100)
                subject_avg_scores.append(avg)
            else:
                subject_avg_scores.append(0)
        
        create_bar_chart(
            subjects, subject_avg_scores,
            'Average Score / Subject (%)', bar_avg_path, pdf.green_color_hex
        )
        if os.path.exists(bar_avg_path): pdf.image(bar_avg_path, w=180)


        # Pie Charts (side-by-side)
        pdf.add_page() # Move pies to a new page for better layout
        pdf.section_title("Distributions")
        
        pie_exams_path = os.path.join(chart_dir, 'overview_pie_exams.png')
        sub_exam_counts = [len([e for e in exams if e['subject'] == s]) for s in subjects]
        create_doughnut_chart(subjects, sub_exam_counts, 'Exams Distribution', pie_exams_path, pdf.chart_colors_hex)
        if os.path.exists(pie_exams_path): pdf.image(pie_exams_path, x=15, y=pdf.get_y(), w=90)

        pie_errors_path = os.path.join(chart_dir, 'overview_pie_errors.png')
        sub_error_counts = []
        for s in subjects:
            sub_exams = [e for e in exams if e['subject'] == s]
            errors = sum(int(t.get('incorrectQuestions', 0)) for e in sub_exams for t in e.get('topics', []))
            sub_error_counts.append(errors)
        create_doughnut_chart(subjects, sub_error_counts, 'Error Distribution', pie_errors_path, pdf.chart_colors_hex)
        if os.path.exists(pie_errors_path): pdf.image(pie_errors_path, x=105, y=pdf.get_y(), w=90)
        pdf.ln(85) # Move down past pie charts
        
        # --- 3. SUBJECT-SPECIFIC PAGES ---
        for subject in subjects:
            pdf.add_page()
            pdf.chapter_title(f"Subject Analysis: {subject}")
            
            sub_exams = [e for e in exams if e.get('subject') == subject]
            if not sub_exams: continue
            
            sub_stats = get_stats(sub_exams)
            pdf.set_font('Arial', '', 11)
            pdf.set_text_color(*pdf.text_color_primary)
            pdf.cell(0, 7, f"Total Exams: {sub_stats['total_exams']}", 0, 1)
            pdf.cell(0, 7, f"Average Score: {sub_stats['avg_score']}%", 0, 1)
            pdf.ln(5)
            
            # Exam History Table
            pdf.section_title("Exam History")
            table_header = ['Exam Name', 'Score', 'Percentage']
            table_data = []
            for e in sub_exams:
                pct = (float(e['marksScored']) / float(e['totalMarks']) * 100) if float(e['totalMarks']) > 0 else 0
                table_data.append([e['name'], f"{e['marksScored']}/{e['totalMarks']}", f"{pct:.1f}%"])
            pdf.draw_table(table_header, table_data, [100, 40, 40])
            
            # Topic Breakdown Table
            topic_stats, topic_table_data = get_topic_stats(sub_exams)
            if topic_table_data:
                pdf.section_title("Topic Performance Breakdown")
                pdf.draw_table(
                    ['Topic', 'Total Qs', 'Incorrect', 'Error Rate'],
                    topic_table_data,
                    [90, 30, 30, 30]
                )
            
            # Subject Charts
            pdf.add_page()
            pdf.section_title(f"{subject} - Performance Trend")
            sub_line_path = os.path.join(chart_dir, f'sub_{subject}_line.png')
            create_line_chart(
                labels=[e['name'] for e in sub_exams],
                data=[(float(e['marksScored']) / float(e['totalMarks']) * 100) for e in sub_exams if float(e['totalMarks']) > 0],
                title=f'{subject} Score Trend',
                file_path=sub_line_path,
                color=pdf.purple_color_hex
            )
            if os.path.exists(sub_line_path): pdf.image(sub_line_path, w=180)
            
            if topic_stats:
                # --- Subject-Level Error Distribution Doughnut ---
                pdf.ln(5)
                pdf.section_title(f"{subject} - Error Distribution")
                sub_doughnut_path = os.path.join(chart_dir, f'sub_{subject}_doughnut.png')
                topic_labels = list(topic_stats.keys())
                topic_error_counts = [stats['incorrect'] for stats in topic_stats.values()]
                create_doughnut_chart(
                    topic_labels, topic_error_counts,
                    f'{subject} Error Distribution', sub_doughnut_path, pdf.chart_colors_hex
                )
                if os.path.exists(sub_doughnut_path): pdf.image(sub_doughnut_path, w=150, x=30)
                pdf.ln(85) # Move down past chart

                # --- Subject-Level Weakest Topics Bar Chart ---
                pdf.section_title(f"{subject} - Weakest Topics")
                sub_bar_path = os.path.join(chart_dir, f'sub_{subject}_bar.png')
                topic_error_rates = [(stats['incorrect'] / stats['total'] * 100) if stats['total'] > 0 else 0 for stats in topic_stats.values()]
                
                # Sort topics by error rate for the bar chart
                sorted_topics = sorted(zip(topic_labels, topic_error_rates), key=lambda x: x[1], reverse=True)
                sorted_labels = [x[0] for x in sorted_topics]
                sorted_rates = [x[1] for x in sorted_topics]

                create_bar_chart(
                    sorted_labels, sorted_rates,
                    'Topic Error Rates (%)', sub_bar_path, pdf.red_color_hex
                )
                if os.path.exists(sub_bar_path): pdf.image(sub_bar_path, w=180)

        # --- 4. Finalize and Email ---
        filename = f"InsightScore_Report_{user_name.replace(' ', '_')}.pdf"
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        pdf.output(file_path)
        
        msg = Message(f"Your InsightScore Report: {user_name}", 
                      sender=app.config['MAIL_USERNAME'], 
                      recipients=[target_email])
        msg.body = f"Hi {user_name},\n\nAttached is your detailed InsightScore performance report.\n\nGood luck with your studies!"
        
        with app.open_resource(file_path) as fp:
            msg.attach(filename, "application/pdf", fp.read())
        
        mail.send(msg)
        
        return jsonify({'status': 'success', 'message': f'Report successfully sent to {target_email}'})

    except Exception as e:
        print(f"Error during PDF generation: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'status': 'error', 'message': f'Failed to generate PDF: {str(e)}'})
    
    finally:
        # --- 5. Cleanup ---
        # Delete the temporary chart folder
        if os.path.exists(chart_dir):
            shutil.rmtree(chart_dir)
        
        # Delete the final PDF from server
        if 'file_path' in locals() and os.path.exists(file_path):
            os.remove(file_path)

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

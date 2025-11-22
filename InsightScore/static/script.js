// --- Global State ---
let exams = [];
let showForm = false;
let selectedSubject = null;
let activeCharts = []; // To clean up Chart.js instances

// Temporary state for new exam entry
let currentExam = { 
    name: '', 
    date: new Date().toISOString().split('T')[0], 
    subject: '', 
    totalMarks: '', 
    marksScored: '', 
    topics: [] 
};

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});

// --- Sidebar & Profile Functions ---

function openSidebar() {
    document.getElementById('sidebar').classList.remove('-translate-x-full');
    document.getElementById('overlay').classList.remove('hidden');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.add('-translate-x-full');
    document.getElementById('overlay').classList.add('hidden');
}

async function uploadProfilePic(input) {
    if (input.files && input.files[0]) {
        const formData = new FormData();
        formData.append('file', input.files[0]);
        
        try {
            const res = await fetch('/api/upload-pic', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.status === 'success') {
                document.getElementById('profile-img').src = '/static/uploads/' + data.filename;
            } else {
                alert('Upload failed: ' + (data.message || 'Unknown error'));
            }
        } catch (e) { console.error(e); }
    }
}

// --- Data Operations ---

async function loadData() {
    try {
        const res = await fetch('/api/exams');
        if (res.ok) {
            exams = await res.json();
            renderApp();
        }
    } catch (e) { console.error("Failed to load exams", e); }
}

async function saveData(newExamsList) {
    try {
        await fetch('/api/exams', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(newExamsList) 
        });
        exams = newExamsList;
        renderApp();
    } catch (e) { console.error("Failed to save", e); }
}

async function sendPdfReport() {
    const stats = getStats();
    
    // --- DIALOG BOX FOR EMAIL ---
    const email = prompt("Enter the email address to send the report to:");
    if (!email) return; // Exit if canceled or empty

    // Prepare summary payload including the target email
    const payload = {
        email: email, 
        totalExams: stats.totalExams,
        avgScore: stats.avgScore,
        weaknesses: stats.weaknesses
    };
    
    alert(`Generating PDF Report for ${email}... Please wait.`);
    
    try {
        const res = await fetch('/api/send-report', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        });
        const data = await res.json();
        alert(data.message);
    } catch (e) {
        console.error(e);
        alert("Failed to send report. Ensure server email config is correct.");
    }
}

// --- Core Calculation Logic ---

const getSubjects = () => [...new Set(exams.map(e => e.subject))];

const getStats = () => {
    const totalExams = exams.length;
    const avgScore = totalExams 
        ? (exams.reduce((sum, e) => sum + (parseFloat(e.marksScored) / parseFloat(e.totalMarks)), 0) / totalExams * 100).toFixed(1) + '%'
        : '0%';
        
    // Aggregate topics
    let allTopics = [];
    exams.forEach(e => {
        if (e.topics) {
            e.topics.forEach(t => {
                allTopics.push({
                    topic: t.name,
                    errorPercentage: ((parseInt(t.incorrectQuestions) / parseInt(t.totalQuestions)) * 100).toFixed(1),
                    exam: e.name
                });
            });
        }
    });
    
    // Filter weaknesses (>0% error) and sort desc
    const weaknesses = allTopics
        .filter(t => parseFloat(t.errorPercentage) > 0)
        .sort((a, b) => parseFloat(b.errorPercentage) - parseFloat(a.errorPercentage))
        .slice(0, 5);
        
    return { totalExams, avgScore, weaknesses };
};

// --- Rendering System ---

function renderApp(subject = selectedSubject) {
    selectedSubject = subject;
    
    // Cleanup old charts
    activeCharts.forEach(c => c.destroy());
    activeCharts = [];
    
    renderSidebarNav();
    renderForm();
    renderMainContent();
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function renderSidebarNav() {
    const container = document.getElementById('sidebar-subjects');
    const subjects = getSubjects();
    
    container.innerHTML = subjects.map(sub => `
        <button onclick="renderApp('${sub}'); closeSidebar()" 
                class="w-full text-left p-2 pl-4 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg flex items-center gap-2 transition group">
            <span class="w-2 h-2 rounded-full ${selectedSubject === sub ? 'bg-purple-500' : 'bg-slate-600 group-hover:bg-slate-400'}"></span> 
            ${sub}
        </button>
    `).join('');
}

function renderMainContent() {
    const container = document.getElementById('main-content');
    
    if (exams.length === 0) {
        container.innerHTML = `
            <div class="text-center py-20 opacity-70">
                <i data-lucide="book-open" class="w-20 h-20 text-slate-600 mx-auto mb-4"></i>
                <h3 class="text-2xl font-bold text-slate-400">No data yet</h3>
                <p class="text-slate-500">Click "Add Exam Data" to get started.</p>
            </div>
        `;
        return;
    }

    if (!selectedSubject) {
        renderOverview(container);
    } else {
        renderSubjectView(container);
    }
}

function renderOverview(container) {
    const stats = getStats();
    const subjects = getSubjects();
    
    // Data for Charts
    const subjectExamCounts = subjects.map(sub => exams.filter(e => e.subject === sub).length);
    const subjectAvgScores = subjects.map(sub => {
        const subExams = exams.filter(e => e.subject === sub);
        if (!subExams.length) return 0;
        const avg = subExams.reduce((acc, e) => acc + (parseFloat(e.marksScored)/parseFloat(e.totalMarks)), 0) / subExams.length;
        return (avg * 100).toFixed(1);
    });

    // Calculate Error Counts per Subject
    const subjectErrorCounts = subjects.map(sub => {
        return exams.filter(e => e.subject === sub).reduce((acc, e) => {
            return acc + (e.topics ? e.topics.reduce((tAcc, t) => tAcc + parseInt(t.incorrectQuestions || 0), 0) : 0);
        }, 0);
    });

    // Weakness List HTML
    const weakHtml = stats.weaknesses.length 
        ? stats.weaknesses.map(w => `
            <div class="flex justify-between items-center p-3 bg-red-500/10 border border-red-500/20 rounded-lg mb-2">
                <div>
                    <span class="font-bold text-red-200">${w.topic}</span>
                    <span class="text-xs text-red-400 ml-2">in ${w.exam}</span>
                </div>
                <span class="font-bold text-red-400">${w.errorPercentage}% Error</span>
            </div>
          `).join('')
        : '<div class="p-4 text-slate-500 text-center">No weaknesses found! Great job.</div>';

    container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <p class="text-slate-400 text-sm font-bold uppercase">Total Exams</p>
                <p class="text-4xl font-bold text-white mt-1">${stats.totalExams}</p>
            </div>
            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <p class="text-slate-400 text-sm font-bold uppercase">Average Score</p>
                <p class="text-4xl font-bold text-blue-400 mt-1">${stats.avgScore}</p>
            </div>
            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <p class="text-slate-400 text-sm font-bold uppercase">Active Subjects</p>
                <p class="text-4xl font-bold text-purple-400 mt-1">${getSubjects().length}</p>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <div class="flex items-center gap-2 mb-6">
                    <i data-lucide="alert-circle" class="text-red-400"></i>
                    <h3 class="text-xl font-bold">Weakest Topics</h3>
                </div>
                <div class="overflow-y-auto max-h-64 custom-scrollbar pr-2">
                    ${weakHtml}
                </div>
            </div>

            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <div class="flex items-center gap-2 mb-6">
                    <i data-lucide="line-chart" class="text-purple-400"></i>
                    <h3 class="text-xl font-bold">Performance Trend</h3>
                </div>
                <div class="chart-container">
                    <canvas id="overviewChart"></canvas>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <!-- PIE CHART: Subject Distribution -->
            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <div class="flex items-center gap-2 mb-6">
                    <i data-lucide="pie-chart" class="text-yellow-400"></i>
                    <h3 class="text-xl font-bold">Exams Distribution</h3>
                </div>
                <div class="chart-container" style="height: 250px;">
                    <canvas id="subjectPieChart"></canvas>
                </div>
            </div>

            <!-- NEW PIE CHART: Error Distribution -->
            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <div class="flex items-center gap-2 mb-6">
                    <i data-lucide="alert-triangle" class="text-red-400"></i>
                    <h3 class="text-xl font-bold">Error Distribution by Subject</h3>
                </div>
                <div class="chart-container" style="height: 250px;">
                    <canvas id="errorPieChart"></canvas>
                </div>
            </div>
        </div>

        <!-- BAR CHART: Average Score -->
        <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg mb-8">
            <div class="flex items-center gap-2 mb-6">
                <i data-lucide="bar-chart-3" class="text-green-400"></i>
                <h3 class="text-xl font-bold">Average Score / Subject</h3>
            </div>
            <div class="chart-container" style="height: 250px;">
                <canvas id="subjectBarChart"></canvas>
            </div>
        </div>

        <div class="mt-10 text-center">
            <button onclick="sendPdfReport()" class="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white px-8 py-3 rounded-full shadow-lg hover:shadow-red-900/30 transition flex items-center gap-3 mx-auto font-bold">
                <i data-lucide="file-text"></i> Email PDF Report
            </button>
        </div>
    `;

    // Render Line Chart (Trend)
    const ctx = document.getElementById('overviewChart');
    if (ctx) {
        const labels = exams.map(e => e.name);
        const data = exams.map(e => (parseFloat(e.marksScored) / parseFloat(e.totalMarks) * 100).toFixed(1));
        
        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Score %',
                    data: data,
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, max: 100, grid: { color: '#334155' } },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
        activeCharts.push(chart);
    }

    // Render Pie Chart (Exams)
    const ctxPie = document.getElementById('subjectPieChart');
    if (ctxPie) {
        const pieChart = new Chart(ctxPie, {
            type: 'pie',
            data: {
                labels: subjects,
                datasets: [{
                    data: subjectExamCounts,
                    backgroundColor: ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: '#94a3b8' } }
                }
            }
        });
        activeCharts.push(pieChart);
    }

    // Render Pie Chart (Errors)
    const ctxErrorPie = document.getElementById('errorPieChart');
    if (ctxErrorPie) {
        const errorPieChart = new Chart(ctxErrorPie, {
            type: 'pie',
            data: {
                labels: subjects,
                datasets: [{
                    data: subjectErrorCounts,
                    backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: '#94a3b8' } }
                }
            }
        });
        activeCharts.push(errorPieChart);
    }

    // Render Bar Chart (Avg Scores)
    const ctxBar = document.getElementById('subjectBarChart');
    if (ctxBar) {
        const barChart = new Chart(ctxBar, {
            type: 'bar',
            data: {
                labels: subjects,
                datasets: [{
                    label: 'Average Score %',
                    data: subjectAvgScores,
                    backgroundColor: '#10b981',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, max: 100, grid: { color: '#334155' } },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
        activeCharts.push(barChart);
    }
}

function renderSubjectView(container) {
    // Filter exams
    const subExams = exams.filter(e => e.subject === selectedSubject);
    
    // Calculate subject average
    const subAvg = subExams.length 
        ? (subExams.reduce((s, e) => s + (parseFloat(e.marksScored) / parseFloat(e.totalMarks)), 0) / subExams.length * 100).toFixed(1)
        : '0.0';

    const rows = subExams.map(e => {
        const pct = (parseFloat(e.marksScored) / parseFloat(e.totalMarks) * 100).toFixed(1);
        let colorClass = pct >= 75 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400';
        
        return `
            <tr class="border-b border-slate-700/50 hover:bg-slate-700/20 transition">
                <td class="p-4">${e.name}</td>
                <td class="p-4 text-right">${e.marksScored} / ${e.totalMarks}</td>
                <td class="p-4 text-right font-bold ${colorClass}">${pct}%</td>
                <td class="p-4 text-center">
                    <button onclick="deleteExam(${e.id})" class="text-slate-500 hover:text-red-400 transition"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="flex justify-between items-end mb-6">
            <div>
                <h2 class="text-3xl font-bold text-white">${selectedSubject}</h2>
                <p class="text-slate-400 text-sm mt-1">Subject Analysis</p>
            </div>
            <div class="text-right">
                <p class="text-4xl font-bold text-purple-400">${subAvg}%</p>
                <p class="text-xs text-slate-500 uppercase font-bold">Average</p>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div class="lg:col-span-2 bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <h3 class="text-lg font-bold mb-4">Exam History</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-slate-300">
                        <thead>
                            <tr class="text-xs uppercase bg-slate-900/50 text-slate-500">
                                <th class="p-3 text-left rounded-l-lg">Exam Name</th>
                                <th class="p-3 text-right">Score</th>
                                <th class="p-3 text-right">Percentage</th>
                                <th class="p-3 text-center rounded-r-lg">Action</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>

            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <h3 class="text-lg font-bold mb-4">Progress</h3>
                <div class="chart-container">
                    <canvas id="subChart"></canvas>
                </div>
            </div>
        </div>
    `;

    // Render Subject Chart
    const ctx = document.getElementById('subChart');
    if (ctx) {
        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: subExams.map(e => e.name),
                datasets: [{
                    label: 'Score %',
                    data: subExams.map(e => (parseFloat(e.marksScored) / parseFloat(e.totalMarks) * 100).toFixed(1)),
                    backgroundColor: '#a855f7',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, max: 100, grid: { color: '#334155' } },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
        activeCharts.push(chart);
    }
}

// --- Form Handling ---

function toggleForm() {
    showForm = !showForm;
    renderApp();
}

function addTopic() {
    const name = document.getElementById('tn').value;
    const total = document.getElementById('tt').value;
    const inc = document.getElementById('ti').value;
    
    if (name && total && inc) {
        currentExam.topics.push({
            name: name, 
            totalQuestions: parseInt(total), 
            incorrectQuestions: parseInt(inc)
        });
        
        // Clear inputs
        document.getElementById('tn').value = '';
        document.getElementById('tt').value = '';
        document.getElementById('ti').value = '';
        
        renderForm(); // Re-render form to show added topic list
    }
}

function removeTopic(index) {
    currentExam.topics.splice(index, 1);
    renderForm();
}

function renderForm() {
    const container = document.getElementById('form-container');
    
    if (!showForm) {
        container.innerHTML = '';
        return;
    }

    const topicsListHtml = currentExam.topics.map((t, i) => `
        <div class="flex justify-between items-center bg-slate-700/50 p-2 rounded mt-2 text-sm border border-slate-600">
            <span>${t.name}</span>
            <div class="flex items-center gap-3">
                <span class="text-red-400 font-mono">${t.incorrectQuestions}/${t.totalQuestions}</span>
                <button onclick="removeTopic(${i})" class="text-slate-400 hover:text-red-400"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="bg-slate-800 border border-purple-500/30 p-6 rounded-2xl shadow-2xl relative animate-in fade-in slide-in-from-top-4 duration-300">
            <button onclick="toggleForm()" class="absolute top-4 right-4 text-slate-500 hover:text-white transition"><i data-lucide="x"></i></button>
            
            <h3 class="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <i data-lucide="file-plus" class="text-purple-500"></i> Add New Exam Data
            </h3>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                    <label class="text-xs text-slate-400 font-bold ml-1">EXAM NAME</label>
                    <input id="en" class="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-purple-500 focus:outline-none" placeholder="e.g. Mid-Term" value="${currentExam.name}" onchange="currentExam.name=this.value">
                </div>
                <div>
                    <label class="text-xs text-slate-400 font-bold ml-1">SUBJECT</label>
                    <input id="es" class="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-purple-500 focus:outline-none" placeholder="e.g. Physics" value="${currentExam.subject}" onchange="currentExam.subject=this.value">
                </div>
                <div>
                    <label class="text-xs text-slate-400 font-bold ml-1">TOTAL MARKS</label>
                    <input id="et" type="number" class="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-purple-500 focus:outline-none" placeholder="100" value="${currentExam.totalMarks}" onchange="currentExam.totalMarks=this.value">
                </div>
                <div>
                    <label class="text-xs text-slate-400 font-bold ml-1">SCORED MARKS</label>
                    <input id="em" type="number" class="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 text-white focus:border-purple-500 focus:outline-none" placeholder="85" value="${currentExam.marksScored}" onchange="currentExam.marksScored=this.value">
                </div>
            </div>

            <div class="bg-slate-900/50 rounded-xl p-4 border border-slate-700">
                <p class="text-sm font-bold text-slate-300 mb-3">Topic Breakdown (For Analytics)</p>
                
                <div class="flex gap-2 items-center mb-2">
                    <input id="tn" class="flex-1 p-2 rounded bg-slate-800 border border-slate-600 text-sm" placeholder="Topic Name">
                    <input id="tt" type="number" class="w-20 p-2 rounded bg-slate-800 border border-slate-600 text-sm" placeholder="Total Qs">
                    <input id="ti" type="number" class="w-24 p-2 rounded bg-slate-800 border border-slate-600 text-sm" placeholder="Incorrect Qs">
                    <button onclick="addTopic()" class="bg-purple-600 hover:bg-purple-700 text-white p-2 rounded transition"><i data-lucide="plus" class="w-4 h-4"></i></button>
                </div>
                
                <div class="max-h-32 overflow-y-auto custom-scrollbar">
                    ${topicsListHtml}
                </div>
            </div>

            <button onclick="saveExamEntry()" class="w-full mt-6 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-bold shadow-lg transition transform active:scale-95">
                Save Exam Data
            </button>
        </div>
    `;
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

async function saveExamEntry() {
    if (!currentExam.name || !currentExam.subject || !currentExam.totalMarks || !currentExam.marksScored) {
        alert("Please fill in all main exam details.");
        return;
    }
    
    // Add ID and timestamp
    const finalEntry = {
        ...currentExam,
        id: Date.now(),
        totalMarks: parseFloat(currentExam.totalMarks),
        marksScored: parseFloat(currentExam.marksScored)
    };
    
    exams.push(finalEntry);
    await saveData(exams);
    
    // Reset
    currentExam = { name: '', date: new Date().toISOString().split('T')[0], subject: '', totalMarks: '', marksScored: '', topics: [] };
    showForm = false;
    renderApp();
}

function deleteExam(id) {
    if (confirm("Are you sure you want to delete this exam?")) {
        const newExams = exams.filter(e => e.id !== id);
        saveData(newExams);
    }
}

// Explicitly Expose Functions to Global Scope (Window)
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.uploadProfilePic = uploadProfilePic;
window.renderApp = renderApp;
window.toggleForm = toggleForm;
window.addTopic = addTopic;
window.removeTopic = removeTopic;
window.saveExamEntry = saveExamEntry;
window.deleteExam = deleteExam;
window.sendPdfReport = sendPdfReport;
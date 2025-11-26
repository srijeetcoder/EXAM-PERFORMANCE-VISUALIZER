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
                // Add timestamp to bust cache
                document.getElementById('profile-img').src = '/static/uploads/' + data.filename + '?t=' + new Date().getTime();
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
    // Get user's name and email from the sidebar for the report
    const userEmailEl = document.querySelector('#sidebar .text-sm.text-slate-400');
    const userEmail = userEmailEl ? userEmailEl.textContent : '';
    const userNameEl = document.querySelector('#sidebar .text-xl.font-bold');
    const userName = userNameEl ? userNameEl.textContent : 'User';

    const email = prompt("Enter the email address to send the report to:", userEmail);
    if (!email) return; // Exit if canceled or empty

    // UPDATED PAYLOAD: We send the user's name and the raw exams array.
    const payload = {
        email: email,
        userName: userName,
        exams: exams // Send the full, raw exam data
    };
    
    alert(`Generating detailed PDF Report for ${email}... This may take a moment.`);
    
    try {
        const res = await fetch('/api/send-report', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        });
        const data = await res.json();
        alert(data.message); // e.g., "Sent to user@example.com"
    } catch (e) {
        console.error(e);
        alert("Failed to send report. Check server logs.");
    }
}

// --- Core Calculation Logic ---

const getSubjects = () => [...new Set(exams.map(e => e.subject))];

const getStats = () => {
    const totalExams = exams.length;
    const avgScore = totalExams 
        ? (exams.reduce((sum, e) => sum + (parseFloat(e.marksScored) / parseFloat(e.totalMarks)), 0) / totalExams * 100).toFixed(1) + '%'
        : '0%';
        
    let allTopics = [];
    exams.forEach(e => {
        if (e.topics && Array.isArray(e.topics)) {
            e.topics.forEach(t => {
                const total = parseInt(t.totalQuestions);
                const incorrect = parseInt(t.incorrectQuestions);
                if (total > 0) {
                    allTopics.push({
                        topic: t.name,
                        subject: e.subject, // Include subject context
                        exam: e.name,
                        errorPercentage: ((incorrect / total) * 100)
                    });
                }
            });
        }
    });
    
    const weaknesses = allTopics
        .filter(t => t.errorPercentage > 0)
        .sort((a, b) => b.errorPercentage - a.errorPercentage)
        .slice(0, 5);
        
    return { totalExams, avgScore, weaknesses };
};

// --- Rendering System ---

function renderApp(subject = selectedSubject) {
    selectedSubject = subject;
    
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
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        return;
    }

    if (!selectedSubject) {
        renderOverview(container);
    } else {
        renderSubjectView(container);
    }
}

// --- THIS IS THE FUNCTION THAT BUILDS THE MAIN PAGE ---
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
                <span class="font-bold text-red-400">${w.errorPercentage.toFixed(1)}% Error</span>
            </div>
          `).join('')
        : '<div class="p-4 text-slate-500 text-center">No weaknesses found! Great job.</div>';

    container.innerHTML = `
        <!-- STATS CARDS -->
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
                <p class="text-4xl font-bold text-purple-400 mt-1">${subjects.length}</p>
            </div>
        </div>

        <!-- WEAKEST TOPICS & PERFORMANCE TREND -->
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

        <!-- PIE CHARTS (from screenshots) -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <div class="flex items-center gap-2 mb-6">
                    <i data-lucide="pie-chart" class="text-yellow-400"></i>
                    <h3 class="text-xl font-bold">Exams Distribution</h3>
                </div>
                <div class="chart-container" style="height: 250px;">
                    <canvas id="subjectPieChart"></canvas>
                </div>
            </div>

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

        <!-- BAR CHART (from screenshots) -->
        <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg mb-8">
            <div class="flex items-center gap-2 mb-6">
                <i data-lucide="bar-chart-3" class="text-green-400"></i>
                <h3 class="text-xl font-bold">Average Score / Subject</h3>
            </div>
            <div class="chart-container" style="height: 250px;">
                <canvas id="subjectBarChart"></canvas>
            </div>
        </div>

        <!-- PDF REPORT BUTTON -->
        <div class="mt-10 text-center">
            <button onclick="sendPdfReport()" class="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white px-8 py-3 rounded-full shadow-lg hover:shadow-red-900/30 transition flex items-center gap-3 mx-auto font-bold">
                <i data-lucide="file-text"></i> Email PDF Report
            </button>
        </div>
    `;

    // --- Render All Overview Charts ---
    const chartColors = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
    
    if (document.getElementById('overviewChart')) {
        const chart = new Chart(document.getElementById('overviewChart'), {
            type: 'line',
            data: {
                labels: exams.map(e => e.name),
                datasets: [{
                    label: 'Score %',
                    data: exams.map(e => (parseFloat(e.marksScored) / parseFloat(e.totalMarks) * 100).toFixed(1)),
                    borderColor: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.1)', tension: 0.4, fill: true
                }]
            },
            options: { scales: { y: { beginAtZero: true, max: 100, grid: { color: '#334155' } }, x: { grid: { display: false } } } }
        });
        activeCharts.push(chart);
    }

    if (document.getElementById('subjectPieChart')) {
        const pieChart = new Chart(document.getElementById('subjectPieChart'), {
            type: 'pie',
            data: { labels: subjects, datasets: [{ data: subjectExamCounts, backgroundColor: chartColors, borderWidth: 0 }] },
            options: { plugins: { legend: { position: 'right', labels: { color: '#94a3b8' } } }, maintainAspectRatio: false }
        });
        activeCharts.push(pieChart);
    }

    if (document.getElementById('errorPieChart')) {
        const errorPieChart = new Chart(document.getElementById('errorPieChart'), {
            type: 'pie',
            data: { labels: subjects, datasets: [{ data: subjectErrorCounts, backgroundColor: chartColors.slice(1), borderWidth: 0 }] },
            options: { plugins: { legend: { position: 'right', labels: { color: '#94a3b8' } } }, maintainAspectRatio: false }
        });
        activeCharts.push(errorPieChart);
    }

    if (document.getElementById('subjectBarChart')) {
        const barChart = new Chart(document.getElementById('subjectBarChart'), {
            type: 'bar',
            data: {
                labels: subjects,
                datasets: [{ label: 'Average Score %', data: subjectAvgScores, backgroundColor: '#10b981', borderRadius: 4 }]
            },
            options: { scales: { y: { beginAtZero: true, max: 100, grid: { color: '#334155' } }, x: { grid: { display: false } } }, maintainAspectRatio: false }
        });
        activeCharts.push(barChart);
    }
}

// --- THIS IS THE FUNCTION THAT BUILDS THE SUBJECT PAGE ---
function renderSubjectView(container) {
    const subExams = exams.filter(e => e.subject === selectedSubject);
    const subAvg = subExams.length 
        ? (subExams.reduce((s, e) => s + (parseFloat(e.marksScored) / parseFloat(e.totalMarks)), 0) / subExams.length * 100).toFixed(1)
        : '0.0';

    // --- TOPIC AGGREGATION & TABLE GENERATION ---
    let topicStats = {};
    subExams.forEach(e => {
        if(e.topics && Array.isArray(e.topics)) {
            e.topics.forEach(t => {
                if(!topicStats[t.name]) {
                    topicStats[t.name] = { total: 0, incorrect: 0 };
                }
                topicStats[t.name].total += parseInt(t.totalQuestions || 0);
                topicStats[t.name].incorrect += parseInt(t.incorrectQuestions || 0);
            });
        }
    });

    const topicLabels = Object.keys(topicStats);
    const topicErrorCounts = topicLabels.map(t => topicStats[t].incorrect);
    const topicErrorRates = topicLabels.map(t => {
        const stats = topicStats[t];
        const rate = (stats.total > 0) ? ((stats.incorrect / stats.total) * 100) : 0;
        return rate.toFixed(1);
    });
    
    // Sort topics by error rate for the bar chart
    const sortedTopics = topicLabels.map((label, i) => ({
        label,
        rate: parseFloat(topicErrorRates[i])
    })).sort((a, b) => b.rate - a.rate);


    const topicRows = topicLabels.map(t => {
        const total = topicStats[t].total;
        const incorrect = topicStats[t].incorrect;
        const errPct = total > 0 ? ((incorrect / total) * 100).toFixed(1) : '0.0';
        let colorClass = parseFloat(errPct) <= 15 ? 'text-green-400' : parseFloat(errPct) <= 40 ? 'text-yellow-400' : 'text-red-400';
        
        return `
            <tr class="border-b border-slate-700 hover:bg-slate-800 transition">
                <td class="p-4 text-slate-200 font-medium">${t}</td>
                <td class="p-4 text-right text-slate-400">${total}</td>
                <td class="p-4 text-right text-red-300">${incorrect}</td>
                <td class="p-4 text-right font-bold ${colorClass}">${errPct}%</td>
            </tr>
        `;
    }).join('');

    const examRows = subExams.map(e => {
        const pct = (parseFloat(e.marksScored) / parseFloat(e.totalMarks) * 100).toFixed(1);
        let colorClass = pct >= 75 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400';
        return `
            <tr class="border-b border-slate-700 hover:bg-slate-800 transition">
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
            <div class="lg:col-span-2 flex flex-col gap-8">
                
                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <h3 class="text-lg font-bold mb-4 flex items-center gap-2"><i data-lucide="history" class="w-5 h-5 text-purple-400"></i> Exam History</h3>
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
                            <tbody>${examRows}</tbody>
                        </table>
                    </div>
                </div>

                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <h3 class="text-lg font-bold mb-4 flex items-center gap-2"><i data-lucide="list" class="w-5 h-5 text-blue-400"></i> Topic Performance Breakdown</h3>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm text-slate-300">
                            <thead>
                                <tr class="text-xs uppercase bg-slate-900/50 text-slate-500">
                                    <th class="p-3 text-left rounded-l-lg">Topic</th>
                                    <th class="p-3 text-right">Total Qs</th>
                                    <th class="p-3 text-right">Incorrect</th>
                                    <th class="p-3 text-right rounded-r-lg">Error Rate</th>
                                </tr>
                            </thead>
                            <tbody>${topicRows.length ? topicRows : '<tr><td colspan="4" class="p-4 text-center text-slate-500">No topic data yet</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>

            </div>

            <!-- CHARTS from screenshots -->
            <div class="flex flex-col gap-6">
                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <h3 class="text-lg font-bold mb-4">Progress</h3>
                    <div class="chart-container" style="height: 200px;">
                        <canvas id="subChart"></canvas>
                    </div>
                </div>

                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <h3 class="text-lg font-bold mb-4">Error Distribution</h3>
                    <div class="chart-container" style="height: 200px;">
                        <canvas id="subTopicDoughnut"></canvas>
                    </div>
                </div>

                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <h3 class="text-lg font-bold mb-4">Weakest Topics</h3>
                    <div class="chart-container" style="height: 200px;">
                        <canvas id="subTopicBar"></canvas>
                    </div>
                </div>
            </div>
        </div>
    `;

    // --- Render All Subject Charts ---
    const chartColors = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
    
    if (document.getElementById('subChart')) {
        activeCharts.push(new Chart(document.getElementById('subChart'), {
            type: 'line',
            data: {
                labels: subExams.map(e => e.name),
                datasets: [{
                    label: 'Score %',
                    data: subExams.map(e => (parseFloat(e.marksScored) / parseFloat(e.totalMarks) * 100).toFixed(1)),
                    borderColor: '#a855f7', tension: 0.4, fill: true, backgroundColor: 'rgba(168, 85, 247, 0.1)'
                }]
            },
            options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, grid: { color: '#334155' } }, x: { display: false } }, plugins: { legend: { display: false } } }
        }));
    }

    if (document.getElementById('subTopicDoughnut') && topicLabels.length) {
        activeCharts.push(new Chart(document.getElementById('subTopicDoughnut'), {
            type: 'doughnut',
            data: {
                labels: topicLabels,
                datasets: [{ data: topicErrorCounts, backgroundColor: chartColors, borderWidth: 0 }]
            },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        }));
    }

    if (document.getElementById('subTopicBar') && topicLabels.length) {
        activeCharts.push(new Chart(document.getElementById('subTopicBar'), {
            type: 'bar',
            data: {
                labels: sortedTopics.map(t => t.label),
                datasets: [{ label: 'Error %', data: sortedTopics.map(t => t.rate), backgroundColor: '#ef4444', borderRadius: 4 }]
            },
            options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, grid: { color: '#334155' } }, x: { display: false } }, plugins: { legend: { display: false } } }
        }));
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
        
        document.getElementById('tn').value = '';
        document.getElementById('tt').value = '';
        document.getElementById('ti').value = '';
        
        renderForm(); 
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
                <button type="button" onclick="removeTopic(${i})" class="text-slate-400 hover:text-red-400"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="bg-slate-800 border border-purple-500/30 p-6 rounded-2xl shadow-2xl relative animate-in fade-in slide-in-from-top-4 duration-300">
            <button type="button" onclick="toggleForm()" class="absolute top-4 right-4 text-slate-500 hover:text-white transition"><i data-lucide="x"></i></button>
            
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
                    <button type="button" onclick="addTopic()" class="bg-purple-600 hover:bg-purple-700 text-white p-2 rounded transition"><i data-lucide="plus" class="w-4 h-4"></i></button>
                </div>
                
                <div id="topic-list" class="max-h-32 overflow-y-auto custom-scrollbar">
                    ${topicsListHtml}
                </div>
            </div>

            <button type="button" onclick="saveExamEntry()" class="w-full mt-6 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-bold shadow-lg transition transform active:scale-95">
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
    
    const finalEntry = {
        ...currentExam,
        id: Date.now(), // Use timestamp as a unique ID
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
    // We use a timestamp ID, so it's a number
    const numId = parseInt(id);
    if (confirm("Are you sure you want to delete this exam?")) {
        const newExams = exams.filter(e => e.id !== numId);
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

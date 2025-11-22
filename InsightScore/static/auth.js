function switchView(id) {
    ['login-form', 'register-form', 'forgot-form'].forEach(i => document.getElementById(i).classList.add('hidden'));
    document.getElementById(id + '-form').classList.remove('hidden');
}

function togglePass(id) {
    const el = document.getElementById(id);
    el.type = el.type === 'password' ? 'text' : 'password';
}

async function handleAuth(type) {
    const url = type === 'login' ? '/api/login' : '/api/register';
    const payload = type === 'login' 
        ? { email: document.getElementById('l-email').value, password: document.getElementById('l-pass').value }
        : { 
            name: document.getElementById('r-name').value, 
            phone: document.getElementById('r-phone').value, 
            email: document.getElementById('r-email').value, 
            password: document.getElementById('r-pass').value 
          };

    const res = await fetch(url, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
    const data = await res.json();
    
    if(data.status === 'success') {
        if(type === 'register') { alert('Success! Please Login.'); switchView('login'); }
        else window.location.href = '/dashboard';
    } else alert(data.message);
}

async function sendOTP() {
    const email = document.getElementById('f-email').value;
    const res = await fetch('/api/forgot-password', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email}) });
    const data = await res.json();
    if(data.status === 'success') {
        alert(data.message);
        document.getElementById('step-1').classList.add('hidden');
        document.getElementById('step-2').classList.remove('hidden');
    } else alert(data.message);
}

async function verifyOTP() {
    const otp = document.getElementById('f-otp').value;
    const res = await fetch('/api/verify-otp', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({otp}) });
    const data = await res.json();
    if(data.status === 'success') window.location.href = '/dashboard';
    else alert(data.message);
}
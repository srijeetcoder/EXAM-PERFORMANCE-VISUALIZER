// This function is called by the "Login" button
function loginUser() {
    handleAuth('login');
}

// This function is called by the "Create Account" button
function registerUser() {
    handleAuth('register');
}

// This function toggles password visibility
function togglePass(id) {
    const el = document.getElementById(id);
    const icon = el.nextElementSibling.querySelector("i"); // Find the icon
    if (el.type === 'password') {
        el.type = 'text';
        icon.setAttribute("data-lucide", "eye-off");
    } else {
        el.type = 'password';
        icon.setAttribute("data-lucide", "eye");
    }
    if (typeof lucide !== 'undefined') {
        lucide.createIcons(); // Redraw the changed icon
    }
}

// This is the main logic function that handles both login and registration
async function handleAuth(type) {
    const url = type === 'login' ? '/api/login' : '/api/register';
    
    // Get elements using the IDs from login.html
    const payload = type === 'login' 
        ? { 
            email: document.getElementById('login-email').value, 
            password: document.getElementById('login-pass').value 
          }
        : { 
            name: document.getElementById('reg-name').value, 
            phone: document.getElementById('reg-phone').value, 
            email: document.getElementById('reg-email').value, 
            password: document.getElementById('reg-pass').value 
          };
    
    try {
        const res = await fetch(url, { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify(payload) 
        });
        const data = await res.json();
        
        if(data.status === 'success') {
            if(type === 'register') { 
                alert('Account created! Please login.');
                // Call the toggleView function from login.html's inline script
                if (typeof toggleView === 'function') {
                    toggleView('login-form');
                }
            } else {
                window.location.href = '/dashboard';
            }
        } else {
            // Show the error message in the correct <p> tag
            if(type === 'login') {
                document.getElementById('login-error').innerText = data.message;
            } else {
                document.getElementById('reg-error').innerText = data.message;
            }
        }
    } catch (e) {
        console.error(e);
        if(type === 'login') {
            document.getElementById('login-error').innerText = "An error occurred.";
        } else {
            document.getElementById('reg-error').innerText = "An error occurred.";
        }
    }
}

// This handles the "Send OTP" button
async function sendOTP() {
    const email = document.getElementById('forgot-email').value;
    const res = await fetch('/api/forgot-password', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({email}) 
    });
    const data = await res.json();
    if(data.status === 'success') {
        alert(data.message);
        document.getElementById('forgot-step1').classList.add('hidden');
        document.getElementById('forgot-step2').classList.remove('hidden');
    } else {
        document.getElementById('forgot-error').innerText = data.message;
    }
}

// This handles the "Verify OTP" button
async function verifyOTP() {
    const otp = document.getElementById('forgot-otp').value;
    const res = await fetch('/api/verify-otp', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({otp}) 
    });
    const data = await res.json();
    if(data.status === 'success') {
        window.location.href = '/dashboard';
    } else {
        document.getElementById('otp-error').innerText = data.message;
    }
}

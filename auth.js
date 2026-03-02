// auth.js - Global Google Authentication & Profile Sync

window.handleCredentialResponse = function(response) {
    const responsePayload = decodeJwtResponse(response.credential);

    // 1. Prepare User Data Object
    // auth.js - Inside window.handleCredentialResponse
    const userData = {
    name: responsePayload.name,
    firstName: responsePayload.given_name,
    email: responsePayload.email,
    picture: responsePayload.picture
    // DELETED: rating and record 
    };

    // 2. Security Check: Ensure it's a CMU email
    if (userData.email.endsWith('@andrew.cmu.edu')) {

        // Store auth state for the session
        sessionStorage.setItem('cmuAuth', 'true');
        sessionStorage.setItem('userData', JSON.stringify(userData));

        console.log("✅ Authenticated as:", userData.name);

        // --- UI Logic for Main Page ---
        const loginContainer = document.getElementById('login-container');
        const contentContainer = document.getElementById('content-container');
        
        if (loginContainer && contentContainer) {
            loginContainer.style.display = 'none';
            contentContainer.style.display = 'block';
        }

        // --- UI Logic for Chess Page ---
        // Syncs the data to the functions in main.js
        if (window.updatePlayerProfile) {
            window.updatePlayerProfile(userData);
        }

        // 3. Log the visitor to your Render Backend
        logVisitorToBackend(userData);
        
    } else {
        // Handle non-CMU emails
        const errorMsg = document.getElementById('error-message');
        if (errorMsg) {
            errorMsg.innerText = "Access denied. Please use your @andrew.cmu.edu email.";
            errorMsg.style.display = 'block';
        }
    }
};

// Helper: Decode Google's JWT Token
function decodeJwtResponse(token) {
    let base64Url = token.split('.')[1];
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    let jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
}

// Helper: Send data to your Render Backend
async function logVisitorToBackend(user) {
    try {
        const response = await fetch('https://eochis23-github-io.onrender.com/api/log-visitor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: user.email,
                firstName: user.firstName
            })
        });
        console.log("Backend Log Status:", response.status);
    } catch (err) {
        console.error("Failed to log visitor:", err);
    }
}
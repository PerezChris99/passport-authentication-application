/**
 * Authentication Scripts
 * Client-side validation and UI interactions
 */

// Toggle Password Visibility
function initPasswordToggle() {
    const toggleButtons = document.querySelectorAll('[data-toggle-password], #togglePassword');
    
    toggleButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetId = this.dataset.target || 'password';
            const passwordInput = document.getElementById(targetId);
            const icon = this.querySelector('i');
            
            if (passwordInput) {
                if (passwordInput.type === 'password') {
                    passwordInput.type = 'text';
                    if (icon) {
                        icon.classList.replace('bi-eye', 'bi-eye-slash');
                    }
                } else {
                    passwordInput.type = 'password';
                    if (icon) {
                        icon.classList.replace('bi-eye-slash', 'bi-eye');
                    }
                }
            }
        });
    });
}

// Password Strength Meter
function initPasswordStrength() {
    const passwordInput = document.getElementById('password');
    const progressBar = document.querySelector('#passwordStrength .progress-bar');
    
    if (passwordInput && progressBar) {
        passwordInput.addEventListener('input', function() {
            const password = this.value;
            let strength = 0;
            
            // Length check
            if (password.length >= 8) strength += 25;
            
            // Lowercase check
            if (/[a-z]/.test(password)) strength += 25;
            
            // Uppercase check
            if (/[A-Z]/.test(password)) strength += 25;
            
            // Number and special character check
            if (/[0-9]/.test(password) && /[@$!%*?&]/.test(password)) strength += 25;
            
            progressBar.style.width = strength + '%';
            
            // Color based on strength
            progressBar.className = 'progress-bar';
            if (strength <= 25) {
                progressBar.classList.add('bg-danger');
            } else if (strength <= 50) {
                progressBar.classList.add('bg-warning');
            } else if (strength <= 75) {
                progressBar.classList.add('bg-info');
            } else {
                progressBar.classList.add('bg-success');
            }
        });
    }
}

// Password Confirmation Match
function initPasswordMatch() {
    const confirmInput = document.getElementById('confirmPassword');
    const matchIndicator = document.getElementById('passwordMatch');
    const passwordInput = document.getElementById('password');
    
    if (confirmInput && matchIndicator && passwordInput) {
        confirmInput.addEventListener('input', function() {
            const match = this.value === passwordInput.value;
            
            if (this.value) {
                if (match) {
                    matchIndicator.innerHTML = '<span class="text-success"><i class="bi bi-check"></i> Passwords match</span>';
                } else {
                    matchIndicator.innerHTML = '<span class="text-danger"><i class="bi bi-x"></i> Passwords do not match</span>';
                }
            } else {
                matchIndicator.innerHTML = '';
            }
        });
    }
}

// Go Back Function for Error Pages
function initGoBackButtons() {
    const goBackButtons = document.querySelectorAll('[data-action="go-back"]');
    goBackButtons.forEach(button => {
        button.addEventListener('click', function() {
            history.back();
        });
    });
}

// Initialize all auth functions when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    initPasswordToggle();
    initPasswordStrength();
    initPasswordMatch();
    initGoBackButtons();
});

// Export functions for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initPasswordToggle,
        initPasswordStrength,
        initPasswordMatch,
        goBack
    };
}

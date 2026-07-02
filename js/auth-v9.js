// js/auth-v9.js
// Модуль авторизации — Firebase 10.x
// Использует window.auth, window.db

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendEmailVerification,
    applyActionCode,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import {
    ref as dbRef,
    update as dbUpdate,
    set as dbSet,
    remove as dbRemove,
    get as dbGet
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-database.js';

const auth = window.auth;
const db = window.db;

let currentUser = null;
let currentUserName = null;
let tempEmail = null;
let tempPassword = null;
let tempName = null;

function listenAuthChanges() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
const emailName = user.email.split('@')[0];

// Пробуем взять имя из базы данных
dbGet(dbRef(db, `users/${emailName}`)).then(snap => {
    if (snap.exists() && snap.val().name) {
        // Имя есть в базе
        currentUserName = snap.val().name;
    } else if (user.displayName) {
        // Имя есть в Firebase Auth
        currentUserName = user.displayName;
    } else {
        // Fallback на email
        currentUserName = emailName;
    }
    window.currentUserName = currentUserName;
    localStorage.setItem('userEmail', user.email);
    
    // Обновляем данные в БД
    dbUpdate(dbRef(db, `users/${currentUserName}`), {
        email: user.email,
        uid: user.uid,
        lastSeen: Date.now()
    });
    
    // Показываем приложение
    if (typeof window.showApp === 'function') {
        window.showApp();
    } else {
        const check = setInterval(() => {
            if (typeof window.showApp === 'function') {
                clearInterval(check);
                window.showApp();
            }
        }, 100);
    }
}).catch(() => {
    // Ошибка запроса — используем fallback
    currentUserName = user.displayName || emailName;
    window.currentUserName = currentUserName;
    
    if (typeof window.showApp === 'function') window.showApp();
});
            localStorage.setItem('userEmail', user.email);

            dbUpdate(dbRef(db, `users/${currentUserName}`), {
                email: user.email,
                uid: user.uid,
                lastSeen: Date.now()
            });

            // Безопасный вызов showApp
            if (typeof showApp === 'function') {
                showApp();
            } else {
                const checkApp = setInterval(() => {
                    if (typeof showApp === 'function') {
                        clearInterval(checkApp);
                        showApp();
                    }
                }, 100);
            }
        } else {
            currentUser = null;
            currentUserName = null;
            window.currentUserName = null;
            localStorage.removeItem('userEmail');

            document.getElementById('login').style.display = 'flex';
            document.getElementById('app').style.display = 'none';
        }
    });
}

// UI функции
function showLoginForm() {
    document.getElementById('btn-show-login').classList.add('active');
    document.getElementById('btn-show-register').classList.remove('active');
    
    document.getElementById('authButtons').style.display = 'none';
    document.getElementById('authFormsContainer').style.display = 'block';
    document.getElementById('loginForm').style.display = 'flex';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('verifyForm').style.display = 'none';
}

function showRegisterForm() {
    document.getElementById('btn-show-login').classList.remove('active');
    document.getElementById('btn-show-register').classList.add('active');
    
    document.getElementById('authButtons').style.display = 'none';
    document.getElementById('authFormsContainer').style.display = 'block';
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'flex';
    document.getElementById('verifyForm').style.display = 'none';
}

function backToButtons() {
    document.getElementById('btn-show-login').classList.add('active');
    document.getElementById('btn-show-register').classList.remove('active');
    
    document.getElementById('authButtons').style.display = 'flex';
    document.getElementById('authFormsContainer').style.display = 'none';
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('verifyForm').style.display = 'none';
    
    // Очищаем поля
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('regName').value = '';
    document.getElementById('regEmail').value = '';
    document.getElementById('regPassword').value = '';
}

function backToRegister() {
    document.getElementById('registerForm').style.display = 'flex';
    document.getElementById('verifyForm').style.display = 'none';
    tempEmail = null;
    tempPassword = null;
    tempName = null;
}

function togglePasswordVisibility(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (!input || !icon) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.textContent = '🔓';
    } else {
        input.type = 'password';
        icon.textContent = '🔒';
    }
}

// Авторизация
function register() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;

    if (!name || !email || !password) { alert('Заполни все поля'); return; }
    if (!email.includes('@')) { alert('Введи нормальную почту'); return; }
    if (password.length < 6) { alert('Пароль должен быть минимум 6 символов'); return; }
    if (/[.#[\]/]/.test(name)) { alert('Имя не должно содержать символы . $ # [ ] /'); return; }

    tempEmail = email;
    tempPassword = password;
    tempName = name;

    createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            // Используем функцию updateProfile из Firebase
            return updateProfile(userCredential.user, { displayName: name })
                .then(() => sendEmailVerification(userCredential.user));
        })
        .then(() => {
            document.getElementById('registerForm').style.display = 'none';
            document.getElementById('verifyForm').style.display = 'flex';
            document.getElementById('verifyEmailDisplay').textContent = email;
            document.getElementById('verifyCode').focus();
            alert('На твою почту отправлен код подтверждения. Проверь папку "Входящие" и "Спам".');
        })
        .catch((error) => {
            if (error.code === 'auth/email-already-in-use') alert('Эта почта уже зарегистрирована');
            else if (error.code === 'auth/weak-password') alert('Пароль слишком слабый (минимум 6 символов)');
            else if (error.code === 'auth/invalid-email') alert('Некорректный email');
            else alert('Ошибка регистрации: ' + error.message);
            tempEmail = null; tempPassword = null; tempName = null;
        });
}

function confirmCode() {
    const code = document.getElementById('verifyCode').value.trim();
    if (!code || code.length < 6) { alert('Введи код из письма (6 цифр)'); return; }

    applyActionCode(auth, code)
        .then(() => dbSet(dbRef(db, `users/${tempName}`), {
            email: tempEmail,
            uid: auth.currentUser.uid,
            name: tempName,
            emailVerified: true,
            createdAt: Date.now()
        }))
        .then(() => {
            alert('✅ Почта подтверждена! Добро пожаловать, ' + tempName + '!');
            tempEmail = null; tempPassword = null; tempName = null;
        })
        .catch((error) => {
            if (error.code === 'auth/invalid-action-code') alert('Неверный код. Проверь письмо и попробуй снова.');
            else if (error.code === 'auth/expired-action-code') { alert('Код просрочен. Запроси новый.'); backToRegister(); }
            else alert('Ошибка подтверждения: ' + error.message);
        });
}

function login() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) { alert('Заполни почту и пароль'); return; }

    signInWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            const user = userCredential.user;
            const emailName = user.email.split('@')[0];
dbGet(dbRef(db, `users/${emailName}`)).then(snap => {
    if (snap.exists() && snap.val().name) {
        currentUserName = snap.val().name;
    } else {
        currentUserName = user.displayName || emailName;
    }
    window.currentUserName = currentUserName;
    
    if (typeof window.showApp === 'function') window.showApp();
}).catch(() => {
    currentUserName = user.displayName || emailName;
    window.currentUserName = currentUserName;
    if (typeof window.showApp === 'function') window.showApp();
});
        })
        .catch((error) => {
            if (error.code === 'auth/user-not-found') alert('Пользователь с такой почтой не найден');
            else if (error.code === 'auth/wrong-password') alert('Неверный пароль');
            else if (error.code === 'auth/invalid-email') alert('Некорректный email');
            else if (error.code === 'auth/too-many-requests') alert('Слишком много попыток. Попробуй позже.');
            else alert('Ошибка входа: ' + error.message);
        });
}

function logout() {
    localStorage.clear();
    signOut(auth).catch(console.error);
}

// Привязка кнопок (устойчивая к асинхронной загрузке модуля)
function bindButtons() {
    console.log('🔗 Привязываем кнопки авторизации...');

    document.getElementById('btn-show-login')?.addEventListener('click', showLoginForm);
    document.getElementById('btn-show-register')?.addEventListener('click', showRegisterForm);

    document.querySelectorAll('#loginForm .glass-btn, #registerForm .glass-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            backToButtons();
        });
    });

    const verifyBackBtn = document.querySelector('#verifyForm .glass-btn');
    if (verifyBackBtn) verifyBackBtn.addEventListener('click', backToRegister);

    const loginButton = document.querySelector('#loginForm .primary');
    console.log('Кнопка входа найдена:', loginButton);
    if (loginButton) loginButton.addEventListener('click', login);

    const registerButton = document.querySelector('#registerForm .primary');
    if (registerButton) registerButton.addEventListener('click', register);

    const verifyButton = document.querySelector('#verifyForm .primary');
    if (verifyButton) verifyButton.addEventListener('click', confirmCode);

    const lockLogin = document.getElementById('toggleLoginPassword');
    if (lockLogin) lockLogin.addEventListener('click', () => togglePasswordVisibility('loginPassword', 'toggleLoginPassword'));

    const lockReg = document.getElementById('toggleRegPassword');
    if (lockReg) lockReg.addEventListener('click', () => togglePasswordVisibility('regPassword', 'toggleRegPassword'));

    document.getElementById('loginPassword')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    document.getElementById('regPassword')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') register(); });
    document.getElementById('verifyCode')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmCode(); });

    console.log('✅ Кнопки привязаны');
}

// Проверка готовности DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        bindButtons();
        listenAuthChanges();
    });
} else {
    bindButtons();
    listenAuthChanges();
}

// Экспорт функций в глобальную область
window.showLoginForm = showLoginForm;
window.showRegisterForm = showRegisterForm;
window.backToButtons = backToButtons;
window.login = login;
window.register = register;
window.confirmCode = confirmCode;
window.logout = logout;
window.togglePasswordVisibility = togglePasswordVisibility;

// js/auth.js
// Модуль авторизации — регистрация и вход через email/пароль

// Инициализируем Firebase Auth (использует твою старую конфигурацию из app.js)
// Эта строка должна быть после того, как firebase.initializeApp() уже вызван в app.js
let auth;

// Инициализация auth (вызывается из app.js после инициализации Firebase)
function initAuth() {
    auth = firebase.auth(); // Используем auth из старой библиотеки 8.x, она совместима
}

// Текущий пользователь
let currentUser = null;
let currentUserName = null;

// Слушатель изменений авторизации
function listenAuthChanges() {
    auth.onAuthStateChanged((user) => {
        if (user) {
            // Пользователь вошел
            currentUser = user;
            currentUserName = user.displayName || user.email.split('@')[0];
            
            // Сохраняем email как идентификатор
            localStorage.setItem('userEmail', user.email);
            
            // Обновляем данные пользователя в БД
            const userRef = firebase.database().ref(`users/${currentUserName}`);
            userRef.update({
                email: user.email,
                uid: user.uid,
                lastSeen: Date.now()
            });
            
            // Показываем приложение
            showApp();
        } else {
            // Пользователь вышел
            currentUser = null;
            currentUserName = null;
            localStorage.removeItem('userEmail');
            
            // Показываем экран входа
            document.getElementById('login').style.display = 'flex';
            document.getElementById('app').style.display = 'none';
        }
    });
}

// Регистрация нового пользователя
function register() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    
    // Проверки
    if (!name || !email || !password) {
        alert('Заполни все поля');
        return;
    }
    
    if (!email.includes('@')) {
        alert('Введи нормальную почту');
        return;
    }
    
    if (password.length < 6) {
        alert('Пароль должен быть минимум 6 символов');
        return;
    }
    
    if (/[.#[\]/]/.test(name)) {
        alert('Имя не должно содержать символы . $ # [ ] /');
        return;
    }
    
    // Создаем пользователя в Firebase Auth
    auth.createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
            const user = userCredential.user;
            
            // Сохраняем имя пользователя в профиле
            return user.updateProfile({
                displayName: name
            }).then(() => {
                // Создаем запись в БД
                return firebase.database().ref(`users/${name}`).set({
                    email: email,
                    uid: user.uid,
                    name: name,
                    createdAt: Date.now()
                });
            });
        })
        .then(() => {
            alert('Регистрация успешна! Сейчас войдем...');
            // После регистрации пользователь автоматически войдет,
            // сработает onAuthStateChanged и вызовет showApp()
        })
        .catch((error) => {
            // Обработка ошибок
            if (error.code === 'auth/email-already-in-use') {
                alert('Эта почта уже зарегистрирована');
            } else if (error.code === 'auth/weak-password') {
                alert('Пароль слишком слабый');
            } else {
                alert('Ошибка: ' + error.message);
            }
        });
}

// Вход существующего пользователя
function login() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!email || !password) {
        alert('Заполни почту и пароль');
        return;
    }
    
    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            // Успешный вход, onAuthStateChanged сам вызовет showApp()
        })
        .catch((error) => {
            if (error.code === 'auth/user-not-found') {
                alert('Пользователь с такой почтой не найден');
            } else if (error.code === 'auth/wrong-password') {
                alert('Неверный пароль');
            } else {
                alert('Ошибка входа: ' + error.message);
            }
        });
}

// Выход
function logout() {
    localStorage.clear();
    auth.signOut().then(() => {
        // onAuthStateChanged сам покажет экран входа
    });
}

// Показать форму входа
function showLoginForm() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('btn-show-login').className = 'primary';
    document.getElementById('btn-show-register').className = 'glass-btn';
}

// Показать форму регистрации
function showRegisterForm() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('btn-show-login').className = 'glass-btn';
    document.getElementById('btn-show-register').className = 'primary';
}

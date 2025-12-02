// server.js (Обновленный)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Хранилище (В памяти) ---
const users = {}; 
const rooms = { 'general-demo': [] }; // Демо-чат комната

// --- Настройка Multer (как в предыдущей версии) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// --- Middleware (как в предыдущей версии) ---
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const sessionMiddleware = session({
    secret: 'hype_secret_key_123',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } 
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

// --- Роуты Аутентификации (как в предыдущей версии) ---

app.post('/register', upload.single('avatar'), (req, res) => {
    const { username, password } = req.body;
    if (users[username]) return res.send('<script>alert("Пользователь занят"); window.location="/"</script>');
    
    users[username] = {
        username,
        password, 
        avatar: req.file ? `/uploads/${req.file.filename}` : 'https://via.placeholder.com/150',
        status: 'Online',
        friends: ['TestUser'] // Для быстрого теста
    };
    
    req.session.user = users[username];
    res.redirect('/');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users[username];
    if (user && user.password === password) {
        req.session.user = user;
        res.redirect('/');
    } else {
        res.send('<script>alert("Неверные данные"); window.location="/"</script>');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/me', (req, res) => {
    if (req.session.user) res.json(users[req.session.user.username]); 
    else res.status(401).json(null);
});

// --- Socket.IO (Реалтайм и WebRTC сигналлинг) ---
io.on('connection', (socket) => {
    const session = socket.request.session;
    let username = null;
    if (session && session.user) {
        username = session.user.username;
        socket.join(username); 
        console.log(`User connected: ${username}`);
    } else {
        return;
    }

    // Сообщения в ЛС
    socket.on('chat_message', (data) => {
        const { toUser, message } = data;
        io.to(toUser).emit('receive_message', { from: username, message });
        socket.emit('receive_message', { from: username, message, isMe: true });
    });

    // --- WebRTC Сигналлинг ---

    // 1. Попытка начать звонок (пользователь кликнул на иконку)
    socket.on('call_attempt', (targetUser) => {
        console.log(`${username} is calling ${targetUser}`);
        // Проверяем, онлайн ли цель и не занята ли
        io.to(targetUser).emit('incoming_call', { from: username });
    });

    // 2. Обмен ICE-кандидатами (сетевая информация)
    socket.on('ice_candidate', (data) => {
        io.to(data.to).emit('ice_candidate', { from: username, candidate: data.candidate });
    });

    // 3. Обмен SDP-описаниями (информация о медиа)
    socket.on('sdp_offer', (data) => {
        io.to(data.to).emit('sdp_offer', { from: username, sdp: data.sdp });
    });

    socket.on('sdp_answer', (data) => {
        io.to(data.to).emit('sdp_answer', { from: username, sdp: data.sdp });
    });

    // 4. Завершение звонка
    socket.on('call_end', (targetUser) => {
        io.to(targetUser).emit('call_end', { from: username });
    });

    // --- Демо-чат для быстрого теста ---
    socket.on('demo_message', (message) => {
        io.to('general-demo').emit('receive_demo_message', { from: username, message });
    });
    socket.join('general-demo');
});

server.listen(3000, () => {
    console.log('HypeScord запущен на http://localhost:3000');
});
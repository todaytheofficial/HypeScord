// server.js (Полная реализация с SQLite)

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer'); // Для обработки аватаров

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

// =========================================================================
// 1. Database Initialization (SQLite)
// =========================================================================

// База данных будет храниться в файле users.db
const db = new sqlite3.Database(path.join(__dirname, 'users.db'), (err) => {
    if (err) {
        console.error("Ошибка при открытии базы данных:", err.message);
    } else {
        console.log('Подключение к базе данных SQLite users.db установлено.');
        // Создание таблицы пользователей и таблицы друзей
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                avatar TEXT DEFAULT 'https://via.placeholder.com/150'
            );
        `, (err) => {
            if (err) console.error("Ошибка при создании таблицы users:", err.message);
        });
        
        db.run(`
            CREATE TABLE IF NOT EXISTS friends (
                user_id INTEGER NOT NULL,
                friend_id INTEGER NOT NULL,
                status TEXT NOT NULL, -- 'pending', 'accepted'
                PRIMARY KEY (user_id, friend_id)
            );
        `, (err) => {
            if (err) console.error("Ошибка при создании таблицы friends:", err.message);
        });
    }
});

// =========================================================================
// 2. Middleware & Configuration
// =========================================================================

// Настройка Express Session
app.use(session({
    secret: 'co$@#$@#%(*de_t@#$@#he_pa%#@$%ssword_cook%@#%$ie_filesdsj*@#%MK#U@(*FEDWJFRH@#(FDS', // Замените на надежный секретный ключ
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 часа
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // Обслуживание статических файлов

// Настройка multer для загрузки файлов (аватаров)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/avatars/'); // Сохраняем аватары в public/avatars
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
// Убедитесь, что папка public/avatars существует!

// =========================================================================
// 3. Authentication Routes
// =========================================================================

// Проверка сессии
app.get('/me', (req, res) => {
    if (req.session.user) {
        res.json({ username: req.session.user.username, avatar: req.session.user.avatar });
    } else {
        res.status(401).send('Unauthorized');
    }
});

// Регистрация
app.post('/register', upload.single('avatar'), async (req, res) => {
    const { username, password } = req.body;
    // Определяем путь к аватару. По умолчанию, если файл не загружен.
    const avatarPath = req.file ? `/avatars/${req.file.filename}` : 'https://via.placeholder.com/150';

    if (!username || !password) return res.status(400).send('Заполните все поля.');

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)`, 
            [username, hashedPassword, avatarPath], 
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(409).send('Пользователь с таким именем уже существует.');
                    }
                    console.error('Ошибка регистрации:', err.message);
                    return res.status(500).send('Ошибка сервера при регистрации.');
                }
                
                // Автоматический вход после регистрации
                req.session.user = { id: this.lastID, username, avatar: avatarPath };
                res.redirect('/');
            }
        );
    } catch (error) {
        console.error('Ошибка хеширования:', error);
        res.status(500).send('Ошибка сервера.');
    }
});

// Вход
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err || !user) {
            return res.status(401).send('Неверное имя пользователя или пароль.');
        }

        if (await bcrypt.compare(password, user.password)) {
            req.session.user = { id: user.id, username: user.username, avatar: user.avatar };
            res.redirect('/');
        } else {
            res.status(401).send('Неверное имя пользователя или пароль.');
        }
    });
});

// Выход
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).send('Ошибка выхода.');
        res.redirect('/');
    });
});

// =========================================================================
// 4. Socket.IO Handlers (Chat & Friends Logic)
// =========================================================================

// Карта для хранения активных Socket.ID по UserID
const onlineUsers = new Map(); 

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    const username = socket.handshake.query.username;

    if (!userId) {
        // Если пользователь не аутентифицирован (на этапе аутентификации),
        // он не должен подключаться к Socket.IO в реальном проекте.
        socket.disconnect(true);
        return;
    }
    
    // Добавляем пользователя в список онлайн
    onlineUsers.set(username, socket.id);
    console.log(`User ${username} connected with ID ${socket.id}`);
    io.emit('user_online', username); // Уведомляем всех о подключении

    // --- Friend Request Logic ---

    socket.on('friend_request', async (targetUsername) => {
        if (!onlineUsers.has(targetUsername)) {
            // В реальном приложении: сохранить запрос в БД со статусом 'pending'
            return socket.emit('error', 'Пользователь не найден или не в сети.');
        }
        
        const targetSocketId = onlineUsers.get(targetUsername);
        
        // В реальном приложении: проверить, не являются ли они уже друзьями
        // и не висит ли уже запрос.
        
        // Отправка уведомления целевому пользователю
        io.to(targetSocketId).emit('new_friend_request', { from: username });
    });

    socket.on('accept_friend', (requesterUsername) => {
        // В реальном приложении: обновить статус в таблице 'friends' на 'accepted'
        // и добавить друг другу.
        console.log(`${username} принял запрос от ${requesterUsername}`);

        // Уведомить отправителя запроса о принятии
        const requesterSocketId = onlineUsers.get(requesterUsername);
        if (requesterSocketId) {
            io.to(requesterSocketId).emit('request_accepted', { from: username });
        }
    });
    
    // --- Chat Logic ---

    socket.on('chat_message', (data) => {
        const { toUser, message } = data;
        const targetSocketId = onlineUsers.get(toUser);
        
        // Отправляем сообщение себе (исходящее)
        socket.emit('receive_message', { from: username, message, isMe: true });

        // Отправляем сообщение собеседнику (входящее)
        if (targetSocketId) {
            io.to(targetSocketId).emit('receive_message', { from: username, message, isMe: false });
        } else {
            // В реальном приложении: сохранить в базе данных как непрочитанное
            console.log(`Пользователь ${toUser} оффлайн. Сообщение не доставлено.`);
        }
    });

    socket.on('demo_message', (message) => {
        // Демо-канал: отправка всем
        io.emit('receive_demo_message', { from: username, message });
    });

    // --- WebRTC Signaling (Placeholder) ---

    socket.on('sdp_offer', (data) => {
        const targetSocketId = onlineUsers.get(data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('sdp_offer', { from: username, sdp: data.sdp });
        }
    });
    
    socket.on('sdp_answer', (data) => {
        const targetSocketId = onlineUsers.get(data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('sdp_answer', { from: username, sdp: data.sdp });
        }
    });

    socket.on('ice_candidate', (data) => {
        const targetSocketId = onlineUsers.get(data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice_candidate', { from: username, candidate: data.candidate });
        }
    });

    socket.on('call_end', (targetUsername) => {
        const targetSocketId = onlineUsers.get(targetUsername);
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_end', { from: username });
        }
    });

    // --- Disconnect ---

    socket.on('disconnect', () => {
        console.log(`User ${username} disconnected.`);
        onlineUsers.delete(username);
        io.emit('user_offline', username);
    });
});

// =========================================================================
// 5. Server Start
// =========================================================================

server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`* База данных пользователей хранится локально в users.db`);
    console.log(`* Для запуска: node server.js`);
});
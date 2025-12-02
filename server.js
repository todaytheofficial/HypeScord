// server.js (Полная реализация с SQLite, персистентными сообщениями и друзьями)

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

// =========================================================================
// 1. Database Initialization & Helpers (CORE PERSISTENCE)
// =========================================================================

// Проверка и создание папки для аватаров
const AVATARS_DIR = path.join(__dirname, 'public', 'avatars');
if (!fs.existsSync(AVATARS_DIR)) {
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
    console.log(`Папка для аватаров (${AVATARS_DIR}) создана.`);
}

// Инициализация базы данных и создание таблиц
const db = new sqlite3.Database(path.join(__dirname, 'users.db'), async (err) => {
    if (err) {
        return console.error("Ошибка при открытии базы данных:", err.message);
    }
    console.log('Подключение к базе данных SQLite users.db установлено. (Сообщения и друзья будут сохраняться)');

    db.serialize(() => {
        // Таблица пользователей
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                avatar TEXT DEFAULT 'https://via.placeholder.com/150'
            );
        `);
        
        // Таблица друзей/заявок (status: 'pending' или 'accepted')
        db.run(`
            CREATE TABLE IF NOT EXISTS friends (
                user_id INTEGER NOT NULL,
                friend_id INTEGER NOT NULL,
                status TEXT NOT NULL, 
                PRIMARY KEY (user_id, friend_id)
            );
        `);

        // Таблица сообщений (ДЛЯ СОХРАНЕНИЯ СООБЩЕНИЙ)
        db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_id INTEGER NOT NULL,
                to_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(from_id) REFERENCES users(id),
                FOREIGN KEY(to_id) REFERENCES users(id)
            );
        `);
    });
});

// Карта для хранения активных Socket.ID по UserID
const onlineUsers = new Map(); 

/** Получить ID пользователя по его никнейму. */
function getUserId(username) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, row) => {
            if (err) return reject(err);
            resolve(row ? row.id : null);
        });
    });
}

/** Получить никнейм пользователя по его ID. */
function getUsername(userId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT username FROM users WHERE id = ?`, [userId], (err, row) => {
            if (err) return reject(err);
            resolve(row ? row.username : null);
        });
    });
}

/** Получить список друзей и входящих заявок (ДЛЯ СОХРАНЕНИЯ ДРУЗЕЙ). */
async function getInitialUserData(userId) {
    // Получаем список принятых друзей
    const friendsQuery = `
        SELECT u.username, f.status 
        FROM friends f
        JOIN users u ON u.id = f.friend_id 
        WHERE f.user_id = ? AND f.status = 'accepted'
    `;
    // Получаем список входящих запросов
    const requestsQuery = `
        SELECT u.username AS fromUser
        FROM friends f
        JOIN users u ON u.id = f.user_id 
        WHERE f.friend_id = ? AND f.status = 'pending'
    `;

    return new Promise((resolve, reject) => {
        db.all(friendsQuery, [userId], (err, friends) => {
            if (err) return reject(err);
            db.all(requestsQuery, [userId], (err, requests) => {
                if (err) return reject(err);
                resolve({ 
                    // Возвращаем только никнеймы друзей
                    friends: friends.map(f => f.username), 
                    pendingRequests: requests.map(r => r.fromUser) 
                });
            });
        });
    });
}


// =========================================================================
// 2. Middleware & Configuration
// =========================================================================

app.use(session({
    secret: 'YOUR_SECRET_KEY_STRONG', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } 
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, AVATARS_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// =========================================================================
// 3. Authentication Routes
// =========================================================================
// (Код аутентификации без изменений)

app.get('/me', (req, res) => {
    if (req.session.user) {
        res.json({ id: req.session.user.id, username: req.session.user.username, avatar: req.session.user.avatar });
    } else {
        res.status(401).send('Unauthorized');
    }
});

app.post('/register', upload.single('avatar'), async (req, res) => {
    const { username, password } = req.body;
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
                
                req.session.user = { id: this.lastID, username, avatar: avatarPath };
                res.redirect('/');
            }
        );
    } catch (error) {
        res.status(500).send('Ошибка сервера.');
    }
});

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

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).send('Ошибка выхода.');
        res.redirect('/');
    });
});

// =========================================================================
// 4. Socket.IO Handlers (Persistence Core Logic)
// =========================================================================

io.on('connection', async (socket) => {
    const userId = parseInt(socket.handshake.query.userId);
    const username = socket.handshake.query.username;

    if (!userId || !username) {
        return socket.disconnect(true);
    }
    
    onlineUsers.set(username, socket.id);
    console.log(`User ${username} connected.`);
    io.emit('user_online', username);

    // 1. Отправка начальных данных (Друзья и Заявки)
    try {
        const initialData = await getInitialUserData(userId);
        socket.emit('initial_data', initialData);
    } catch (e) {
        console.error('Error fetching initial data:', e);
    }

    // --- Message History (ЗАГРУЗКА СОХРАНЕННЫХ СООБЩЕНИЙ) ---

    socket.on('get_history', async (partnerUsername) => {
        const partnerId = await getUserId(partnerUsername);
        if (!partnerId) return;

        // Запрос истории сообщений (в обе стороны)
        const historyQuery = `
            SELECT T1.id, T1.message, T1.timestamp, 
                   CASE WHEN T1.from_id = ? THEN ? ELSE ? END AS from_username
            FROM messages T1
            WHERE (T1.from_id = ? AND T1.to_id = ?) OR (T1.from_id = ? AND T1.to_id = ?)
            ORDER BY T1.timestamp ASC
        `;
        
        db.all(historyQuery, 
            [userId, username, partnerUsername, 
             userId, partnerId, partnerId, userId], 
            (err, rows) => {
                if (err) {
                    console.error('Error fetching history:', err.message);
                    return socket.emit('error', 'Не удалось загрузить историю сообщений.');
                }

                socket.emit('message_history', { 
                    partner: partnerUsername, 
                    messages: rows.map(row => ({
                        from: row.from_username,
                        message: row.message,
                        isMe: row.from_username === username
                    }))
                });
        });
    });

    // --- Chat Logic (СОХРАНЕНИЕ СООБЩЕНИЙ) ---

    socket.on('chat_message', async (data) => {
        const { toUser, message } = data;
        const targetSocketId = onlineUsers.get(toUser);
        const toId = await getUserId(toUser);
        
        if (!toId) return socket.emit('error', 'Получатель не найден.');

        // 1. Сохранение сообщения в базе данных
        db.run(`INSERT INTO messages (from_id, to_id, message) VALUES (?, ?, ?)`, 
            [userId, toId, message], (err) => {
                if (err) console.error('Error saving message:', err.message);
            }
        );

        // 2. Отправка себе (для немедленного отображения)
        socket.emit('receive_message', { from: username, message, isMe: true });

        // 3. Отправка собеседнику
        if (targetSocketId) {
            io.to(targetSocketId).emit('receive_message', { from: username, message, isMe: false });
        }
    });
    
    // --- Friend Request Logic (СОХРАНЕНИЕ ДРУЗЕЙ) ---

    socket.on('friend_request', async (targetUsername) => {
        const targetId = await getUserId(targetUsername);
        if (!targetId || targetId === userId) {
            return socket.emit('error', 'Пользователь не найден или это вы.');
        }

        const existingQuery = `SELECT status FROM friends WHERE user_id = ? AND friend_id = ?`;
        db.get(existingQuery, [userId, targetId], async (err, row) => {
            if (row) {
                if (row.status === 'pending') return socket.emit('error', 'Запрос уже отправлен.');
                if (row.status === 'accepted') return socket.emit('error', 'Вы уже друзья.');
            }
            
            // Проверка на входящий запрос
            db.get(existingQuery, [targetId, userId], async (err, reciprocalRow) => {
                if (reciprocalRow && reciprocalRow.status === 'pending') {
                    return socket.emit('error', 'У вас уже есть входящий запрос от этого пользователя.');
                }
                
                // Сохранение запроса в БД
                db.run(`INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')`, 
                    [userId, targetId], (err) => {
                        if (err) {
                           return socket.emit('error', 'Ошибка сохранения запроса в БД.');
                        }
                    }
                );
                
                // Отправка уведомления
                const targetSocketId = onlineUsers.get(targetUsername);
                if (targetSocketId) {
                    io.to(targetSocketId).emit('new_friend_request', { from: username });
                } else {
                    socket.emit('info', 'Запрос отправлен, будет доставлен при входе пользователя.');
                }
            });
        });
    });

    socket.on('accept_friend', async (requesterUsername) => {
        const requesterId = await getUserId(requesterUsername);
        if (!requesterId) return;

        // 1. Обновить статус запроса (отправителя) на accepted
        db.run(`UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ? AND status = 'pending'`, 
            [requesterId, userId]
        );
        
        // 2. Создать обратную запись для двусторонней дружбы
        db.run(`INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')`, 
            [userId, requesterId]
        );

        // 3. Уведомить отправителя
        const requesterSocketId = onlineUsers.get(requesterUsername);
        if (requesterSocketId) {
            io.to(requesterSocketId).emit('request_accepted', { from: username });
        }
    });

    socket.on('reject_friend', async (requesterUsername) => {
        const requesterId = await getUserId(requesterUsername);
        if (!requesterId) return;

        // Удаляем запись
        db.run(`DELETE FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'pending'`, 
            [requesterId, userId]
        );
    });
    
    // --- Disconnect ---

    socket.on('disconnect', () => {
        onlineUsers.delete(username);
        io.emit('user_offline', username);
        console.log(`User ${username} disconnected.`);
    });
});

// =========================================================================
// 5. Server Start
// =========================================================================

server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
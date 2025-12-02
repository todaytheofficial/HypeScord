// public/client.js (ФИНАЛЬНАЯ ВЕРСИЯ с WebRTC, Material Icons, исправленной логикой звонков и файлов)

// =========================================================================
// Глобальные переменные и Конфигурация WebRTC
// =========================================================================

var currentUser = null; 
var currentChatUser = 'general-demo'; 
var callPartner = null;
var isCallActive = false;
var localStream = null;
var peerConnection = null;
var screenShareStream = null;
var isSharingScreen = false;
var friendRequests = []; 
var isAwaitingAnswer = false; 
var incomingSdpOffer = null; // Переменная для хранения входящего SDP

const ICE_SERVERS = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// =========================================================================
// 1. UI Initialization & Socket Setup
// =========================================================================

window.showAuth = (type) => {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    loginForm.style.display = type === 'login' ? 'block' : 'none';
    registerForm.style.display = type === 'register' ? 'block' : 'none';
    
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tabs button:nth-child(${type === 'login' ? 1 : 2})`).classList.add('active');
};

window.onload = async () => {
    const res = await fetch('/me');
    const authScreen = document.getElementById('auth-screen');
    
    applyInitialTheme();

    if (res.ok) {
        currentUser = await res.json();
        initApp();
        authScreen.style.display = 'none';
    } else {
        authScreen.style.display = 'flex';
        showAuth('login'); 
    }
};

function initApp() {
    document.getElementById('app-screen').style.display = 'flex';
    document.getElementById('current-username').innerText = currentUser.username;
    
    const userAvatarEl = document.getElementById('current-user-avatar');
    userAvatarEl.src = currentUser.avatar || 'https://via.placeholder.com/150'; 
    
    if (currentUser.username === 'Today_Idk') {
        userAvatarEl.classList.add('special-border');
    }
    
    // Инициализация Socket.IO
    window.socket = io({ 
        query: { 
            userId: currentUser.id, 
            username: currentUser.username 
        } 
    });
    setupSocketListeners();
}

function setupSocketListeners() {
    window.socket.on('initial_data', (data) => {
        const friendsList = document.getElementById('friends-list');
        friendsList.innerHTML = ''; 
        
        data.friends.forEach(f => addFriendToUI(`${f} (Offline)`, f));
        friendRequests = data.pendingRequests.map(username => ({ from: username }));
        
        openChat('general-demo'); 
    });

    window.socket.on('message_history', (data) => {
        const container = document.getElementById('messages-container');
        container.innerHTML = ''; 

        if (data.partner === currentChatUser) {
            data.messages.forEach(msg => displayMessage(msg));
        }
    });

    window.socket.on('receive_message', (data) => {
        if (data.from === currentChatUser || (data.isMe && data.from === currentUser.username)) {
            displayMessage(data);
        } 
    });

    window.socket.on('receive_demo_message', (data) => {
        if (currentChatUser === 'general-demo') {
            data.isMe = data.from === currentUser.username;
            displayMessage(data, true);
        }
    });

    window.socket.on('new_friend_request', (data) => {
        if (!friendRequests.find(req => req.from === data.from)) {
            friendRequests.push(data);
            alert(`Новый запрос в друзья от ${data.from}!`);
        }
    });

    window.socket.on('request_accepted', (data) => {
        addFriendToUI(`${data.from} (Online)`, data.from);
        alert(`${data.from} принял ваш запрос в друзья!`);
    });

    window.socket.on('user_online', (username) => {
        updateFriendStatus(username, true);
    });

    window.socket.on('user_offline', (username) => {
        updateFriendStatus(username, false);
    });

    window.socket.on('error', (message) => {
        alert('Ошибка сервера: ' + message);
    });

    // --- WebRTC Listeners ---
    window.socket.on('sdp_offer', handleSdpOffer);
    window.socket.on('sdp_answer', handleSdpAnswer);
    window.socket.on('ice_candidate', handleIceCandidate);
    window.socket.on('call_end', handleCallEnd);
}

// --- Friends List UI ---

function addFriendToUI(nameWithStatus, rawName, avatarUrl = 'https://via.placeholder.com/50') {
    const list = document.getElementById('friends-list');
    const existing = document.getElementById(`friend-${rawName}`);
    if (existing) return;

    const div = document.createElement('div');
    div.id = `friend-${rawName}`; 
    div.className = 'friend-item';
    
    const borderClass = rawName === 'Today_Idk' ? ' special-border' : '';
    div.innerHTML = `<img src="${avatarUrl}" alt="${rawName}" class="${borderClass}"><span>${nameWithStatus}</span>`;
    
    div.onclick = () => openChat(rawName);
    list.appendChild(div);
}

function updateFriendStatus(username, isOnline) {
    const friendElement = document.getElementById(`friend-${username}`);
    if (friendElement) {
        const span = friendElement.querySelector('span');
        span.textContent = `${username} (${isOnline ? 'Online' : 'Offline'})`;
    }
}

window.openChat = function(username) {
    currentChatUser = username;
    document.getElementById('chat-with-name').innerText = username;
    document.getElementById('messages-container').innerHTML = '';

    const callBtn = document.getElementById('call-btn');
    callBtn.style.display = username !== 'general-demo' ? 'flex' : 'none';
    
    document.querySelectorAll('.friend-item').forEach(el => el.classList.remove('active'));
    
    if (username !== 'general-demo') {
        const friendElement = document.getElementById(`friend-${username}`);
        if (friendElement) {
             friendElement.classList.add('active');
             window.socket.emit('get_history', username);
        }
    }
}

// --- Theme & Settings Logic ---
function applyInitialTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeUI(savedTheme);
}

function updateThemeUI(theme) {
    const isDark = theme === 'dark';
    const themeNameEl = document.getElementById('current-theme-name');
    const themeBtnEl = document.getElementById('theme-btn');
    
    if (themeNameEl) { 
        themeNameEl.innerText = isDark ? 'Темная' : 'Светлая'; 
    }
    if (themeBtnEl) {
        themeBtnEl.innerText = isDark ? 'Сменить на Светлую' : 'Сменить на Темную';
    }
}

window.toggleTheme = function() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeUI(newTheme);
}

window.toggleSettings = function() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    }
}

// =========================================================================
// 2. Messaging & File Logic (ИСПРАВЛЕНА ЛОГИКА ФАЙЛОВ)
// =========================================================================

window.sendMessage = function() {
    const input = document.getElementById('msg-input');
    const msg = input.value.trim();
    if (!msg) return;

    if (currentChatUser === 'general-demo') {
        window.socket.emit('demo_message', { message: msg });
    } else if (currentChatUser) {
        // Отправляем только текстовое сообщение
        window.socket.emit('chat_message', { toUser: currentChatUser, message: msg });
    }
    input.value = '';
}

window.sendFile = async (files) => {
    if (files.length === 0 || !currentChatUser || currentChatUser === 'general-demo') return;

    const file = files[0];
    
    if (file.size > 5 * 1024 * 1024) { 
        alert("Файл слишком большой. Максимальный размер 5MB.");
        document.getElementById('file-input').value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const fileData = e.target.result;
        
        // Отправляем объект file. Добавляем message: '' для предотвращения ошибки NOT NULL на сервере.
        window.socket.emit('chat_message', { 
            toUser: currentChatUser, 
            file: {
                data: fileData,
                name: file.name,
                type: file.type
            },
            message: '' 
        });
        
        document.getElementById('file-input').value = '';
    };
    reader.readAsDataURL(file);
}


function displayMessage(data, isDemo = false) {
    const container = document.getElementById('messages-container');
    const div = document.createElement('div');
    const author = data.from;
    const isOutgoing = data.isMe && !isDemo; 

    div.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
    
    const borderClass = author === 'Today_Idk' ? ' special-border' : '';
    let avatarHtml = `<img src="https://via.placeholder.com/50" alt="${author}" class="${borderClass}">`; 
    
    let contentHtml = '';

    if (data.message && data.message.trim() !== '') {
        contentHtml = data.message;
    } 
    else if (data.file && data.file.data) {
        const file = data.file;
        const mimeType = file.type.split('/')[0];
        let mediaTag = '';

        if (mimeType === 'image') {
            mediaTag = `<img src="${file.data}" alt="${file.name}">`;
        } else if (mimeType === 'video' || mimeType === 'audio') {
            const tag = mimeType === 'video' ? 'video' : 'audio';
            mediaTag = `<${tag} controls src="${file.data}"></${tag}>`;
        } else {
            // Иконка Material Icons для вложения
            mediaTag = `<div class="file-info"><i class="material-icons">attachment</i><span>${file.name}</span></div>`;
        }

        contentHtml = `<div class="media-attachment">${mediaTag}</div>`;
    } else {
        // Если сообщение пустое и файла нет, не отображаем.
        return; 
    }

    div.innerHTML = `${avatarHtml}<div class="content"><span class="author">${author}</span>${contentHtml}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}


// =========================================================================
// 3. Friend Request Logic
// =========================================================================

window.toggleRequestModal = function() {
    const modal = document.getElementById('requests-modal');
    if (modal.style.display === 'flex') {
        modal.style.display = 'none';
    } else {
        renderFriendRequests();
        modal.style.display = 'flex';
    }
}

window.sendFriendRequest = function() {
    const target = document.getElementById('friend-req-input').value.trim();
    if (!target || target === currentUser.username) {
        alert('Введите корректный ник.');
        return;
    }
    
    window.socket.emit('friend_request', target);
    alert(`Запрос в друзья отправлен пользователю: ${target}.`);
    document.getElementById('friend-req-input').value = '';
};

function renderFriendRequests() {
    const container = document.getElementById('friend-requests-list');
    container.innerHTML = '';
    
    if (friendRequests.length === 0) {
        container.innerHTML = '<p class="no-requests">Нет входящих запросов.</p>';
        return;
    }

    friendRequests.forEach(request => {
        const div = document.createElement('div');
        div.className = 'request-item';
        div.innerHTML = `
            <span>${request.from}</span>
            <div>
                <button class="accept-btn" onclick="handleFriendRequest('${request.from}', 'accept')">Принять</button>
                <button class="reject-btn" onclick="handleFriendRequest('${request.from}', 'reject')">Отклонить</button>
            </div>
        `;
        container.appendChild(div);
    });
}

function handleFriendRequest(username, action) {
    if (action === 'accept') {
        window.socket.emit('accept_friend', username);
        addFriendToUI(`${username} (Online)`, username);
        alert(`Вы приняли запрос от ${username}.`);
    } else {
        window.socket.emit('reject_friend', username);
        alert(`Вы отклонили запрос от ${username}.`);
    }

    friendRequests = friendRequests.filter(req => req.from !== username);
    renderFriendRequests();
}


// =========================================================================
// 4. WebRTC Implementation (Call Core)
// =========================================================================

window.startCall = async function() {
    if (isCallActive || currentChatUser === 'general-demo' || isAwaitingAnswer) return;

    try {
        // Получаем локальный медиапоток
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        document.getElementById('current-call-partner').innerText = currentChatUser;
        document.getElementById('call-ui').style.display = 'flex';
        document.getElementById('local-video').srcObject = localStream;

        await setupPeerConnection(currentChatUser);
        
        // Создаем и отправляем SDP Offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        window.socket.emit('sdp_offer', { to: currentChatUser, sdp: peerConnection.localDescription });

        // Устанавливаем состояние ожидания
        isAwaitingAnswer = true;
        callPartner = currentChatUser;
        document.getElementById('calling-name').innerText = currentChatUser;
        document.getElementById('awaiting-answer-box').style.display = 'flex'; 
        
    } catch (err) {
        console.error("Ошибка доступа к медиа:", err);
        alert('Невозможно получить доступ к микрофону/камере. Проверьте разрешения.');
        endCall(false); 
    }
}

async function setupPeerConnection(targetUser) {
    if (peerConnection) {
        peerConnection.close();
    }
    peerConnection = new RTCPeerConnection(ICE_SERVERS);
    
    // Добавляем локальные треки
    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }


    peerConnection.ontrack = (event) => {
        const remoteVideo = document.getElementById('remote-video');
        const screenShareVideo = document.getElementById('screen-share-video');
        
        // Определяем, является ли это потоком демонстрации экрана
        const videoTracks = event.streams[0].getVideoTracks();
        if (videoTracks.length > 0 && videoTracks[0].label.includes('screen')) {
            screenShareVideo.srcObject = event.streams[0];
            screenShareVideo.style.display = 'block';
        } else {
            remoteVideo.srcObject = event.streams[0];
        }
    };
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            window.socket.emit('ice_candidate', { to: targetUser, candidate: event.candidate });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'disconnected' || 
            peerConnection.iceConnectionState === 'failed' ||
            peerConnection.iceConnectionState === 'closed') {
            console.log("ICE Connection State:", peerConnection.iceConnectionState);
            if (isCallActive) {
                endCall(true, "Соединение разорвано или сбой.");
            }
        }
    };
}

// ИСПРАВЛЕНА ЛОГИКА ПРИГЛАШЕНИЯ
function handleSdpOffer(data) {
    // Если звонок еще не активен и мы не ждем ответа
    if (!isCallActive && !isAwaitingAnswer) {
        callPartner = data.from;
        // Показываем UI входящего звонка (ту самая "менюшка")
        document.getElementById('caller-name').innerText = data.from;
        document.getElementById('incoming-call-box').style.display = 'flex';
        // Сохраняем SDP для обработки при нажатии "answerCall()"
        window.incomingSdpOffer = data;
    }
    
    // Если мы уже в звонке (используется для обмена треками)
    if (peerConnection && isCallActive) { 
        // Не вызываем answerCall(), если это не новый SDP для замены треков
        // В данном случае, просто игнорируем или обрабатываем как re-negotiation
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
            .then(() => peerConnection.createAnswer())
            .then(answer => peerConnection.setLocalDescription(answer))
            .then(() => {
                window.socket.emit('sdp_answer', { to: data.from, sdp: peerConnection.localDescription });
            })
            .catch(e => console.error("Error handling mid-call offer:", e));
    }
}

function handleSdpAnswer(data) {
    if (peerConnection && peerConnection.remoteDescription === null) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        // Скрываем окно ожидания, так как звонок принят
        document.getElementById('awaiting-answer-box').style.display = 'none';
        isAwaitingAnswer = false;
        isCallActive = true;
    }
}

function handleIceCandidate(data) {
    if (peerConnection) {
        try {
            if (peerConnection.remoteDescription) {
                peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch (e) {
            console.error('Error adding received ICE candidate', e);
        }
    }
}

function handleCallEnd(data) {
    if (data.from === callPartner) {
        endCall(false); // Завершить локально, не отправляя сигнал обратно
        alert(`Звонок с ${data.from} завершен.`);
    }
}

// ИСПРАВЛЕНА ЛОГИКА ОТВЕТА (Принятие входящего звонка)
window.answerCall = async function() {
    const data = window.incomingSdpOffer;
    if (!data || isCallActive) return; 

    document.getElementById('incoming-call-box').style.display = 'none';
    isCallActive = true; 
    const targetUser = callPartner; 
    window.incomingSdpOffer = null; // Очищаем

    // Получаем медиапоток, если его еще нет
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (err) {
            alert('Невозможно получить доступ к микрофону/камере.');
            rejectCall(false); // Отклоняем без отправки сигнала
            return;
        }
    }
        
    document.getElementById('current-call-partner').innerText = targetUser;
    document.getElementById('call-ui').style.display = 'flex';
    document.getElementById('local-video').srcObject = localStream;
        
    // 1. Создаем PeerConnection и добавляем треки
    if (!peerConnection) {
        await setupPeerConnection(targetUser);
    }
    
    // 2. Устанавливаем offer, который мы сохранили
    if (data && data.sdp) {
         await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    }
    
    // 3. Создаем и отправляем ответ (Answer)
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    window.socket.emit('sdp_answer', { to: targetUser, sdp: peerConnection.localDescription });
}


window.endCall = function(sendSignal = true, message = "Звонок завершен.") {
    if (!isCallActive && !isAwaitingAnswer) return;

    if (isSharingScreen) {
        stopScreenShare();
    }

    if (callPartner && sendSignal) {
        window.socket.emit('call_end', callPartner);
    }

    // Закрытие PeerConnection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // Остановка медиа треков
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Сброс UI
    document.getElementById('call-ui').style.display = 'none';
    document.getElementById('incoming-call-box').style.display = 'none';
    document.getElementById('awaiting-answer-box').style.display = 'none'; 
    document.getElementById('local-screen-indicator').style.display = 'none';
    
    const videoElements = ['remote-video', 'local-video', 'screen-share-video'];
    videoElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.srcObject = null;
    });

    isCallActive = false;
    isAwaitingAnswer = false; 
    callPartner = null;
    incomingSdpOffer = null; // Очищаем
    
    document.getElementById('mic-toggle').classList.remove('off');
    document.getElementById('camera-toggle').classList.remove('off');
    document.getElementById('screen-share-toggle').classList.remove('active');
}


window.rejectCall = function(sendSignal = true) {
    document.getElementById('incoming-call-box').style.display = 'none';
    if (callPartner && sendSignal) {
        window.socket.emit('call_end', callPartner); 
        alert(`Вы отклонили вызов от ${callPartner}.`);
    }
    callPartner = null;
    incomingSdpOffer = null;
}


// =========================================================================
// 5. Media Controls (Mic, Cam, Screen Share)
// =========================================================================

window.toggleMic = function() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    const button = document.getElementById('mic-toggle');
    
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        button.classList.toggle('off', !audioTrack.enabled);
        button.querySelector('.material-icons').innerText = audioTrack.enabled ? 'mic' : 'mic_off';
    }
}

window.toggleCamera = function() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    const button = document.getElementById('camera-toggle');
    
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        button.classList.toggle('off', !videoTrack.enabled);
        button.querySelector('.material-icons').innerText = videoTrack.enabled ? 'videocam' : 'videocam_off';
    }
}

window.toggleScreenShare = async function() {
    if (!peerConnection || isAwaitingAnswer || !isCallActive) return;

    if (isSharingScreen) {
        stopScreenShare();
    } else {
        try {
            // Запрашиваем поток демонстрации экрана
            screenShareStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const screenTrack = screenShareStream.getVideoTracks()[0];

            // Находим отправителя видео и заменяем трек
            const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
            if (sender) {
                await sender.replaceTrack(screenTrack);
            }
            
            // Отображаем локально демонстрацию экрана
            document.getElementById('local-video').srcObject = screenShareStream;

            // Обработка завершения демонстрации (например, через кнопку в браузере)
            screenTrack.onended = () => {
                if (isSharingScreen) {
                    stopScreenShare();
                }
            };

            document.getElementById('local-screen-indicator').style.display = 'flex';

            isSharingScreen = true;
            document.getElementById('screen-share-toggle').classList.add('active');

        } catch (err) {
            console.error('Ошибка при демонстрации экрана:', err);
            isSharingScreen = false;
            document.getElementById('screen-share-toggle').classList.remove('active');
            document.getElementById('local-screen-indicator').style.display = 'none';
        }
    }
}

function stopScreenShare() {
    if (!isSharingScreen || !localStream) return;
    
    // Заменяем трек обратно на локальную камеру
    const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
    const localVideoTrack = localStream.getVideoTracks()[0];

    if (sender && localVideoTrack) {
        sender.replaceTrack(localVideoTrack);
    }
    
    // Останавливаем поток демонстрации
    if (screenShareStream) {
        screenShareStream.getTracks().forEach(track => track.stop());
        screenShareStream = null;
    }

    // Сброс UI
    document.getElementById('local-video').srcObject = localStream;
    document.getElementById('screen-share-toggle').classList.remove('active');
    document.getElementById('local-screen-indicator').style.display = 'none'; 
    isSharingScreen = false;
}
// public/client.js
// Глобальные переменные объявлены через 'var' для совместимости с HTML-обработчиками
// Глобальный объект window.socket будет инициализирован после успешного входа
var currentUser = null; 
var currentChatUser = 'general-demo'; 
var callPartner = null;
var isCallActive = false;
var localStream = null;
var peerConnection = null;
var screenShareStream = null;
var isSharingScreen = false;
var friendRequests = []; 

// WebRTC Configuration
const ICE_SERVERS = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// =========================================================================
// 1. UI Initialization & Theme Logic
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
    document.getElementById('current-user-avatar').src = currentUser.avatar;
    
    // ---------------------------------------------------------------------
    // Инициализация Socket.IO после аутентификации
    // ---------------------------------------------------------------------
    window.socket = io({ 
        query: { 
            userId: currentUser.id, 
            username: currentUser.username 
        } 
    });
    setupSocketListeners();
    // ---------------------------------------------------------------------

    const friendsList = document.getElementById('friends-list');
    friendsList.innerHTML = ''; 
    
    openChat('general-demo'); 
}

function setupSocketListeners() {
    // Messaging Logic
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

    // Friend Request Logic
    window.socket.on('new_friend_request', (data) => {
        if (!friendRequests.find(req => req.from === data.from)) {
            friendRequests.push(data);
            alert(`Новый запрос в друзья от ${data.from}!`);
            if (document.getElementById('requests-modal').style.display === 'flex') {
                 renderFriendRequests();
            }
        }
    });

    window.socket.on('request_accepted', (data) => {
        addFriendToUI(`${data.from} (Online)`, data.from);
        alert(`${data.from} принял ваш запрос в друзья!`);
    });
    
    // Error Handling
    window.socket.on('error', (message) => {
        alert('Ошибка сервера: ' + message);
    });

    // Online/Offline Statuses
    window.socket.on('user_online', (username) => {
        updateFriendStatus(username, true);
    });

    window.socket.on('user_offline', (username) => {
        updateFriendStatus(username, false);
    });
    
    // WebRTC Listeners
    window.socket.on('sdp_offer', handleSdpOffer);
    window.socket.on('sdp_answer', handleSdpAnswer);
    window.socket.on('ice_candidate', handleIceCandidate);
    window.socket.on('call_end', handleCallEnd);
}

function handleSdpOffer(data) {
    if (!peerConnection) {
        callPartner = data.from;
        // Показываем входящий звонок
        document.getElementById('caller-name').innerText = data.from;
        document.getElementById('incoming-call-box').style.display = 'block';
    }
    
    if (peerConnection) {
        // Если уже в звонке (был ответ answerCall) или мы инициатор
        answerCall(data);
    }
}

function handleSdpAnswer(data) {
    if (peerConnection && peerConnection.remoteDescription === null) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
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
        alert('Звонок завершен собеседником.');
        endCall();
    }
}


function addFriendToUI(nameWithStatus, rawName, avatarUrl = 'https://via.placeholder.com/150') {
    const list = document.getElementById('friends-list');
    const existing = document.getElementById(`friend-${rawName}`);
    if (existing) return;

    const div = document.createElement('div');
    div.id = `friend-${rawName}`; 
    div.className = 'friend-item';
    div.innerHTML = `<img src="${avatarUrl}" alt="${rawName}"><span>${nameWithStatus}</span>`;
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

function openChat(username) {
    currentChatUser = username;
    document.getElementById('chat-with-name').innerText = username;
    document.getElementById('messages-container').innerHTML = '';

    const callBtn = document.getElementById('call-btn');
    callBtn.style.display = username !== 'general-demo' ? 'flex' : 'none';
    
    document.querySelectorAll('.friend-item').forEach(el => el.classList.remove('active'));
    
    if (username !== 'general-demo') {
        const friendElement = Array.from(document.querySelectorAll('.friend-item span')).find(span => span.textContent.startsWith(username));
        if (friendElement) {
             friendElement.closest('.friend-item').classList.add('active');
        }
    }
}

window.toggleSettings = function() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    }
}

// --- Theme Implementation ---
function applyInitialTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeUI(savedTheme);
}

function updateThemeUI(theme) {
    const isDark = theme === 'dark';
    document.getElementById('current-theme-name').innerText = isDark ? 'Темная' : 'Светлая';
    document.getElementById('theme-btn').innerText = isDark ? 'Сменить на Светлую' : 'Сменить на Темную';
}

window.toggleTheme = function() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeUI(newTheme);
}

// =========================================================================
// 2. Messaging Logic
// =========================================================================

function sendMessage() {
    const input = document.getElementById('msg-input');
    const msg = input.value.trim();
    if (!msg) return;

    if (currentChatUser === 'general-demo') {
        window.socket.emit('demo_message', msg);
    } else if (currentChatUser) {
        window.socket.emit('chat_message', { toUser: currentChatUser, message: msg });
    }
    input.value = '';
}

function displayMessage(data, isDemo = false) {
    const container = document.getElementById('messages-container');
    const div = document.createElement('div');
    const author = data.isMe || isDemo ? data.from : data.from;
    const isOutgoing = data.isMe && !isDemo; 

    div.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
    div.innerHTML = `<span class="author">${author}</span>${data.message}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// =========================================================================
// 3. Friend Request Logic
// =========================================================================

window.sendFriendRequest = function() {
    const target = document.getElementById('friend-req-input').value.trim();
    if (!target || target === currentUser.username) {
        alert('Введите корректный ник, чтобы отправить запрос.');
        return;
    }
    
    window.socket.emit('friend_request', target);
    alert(`Запрос в друзья отправлен пользователю: ${target}`);
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

window.toggleRequestModal = function() {
    const modal = document.getElementById('requests-modal');
    if (modal.style.display === 'flex') {
        modal.style.display = 'none';
    } else {
        renderFriendRequests();
        modal.style.display = 'flex';
    }
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

async function startCall() {
    if (isCallActive || currentChatUser === 'general-demo') return;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        document.getElementById('current-call-partner').innerText = currentChatUser;
        document.getElementById('call-ui').style.display = 'flex';
        document.getElementById('local-video').srcObject = localStream;

        await setupPeerConnection(currentChatUser);
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        window.socket.emit('sdp_offer', { to: currentChatUser, sdp: peerConnection.localDescription });

        isCallActive = true;
        callPartner = currentChatUser;
    } catch (err) {
        console.error("Ошибка доступа к медиа:", err);
        alert('Невозможно получить доступ к микрофону/камере. Проверьте разрешения.');
    }
}

async function setupPeerConnection(targetUser) {
    peerConnection = new RTCPeerConnection(ICE_SERVERS);
    
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        const remoteVideo = document.getElementById('remote-video');
        const screenShareVideo = document.getElementById('screen-share-video');
        
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
}

// Принятие звонка (используется и для входящего звонка, и как ответ на offer)
async function answerCall(data) {
    document.getElementById('incoming-call-box').style.display = 'none';
    isCallActive = true;
    const targetUser = callPartner; // Имя собеседника

    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (err) {
            console.error("Ошибка доступа к медиа:", err);
            alert('Невозможно получить доступ к микрофону/камере.');
            rejectCall();
            return;
        }
    }
        
    document.getElementById('current-call-partner').innerText = targetUser;
    document.getElementById('call-ui').style.display = 'flex';
    document.getElementById('local-video').srcObject = localStream;
        
    if (!peerConnection) {
        await setupPeerConnection(targetUser);
    }
    
    if (data && data.sdp.type === 'offer') {
        // Установка удаленного описания и отправка ответа (answer)
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        window.socket.emit('sdp_answer', { to: data.from, sdp: peerConnection.localDescription });
    }
}


function endCall() {
    if (!isCallActive) return;

    if (isSharingScreen) {
        stopScreenShare();
    }

    if (callPartner) {
        window.socket.emit('call_end', callPartner);
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    document.getElementById('call-ui').style.display = 'none';
    document.getElementById('incoming-call-box').style.display = 'none';
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('local-video').srcObject = null;
    document.getElementById('screen-share-video').srcObject = null;
    document.getElementById('screen-share-video').style.display = 'none';

    document.getElementById('mic-toggle').classList.remove('off');
    document.getElementById('camera-toggle').classList.remove('off');
    document.getElementById('screen-share-toggle').classList.remove('active');

    isCallActive = false;
    callPartner = null;
}

window.rejectCall = function() {
    document.getElementById('incoming-call-box').style.display = 'none';
    if (callPartner) {
        window.socket.emit('call_end', callPartner); 
    }
    callPartner = null;
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
    }
}

window.toggleCamera = function() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    const button = document.getElementById('camera-toggle');
    
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        button.classList.toggle('off', !videoTrack.enabled);
    }
}

window.toggleScreenShare = async function() {
    if (!peerConnection) return;

    if (isSharingScreen) {
        stopScreenShare();
    } else {
        try {
            screenShareStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const screenTrack = screenShareStream.getVideoTracks()[0];

            const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
            if (sender) {
                await sender.replaceTrack(screenTrack);
            }
            
            document.getElementById('local-video').srcObject = screenShareStream;

            screenTrack.onended = () => {
                if (isSharingScreen) {
                    stopScreenShare();
                }
            };

            isSharingScreen = true;
            document.getElementById('screen-share-toggle').classList.add('active');

        } catch (err) {
            console.error('Ошибка при демонстрации экрана:', err);
            isSharingScreen = false;
            document.getElementById('screen-share-toggle').classList.remove('active');
        }
    }
}

function stopScreenShare() {
    if (!isSharingScreen || !localStream) return;
    
    const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
    const localVideoTrack = localStream.getVideoTracks()[0];

    if (sender && localVideoTrack) {
        sender.replaceTrack(localVideoTrack);
    }
    
    if (screenShareStream) {
        screenShareStream.getTracks().forEach(track => track.stop());
        screenShareStream = null;
    }

    document.getElementById('local-video').srcObject = localStream;
    document.getElementById('screen-share-toggle').classList.remove('active');
    isSharingScreen = false;
}
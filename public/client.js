// public/client.js
// Глобальные переменные объявлены через 'var' для совместимости с HTML-обработчиками
const socket = io();
var currentUser = null; 
var currentChatUser = 'general-demo'; 
var callPartner = null;
var isCallActive = false;
var localStream = null;
var peerConnection = null;
var screenShareStream = null;
var isSharingScreen = false;
var friendRequests = []; // Массив для хранения входящих запросов

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
    
    // Инициализация темы
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
    
    const friendsList = document.getElementById('friends-list');
    friendsList.innerHTML = ''; 
    addFriendToUI('Вася Пупкин'); 
    
    openChat('general-demo'); 
}

function addFriendToUI(name, avatarUrl = 'https://via.placeholder.com/150') {
    const list = document.getElementById('friends-list');
    const div = document.createElement('div');
    div.className = 'friend-item';
    div.innerHTML = `<img src="${avatarUrl}" alt="${name}"><span>${name}</span>`;
    div.onclick = () => openChat(name);
    list.appendChild(div);
}

function openChat(username) {
    currentChatUser = username;
    document.getElementById('chat-with-name').innerText = username;
    document.getElementById('messages-container').innerHTML = '';

    const callBtn = document.getElementById('call-btn');
    callBtn.style.display = username !== 'general-demo' ? 'flex' : 'none';
    
    document.querySelectorAll('.friend-item').forEach(el => el.classList.remove('active'));
    
    if (username !== 'general-demo') {
        const friendElement = Array.from(document.querySelectorAll('.friend-item span')).find(span => span.textContent === username);
        if (friendElement) {
             friendElement.closest('.friend-item').classList.add('active');
        }
    }
}

function toggleSettings() {
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
        socket.emit('demo_message', msg);
    } else if (currentChatUser) {
        socket.emit('chat_message', { toUser: currentChatUser, message: msg });
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

socket.on('receive_message', (data) => {
    if (data.from === currentChatUser || data.isMe) {
        displayMessage(data);
    } 
});

socket.on('receive_demo_message', (data) => {
    if (currentChatUser === 'general-demo') {
        data.isMe = data.from === currentUser.username;
        displayMessage(data, true);
    }
});

// =========================================================================
// 3. Friend Request Logic
// =========================================================================

/**
 * Отправляет запрос в друзья выбранному пользователю.
 */
window.sendFriendRequest = function() {
    const target = document.getElementById('friend-req-input').value.trim();
    if (!target || target === currentUser.username) {
        alert('Введите корректный ник, чтобы отправить запрос.');
        return;
    }
    
    socket.emit('friend_request', target);
    alert(`Запрос в друзья отправлен пользователю: ${target}`);
    document.getElementById('friend-req-input').value = '';
};

/**
 * Рендерит список входящих запросов в модальном окне.
 */
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

/**
 * Открывает/закрывает модальное окно с запросами в друзья.
 */
window.toggleRequestModal = function() {
    const modal = document.getElementById('requests-modal');
    if (modal.style.display === 'flex') {
        modal.style.display = 'none';
    } else {
        renderFriendRequests();
        modal.style.display = 'flex';
    }
}

/**
 * Обрабатывает принятие или отклонение запроса.
 */
function handleFriendRequest(username, action) {
    if (action === 'accept') {
        socket.emit('accept_friend', username);
        addFriendToUI(username);
        alert(`Вы приняли запрос от ${username}.`);
    } else {
        socket.emit('reject_friend', username);
        alert(`Вы отклонили запрос от ${username}.`);
    }

    friendRequests = friendRequests.filter(req => req.from !== username);
    renderFriendRequests();
}

// --- Socket Listeners для запросов ---

socket.on('new_friend_request', (data) => {
    if (!friendRequests.find(req => req.from === data.from)) {
        friendRequests.push(data);
        alert(`Новый запрос в друзья от ${data.from}!`);
        // В реальном приложении: добавить счетчик на кнопку запросов
    }
});

socket.on('request_accepted', (data) => {
    addFriendToUI(data.from);
    alert(`${data.from} принял ваш запрос в друзья!`);
});

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
        socket.emit('sdp_offer', { to: currentChatUser, sdp: peerConnection.localDescription });

        isCallActive = true;
        callPartner = currentChatUser;
        socket.emit('call_attempt', currentChatUser); 
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
        
        // Определяем, является ли поток экраном
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
            socket.emit('ice_candidate', { to: targetUser, candidate: event.candidate });
        }
    };
}

async function answerCall() {
    document.getElementById('incoming-call-box').style.display = 'none';
    isCallActive = true;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        document.getElementById('current-call-partner').innerText = callPartner;
        document.getElementById('call-ui').style.display = 'flex';
        document.getElementById('local-video').srcObject = localStream;
        
        await setupPeerConnection(callPartner);

    } catch (err) {
        console.error("Ошибка доступа к медиа:", err);
        alert('Невозможно получить доступ к микрофону/камере.');
        rejectCall();
    }
}

socket.on('sdp_offer', async (data) => {
    if (!peerConnection) {
        callPartner = data.from;
        await answerCall(); 
    }

    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (data.sdp.type === 'offer') {
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('sdp_answer', { to: data.from, sdp: peerConnection.localDescription });
        }
    }
});

socket.on('sdp_answer', async (data) => {
    if (peerConnection && peerConnection.remoteDescription === null) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    }
});

socket.on('ice_candidate', async (data) => {
    if (peerConnection) {
        try {
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch (e) {
            console.error('Error adding received ICE candidate', e);
        }
    }
});

function endCall() {
    if (!isCallActive) return;

    if (isSharingScreen) {
        stopScreenShare();
    }

    if (callPartner) {
        socket.emit('call_end', callPartner);
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

function rejectCall() {
    document.getElementById('incoming-call-box').style.display = 'none';
    if (callPartner) {
        socket.emit('call_end', callPartner); 
    }
    callPartner = null;
}

socket.on('call_end', (data) => {
    if (data.from === callPartner) {
        alert('Звонок завершен собеседником.');
        endCall();
    }
});

// =========================================================================
// 5. Media Controls (Mic, Cam, Screen Share)
// =========================================================================

function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    const button = document.getElementById('mic-toggle');
    
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        button.classList.toggle('off', !audioTrack.enabled);
    }
}

function toggleCamera() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    const button = document.getElementById('camera-toggle');
    
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        button.classList.toggle('off', !videoTrack.enabled);
    }
}

async function toggleScreenShare() {
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
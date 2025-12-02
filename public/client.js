// public/client.js (ФИНАЛЬНАЯ ВЕРСИЯ с файлами, WebRTC и исправлением UI ошибок)

// Глобальные переменные
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

// WebRTC Configuration
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
        // Ошибка 401: Пользователь не аутентифицирован - показываем экран входа
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

// --- Theme & Settings Logic (Исправление ошибки client.js:194) ---
function applyInitialTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeUI(savedTheme);
}

function updateThemeUI(theme) {
    const isDark = theme === 'dark';
    // Проверка на наличие элементов, чтобы избежать TypeError: Cannot set properties of null
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
// 2. Messaging & File Logic
// =========================================================================

window.sendMessage = function() {
    const input = document.getElementById('msg-input');
    const msg = input.value.trim();
    if (!msg) return;

    if (currentChatUser === 'general-demo') {
        window.socket.emit('demo_message', { message: msg });
    } else if (currentChatUser) {
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
        
        window.socket.emit('chat_message', { 
            toUser: currentChatUser, 
            file: {
                data: fileData,
                name: file.name,
                type: file.type
            }
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

    if (data.message) {
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
            mediaTag = `<div class="file-info"><svg class="icon-attachment" viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V6h-1.5z"/></svg><span>${file.name}</span></div>`;
        }

        contentHtml = `<div class="media-attachment">${mediaTag}</div>`;
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
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        document.getElementById('current-call-partner').innerText = currentChatUser;
        document.getElementById('call-ui').style.display = 'flex';
        document.getElementById('local-video').srcObject = localStream;

        await setupPeerConnection(currentChatUser);
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        window.socket.emit('sdp_offer', { to: currentChatUser, sdp: peerConnection.localDescription });

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
    
    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }


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

function handleSdpOffer(data) {
    if (!peerConnection && !isAwaitingAnswer) {
        callPartner = data.from;
        document.getElementById('caller-name').innerText = data.from;
        document.getElementById('incoming-call-box').style.display = 'flex';
    }
    
    if (peerConnection && !isAwaitingAnswer) { 
        answerCall(data);
    }
}

function handleSdpAnswer(data) {
    if (peerConnection && peerConnection.remoteDescription === null) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
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
        endCall(false); 
    }
}

window.answerCall = async function(data) {
    document.getElementById('incoming-call-box').style.display = 'none';
    isCallActive = true; 
    const targetUser = callPartner; 

    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (err) {
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
    
    // Принимаем offer
    if (data && data.sdp) {
         await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    }
    
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
    
    document.getElementById('mic-toggle').classList.remove('off');
    document.getElementById('camera-toggle').classList.remove('off');
    document.getElementById('screen-share-toggle').classList.remove('active');
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
    if (!peerConnection || isAwaitingAnswer) return;

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
    document.getElementById('local-screen-indicator').style.display = 'none'; 
    isSharingScreen = false;
}
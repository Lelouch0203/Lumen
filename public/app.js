// WiFi Chat Client Application
class WiFiChat {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.rooms = new Map();
        this.currentChat = null;
        this.notificationSoundEnabled = true;
        this.fileTransfers = new Map();
        this.peerConnections = new Map(); // WebRTC peer connections
        this.isWebRTCSupported = typeof SimplePeer !== 'undefined';
        
        // Performance optimizations
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.lastMessageTime = 0;
        this.messageThrottleDelay = 100; // 100ms between messages

        this.init();
    }

    buildPreviewHtml(message) {
        if (!message.preview) return '';
        const p = message.preview;
        if (p.type && p.url) {
            if (p.type.startsWith('image/')) {
                return `<div class="preview"><img src="${p.url}" alt="image"/></div>`;
            } else if (p.type.startsWith('video/')) {
                return `<div class="preview"><video controls src="${p.url}"></video></div>`;
            } else if (p.type.startsWith('audio/')) {
                return `<div class="preview"><audio controls src="${p.url}"></audio></div>`;
            } else if (p.type.startsWith('text/')) {
                return `<div class="preview"><iframe src="${p.url}" style="width:260px;height:160px;border:none;border-radius:8px;background:#111"></iframe></div>`;
            }
        }
        return '';
    }

    populateEmojiPicker(container) {
        const emojis = [
            '😀','😃','😄','😁','😆','😅','😂','🤣','🥲','☺️','😊','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🫠','🫡','🤗','🤭','🤫','🤔','😐','😑','😶','🫥','😶‍🌫️','🙄','😬','😮‍💨','🤥','😌','😴','🤤','😪','😮','😯','😲','🥱','😧','😦','😨','😰','😥','😢','😭','😱','😳','🤯','🥵','🥶','😶‍🌫️','😡','😠','🤬','😤','👍','👎','👏','🙏','🔥','💯','🎉','❤️','💙','💚','💛','💜','🖤','🤍','🤎'
        ];
        emojis.forEach(e => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = e;
            btn.addEventListener('click', () => {
                const input = document.getElementById('messageInput');
                const start = input.selectionStart || input.value.length;
                const before = input.value.substring(0, start);
                const after = input.value.substring(start);
                input.value = before + e + after;
                input.focus();
                input.selectionStart = input.selectionEnd = start + e.length;
            });
            container.appendChild(btn);
        });
    }

    init() {
        this.initializeIndexedDB();
        this.registerServiceWorker();
        this.setupOfflineDetection();
        this.checkSession();
        this.setupEventListeners();
        this.requestNotificationPermission();
    }

    onReact(messageId, emoji) {
        const action = 'toggle';
        if (this.currentChat.type === 'room') {
            this.socket.emit('room:reaction', { roomId: this.currentChat.id, messageId, emoji, action });
            this.applyReaction(messageId, emoji, this.currentUser.userId, action);
        }
    }

    applyReaction(messageId, emoji, userId, action) {
        const container = document.getElementById(`reactions-${messageId}`);
        if (!container) return;
        const key = `${emoji}`;
        let countEl = container.querySelector(`[data-emoji="${key}"]`);
        if (!countEl) {
            countEl = document.createElement('span');
            countEl.className = 'reaction-count';
            countEl.dataset.emoji = key;
            countEl.dataset.count = '0';
            countEl.textContent = `${emoji} 0`;
            container.appendChild(countEl);
        }
        let count = parseInt(countEl.dataset.count || '0', 10);
        if (action === 'toggle') {
            count = count + 1;
        }
        countEl.dataset.count = String(count);
        countEl.textContent = `${emoji} ${count}`;
    }

    // Session Management
    checkSession() {
        const session = localStorage.getItem('p2p_session');
        if (session) {
            const sessionData = JSON.parse(session);
            const now = new Date().getTime();
            
            if (sessionData.expiry > now) {
                this.currentUser = sessionData;
                this.showApp();
                this.connectToServer();
                return;
            }
        }
        this.showUserSetup();
    }

    saveSession(userData) {
        const expiry = new Date().getTime() + (30 * 60 * 1000); // 30 minutes
        const sessionData = { ...userData, expiry };
        localStorage.setItem('p2p_session', JSON.stringify(sessionData));
        this.currentUser = sessionData;
    }

    // UI Management
    showUserSetup() {
        document.getElementById('userSetupModal').classList.remove('hidden');
        document.getElementById('appContainer').classList.add('hidden');
    }

    showApp() {
        document.getElementById('userSetupModal').classList.add('hidden');
        document.getElementById('appContainer').classList.remove('hidden');
        document.getElementById('currentUserName').textContent = this.currentUser.name;
        if (this.currentUser.avatarUrl) {
            const avatar = document.getElementById('currentUserAvatar');
            avatar.style.backgroundImage = `url('${this.currentUser.avatarUrl}')`;
        } else {
            const avatar = document.getElementById('currentUserAvatar');
            avatar.style.backgroundImage = '';
        }
        document.body.classList.toggle('light', !!this.currentUser.lightTheme);
    }

    // Socket.IO Connection
    connectToServer() {
        if (typeof io === 'undefined') {
            this.showNotification('Socket.IO library not loaded. Please refresh the page.', 'error');
            return;
        }
        
        this.socket = io();
        
        this.socket.on('connect', () => {
            this.updateConnectionStatus(true);
            this.socket.emit('user:join', {
                name: this.currentUser.name,
                userId: this.currentUser.userId,
                avatarUrl: this.currentUser.avatarUrl
            });
            // Process any offline messages
            this.processOfflineMessages();
        });

        this.socket.on('disconnect', () => {
            this.updateConnectionStatus(false);
        });

        this.socket.on('user:joined', (data) => {
            this.currentUser.userId = data.userId;
            this.saveSession(this.currentUser);
            
            // Display server stats if available
            if (data.serverStats) {
                this.showNotification(`Connected! ${data.serverStats.totalUsers}/${data.serverStats.maxUsers} users online`, 'success');
            }
        });

        this.socket.on('user:list', (users) => {
            // Users list is no longer needed for peer functionality
        });

        this.socket.on('room:list', (rooms) => {
            this.updateRoomsList(rooms);
        });

        this.socket.on('room:created', (data) => {
            this.showNotification('Room created successfully', 'success');
            this.hideRoomModal();
            // Auto-join the created room
            setTimeout(() => {
                this.joinRoom(data.roomId);
            }, 500);
        });

        this.socket.on('room:joined', (data) => {
            this.showNotification(`Joined room: ${data.room.name}`, 'success');
            // Auto-open room chat
            setTimeout(() => {
                this.startRoomChat(data.roomId);
            }, 300);
        });

        this.socket.on('room:kicked', (data) => {
            this.showNotification('You were removed from the room', 'warning');
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.closeChat();
            }
        });

        this.socket.on('room:left', (data) => {
            this.showNotification('Left room successfully', 'success');
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.closeChat();
            }
        });

        this.socket.on('error', (data) => {
            this.showNotification(data.message, 'error');
        });


        this.socket.on('room:update', (data) => {
            // Update room in local storage
            this.rooms.set(data.roomId, data.room);
            this.updateRoomsList(Array.from(this.rooms.values()));
        });

        // Room typing indicator
        this.socket.on('room:typing', (data) => {
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.showTyping(true, data.userId);
                clearTimeout(this.typingTimeout);
                this.typingTimeout = setTimeout(() => this.showTyping(false), 1500);
            }
        });


        // Room message handling
        this.socket.on('room:message', (data) => {
            // Always save the message, regardless of chat panel state
            this.saveChatMessage(data.roomId, data.message);
            
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                // Display message if chat is currently open
                this.displayMessage(data.message, false);
            } else {
                // Handle background message (user is not in this chat room)
                this.handleBackgroundMessage('room', data.roomId, data.message);
                
                // Only show notification if user is NOT in the same chat room and message is not from current user
                if (data.message.userId !== this.currentUser.userId) {
                    const roomName = this.rooms.get(data.roomId)?.name || 'room';
                    this.showNotificationAlert(`New message in ${roomName}`, data.message.text, () => {
                        this.startRoomChat(data.roomId);
                    });
                }
            }
        });

        this.socket.on('room:message-edit', (data) => {
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.applyMessageEdit(data.messageId, data.newText);
            }
        });

        this.socket.on('room:message-delete', (data) => {
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.applyMessageDelete(data.messageId);
            }
        });

        this.socket.on('room:reaction', (data) => {
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.applyReaction(data.messageId, data.emoji, data.userId, data.action);
            }
        });

        // Room file transfer handlers
        this.socket.on('room:file:start', (data) => {
            this.handleRoomFileTransferStart(data);
        });

        this.socket.on('room:file:chunk', (data) => {
            this.handleRoomFileTransferChunk(data);
        });

        this.socket.on('room:file:end', (data) => {
            this.handleRoomFileTransferEnd(data);
        });

        // WebRTC signaling handlers
        this.socket.on('webrtc:offer', (data) => {
            this.handleWebRTCOffer(data);
        });

        this.socket.on('webrtc:answer', (data) => {
            this.handleWebRTCAnswer(data);
        });

        this.socket.on('webrtc:ice-candidate', (data) => {
            this.handleWebRTCIceCandidate(data);
        });
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('connectionStatus');
        indicator.classList.toggle('disconnected', !connected);
    }

    // Event Listeners Setup
    setupEventListeners() {
        // User Setup
        document.getElementById('joinNetworkBtn').addEventListener('click', () => {
            const name = document.getElementById('displayNameInput').value.trim();
            const avatarUrl = document.getElementById('avatarUrlInput').value.trim();
            const lightTheme = document.getElementById('themeToggleInput').checked;
            if (name) {
                this.saveSession({ name, avatarUrl, lightTheme });
                this.showApp();
                this.connectToServer();
            }
        });

        // Tab Navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Room Creation
        document.getElementById('createPublicRoomBtn').addEventListener('click', () => {
            this.showRoomModal(false);
        });

        document.getElementById('createPrivateRoomBtn').addEventListener('click', () => {
            this.showRoomModal(true);
        });

        document.getElementById('createRoomBtn').addEventListener('click', () => {
            this.createRoom();
        });

        document.getElementById('cancelRoomBtn').addEventListener('click', () => {
            this.hideRoomModal();
        });

        // Private Room Join
        document.getElementById('joinPrivateRoomBtn').addEventListener('click', () => {
            const pin = document.getElementById('privateRoomPin').value;
            if (pin && pin.length === 4) {
                // Find private room and join
                this.joinRoomWithPin(pin);
            }
        });

        // Chat
        document.getElementById('closeChatBtn').addEventListener('click', () => {
            this.closeChat();
        });

        document.getElementById('sendMessageBtn').addEventListener('click', () => {
            this.sendMessage();
        });

        const msgInput = document.getElementById('messageInput');
        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
            this.emitTyping();
        });

        // File Upload
        document.getElementById('attachFileBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                Array.from(e.target.files).forEach(file => {
                    this.sendRoomFile(file);
                });
                e.target.value = '';
            }
        });

        // Emoji picker
        const emojiBtn = document.getElementById('emojiBtn');
        const emojiPicker = document.getElementById('emojiPicker');
        if (emojiBtn && emojiPicker) {
            emojiBtn.addEventListener('click', () => {
                if (emojiPicker.childElementCount === 0) {
                    this.populateEmojiPicker(emojiPicker);
                }
                emojiPicker.classList.toggle('hidden');
                // Position picker near the button
                const rect = emojiBtn.getBoundingClientRect();
                const panelRect = document.getElementById('chatPanel').getBoundingClientRect();
                emojiPicker.style.right = `${Math.max(20, panelRect.right - rect.right)}px`;
            });
            document.addEventListener('click', (e) => {
                if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
                    emojiPicker.classList.add('hidden');
                }
            });
        }


        // Discover servers button
        const discoverBtn = document.getElementById('discoverServersBtn');
        if (discoverBtn) {
            discoverBtn.addEventListener('click', () => {
                this.discoverLocalServers();
            });
        }

        // Theme toggle button
        const themeBtn = document.getElementById('themeToggleBtn');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                const isLight = !document.body.classList.contains('light');
                document.body.classList.toggle('light', isLight);
                this.currentUser.lightTheme = isLight;
                this.saveSession(this.currentUser);
            });
        }

        // Edit profile
        const editBtn = document.getElementById('editProfileBtn');
        const editModal = document.getElementById('editProfileModal');
        if (editBtn && editModal) {
            const open = () => {
                document.getElementById('editNameInput').value = this.currentUser.name || '';
                document.getElementById('editAvatarInput').value = this.currentUser.avatarUrl || '';
                editModal.classList.remove('hidden');
            };
            const close = () => editModal.classList.add('hidden');
            editBtn.addEventListener('click', open);
            document.getElementById('cancelEditProfileBtn').addEventListener('click', close);
            document.getElementById('saveEditProfileBtn').addEventListener('click', () => {
                const newName = document.getElementById('editNameInput').value.trim();
                const newAvatar = document.getElementById('editAvatarInput').value.trim();
                if (!newName) {
                    this.showNotification('Name cannot be empty', 'error');
                    return;
                }
                this.currentUser.name = newName;
                this.currentUser.avatarUrl = newAvatar;
                this.saveSession(this.currentUser);
                document.getElementById('currentUserName').textContent = newName;
                const avatar = document.getElementById('currentUserAvatar');
                avatar.style.backgroundImage = newAvatar ? `url('${newAvatar}')` : '';
                this.socket.emit('user:update', { name: newName, avatarUrl: newAvatar });
                close();
            });
        }
    }

    // Tab Management
    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(tabName).classList.add('active');
        
        // Refresh room list when switching to public or private rooms tabs
        if (tabName === 'public-rooms' || tabName === 'private-rooms') {
            this.refreshRoomList();
        }
    }

    // Room Management
    showRoomModal(isPrivate) {
        document.getElementById('roomModal').classList.remove('hidden');
        document.getElementById('roomModalTitle').textContent = 
            isPrivate ? 'Create Private Room' : 'Create Public Room';
        document.getElementById('pinSection').classList.toggle('hidden', !isPrivate);
        document.getElementById('roomNameInput').value = '';
        document.getElementById('roomPinInput').value = '';
        document.getElementById('roomNameInput').focus();
    }

    hideRoomModal() {
        document.getElementById('roomModal').classList.add('hidden');
    }

    createRoom() {
        const name = document.getElementById('roomNameInput').value.trim();
        const isPrivate = !document.getElementById('pinSection').classList.contains('hidden');
        const pin = document.getElementById('roomPinInput').value;
        const maxMembers = document.getElementById('maxMembersInput')?.value || 50;

        if (!name) {
            this.showNotification('Please enter a room name', 'error');
            return;
        }

        if (isPrivate && (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin))) {
            this.showNotification('Please enter a 4-digit numeric PIN', 'error');
            return;
        }

        const maxMembersNum = parseInt(maxMembers);
        if (isNaN(maxMembersNum) || maxMembersNum < 2 || maxMembersNum > 50) {
            this.showNotification('Max members must be between 2 and 50', 'error');
            return;
        }

        if (this.socket && this.socket.connected) {
            this.socket.emit('room:create', { name, isPrivate, pin, maxMembers: maxMembersNum });
        } else {
            this.showNotification('Not connected to server. Please wait and try again.', 'error');
            return;
        }
        // UX: show creating feedback
        this.showNotification(isPrivate ? 'Creating private room…' : 'Creating public room…', 'info');
    }

    joinRoom(roomId, pin = null) {
        if (this.socket && this.socket.connected) {
            this.socket.emit('room:join', { roomId, pin });
        } else {
            this.showNotification('Not connected to server. Please wait and try again.', 'error');
        }
    }

    joinRoomWithPin(pin) {
        if (this.socket && this.socket.connected) {
            this.socket.emit('room:joinByPin', { pin });
        } else {
            this.showNotification('Not connected to server. Please wait and try again.', 'error');
        }
    }

    // Room List Updates
    
    refreshRoomList() {
        // Repopulate room lists with existing room data
        if (this.rooms.size > 0) {
            this.updateRoomsList(Array.from(this.rooms.values()));
        } else if (this.socket && this.socket.connected) {
            // If no rooms in memory, request fresh room list from server
            this.socket.emit('room:list:request');
        }
    }

    updateRoomsList(rooms) {
        const publicContainer = document.getElementById('publicRoomsList');
        const privateContainer = document.getElementById('privateRoomsList');
        
        publicContainer.innerHTML = '';
        privateContainer.innerHTML = '';

        rooms.forEach(room => {
            const tile = this.createRoomTile(room);
            if (room.isPrivate) {
                privateContainer.appendChild(tile);
            } else {
                publicContainer.appendChild(tile);
            }
        });

        this.rooms.clear();
        rooms.forEach(room => {
            this.rooms.set(room.id, room);
        });
        
        // Update lobby with joined rooms
        this.updateMyRooms();
        this.updateLobbyStats();
    }


    createRoomTile(room) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        
        const isLead = room.leadUserId === this.currentUser.userId;
        const isMember = room.members.some(m => m.id === this.currentUser.userId);
        
        tile.innerHTML = `
            <div class="tile-header">
                <span class="tile-title">${this.escapeHtml(room.name)}</span>
                <span class="tile-badge ${room.isPrivate ? 'private' : ''}">${room.isPrivate ? 'Private' : 'Public'}</span>
            </div>
            <div class="tile-info">
                ${room.memberCount || room.members.length}/${room.maxMembers || 50} members 
                ${isMember ? '• Joined' : ''}
                ${room.memberCount >= (room.maxMembers || 50) ? '• Full' : ''}
            </div>
            <div class="tile-actions">
                ${!isMember && room.memberCount < (room.maxMembers || 50) ? `<button class="tile-btn" onclick="app.joinRoom('${room.id}')">Join</button>` : ''}
                ${isMember ? `<button class="tile-btn" onclick="app.startRoomChat('${room.id}')">Open Chat</button>` : ''}
                ${isLead && isMember ? `<button class="tile-btn danger" onclick="app.leaveRoom('${room.id}')">Leave</button>` : ''}
                ${!isMember && room.memberCount >= (room.maxMembers || 50) ? `<button class="tile-btn" disabled>Room Full</button>` : ''}
            </div>
        `;
        return tile;
    }


    // New methods for lobby updates
    updateLobbyStats() {
        const joinedRooms = Array.from(this.rooms.values()).filter(room => 
            room.members.some(m => m.id === this.currentUser.userId)
        );
        
        // Update stat cards
        document.getElementById('roomCount').textContent = joinedRooms.length;
        
        // Update section badges
        document.getElementById('myRoomsBadge').textContent = joinedRooms.length;
        
        // Get message count from localStorage
        const messageCount = this.getTodayMessageCount();
        document.getElementById('messageCount').textContent = messageCount;
    }

    updateMyRooms() {
        const container = document.getElementById('myRooms');
        const emptyState = document.getElementById('emptyRooms');
        
        const joinedRooms = Array.from(this.rooms.values()).filter(room => 
            room.members.some(m => m.id === this.currentUser.userId)
        );
        
        if (joinedRooms.length === 0) {
            emptyState.style.display = 'block';
            // Clear any existing room tiles
            const existingTiles = container.querySelectorAll('.room-tile');
            existingTiles.forEach(tile => tile.remove());
        } else {
            emptyState.style.display = 'none';
            
            // Clear existing tiles
            const existingTiles = container.querySelectorAll('.room-tile');
            existingTiles.forEach(tile => tile.remove());
            
            // Add joined rooms
            joinedRooms.forEach(room => {
                const tile = this.createLobbyRoomTile(room);
                container.appendChild(tile);
            });
        }
    }


    createLobbyRoomTile(room) {
        const tile = document.createElement('div');
        tile.className = 'room-tile enhanced-tile';
        tile.setAttribute('data-room-id', room.id);
        
        const isLead = room.leadUserId === this.currentUser.userId;
        const lastActivity = this.getLastRoomActivity(room.id);
        
        tile.innerHTML = `
            <div class="tile-header">
                <div class="tile-icon">${room.isPrivate ? '🔒' : '🌐'}</div>
                <div class="tile-content">
                    <div class="tile-title">${this.escapeHtml(room.name)}</div>
                    <div class="tile-subtitle">${room.members.length} members ${isLead ? '• Leader' : ''}</div>
                </div>
                <div class="tile-status ${room.isPrivate ? 'private' : 'public'}">${room.isPrivate ? 'Private' : 'Public'}</div>
            </div>
            <div class="tile-footer">
                <div class="tile-activity">${lastActivity}</div>
                <div class="tile-actions">
                    <button class="tile-btn primary" onclick="app.startRoomChat('${room.id}')">💬 Chat</button>
                    <button class="tile-btn secondary" onclick="app.leaveRoom('${room.id}')">🚪 Leave</button>
                </div>
            </div>
        `;
        return tile;
    }


    addRecentActivity(type, description, roomId = null) {
        const container = document.getElementById('recentActivity');
        const emptyState = container.querySelector('.empty-state');
        
        if (emptyState) {
            emptyState.style.display = 'none';
        }
        
        const activity = document.createElement('div');
        activity.className = 'activity-item';
        
        const icons = {
            'message': '💬',
            'join': '👋',
            'leave': '👋',
            'room_create': '🏠',
            'file': '📎',
            'connect': '🔗'
        };
        
        activity.innerHTML = `
            <div class="activity-icon">${icons[type] || '📝'}</div>
            <div class="activity-content">
                <div class="activity-title">${this.escapeHtml(description)}</div>
                <div class="activity-time">${this.formatTime(new Date())}</div>
            </div>
        `;
        
        container.insertBefore(activity, container.firstChild);
        
        // Keep only last 10 activities
        const activities = container.querySelectorAll('.activity-item');
        if (activities.length > 10) {
            activities[activities.length - 1].remove();
        }
    }

    getLastRoomActivity(roomId) {
        // This would typically come from stored chat history
        return 'Active now';
    }

    getTodayMessageCount() {
        // Get from localStorage or return 0
        const today = new Date().toDateString();
        const stored = localStorage.getItem(`messageCount_${today}`);
        return stored ? parseInt(stored) : 0;
    }

    incrementMessageCount() {
        const today = new Date().toDateString();
        const current = this.getTodayMessageCount();
        localStorage.setItem(`messageCount_${today}`, (current + 1).toString());
        document.getElementById('messageCount').textContent = current + 1;
    }

    formatLastSeen(joinedAt) {
        const now = new Date();
        const joined = new Date(joinedAt);
        const diff = now - joined;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return `${Math.floor(diff / 86400000)}d ago`;
    }

    formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Background message handling
    handleBackgroundMessage(type, chatId, message) {
        // Store unread message count
        const key = `unread_${type}_${chatId}`;
        const currentCount = parseInt(localStorage.getItem(key) || '0');
        localStorage.setItem(key, (currentCount + 1).toString());
        
        // Update UI indicators
        this.updateUnreadIndicators();
        
        // Add to recent activity
        const description = type === 'room' 
            ? `New message in ${this.rooms.get(chatId)?.name || 'room'}`
            : `New message`;
        this.addRecentActivity('message', description, chatId);
        
        // Play notification sound if enabled
        this.playNotificationSound();
    }

    // Enhanced notification system
    showNotificationAlert(title, message, onClick = null) {
        // Browser notification if permission granted
        if (Notification.permission === 'granted') {
            const notification = new Notification(title, {
                body: message.substring(0, 100),
                icon: '/favicon.ico',
                tag: 'wifichat-message'
            });
            
            if (onClick) {
                notification.onclick = () => {
                    window.focus();
                    onClick();
                    notification.close();
                };
            }
            
            // Auto close after 5 seconds
            setTimeout(() => notification.close(), 5000);
        }
        
        // In-app notification
        this.showInAppNotification(title, message, onClick);
    }

    showInAppNotification(title, message, onClick = null) {
        const container = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = 'notification-alert';
        
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-title">${this.escapeHtml(title)}</div>
                <div class="notification-message">${this.escapeHtml(message.substring(0, 100))}</div>
            </div>
            <div class="notification-actions">
                ${onClick ? '<button class="notification-btn primary" data-action="open">Open</button>' : ''}
                <button class="notification-btn secondary" data-action="close">×</button>
            </div>
        `;
        
        // Add event listeners
        const openBtn = notification.querySelector('[data-action="open"]');
        const closeBtn = notification.querySelector('[data-action="close"]');
        
        if (openBtn && onClick) {
            openBtn.addEventListener('click', () => {
                onClick();
                notification.remove();
            });
        }
        
        closeBtn.addEventListener('click', () => {
            notification.remove();
        });
        
        container.appendChild(notification);
        
        // Auto remove after 8 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 8000);
    }

    updateUnreadIndicators() {
        // Update room tiles with unread counts
        Array.from(this.rooms.values()).forEach(room => {
            const unreadCount = parseInt(localStorage.getItem(`unread_room_${room.id}`) || '0');
            const tile = document.querySelector(`[data-room-id="${room.id}"]`);
            if (tile) {
                this.updateTileUnreadBadge(tile, unreadCount);
            }
        });
        
        // Update lobby stats
        this.updateLobbyStats();
    }

    updateTileUnreadBadge(tile, count) {
        let badge = tile.querySelector('.unread-badge');
        
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'unread-badge';
                tile.appendChild(badge);
            }
            badge.textContent = count > 99 ? '99+' : count.toString();
            badge.style.display = 'block';
        } else if (badge) {
            badge.style.display = 'none';
        }
    }

    clearUnreadCount(type, chatId) {
        const key = `unread_${type}_${chatId}`;
        localStorage.removeItem(key);
        this.updateUnreadIndicators();
    }

    playNotificationSound() {
        // Create a subtle notification sound
        if (this.notificationSoundEnabled) {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.2);
        }
    }

    // Request notification permission on app start
    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    this.showNotification('Notifications enabled!', 'success');
                }
            });
        }
    }

    // Chat Management

    startRoomChat(roomId) {
        this.currentChat = { type: 'room', id: roomId };
        const room = this.rooms.get(roomId);
        
        document.getElementById('chatTitle').textContent = `Room: ${room.name} (${room.memberCount || room.members.length} members)`;
        document.getElementById('chatPanel').classList.remove('hidden');
        
        // Clear unread count when opening chat
        this.clearUnreadCount('room', roomId);
        
        this.loadChatHistory(roomId);
        this.displayRoomMembers(room);
        
        // Add to recent activity
        this.addRecentActivity('join', `Opened room ${room.name}`);
    }

    closeChat() {
        const chatPanel = document.getElementById('chatPanel');
        chatPanel.classList.add('hidden');
        this.currentChat = null;
        
        // Clear chat messages to prevent UI issues
        document.getElementById('chatMessages').innerHTML = '';
        document.getElementById('messageInput').value = '';
        
        // Hide room members section
        const membersSection = document.getElementById('roomMembers');
        if (membersSection) {
            membersSection.classList.add('hidden');
        }
    }

    displayRoomMembers(room) {
        // Show the room members section in the sidebar
        const membersSection = document.getElementById('roomMembers');
        if (membersSection) {
            membersSection.classList.remove('hidden');
            
            const membersList = membersSection.querySelector('.members-list');
            membersList.innerHTML = '';

            room.members.forEach(member => {
                const memberDiv = document.createElement('div');
                memberDiv.className = 'member-item';
                
                const isCurrentUser = member.id === this.currentUser.userId;
                const hasDirectConnection = this.peerConnections.has(member.id);
                
                memberDiv.innerHTML = `
                    <div class="member-info">
                        <div class="member-avatar">${member.name.charAt(0).toUpperCase()}</div>
                        <div class="member-details">
                            <div class="member-name">${this.escapeHtml(member.name)} ${isCurrentUser ? '(You)' : ''}</div>
                            <div class="member-status">${hasDirectConnection ? 'Direct Connected' : 'Connected'}</div>
                        </div>
                    </div>
                    <div class="member-actions">
                        ${!isCurrentUser ? `
                            <button class="member-btn" onclick="app.initiateDirectConnection('${member.id}', '${room.id}')" 
                                    title="Start direct connection">
                                🔗 Direct
                            </button>
                            ${hasDirectConnection ? `
                                <button class="member-btn danger" onclick="app.closeDirectConnection('${member.id}')" 
                                        title="Close direct connection">
                                    ❌ Close
                                </button>
                            ` : ''}
                        ` : ''}
                    </div>
                `;
                
                membersList.appendChild(memberDiv);
            });
        }
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();
        
        if (!text || !this.currentChat) return;
        
        // Throttle message sending
        const now = Date.now();
        if (now - this.lastMessageTime < this.messageThrottleDelay) {
            // Queue message if sending too fast
            this.messageQueue.push({ text, input });
            this.processMessageQueue();
            return;
        }
        
        this.lastMessageTime = now;
        
        const message = {
            id: this.generateId(),
            text: text,
            timestamp: new Date().toISOString(),
            userId: this.currentUser.userId,
            userName: this.currentUser.name
        };
        
        // Display message immediately
        this.displayMessage(message, true);
        this.saveChatMessage(this.currentChat.id, message);
        
        // Increment message count
        this.incrementMessageCount();
        
        if (this.currentChat.type === 'room') {
            this.socket.emit('room:message', {
                roomId: this.currentChat.id,
                message: message
            });
        }
        
        input.value = '';
        this.autoResizeTextarea(input);
    }

    processMessageQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) return;
        
        this.isProcessingQueue = true;
        
        const processNext = () => {
            if (this.messageQueue.length === 0) {
                this.isProcessingQueue = false;
                return;
            }
            
            const { text, input } = this.messageQueue.shift();
            input.value = text;
            this.sendMessage();
            
            // Process next message after delay
            setTimeout(processNext, this.messageThrottleDelay);
        };
        
        processNext();
    }

    displayMessage(message, isSent) {
        const container = document.getElementById('chatMessages');
        
        // Performance optimization: limit visible messages
        const maxVisibleMessages = 100;
        const messages = container.querySelectorAll('.msg-row');
        if (messages.length > maxVisibleMessages) {
            // Remove oldest messages (keep last 50)
            const toRemove = messages.length - 50;
            for (let i = 0; i < toRemove; i++) {
                messages[i].remove();
            }
        }
        
        const row = document.createElement('div');
        row.className = `msg-row ${isSent ? 'sent' : 'received'}`;
        row.dataset.timestamp = new Date(message.timestamp).getTime();

        const bubble = document.createElement('div');
        bubble.className = `message ${isSent ? 'sent' : 'received'}`;
        bubble.dataset.messageId = message.id;

        const previewHtml = this.buildPreviewHtml(message);
        const senderName = message.userName || message.fromUserName || 'Unknown';
        bubble.innerHTML = `
            ${!isSent ? `<div class="message-sender">${this.escapeHtml(senderName)}</div>` : ''}
            <div class="message-text">${this.escapeHtml(message.text)}</div>
            ${previewHtml}
            <div class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</div>
            ${isSent ? `
            <div class="message-actions">
                <button class="message-action-btn" onclick="app.onEditMessage('${message.id}')">Edit</button>
                <button class="message-action-btn" onclick="app.onDeleteMessage('${message.id}')">Delete</button>
            </div>` : ''}
            <div class="reactions" id="reactions-${message.id}">
                <button class="reaction-btn" onclick="app.onReact('${message.id}','👍')">👍</button>
                <button class="reaction-btn" onclick="app.onReact('${message.id}','❤️')">❤️</button>
                <button class="reaction-btn" onclick="app.onReact('${message.id}','😂')">😂</button>
            </div>
        `;

        const avatar = document.createElement('div');
        avatar.className = 'avatar-sm';
        let avatarUrl = null;
        
        if (!isSent) {
            // For received messages, show sender's initial
            const senderInitial = senderName.charAt(0).toUpperCase();
            avatar.textContent = senderInitial;
        } else {
            // For sent messages, show current user's initial
            if (this.currentUser && this.currentUser.avatarUrl) {
                avatarUrl = this.currentUser.avatarUrl;
            }
            avatar.textContent = this.currentUser && this.currentUser.name ? this.currentUser.name.charAt(0).toUpperCase() : 'U';
        }
        if (avatarUrl) avatar.style.backgroundImage = `url('${avatarUrl}')`;
        if (isSent) {
            row.appendChild(bubble);
            row.appendChild(avatar);
        } else {
            row.appendChild(avatar);
            row.appendChild(bubble);
        }

        // Insert message in correct chronological position
        this.insertMessageInOrder(container, row);
        
        // Smooth scroll to bottom
        container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
        });
    }

    insertMessageInOrder(container, newRow) {
        const newTimestamp = parseInt(newRow.dataset.timestamp);
        const existingRows = Array.from(container.querySelectorAll('.msg-row'));
        
        // Find the correct position to insert the new message
        let insertIndex = existingRows.length;
        for (let i = 0; i < existingRows.length; i++) {
            const existingTimestamp = parseInt(existingRows[i].dataset.timestamp);
            if (newTimestamp < existingTimestamp) {
                insertIndex = i;
                break;
            }
        }
        
        // Insert the new message at the correct position
        if (insertIndex === existingRows.length) {
            // Insert at the end
            container.appendChild(newRow);
        } else {
            // Insert before the element at insertIndex
            container.insertBefore(newRow, existingRows[insertIndex]);
        }
    }

    onEditMessage(messageId) {
        const el = document.querySelector(`[data-message-id="${messageId}"] .message-text`);
        if (!el) return;
        const current = el.textContent;
        const updated = prompt('Edit message:', current);
        if (updated === null) return;
        const trimmed = updated.trim();
        if (!trimmed) return;

        // Apply locally
        this.applyMessageEdit(messageId, trimmed);

        // Persist in IndexedDB not strictly necessary for demo; skip for simplicity

        if (this.currentChat.type === 'room') {
            this.socket.emit('room:message-edit', { roomId: this.currentChat.id, messageId, newText: trimmed });
        }
    }

    onDeleteMessage(messageId) {
        if (!confirm('Delete this message?')) return;
        this.applyMessageDelete(messageId);
        if (this.currentChat.type === 'room') {
            this.socket.emit('room:message-delete', { roomId: this.currentChat.id, messageId });
        }
    }

    applyMessageEdit(messageId, newText) {
        const el = document.querySelector(`[data-message-id="${messageId}"] .message-text`);
        if (el) {
            el.textContent = newText;
        }
    }

    applyMessageDelete(messageId) {
        const bubble = document.querySelector(`[data-message-id="${messageId}"]`);
        if (bubble) {
            const row = bubble.parentElement;
            if (row && row.classList.contains('msg-row')) {
                row.remove();
            } else {
                bubble.remove();
            }
        }
    }


    // IndexedDB Implementation
    async initializeIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('WiFiChat', 2);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Chat messages store
                if (!db.objectStoreNames.contains('messages')) {
                    const messagesStore = db.createObjectStore('messages', { keyPath: 'id' });
                    messagesStore.createIndex('chatId', 'chatId', { unique: false });
                    messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
                // Files store
                if (!db.objectStoreNames.contains('files')) {
                    const filesStore = db.createObjectStore('files', { keyPath: 'id' });
                }
            };
        });
    }

    async saveChatMessage(chatId, message) {
        if (!this.db) return;
        
        const transaction = this.db.transaction(['messages'], 'readwrite');
        const store = transaction.objectStore('messages');
        
        await store.add({
            id: this.generateId(),
            chatId: chatId,
            message: message,
            timestamp: new Date()
        });
    }

    async loadChatHistory(chatId) {
        if (!this.db) return;
        
        const transaction = this.db.transaction(['messages'], 'readonly');
        const store = transaction.objectStore('messages');
        const index = store.index('chatId');
        
        const request = index.getAll(chatId);
        request.onsuccess = () => {
            const messages = request.result;
            const container = document.getElementById('chatMessages');
            container.innerHTML = '';
            
            // Sort messages by timestamp to ensure correct chronological order
            messages.sort((a, b) => {
                const timeA = new Date(a.message.timestamp).getTime();
                const timeB = new Date(b.message.timestamp).getTime();
                return timeA - timeB;
            });
            
            messages.forEach(record => {
                const isSent = record.message.userId === this.currentUser.userId;
                this.displayMessage(record.message, isSent);
            });
        };
    }


    // Room messaging
    sendRoomMessage(roomId, message) {
        // Send room message via Socket.IO
        this.socket.emit('room:message', {
            roomId: roomId,
            message: message
        });
    }

    // Utility Functions
    generateId() {
        return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    emitTyping() {
        if (!this.currentChat) return;
        const now = Date.now();
        if (this._lastTypingEmit && now - this._lastTypingEmit < 500) return;
        this._lastTypingEmit = now;

        if (this.currentChat.type === 'room') {
            this.socket.emit('room:typing', { roomId: this.currentChat.id, isTyping: true });
        }
    }

    showTyping(isTyping, fromId = null) {
        const el = document.getElementById('typingIndicator');
        if (!el) return;
        if (isTyping) {
            if (this.currentChat && this.currentChat.type === 'room' && fromId) {
                el.textContent = 'Someone is typing…';
            } else {
                el.textContent = 'Typing…';
            }
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }


    leaveRoom(roomId) {
        this.socket.emit('room:leave', { roomId });
    }

    // Room File Transfer Implementation
    async sendRoomFile(file) {
        if (!this.currentChat || this.currentChat.type !== 'room') {
            this.showNotification('File sharing only available in rooms', 'error');
            return;
        }

        const fileId = this.generateId();
        const chunkSize = 512 * 1024; // 512KB chunks
        const totalChunks = Math.ceil(file.size / chunkSize);
        
        const fileData = {
            id: fileId,
            name: file.name,
            size: file.size,
            type: file.type,
            totalChunks: totalChunks
        };

        this.fileTransfers.set(fileId, {
            ...fileData,
            chunks: new Map(),
            progress: 0,
            direction: 'sending'
        });

        this.showFileProgress(fileData, 0);

        // Send file start notification
        this.socket.emit('room:file:start', {
            roomId: this.currentChat.id,
                fileId: fileId,
                fileName: file.name,
                fileSize: file.size,
                totalChunks: totalChunks
            });

        // Send chunks
            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                
                const arrayBuffer = await chunk.arrayBuffer();
                const base64 = this.arrayBufferToBase64(arrayBuffer);
                
            this.socket.emit('room:file:chunk', {
                roomId: this.currentChat.id,
                    fileId: fileId,
                    chunkIndex: i,
                    chunk: base64
                });

                const progress = ((i + 1) / totalChunks) * 100;
                this.updateFileProgress(fileId, progress);
                
            // Small delay to prevent overwhelming
            await new Promise(resolve => setTimeout(resolve, 10));
            }

        this.socket.emit('room:file:end', {
            roomId: this.currentChat.id,
                fileId: fileId
            });

        // Store file for download - convert to ArrayBuffer for IndexedDB storage
        const arrayBuffer = await file.arrayBuffer();
        await this.storeFile(fileId, {
            name: file.name,
            size: file.size,
            type: file.type,
            data: arrayBuffer
        });

        // Create file message with timestamp
        const fileMessage = {
            id: fileData.id,
            text: `📎 ${fileData.name}`,
            timestamp: new Date().toISOString(),
            userId: this.currentUser.userId,
            userName: this.currentUser.name,
            type: 'file',
            fileData: fileData
        };
        
        // Save file message to chat history
        this.saveChatMessage(this.currentChat.id, fileMessage);
        
        // Display file message for sender
        this.displayFileMessage(fileData, true);
    }

    handleRoomFileTransferStart(data) {
        // Only handle if we're in the correct room and not from ourselves
        if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId && data.fromUserId !== this.currentUser.userId) {
            this.fileTransfers.set(data.fileId, {
                id: data.fileId,
                name: data.fileName,
                size: data.fileSize,
                totalChunks: data.totalChunks,
                chunks: new Map(),
                progress: 0,
                direction: 'receiving',
                fromUserId: data.fromUserId,
                fromUserName: data.fromUserName
            });

            this.showFileProgress({ id: data.fileId, name: data.fileName }, 0);
            
            // Create file message with timestamp for received files
            const fileMessage = {
                id: data.fileId,
                text: `📎 ${data.fileName}`,
                timestamp: new Date().toISOString(),
                userId: data.fromUserId,
                userName: data.fromUserName,
                type: 'file',
                fileData: { id: data.fileId, name: data.fileName, size: data.fileSize }
            };
            
            // Save received file message to chat history
            this.saveChatMessage(data.roomId, fileMessage);
            
            this.displayFileMessage({ id: data.fileId, name: data.fileName, size: data.fileSize, timestamp: fileMessage.timestamp }, false, data.fromUserName);
        }
    }

    handleRoomFileTransferChunk(data) {
        // Only handle if we're in the correct room and not from ourselves
        if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId && data.fromUserId !== this.currentUser.userId) {
            const transfer = this.fileTransfers.get(data.fileId);
            if (transfer) {
                transfer.chunks.set(data.chunkIndex, data.chunk);
                const progress = (transfer.chunks.size / transfer.totalChunks) * 100;
                transfer.progress = progress;
                this.updateFileProgress(data.fileId, progress);
            }
        }
    }

    handleRoomFileTransferEnd(data) {
        // Only handle if we're in the correct room and not from ourselves
        if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId && data.fromUserId !== this.currentUser.userId) {
            const transfer = this.fileTransfers.get(data.fileId);
            if (transfer && transfer.chunks.size === transfer.totalChunks) {
                this.assembleRoomFile(transfer);
            } else if (transfer) {
                this.showNotification(`File transfer incomplete for ${transfer.name}`, 'error');
            }
        }
    }

    async assembleRoomFile(transfer) {
        const chunks = [];
        for (let i = 0; i < transfer.totalChunks; i++) {
            const base64Chunk = transfer.chunks.get(i);
            if (base64Chunk) {
                chunks.push(this.base64ToArrayBuffer(base64Chunk));
            }
        }

        if (chunks.length !== transfer.totalChunks) {
            this.showNotification(`File transfer incomplete. Received ${chunks.length}/${transfer.totalChunks} chunks.`, 'error');
            return;
        }

        const blob = new Blob(chunks);
        const arrayBuffer = await blob.arrayBuffer();
        
        // Store in IndexedDB
        await this.storeFile(transfer.id, {
            name: transfer.name,
            size: transfer.size,
            type: transfer.type || 'application/octet-stream',
            data: arrayBuffer
        });

        this.hideFileProgress();
        this.showNotification(`File received: ${transfer.name}. Click the download button to save it.`, 'success');
    }

    showFileProgress(fileData, progress) {
        document.getElementById('fileTransferProgress').classList.remove('hidden');
        const displayName = fileData.name || fileData.fileName || '';
        document.getElementById('progressFileName').textContent = displayName;
        const id = fileData.id || fileData.fileId;
        if (id) this.updateFileProgress(id, progress);
    }

    updateFileProgress(fileId, progress) {
        document.getElementById('progressPercent').textContent = `${Math.round(progress)}%`;
        document.getElementById('progressFill').style.width = `${progress}%`;
    }

    hideFileProgress() {
        document.getElementById('fileTransferProgress').classList.add('hidden');
    }

    displayFileMessage(fileData, isSent, fromUserName = null) {
        const container = document.getElementById('chatMessages');
        const row = document.createElement('div');
        row.className = `msg-row ${isSent ? 'sent' : 'received'}`;

        const bubble = document.createElement('div');
        bubble.className = `message ${isSent ? 'sent' : 'received'}`;
        
        const name = fileData.name || fileData.fileName || 'file';
        const size = typeof fileData.size === 'number' ? fileData.size : (fileData.fileSize || 0);
        const downloadButton = !isSent ? 
            `<button class="download-btn" onclick="app.downloadFile('${fileData.id || fileData.fileId || ''}', '${name}', ${size})" title="Download file">
                <span class="download-icon">⬇️</span> Download
            </button>` : '';
        
        bubble.innerHTML = `
            <div class="file-message">
                <div class="file-info">
                    <span class="file-icon">📎</span>
                    <div class="file-details">
                        <div class="file-name">${this.escapeHtml(name)}</div>
                        <div class="file-size">${this.formatFileSize(size)}</div>
                        ${fromUserName && !isSent ? `<div class="file-sender">from ${this.escapeHtml(fromUserName)}</div>` : ''}
                        ${downloadButton}
                    </div>
                </div>
            </div>
            <div class="message-time">${new Date(fileData.timestamp || Date.now()).toLocaleTimeString()}</div>
        `;

        const avatar = document.createElement('div');
        avatar.className = 'avatar-sm';
        if (isSent) {
            avatar.textContent = this.currentUser && this.currentUser.name ? this.currentUser.name.charAt(0).toUpperCase() : '';
            if (this.currentUser && this.currentUser.avatarUrl) {
                avatar.style.backgroundImage = `url('${this.currentUser.avatarUrl}')`;
            }
            row.appendChild(bubble);
            row.appendChild(avatar);
        } else {
            avatar.textContent = 'R';
            row.appendChild(avatar);
            row.appendChild(bubble);
        }
        
        container.appendChild(row);
        container.scrollTop = container.scrollHeight;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    async storeFile(fileId, fileData) {
        if (!this.db) {
            console.log('Database not initialized, reinitializing...');
            await this.initializeIndexedDB();
        }
        
        if (!this.db.objectStoreNames.contains('files')) {
            console.log('Files store not found, database needs upgrade. Please refresh the page.');
            this.showNotification('Database needs update. Please refresh the page.', 'error');
            return;
        }
        
        const transaction = this.db.transaction(['files'], 'readwrite');
        const store = transaction.objectStore('files');
        
        await store.add({
            id: fileId,
            ...fileData,
            timestamp: new Date()
        });
    }

    async downloadFile(fileId, fileName, fileSize) {
        try {
            console.log('Attempting to download file:', fileId, fileName);
            
            if (!this.db) {
                console.log('Database not initialized, reinitializing...');
                await this.initializeIndexedDB();
            }
            
            if (!this.db.objectStoreNames.contains('files')) {
                console.log('Files store not found, database needs upgrade. Please refresh the page.');
                this.showNotification('Database needs update. Please refresh the page.', 'error');
                return;
            }

            const transaction = this.db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const request = store.get(fileId);

            request.onsuccess = () => {
                const fileData = request.result;
                console.log('File data retrieved:', fileData);
                
                if (fileData && fileData.data) {
                    // Recreate Blob from stored ArrayBuffer
                    const blob = new Blob([fileData.data], { type: fileData.type || 'application/octet-stream' });
                    const url = URL.createObjectURL(blob);
                    
                    console.log('Created blob and URL for download');
                    
                    // Create download link
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    
                    // Clean up the URL
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    
                    this.showNotification(`Downloading ${fileName}`, 'success');
                } else {
                    console.error('File data not found or invalid:', fileData);
                    this.showNotification('File not found', 'error');
                }
            };

            request.onerror = () => {
                console.error('Database request failed');
                this.showNotification('Failed to retrieve file', 'error');
            };
        } catch (error) {
            console.error('Download error:', error);
            this.showNotification('Download failed', 'error');
        }
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        container.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    async ensureNotificationPermission() {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') return true;
        if (Notification.permission === 'denied') return false;
        const perm = await Notification.requestPermission();
        return perm === 'granted';
    }

    async maybeNotify(title, body) {
        try {
            if (document.hasFocus()) return;
            const ok = await this.ensureNotificationPermission();
            if (!ok) return;
            new Notification(title, { body });
        } catch {}
    }

    // WebRTC Methods
    async initiateDirectConnection(targetUserId, roomId = null) {
        if (!this.isWebRTCSupported || typeof SimplePeer === 'undefined') {
            this.showNotification('WebRTC not supported in this browser', 'error');
            return;
        }

        try {
            const peer = new SimplePeer({
                initiator: true,
                trickle: false
            });

            this.peerConnections.set(targetUserId, peer);

            peer.on('signal', (data) => {
                this.socket.emit('webrtc:offer', {
                    targetUserId: targetUserId,
                    offer: data,
                    roomId: roomId
                });
            });

            peer.on('connect', () => {
                this.showNotification(`Direct connection established with user`, 'success');
                console.log('WebRTC connection established');
            });

            peer.on('data', (data) => {
                this.handleDirectMessage(data, targetUserId);
            });

            peer.on('error', (err) => {
                console.error('WebRTC error:', err);
                this.showNotification('Direct connection failed', 'error');
                this.peerConnections.delete(targetUserId);
            });

        } catch (error) {
            console.error('Failed to initiate direct connection:', error);
            this.showNotification('Failed to start direct connection', 'error');
        }
    }

    async handleWebRTCOffer(data) {
        if (!this.isWebRTCSupported) return;

        try {
            const { fromUserId, offer, roomId } = data;
            
            const peer = new SimplePeer({
                initiator: false,
                trickle: false
            });

            this.peerConnections.set(fromUserId, peer);

            peer.on('signal', (answer) => {
                this.socket.emit('webrtc:answer', {
                    targetUserId: fromUserId,
                    answer: answer,
                    roomId: roomId
                });
            });

            peer.on('connect', () => {
                this.showNotification(`Direct connection established with user`, 'success');
                console.log('WebRTC connection established');
            });

            peer.on('data', (data) => {
                this.handleDirectMessage(data, fromUserId);
            });

            peer.on('error', (err) => {
                console.error('WebRTC error:', err);
                this.showNotification('Direct connection failed', 'error');
                this.peerConnections.delete(fromUserId);
            });

            peer.signal(offer);

        } catch (error) {
            console.error('Failed to handle WebRTC offer:', error);
        }
    }

    async handleWebRTCAnswer(data) {
        const { fromUserId, answer } = data;
        const peer = this.peerConnections.get(fromUserId);
        
        if (peer) {
            peer.signal(answer);
        }
    }

    async handleWebRTCIceCandidate(data) {
        const { fromUserId, candidate } = data;
        const peer = this.peerConnections.get(fromUserId);
        
        if (peer) {
            peer.signal(candidate);
        }
    }

    handleDirectMessage(data, fromUserId) {
        try {
            const message = JSON.parse(data.toString());
            console.log('Direct message received:', message);
            
            // Handle different types of direct messages
            if (message.type === 'text') {
                this.showNotification(`Direct message from user: ${message.text}`, 'info');
            } else if (message.type === 'file') {
                this.showNotification(`Direct file transfer from user: ${message.fileName}`, 'info');
            }
        } catch (error) {
            console.error('Failed to parse direct message:', error);
        }
    }

    sendDirectMessage(targetUserId, message) {
        const peer = this.peerConnections.get(targetUserId);
        if (peer && peer.connected) {
            const data = JSON.stringify({
                type: 'text',
                text: message,
                fromUserId: this.currentUser.userId,
                timestamp: new Date().toISOString()
            });
            peer.send(data);
            return true;
        }
        return false;
    }

    sendDirectFile(targetUserId, file) {
        const peer = this.peerConnections.get(targetUserId);
        if (peer && peer.connected) {
            const data = JSON.stringify({
                type: 'file',
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                fromUserId: this.currentUser.userId,
                timestamp: new Date().toISOString()
            });
            peer.send(data);
            return true;
        }
        return false;
    }

    closeDirectConnection(targetUserId) {
        const peer = this.peerConnections.get(targetUserId);
        if (peer) {
            peer.destroy();
            this.peerConnections.delete(targetUserId);
        }
    }

    // Offline Support Methods
    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js');
                console.log('Service Worker registered successfully:', registration);
            } catch (error) {
                console.log('Service Worker registration failed:', error);
            }
        }
    }

    setupOfflineDetection() {
        // Listen for online/offline events
        window.addEventListener('online', () => {
            this.showNotification('Connection restored!', 'success');
            this.updateConnectionStatus(true);
            this.attemptReconnection();
        });

        window.addEventListener('offline', () => {
            this.showNotification('Connection lost. Working offline...', 'warning');
            this.updateConnectionStatus(false);
        });

        // Initial connection status
        this.updateConnectionStatus(navigator.onLine);
    }

    attemptReconnection() {
        if (this.socket && this.socket.disconnected) {
            this.socket.connect();
        }
    }

    // Local Network Discovery
    async discoverLocalServers() {
        // This would scan for other WiFi Chat servers on the local network
        // For now, we'll show a placeholder
        this.showNotification('Local network discovery not yet implemented', 'info');
    }

    // Offline Message Queue
    queueOfflineMessage(message) {
        const offlineMessages = JSON.parse(localStorage.getItem('offlineMessages') || '[]');
        offlineMessages.push({
            ...message,
            timestamp: new Date().toISOString(),
            queued: true
        });
        localStorage.setItem('offlineMessages', JSON.stringify(offlineMessages));
    }

    async processOfflineMessages() {
        const offlineMessages = JSON.parse(localStorage.getItem('offlineMessages') || '[]');
        if (offlineMessages.length > 0 && this.socket && this.socket.connected) {
            this.showNotification(`Sending ${offlineMessages.length} offline messages...`, 'info');
            
            for (const message of offlineMessages) {
                try {
                    if (message.type === 'room') {
                        this.socket.emit('room:message', {
                            roomId: message.roomId,
                            message: message
                        });
                    }
                    // Add small delay to prevent overwhelming the server
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error('Failed to send offline message:', error);
                }
            }
            
            // Clear processed messages
            localStorage.removeItem('offlineMessages');
            this.showNotification('Offline messages sent successfully!', 'success');
        }
    }
}

// Initialize the application
const app = new WiFiChat();

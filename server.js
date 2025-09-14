const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  // Performance optimizations for many users
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// In-memory data structures
const users = new Map(); // userId -> { id, name, socketId, joinedAt, lastSeen }
const rooms = new Map(); // roomId -> { id, name, isPrivate, pinHash, leadUserId, members: Set, maxMembers, createdAt }
const socketToUser = new Map(); // socketId -> userId
const userSessions = new Map(); // socketId -> { userId, connectedAt, lastActivity }

// Configuration
const MAX_ROOM_MEMBERS = 50; // Maximum users per room
const MAX_ROOMS_PER_USER = 10; // Maximum rooms a user can create
const MAX_TOTAL_USERS = 200; // Maximum total users on server
const MESSAGE_RATE_LIMIT = 10; // Messages per minute per user
const FILE_RATE_LIMIT = 5; // Files per minute per user

// Rate limiting
const userMessageCounts = new Map(); // userId -> { count, resetTime }
const userFileCounts = new Map(); // userId -> { count, resetTime }


app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // User joins the network
  socket.on('user:join', ({ name, userId, avatarUrl }) => {
    try {
      // Check server capacity
      if (users.size >= MAX_TOTAL_USERS) {
        socket.emit('error', { message: 'Server is at capacity. Please try again later.' });
        return;
      }

      // Generate new userId if not provided or if user doesn't exist
      let finalUserId = userId;
      if (!userId || !users.has(userId)) {
        finalUserId = uuidv4();
      }

      // Update or create user
      const user = {
        id: finalUserId,
        name: escapeHtml(name),
        avatarUrl: avatarUrl ? String(avatarUrl) : undefined,
        socketId: socket.id,
        joinedAt: new Date(),
        lastSeen: new Date()
      };

      users.set(finalUserId, user);
      socketToUser.set(socket.id, finalUserId);
      userSessions.set(socket.id, {
        userId: finalUserId,
        connectedAt: new Date(),
        lastActivity: new Date()
      });

      // Send user their ID and updated peer list
      socket.emit('user:joined', { 
        userId: finalUserId, 
        user,
        serverStats: {
          totalUsers: users.size,
          totalRooms: rooms.size,
          maxUsers: MAX_TOTAL_USERS
        }
      });
      broadcastUserList();

      console.log(`User joined: ${name} (${finalUserId}) - Total users: ${users.size}`);
    } catch (error) {
      console.error('User join error:', error);
      socket.emit('error', { message: 'Failed to join network' });
    }
  });

  // User profile update
  socket.on('user:update', ({ name, avatarUrl }) => {
    try {
      const userId = socketToUser.get(socket.id);
      if (!userId || !users.has(userId)) return;
      const user = users.get(userId);
      if (typeof name === 'string' && name.trim()) {
        user.name = escapeHtml(name.trim());
      }
      if (typeof avatarUrl === 'string') {
        user.avatarUrl = avatarUrl;
      }
      users.set(userId, user);
      broadcastUserList();
      socket.emit('user:updated', { user });
    } catch (e) {
      socket.emit('error', { message: 'Failed to update profile' });
    }
  });

  // Room creation
  socket.on('room:create', async ({ name, isPrivate, pin, maxMembers }) => {
    try {
      const userId = socketToUser.get(socket.id);
      if (!userId || !users.has(userId)) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      // Check if user has reached room creation limit
      const userRooms = Array.from(rooms.values()).filter(room => room.leadUserId === userId);
      if (userRooms.length >= MAX_ROOMS_PER_USER) {
        socket.emit('error', { message: `You can only create up to ${MAX_ROOMS_PER_USER} rooms` });
        return;
      }

      const roomId = uuidv4();
      let pinHash = null;

      if (isPrivate && pin) {
        pinHash = await bcrypt.hash(pin, 10);
      }

      const room = {
        id: roomId,
        name: escapeHtml(name),
        isPrivate: !!isPrivate,
        pinHash,
        leadUserId: userId,
        members: new Set([userId]),
        maxMembers: Math.min(maxMembers || MAX_ROOM_MEMBERS, MAX_ROOM_MEMBERS),
        createdAt: new Date()
      };

      rooms.set(roomId, room);
      socket.join(roomId);

      socket.emit('room:created', { roomId, room: serializeRoom(room) });
      broadcastRoomList();

      console.log(`Room created: ${name} by ${users.get(userId).name} (${room.members.size}/${room.maxMembers} members)`);
    } catch (error) {
      console.error('Room creation error:', error);
      socket.emit('error', { message: 'Failed to create room' });
    }
  });

  // Room joining
  socket.on('room:join', async ({ roomId, pin }) => {
    try {
      const userId = socketToUser.get(socket.id);
      if (!userId || !users.has(userId)) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Check if room is full
      if (room.members.size >= room.maxMembers) {
        socket.emit('error', { message: 'Room is full' });
        return;
      }

      // Check if user is already in the room
      if (room.members.has(userId)) {
        socket.emit('error', { message: 'You are already in this room' });
        return;
      }

      // Check PIN for private rooms
      if (room.isPrivate && room.pinHash) {
        if (!pin || !(await bcrypt.compare(pin, room.pinHash))) {
          socket.emit('error', { message: 'Invalid PIN' });
          return;
        }
      }

      // Add user to room
      room.members.add(userId);
      socket.join(roomId);

      // Update user's last activity
      const user = users.get(userId);
      if (user) {
        user.lastSeen = new Date();
      }

      socket.emit('room:joined', { roomId, room: serializeRoom(room) });
      socket.to(roomId).emit('room:update', { roomId, room: serializeRoom(room) });

      console.log(`User ${users.get(userId).name} joined room ${room.name} (${room.members.size}/${room.maxMembers} members)`);
    } catch (error) {
      console.error('Room join error:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Join private room by PIN (no roomId required)
  socket.on('room:joinByPin', async ({ pin }) => {
    try {
      const userId = socketToUser.get(socket.id);
      if (!userId || !users.has(userId)) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      if (!pin) {
        socket.emit('error', { message: 'PIN is required' });
        return;
      }

      let targetRoom = null;
      for (const room of rooms.values()) {
        if (room.isPrivate && room.pinHash) {
          const match = await bcrypt.compare(pin, room.pinHash);
          if (match) {
            targetRoom = room;
            break;
          }
        }
      }

      if (!targetRoom) {
        socket.emit('error', { message: 'Invalid PIN or room not found' });
        return;
      }

      targetRoom.members.add(userId);
      socket.join(targetRoom.id);

      socket.emit('room:joined', { roomId: targetRoom.id, room: serializeRoom(targetRoom) });
      socket.to(targetRoom.id).emit('room:update', { roomId: targetRoom.id, room: serializeRoom(targetRoom) });
      broadcastRoomList();
    } catch (error) {
      socket.emit('error', { message: 'Failed to join by PIN' });
    }
  });

  // Room kick (only room lead can kick)
  socket.on('room:kick', ({ roomId, targetUserId }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const room = rooms.get(roomId);

      if (!room || room.leadUserId !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      if (room.members.has(targetUserId)) {
        room.members.delete(targetUserId);
        const targetUser = users.get(targetUserId);
        if (targetUser) {
          io.to(targetUser.socketId).socketsLeave(roomId);
          io.to(targetUser.socketId).emit('room:kicked', { roomId });
        }

        socket.to(roomId).emit('room:update', { roomId, room: serializeRoom(room) });
        console.log(`User ${targetUserId} kicked from room ${room.name}`);
      }
    } catch (error) {
      socket.emit('error', { message: 'Failed to kick user' });
    }
  });


  // Request room list
  socket.on('room:list:request', () => {
    try {
      const userId = socketToUser.get(socket.id);
      if (!userId || !users.has(userId)) {
        socket.emit('error', { message: 'User not found' });
        return;
      }
      
      // Send current room list to the requesting user
      const roomList = Array.from(rooms.values()).map(room => serializeRoom(room));
      socket.emit('room:list', roomList);
    } catch (error) {
      socket.emit('error', { message: 'Failed to get room list' });
    }
  });

  // Room leave
  socket.on('room:leave', ({ roomId }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const room = rooms.get(roomId);
      
      if (room && room.members.has(userId)) {
        room.members.delete(userId);
        socket.leave(roomId);
        
        if (room.members.size === 0) {
          rooms.delete(roomId);
        } else if (room.leadUserId === userId) {
          // Assign new lead
          room.leadUserId = room.members.values().next().value;
        }
        
        socket.emit('room:left', { roomId });
        socket.to(roomId).emit('room:update', { roomId, room: serializeRoom(room) });
        broadcastRoomList();
      }
    } catch (error) {
      socket.emit('error', { message: 'Failed to leave room' });
    }
  });

  // Room messaging
  socket.on('room:message', ({ roomId, message }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const room = rooms.get(roomId);
      
      if (!room || !room.members.has(userId)) {
        socket.emit('error', { message: 'Not authorized to send messages in this room' });
        return;
      }

      // Check rate limit
      if (!checkRateLimit(userId, 'message')) {
        socket.emit('error', { message: 'Message rate limit exceeded. Please slow down.' });
        return;
      }

      // Update user activity
      const user = users.get(userId);
      if (user) {
        user.lastSeen = new Date();
      }

      // Broadcast message to all room members except sender
      room.members.forEach(memberId => {
        const member = users.get(memberId);
        if (member && member.socketId !== socket.id) {
          io.to(member.socketId).emit('room:message', { roomId, message });
        }
      });
    } catch (error) {
      console.error('Room message error:', error);
      socket.emit('error', { message: 'Failed to send room message' });
    }
  });

  // Typing indicator in rooms
  socket.on('room:typing', ({ roomId, isTyping }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const room = rooms.get(roomId);
      if (!room || !room.members.has(userId)) return;
      socket.to(roomId).emit('room:typing', { roomId, userId, isTyping });
    } catch (error) {
      // ignore
    }
  });

  // Room message edit
  socket.on('room:message-edit', ({ roomId, messageId, newText }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const room = rooms.get(roomId);
      if (!room || !room.members.has(userId)) {
        socket.emit('error', { message: 'Not authorized to edit in this room' });
        return;
      }
      socket.to(roomId).emit('room:message-edit', { roomId, messageId, newText, userId });
    } catch (error) {
      socket.emit('error', { message: 'Failed to edit message' });
    }
  });

  // Room message delete
  socket.on('room:message-delete', ({ roomId, messageId }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const room = rooms.get(roomId);
      if (!room || !room.members.has(userId)) {
        socket.emit('error', { message: 'Not authorized to delete in this room' });
        return;
      }
      socket.to(roomId).emit('room:message-delete', { roomId, messageId, userId });
    } catch (error) {
      socket.emit('error', { message: 'Failed to delete message' });
    }
  });

  // Room message reactions
  socket.on('room:reaction', ({ roomId, messageId, emoji, action }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const room = rooms.get(roomId);
      if (!room || !room.members.has(userId)) {
        socket.emit('error', { message: 'Not authorized to react in this room' });
        return;
      }
      io.to(roomId).emit('room:reaction', { roomId, messageId, emoji, action, userId });
    } catch (error) {
      socket.emit('error', { message: 'Failed to react to message' });
    }
  });

  // Room file transfer
  socket.on('room:file:start', ({ roomId, fileId, fileName, fileSize, totalChunks }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const room = rooms.get(roomId);
      if (!room || !room.members.has(userId)) {
        socket.emit('error', { message: 'Not authorized to send files in this room' });
        return;
      }

      // Check rate limit for file transfers
      if (!checkRateLimit(userId, 'file')) {
        socket.emit('error', { message: 'File transfer rate limit exceeded. Please wait before sending another file.' });
        return;
      }

      // Check file size limit (50MB)
      const MAX_FILE_SIZE = 50 * 1024 * 1024;
      if (fileSize > MAX_FILE_SIZE) {
        socket.emit('error', { message: 'File size too large. Maximum 50MB allowed.' });
        return;
      }

      // Check chunk limit
      if (totalChunks > 1000) {
        socket.emit('error', { message: 'Too many chunks. Please try a smaller file.' });
        return;
      }
      
      const user = users.get(userId);
      // Broadcast to all room members except sender
      room.members.forEach(memberId => {
        const member = users.get(memberId);
        if (member && member.socketId !== socket.id) {
          io.to(member.socketId).emit('room:file:start', {
            roomId,
            fileId,
            fileName: escapeHtml(fileName),
            fileSize,
            totalChunks,
            fromUserId: userId,
            fromUserName: user.name
          });
        }
      });

      console.log(`File transfer started: ${fileName} (${fileSize} bytes) by ${user.name} in room ${room.name}`);
    } catch (error) {
      console.error('File transfer start error:', error);
      socket.emit('error', { message: 'Failed to start file transfer' });
    }
  });

  socket.on('room:file:chunk', ({ roomId, fileId, chunkIndex, chunk }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const room = rooms.get(roomId);
      if (!room || !room.members.has(userId)) {
        socket.emit('error', { message: 'Not authorized to send files in this room' });
        return;
      }
      
      // Broadcast to all room members except sender
      room.members.forEach(memberId => {
        const member = users.get(memberId);
        if (member && member.socketId !== socket.id) {
          io.to(member.socketId).emit('room:file:chunk', {
            roomId,
            fileId,
            chunkIndex,
            chunk,
            fromUserId: userId
          });
        }
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to send file chunk' });
    }
  });

  socket.on('room:file:end', ({ roomId, fileId }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const room = rooms.get(roomId);
      if (!room || !room.members.has(userId)) {
        socket.emit('error', { message: 'Not authorized to send files in this room' });
        return;
      }
      
      // Broadcast to all room members except sender
      room.members.forEach(memberId => {
        const member = users.get(memberId);
        if (member && member.socketId !== socket.id) {
          io.to(member.socketId).emit('room:file:end', {
            roomId,
            fileId,
            fromUserId: userId
          });
        }
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to complete file transfer' });
    }
  });

  // WebRTC signaling for direct peer-to-peer connections
  socket.on('webrtc:offer', ({ targetUserId, offer, roomId }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const targetUser = users.get(targetUserId);
      
      if (!targetUser) {
        socket.emit('error', { message: 'Target user not found' });
        return;
      }

      // Check if both users are in the same room
      if (roomId) {
        const room = rooms.get(roomId);
        if (!room || !room.members.has(userId) || !room.members.has(targetUserId)) {
          socket.emit('error', { message: 'Both users must be in the same room for direct connection' });
          return;
        }
      }

      io.to(targetUser.socketId).emit('webrtc:offer', {
        fromUserId: userId,
        offer: offer,
        roomId: roomId
      });
    } catch (error) {
      console.error('WebRTC offer error:', error);
      socket.emit('error', { message: 'Failed to send WebRTC offer' });
    }
  });

  socket.on('webrtc:answer', ({ targetUserId, answer, roomId }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const targetUser = users.get(targetUserId);
      
      if (!targetUser) {
        socket.emit('error', { message: 'Target user not found' });
        return;
      }

      io.to(targetUser.socketId).emit('webrtc:answer', {
        fromUserId: userId,
        answer: answer,
        roomId: roomId
      });
    } catch (error) {
      console.error('WebRTC answer error:', error);
      socket.emit('error', { message: 'Failed to send WebRTC answer' });
    }
  });

  socket.on('webrtc:ice-candidate', ({ targetUserId, candidate, roomId }) => {
    try {
      const userId = socketToUser.get(socket.id);
      const targetUser = users.get(targetUserId);
      
      if (!targetUser) {
        socket.emit('error', { message: 'Target user not found' });
        return;
      }

      io.to(targetUser.socketId).emit('webrtc:ice-candidate', {
        fromUserId: userId,
        candidate: candidate,
        roomId: roomId
      });
    } catch (error) {
      console.error('WebRTC ICE candidate error:', error);
      socket.emit('error', { message: 'Failed to send ICE candidate' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const userId = socketToUser.get(socket.id);
    if (userId) {
      // Remove user from all rooms
      for (const [roomId, room] of rooms.entries()) {
        if (room.members.has(userId)) {
          room.members.delete(userId);
          if (room.members.size === 0) {
            // Delete empty room
            rooms.delete(roomId);
          } else {
            // If lead user left, assign new lead
            if (room.leadUserId === userId) {
              room.leadUserId = room.members.values().next().value;
            }
            socket.to(roomId).emit('room:update', { roomId, room: serializeRoom(room) });
          }
        }
      }

      users.delete(userId);
      socketToUser.delete(socket.id);
      broadcastUserList();
      broadcastRoomList();

      console.log(`User disconnected: ${userId}`);
    }
  });
});

// Helper functions
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function checkRateLimit(userId, type) {
  const now = Date.now();
  const limit = type === 'message' ? MESSAGE_RATE_LIMIT : FILE_RATE_LIMIT;
  const counts = type === 'message' ? userMessageCounts : userFileCounts;
  
  const userCount = counts.get(userId);
  
  if (!userCount || now > userCount.resetTime) {
    // Reset or initialize counter
    counts.set(userId, {
      count: 1,
      resetTime: now + 60000 // Reset in 1 minute
    });
    return true;
  }
  
  if (userCount.count >= limit) {
    return false; // Rate limit exceeded
  }
  
  userCount.count++;
  return true;
}

function serializeRoom(room) {
  return {
    id: room.id,
    name: room.name,
    isPrivate: room.isPrivate,
    leadUserId: room.leadUserId,
    maxMembers: room.maxMembers,
    memberCount: room.members.size,
    createdAt: room.createdAt,
    members: Array.from(room.members).map(userId => {
      const user = users.get(userId);
      return user ? { 
        id: user.id, 
        name: user.name, 
        avatarUrl: user.avatarUrl,
        lastSeen: user.lastSeen 
      } : null;
    }).filter(Boolean)
  };
}

function broadcastUserList() {
  const userList = Array.from(users.values()).map(user => ({
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    joinedAt: user.joinedAt,
    lastSeen: user.lastSeen
  }));
  io.emit('user:list', userList);
}

function broadcastRoomList() {
  const roomList = Array.from(rooms.values()).map(room => serializeRoom(room));
  io.emit('room:list', roomList);
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Lumen Chat server running on http://0.0.0.0:${PORT}`);
  console.log(`Access from other devices on your network using your local IP address`);
});
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

console.log(`Local network IP: http://${getLocalIp()}:${PORT}`);
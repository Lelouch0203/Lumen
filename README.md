# WiFi Chat - Multi-User P2P Chat Application

A powerful peer-to-peer webchat application that works without internet, supporting many users with advanced features like WebRTC, file sharing, and offline support.

## 🚀 Features

### Core Functionality
- **No Internet Required**: Works entirely on local WiFi networks
- **Multi-User Support**: Up to 200 concurrent users, 50 users per room
- **Real-time Messaging**: Instant message delivery using Socket.IO
- **Room-based Chat**: Create public and private rooms with custom member limits
- **Advanced File Sharing**: Send files up to 50MB with progress indicators
- **WebRTC Support**: Direct peer-to-peer connections as backup
- **Offline Support**: Service worker for offline functionality
- **Local Network Discovery**: Find other WiFi Chat servers on your network

### User Experience
- **Modern UI**: Beautiful, responsive interface with light/dark themes
- **Room Management**: Create, join, and manage rooms with member limits
- **Direct Connections**: Establish direct peer-to-peer connections with other users
- **Message Features**: Edit, delete, and react to messages
- **File Management**: Download and manage shared files
- **Performance Optimized**: Rate limiting and message throttling for smooth operation

### Technical Features
- **Rate Limiting**: Prevents spam with message and file transfer limits
- **Performance Optimization**: Virtual scrolling and message queuing
- **Offline Queue**: Messages are queued when offline and sent when reconnected
- **Cross-platform**: Works on any device with a modern web browser
- **Progressive Web App**: Service worker for offline functionality

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd Lumen
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. **Access the application**
   - Open your browser to `http://localhost:3000`
   - The console will display your local IP address for other devices

## 🎯 Usage

### Getting Started
1. **Join the Network**: Enter your display name and optional avatar URL
2. **Create Rooms**: Set up public or private rooms with custom member limits
3. **Join Rooms**: Browse available rooms or join with a PIN for private rooms
4. **Start Chatting**: Send messages, share files, and interact with other users

### Advanced Features
- **Direct Connections**: Click "🔗 Direct" next to any user to establish a WebRTC connection
- **File Sharing**: Use the 📎 button to attach and send files
- **Room Management**: Room creators can manage members and settings
- **Offline Mode**: Continue using the app offline - messages will be sent when reconnected

### Network Discovery
- Click the "🔍 Discover" button to scan for other WiFi Chat servers on your local network
- Share your local IP address with others to let them join your server

## 🛠 Technical Details

### Backend Architecture
- **Node.js** with Express and Socket.IO
- **Rate Limiting**: 10 messages/minute, 5 files/minute per user
- **Room Management**: Configurable member limits and room creation limits
- **WebRTC Signaling**: Server-assisted peer-to-peer connection setup
- **Performance**: Optimized for up to 200 concurrent users

### Frontend Technology
- **Vanilla JavaScript** with modern ES6+ features
- **IndexedDB** for offline message and file storage
- **Service Worker** for offline functionality
- **WebRTC** with SimplePeer for direct connections
- **Responsive CSS** with modern design patterns

### File Transfer
- **Chunked Transfer**: Large files are split into 512KB chunks
- **Progress Tracking**: Real-time upload/download progress
- **Size Limits**: Maximum 50MB per file, 1000 chunks maximum
- **Type Support**: All file types supported

### Security Features
- **Input Sanitization**: All user input is properly escaped
- **Rate Limiting**: Prevents abuse and spam
- **Room Privacy**: PIN-protected private rooms
- **User Validation**: Proper user authentication and session management

## 🌐 Network Setup

### Local Network Access
1. Start the server on your computer
2. Note the local IP address displayed in the console
3. Other devices on the same WiFi network can access: `http://YOUR_IP:3000`
4. No internet connection required - works entirely on local network

### Port Configuration
- Default port: 3000
- Change with: `PORT=8080 npm start`
- Ensure firewall allows the port for network access

## 📱 Browser Compatibility

- **Chrome/Edge**: Full support including WebRTC
- **Firefox**: Full support including WebRTC
- **Safari**: Full support including WebRTC
- **Mobile Browsers**: Responsive design works on all mobile devices

## 🔧 Configuration

### Server Limits (configurable in server.js)
```javascript
const MAX_ROOM_MEMBERS = 50;        // Users per room
const MAX_ROOMS_PER_USER = 10;      // Rooms per user
const MAX_TOTAL_USERS = 200;        // Total server users
const MESSAGE_RATE_LIMIT = 10;      // Messages per minute
const FILE_RATE_LIMIT = 5;          // Files per minute
```

### Client Settings
- Message throttling: 100ms between messages
- Max visible messages: 100 (older messages are removed for performance)
- File chunk size: 512KB
- Offline message queue: Unlimited (stored in localStorage)

## 🚀 Performance Features

### Server Optimizations
- **Connection Pooling**: Efficient WebSocket management
- **Rate Limiting**: Prevents server overload
- **Memory Management**: Automatic cleanup of disconnected users
- **Error Handling**: Comprehensive error handling and logging

### Client Optimizations
- **Message Queuing**: Smooth message sending with throttling
- **Virtual Scrolling**: Efficient rendering of large message lists
- **Lazy Loading**: On-demand loading of chat history
- **Caching**: Service worker caching for offline functionality

## 🔒 Privacy & Security

- **Local Network Only**: No data leaves your local network
- **No External Services**: No third-party tracking or analytics
- **Encrypted Connections**: WebRTC provides end-to-end encryption for direct connections
- **User Control**: Users control their own data and connections

## 📄 License

MIT License - Feel free to use, modify, and distribute.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## 📞 Support

For issues or questions, please check the console logs for detailed error information and ensure all devices are on the same local network.

---

**Enjoy your enhanced WiFi Chat experience!** 🚀
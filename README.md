# Lumen Chat Web-Application

## Name update

A complete peer-to-peer webchat application that works over LAN and the internet using WebRTC and Socket.IO. Features real-time messaging, file transfers, public/private rooms, and direct peer connections with no database required.

## Features

- **Real-time P2P Communication**: Direct peer-to-peer messaging using WebRTC DataChannels
- **Room System**: Create and join public or private rooms (with 4-digit PIN protection)
- **File Transfers**: Chunked file transfer (512KB chunks) with progress tracking
- **Fallback Support**: Automatic fallback to server relay if P2P connection fails
- **Session Management**: 30-minute session persistence with localStorage
- **Client-side Caching**: IndexedDB for chat history and file storage
- **Responsive Design**: Mobile-friendly dark theme interface
- **LAN Support**: Works across local network devices
- **Security**: PIN hashing, XSS protection, and secure WebRTC connections

## Technology Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Real-time**: WebRTC DataChannels, Socket.IO
- **Storage**: IndexedDB (client-side), In-memory (server-side)
- **Security**: bcryptjs for PIN hashing, HTML escaping

## Installation

1. **Clone or download the project files**

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```
   
   For development with auto-restart:
   ```bash
   npm run dev
   ```

4. **Access the application**:
   - Local: http://localhost:3000
   - LAN: http://[YOUR_LOCAL_IP]:3000

## Finding Your Local IP Address

To allow other devices on your network to connect:

### Windows:
```bash
ipconfig
```
Look for "IPv4 Address" under your active network adapter.

### macOS/Linux:
```bash
ifconfig
```
Look for "inet" address under your active network interface.

### Alternative (All platforms):
```bash
node -e "console.log(require('os').networkInterfaces())"
```

## Usage Guide

### First Time Setup

1. **Enter Display Name**: When you first visit the app, enter your display name
2. **Session Persistence**: Your session will be saved for 30 minutes
3. **Automatic Reconnection**: If you refresh within 30 minutes, you'll automatically rejoin

### Navigation

The app has four main tabs:

- **Lobby**: Overview of your rooms and active connections
- **Public Rooms**: Browse and join public chat rooms
- **Private Rooms**: Create or join PIN-protected rooms
- **Peers**: View all connected users and start direct chats

### Creating Rooms

#### Public Room:
1. Go to "Public Rooms" tab
2. Click "Create Room"
3. Enter room name
4. Click "Create"

#### Private Room:
1. Go to "Private Rooms" tab
2. Click "Create Room"
3. Enter room name and 4-digit PIN
4. Click "Create"

### Joining Rooms

- **Public Rooms**: Click "Join" on any public room tile
- **Private Rooms**: Enter the 4-digit PIN and click "Join with PIN"

### Direct Peer Chat

1. Go to "Peers" tab
2. Use search bar to filter users
3. Click "Chat" on any peer tile
4. WebRTC connection will be established automatically

### File Sharing

1. Open any peer chat
2. Click the attachment button (📎)
3. Select files to send
4. Files are sent via WebRTC (or server fallback)
5. Recipients can download files automatically

### Room Management

- **Room Leaders**: The creator becomes the room lead
- **Kick Users**: Room leads can kick other users
- **Auto-cleanup**: Empty rooms are automatically deleted

## Network Configuration

### LAN Usage

The server listens on `0.0.0.0:3000`, making it accessible from any device on your local network.

**Example**: If your computer's IP is `192.168.1.100`, other devices can access:
```
http://192.168.1.100:3000
```

### Internet Usage

For internet access, you'll need to:

1. **Port Forward**: Forward port 3000 on your router to your computer
2. **Public IP**: Share your public IP address with remote users
3. **Firewall**: Ensure port 3000 is allowed through your firewall

### WebRTC Configuration

The app uses Google's STUN servers by default:
- `stun:stun.l.google.com:19302`
- `stun:stun1.l.google.com:19302`

For better connectivity across different networks, you can add TURN servers by modifying the `rtcConfig` in `public/app.js`.

## File Structure

```
P2P chat - ws/
├── package.json          # Dependencies and scripts
├── server.js            # Node.js server with Socket.IO
├── README.md           # This file
└── public/
    ├── index.html      # Main HTML structure
    ├── styles.css      # Responsive CSS styling
    └── app.js          # Client-side JavaScript
```

## Technical Details

### Data Flow

1. **User Connection**: Socket.IO handles initial connection and user registration
2. **Room Management**: Server maintains room state in memory
3. **P2P Signaling**: WebRTC signaling via Socket.IO
4. **Direct Communication**: Messages and files sent via WebRTC DataChannels
5. **Fallback**: Server relay when P2P fails

### File Transfer Process

1. **Chunking**: Files split into 512KB chunks
2. **Sequential Transfer**: Chunks sent with progress tracking
3. **Reassembly**: Receiver rebuilds file from chunks
4. **Storage**: Temporary storage in IndexedDB
5. **Download**: Automatic download trigger

### Security Features

- **PIN Protection**: Private room PINs hashed with bcryptjs
- **XSS Prevention**: All user input escaped
- **Session Security**: 30-minute expiry with secure storage
- **WebRTC Security**: Secure peer connections with STUN/TURN

## Troubleshooting

### Connection Issues

- **Can't connect to server**: Check if port 3000 is available
- **LAN access fails**: Verify firewall settings and local IP
- **WebRTC fails**: Check if STUN servers are accessible

### File Transfer Issues

- **Large files fail**: Increase chunk size or add delays
- **Transfer stuck**: Check WebRTC connection status
- **Fallback not working**: Verify Socket.IO connection

### Performance Tips

- **Large rooms**: Limit concurrent connections for better performance
- **File sizes**: Recommend files under 100MB for best experience
- **Network quality**: Better networks = faster P2P connections

## Browser Compatibility

- **Chrome**: Full support (recommended)
- **Firefox**: Full support
- **Safari**: WebRTC support varies by version
- **Edge**: Full support on Chromium-based versions

## Development

### Adding Features

The modular structure makes it easy to add features:

- **Server**: Modify `server.js` for new Socket.IO events
- **Client**: Extend the `P2PWebChat` class in `app.js`
- **UI**: Add components to `index.html` and style in `styles.css`

### Configuration Options

Key configuration points:

- **Port**: Change `PORT` environment variable or modify server.js
- **Session Duration**: Modify expiry time in `app.js`
- **Chunk Size**: Adjust `chunkSize` in file transfer code
- **STUN/TURN**: Update `rtcConfig` for different servers

## License

MIT License - Feel free to use and modify as needed.

## Support

For issues or questions:
1. Check the troubleshooting section
2. Verify your network configuration
3. Test with multiple devices on the same network
4. Check browser console for error messages

---

**Enjoy your P2P WebChat experience!** 🚀

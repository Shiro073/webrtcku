'use strict';

const socket = io.connect();

const localVideo = document.querySelector('#localVideo-container video');
const videoGrid = document.querySelector('#videoGrid');
const notification = document.querySelector('#notification');
const notify = (message) => {
    notification.innerHTML = message;
};

const pcConfig = {
    iceServers: [
        {
            urls: [
                'stun:stun.l.google.com:19302',
                'stun:stun1.l.google.com:19302',
                'stun:stun2.l.google.com:19302',
                'stun:stun3.l.google.com:19302',
                'stun:stun4.l.google.com:19302',
            ],
        },
        {
            urls: 'turn:numb.viagenie.ca',
            credential: 'muazkh',
            username: 'webrtc@live.com',
        },
        {
            urls: 'turn:numb.viagenie.ca',
            credential: 'muazkh',
            username: 'webrtc@live.com',
        },
        {
            urls: 'turn:192.158.29.39:3478?transport=udp',
            credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA=',
            username: '28224511:1379330808',
        },
    ],
};

/**
 * Initialize webrtc
 */
const webrtc = new Webrtc(socket, pcConfig, {
    log: true,
    warn: true,
    error: true,
});

/**
 * Create or join a room
 */
const roomInput = document.querySelector('#roomId');
const joinBtn = document.querySelector('#joinBtn');
joinBtn.addEventListener('click', () => {
    const room = roomInput.value;
    if (!room) {
        notify('Room ID not provided');
        return;
    }

    webrtc.joinRoom(room);
});

const setTitle = (status, e) => {
    const room = e.detail.roomId;

    console.log(`Room ${room} was ${status}`);

    notify(`Room ${room} was ${status}`);
    document.querySelector('h1').textContent = `Room: ${room}`;
    webrtc.gotStream();
};
webrtc.addEventListener('createdRoom', setTitle.bind(this, 'created'));
webrtc.addEventListener('joinedRoom', setTitle.bind(this, 'joined'));

/**
 * Leave the room
 */
const leaveBtn = document.querySelector('#leaveBtn');
leaveBtn.addEventListener('click', () => {
    webrtc.leaveRoom();
});
webrtc.addEventListener('leftRoom', (e) => {
    const room = e.detail.roomId;
    document.querySelector('h1').textContent = '';
    notify(`Left the room ${room}`);
});

/**
 * Get local media
 */
webrtc
    .getLocalStream(true, { width: 640, height: 480 })
    .then((stream) => (localVideo.srcObject = stream));

webrtc.addEventListener('kicked', () => {
    document.querySelector('h1').textContent = 'You were kicked out';
    videoGrid.innerHTML = '';
});

webrtc.addEventListener('userLeave', (e) => {
    console.log(`user ${e.detail.socketId} left room`);
});

/**
 * Handle new user connection
 */
webrtc.addEventListener('newUser', (e) => {
    const socketId = e.detail.socketId;
    const stream = e.detail.stream;

    const videoContainer = document.createElement('div');
    videoContainer.setAttribute('class', 'grid-item');
    videoContainer.setAttribute('id', socketId);

    const video = document.createElement('video');
    video.setAttribute('autoplay', true);
    video.setAttribute('muted', true);
    video.setAttribute('playsinline', true);
    video.srcObject = stream;

    const p = document.createElement('p');
    p.textContent = socketId;

    videoContainer.append(p);
    videoContainer.append(video);

    // If user is admin add kick buttons
    if (webrtc.isAdmin) {
        const kickBtn = document.createElement('button');
        kickBtn.setAttribute('class', 'kick_btn');
        kickBtn.textContent = 'Kick';

        kickBtn.addEventListener('click', () => {
            webrtc.kickUser(socketId);
        });

        videoContainer.append(kickBtn);
    }
    videoGrid.append(videoContainer);
});

/**
 * Handle user got removed
 */
webrtc.addEventListener('removeUser', (e) => {
    const socketId = e.detail.socketId;
    if (!socketId) {
        // remove all remote stream elements
        videoGrid.innerHTML = '';
        return;
    }
    document.getElementById(socketId).remove();
});

/**
 * Handle errors
 */
webrtc.addEventListener('error', (e) => {
    const error = e.detail.error;
    console.error(error);

    notify(error);
});

/**
 * Handle notifications
 */
webrtc.addEventListener('notification', (e) => {
    const notif = e.detail.notification;
    console.log(notif);

    notify(notif);
});

/**
 * Share Screen
 */
const shareScreenBtn = document.querySelector('#shareScreenBtn');
shareScreenBtn.addEventListener('click', async () => {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        
        // Replace local video with screen stream
        localVideo.srcObject = screenStream;

        screenStream.getTracks().forEach(track => {
            // Add screen stream tracks to the peer connection
            webrtc.peerConnection.addTrack(track, screenStream);
        });

        screenStream.getTracks()[0].addEventListener('ended', () => {
            // When the screen share stops, switch back to the camera stream
            webrtc.getLocalStream(true, { width: 640, height: 480 })
                .then((stream) => (localVideo.srcObject = stream));
        });
    } catch (error) {
        notify(`Error sharing screen: ${error.message}`);
    }
});


// Initialize the admin flag
webrtc.isAdmin = false;

// Handle admin-related events
webrtc.addEventListener('admin', (e) => {
  webrtc.isAdmin = true;
  notify('You are now the admin!');
  console.log("Admin flag set to true.");
});

// Handle joining the room
webrtc.addEventListener('joinedRoom', (e) => {
  const room = e.detail.roomId;
  // Check if user is admin
  if (webrtc.isAdmin) {
    // Allow admin to set up the room (e.g., share screen)
    notify('You are the admin. You can now share your screen.');
  }
  document.querySelector('h1').textContent = `Room: ${room}`;
  webrtc.gotStream();
});

// Handle leaving the room
webrtc.addEventListener('leftRoom', (e) => {
  const room = e.detail.roomId;
  document.querySelector('h1').textContent = '';
  notify(`Left the room ${room}`);
  webrtc.isAdmin = false;
});

// Handle new users joining the room
webrtc.addEventListener('newUser', (e) => {
  const socketId = e.detail.socketId;
  const stream = e.detail.stream;

  // Create a video container for the new user
  // ... (same as before)

  // Add the kick button if the user is admin
  if (webrtc.isAdmin) {
    // ... (same as before)
  } else {
    // If the user is not the admin, the join button should be disabled
    joinBtn.disabled = true;
  }
  videoGrid.append(videoContainer);
});

// Handle room setup events
webrtc.addEventListener('setupRoom', (e) => {
  const stream = e.detail.stream;
  
  // Handle admin setup here (e.g., sharing screen, setting the initial layout)
  
  // Update the video grid with the admin's stream
  videoGrid.innerHTML = '';
  const videoContainer = document.createElement('div');
  videoContainer.setAttribute('class', 'grid-item');
  videoContainer.setAttribute('id', 'admin');

  const video = document.createElement('video');
  video.setAttribute('autoplay', true);
  video.setAttribute('muted', true);
  video.setAttribute('playsinline', true);
  video.srcObject = stream;

  videoContainer.append(video);
  videoGrid.append(videoContainer);

  // Disable the join button for others
  joinBtn.disabled = true;
});

// Update UI for admin
webrtc.addEventListener('admin', () => {
  joinBtn.disabled = false;
  shareScreenBtn.disabled = false;
  notify("You are now the admin. You can share your screen.");
});

// Setup the server
const server = require('http').createServer();
const io = require('socket.io')(server, {
  cors: {
    origin: '*',
  },
});

io.on('connection', (socket) => {
  // Handle admin flag
  socket.on('admin', () => {
    socket.emit('admin');
  });
  // Handle room creation
  socket.on('createRoom', (room) => {
    socket.join(room);
    socket.to(room).emit('createdRoom', { roomId: room });
    console.log(`Room ${room} was created`);
  });

  // Handle joining a room
  socket.on('joinRoom', (room) => {
    socket.join(room);
    socket.to(room).emit('joinedRoom', { roomId: room });
    console.log(`User joined room ${room}`);
    socket.emit('joinedRoom', { roomId: room });
  });

  // Handle leaving a room
  socket.on('leaveRoom', (room) => {
    socket.leave(room);
    socket.to(room).emit('leftRoom', { roomId: room });
    console.log(`User left room ${room}`);
    socket.emit('leftRoom', { roomId: room });
  });

  // Handle kicking a user
  socket.on('kickUser', (roomId, socketId) => {
    socket.to(roomId).emit('kicked', { socketId: socketId });
    socket.to(roomId).emit('removeUser', { socketId: socketId });
    console.log(`User ${socketId} was kicked from room ${roomId}`);
  });

  // Handle new user connection in a room
  socket.on('newUser', (room, stream) => {
    socket.to(room).emit('newUser', { socketId: socket.id, stream: stream });
    console.log(`New user connected to room ${room}`);
  });

  // Handle user disconnection
  socket.on('disconnect', () => {
    const rooms = Object.keys(socket.rooms).filter((room) => room !== socket.id);
    rooms.forEach((room) => {
      socket.to(room).emit('removeUser', { socketId: socket.id });
      console.log(`User disconnected from room ${room}`);
    });
  });

  // Handle setup room event
  socket.on('setupRoom', (room, stream) => {
    socket.to(room).emit('setupRoom', { stream: stream });
  });

  socket.on('shareScreen', (room, stream) => {
    socket.to(room).emit('shareScreen', { stream: stream });
  });

  // Handle sharing a screen
  socket.on('shareScreen', (room, stream) => {
    // Send the screen stream to all users in the room
    socket.to(room).emit('shareScreen', { stream: stream });
  });

  // Handle room setup event
  socket.on('setupRoom', (room, stream) => {
    // Send the admin's stream to all users in the room
    socket.to(room).emit('setupRoom', { stream: stream });
  });
});

// Start the server
server.listen(3000, () => {
  console.log('Server listening on port 3000');
});

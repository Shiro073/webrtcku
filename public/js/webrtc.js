'use strict';

class Webrtc extends EventTarget {
  constructor(socket, pcConfig = null, logging = { log: true, warn: true, error: true }) {
    super();
    this.socket = socket;
    this.pcConfig = pcConfig;

    this._myId = null;
    this.pcs = {}; // Peer connections
    this.streams = {};
    this.room = null;
    this.inCall = false;
    this.isReady = false; // At least 2 users are in room
    this.isInitiator = false; // Initiates connections if true
    this._isAdmin = false; // Should be checked on the server
    this._localStream = null;

    // Manage logging
    this.log = logging.log ? console.log : () => {};
    this.warn = logging.warn ? console.warn : () => {};
    this.error = logging.error ? console.error : () => {};

    // Initialize socket.io listeners
    this._onSocketListeners();
  }

  // Custom event emitter
  _emit(eventName, details) {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail: details,
      })
    );
  }

  get localStream() {
    return this._localStream;
  }

  get myId() {
    return this._myId;
  }

  get isAdmin() {
    return this._isAdmin;
  }

  get roomId() {
    return this.room;
  }

  get participants() {
    return Object.keys(this.pcs);
  }

  joinRoom(roomId, userId) {
    if (this.room) {
      this.warn('Leave current room before joining a new one');
      this._emit('notification', { notification: `Leave current room before joining a new one` });
      return;
    }
    if (!roomId) {
      this.warn('Room ID not provided');
      this._emit('notification', { notification: `Room ID not provided` });
      return;
    }
    this.room = roomId;
    this.socket.emit('create or join', roomId, userId);
    this._emit('joinedRoom', { roomId: roomId });
    this.isAdmin = false; // Initially set as not admin

    this.getLocalStream().then(() => {
      this.createPeerConnection();
      this.createOffer();
    });
  }

  leaveRoom() {
    if (!this.room) {
      this.warn('You are currently not in a room');
      this._emit('notification', { notification: `You are currently not in a room` });
      return;
    }
    this.isInitiator = false;
    this.socket.emit('leave room', this.room);
  }

  // Get local stream
  getLocalStream(audio = true, video = true) {
    return navigator.mediaDevices
      .getUserMedia({
        video: video,
        audio: audio,
      })
      .then((stream) => {
        this.log('Got local stream.');
        this._localStream = stream;
        return stream;
      })
      .catch(() => {
        this.error("Can't get usermedia");
        this._emit('error', { error: new Error(`Can't get usermedia`) });
      });
  }

  // Create Peer Connection
  createPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.pcConfig);

    this.peerConnection.ontrack = (event) => {
      this.onTrack(event);
    };

    this.peerConnection.onicecandidate = (event) => {
      this.onIceCandidate(event);
    };

    this.peerConnection.onnegotiationneeded = () => {
      this.onNegotiationNeeded();
    };

    // Add local stream to the peer connection
    this._localStream.getTracks().forEach((track) => {
      this.peerConnection.addTrack(track, this._localStream);
    });
  }

  // Handle new user connected
  onUserConnected(userId) {
    this.createOffer();
  }

  // Handle user disconnected
  onUserDisconnected(userId) {
    this._emit('removeUser', { socketId: userId });
  }

  // Handle ICE candidate
  onIceCandidate(event) {
    if (event.candidate) {
      this.socket.emit('candidate', this.room, event.candidate);
    }
  }

  // Handle track received
  onTrack(event) {
    this._emit('newUser', { socketId: event.streams[0].id, stream: event.streams[0] });
  }

  // Handle offer
  onOffer(offer) {
    this.peerConnection
      .setRemoteDescription(offer)
      .then(() => this.peerConnection.createAnswer())
      .then((answer) => {
        this.peerConnection
          .setLocalDescription(answer)
          .then(() => {
            this.socket.emit('answer', this.room, answer);
          });
      })
      .catch((error) => {
        this._emit('error', { error: error.message });
      });
  }

  // Handle answer
  onAnswer(answer) {
    this.peerConnection.setRemoteDescription(answer).catch((error) => {
      this._emit('error', { error: error.message });
    });
  }

  // Handle candidate
  onCandidate(candidate) {
    this.peerConnection.addIceCandidate(candidate).catch((error) => {
      this._emit('error', { error: error.message });
    });
  }

  // Handle negotiation needed
  onNegotiationNeeded() {
    this.createOffer();
  }

  // Create offer
  createOffer() {
    this.peerConnection
      .createOffer()
      .then((offer) => {
        this.peerConnection.setLocalDescription(offer).then(() => {
          this.socket.emit('create-offer', this.room, offer);
        });
      })
      .catch((error) => {
        this._emit('error', { error: error.message });
      });
  }

  // Handle kicked event
  onKicked() {
    this._emit('kicked');
    this.leaveRoom();
  }

  // Initialize listeners for socket.io events
  _onSocketListeners() {
    this.log('Socket listeners initialized');

    // Room got created
    this.socket.on('created', (room, socketId) => {
      this.room = room;
      this._myId = socketId;
      this.isInitiator = true;
      this._isAdmin = true;
      this._emit('createdRoom', { roomId: room });
    });

    // Joined the room
    this.socket.on('joined', (room, socketId) => {
      this.log('Joined: ' + room);
      this.room = room;
      this.isReady = true;
      this._myId = socketId;
      this._emit('joinedRoom', { roomId: room });
    });

    // Left the room
    this.socket.on('left room', (room) => {
      if (room === this.room) {
        this.warn(`Left the room ${room}`);
        this.room = null;
        this._removeUser();
        this._emit('leftRoom', { roomId: room });
      }
    });

    // Someone joins room
    this.socket.on('join', (room) => {
      this.log('Incoming request to join room: ' + room);
      this.isReady = true;
      this.dispatchEvent(new Event('newJoin'));
    });

    // Room is ready for connection
    this.socket.on('ready', (user) => {
      this.log('User: ', user, ' joined room');
      if (user !== this._myId && this.inCall) this.isInitiator = true;
    });

    // Someone got kicked from call
    this.socket.on('kickout', (socketId) => {
      this.log('Kickout user: ', socketId);
      if (socketId === this._myId) {
        // You got kicked out
        this.dispatchEvent(new Event('kicked'));
        this._removeUser();
      } else {
        // Someone else got kicked out
        this._removeUser(socketId);
      }
    });

    // Logs from server
    this.socket.on('log', (log) => {
      this.log.apply(console, log);
    });

    // Message from the server
    this.socket.on('message', (message, socketId) => {
      this.log('From', socketId, ' received:', message.type);

      // Participant leaves
      if (message.type === 'leave') {
        this.log(socketId, 'Left the call.');
        this._removeUser(socketId);
        this.isInitiator = true;
        this._emit('userLeave', { socketId: socketId });
        return;
      }

      // Avoid duplicate connections
      if (this.pcs[socketId] && this.pcs[socketId].connectionState === 'connected') {
        this.log('Connection with ', socketId, ' is already established');
        return;
      }

      switch (message.type) {
        case 'gotstream': // user is ready to share their stream
          this._connect(socketId);
          break;
        case 'offer': // got connection offer
          if (!this.pcs[socketId]) {
            this._connect(socketId);
          }
          this.pcs[socketId].setRemoteDescription(new RTCSessionDescription(message));
          this._answer(socketId);
          break;
        case 'answer': // got answer for sent offer
          this.pcs[socketId].setRemoteDescription(new RTCSessionDescription(message));
          break;
        case 'candidate': // got new ice candidate
          this.pcs[socketId]
            .addIceCandidate(new RTCIceCandidate(message.candidate))
            .then(() => this.log('Added ICE candidate'))
            .catch((error) => this.warn('ICE candidate error', error));
          break;
      }
    });

    this.socket.on('kicked', () => this.onKicked());
    this.socket.on('offer', (offer) => this.onOffer(offer));
    this.socket.on('answer', (answer) => this.onAnswer(answer));
    this.socket.on('candidate', (candidate) => this.onCandidate(candidate));
  }

  _removeUser(userId) {
    if (this.pcs[userId]) {
      this.pcs[userId].close();
      delete this.pcs[userId];
    }
    this._emit('removeUser', { socketId: userId });
  }

  // Connect to other peer
  _connect(userId) {
    if (!this.pcs[userId]) {
      this.pcs[userId] = new RTCPeerConnection(this.pcConfig);

      this.pcs[userId].onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit('candidate', this.room, event.candidate);
        }
      };

      this.pcs[userId].ontrack = (event) => {
        this._emit('newUser', { socketId: userId, stream: event.streams[0] });
      };

      this._localStream.getTracks().forEach((track) => {
        this.pcs[userId].addTrack(track, this._localStream);
      });
    }
  }

  // Send answer to peer
  _answer(userId) {
    this.pcs[userId]
      .createAnswer()
      .then((answer) => {
        return this.pcs[userId].setLocalDescription(answer);
      })
      .then(() => {
        this.socket.emit('message', { type: 'answer', sdp: this.pcs[userId].localDescription.sdp }, userId);
      })
      .catch((error) => this._emit('error', { error: error.message }));
  }
}

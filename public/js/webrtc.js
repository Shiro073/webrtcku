'use strict';

class Webrtc {
  constructor(socket, pcConfig, options) {
    this.socket = socket;
    this.pcConfig = pcConfig;
    this.options = options;
    this.peerConnection = null;
    this.localStream = null;
    this.isAdmin = false;
    this.roomId = null;
    this.roomName = null;

    this.eventListeners = new Map();

    this.socket.on('user-connected', (userId) => {
      this.onUserConnected(userId);
    });

    this.socket.on('user-disconnected', (userId) => {
      this.onUserDisconnected(userId);
    });

    this.socket.on('create-offer', (offer) => {
      this.onOffer(offer);
    });

    this.socket.on('answer', (answer) => {
      this.onAnswer(answer);
    });

    this.socket.on('candidate', (candidate) => {
      this.onCandidate(candidate);
    });

    this.socket.on('kicked', () => {
      this.onKicked();
    });

    this.socket.on('new-room', (roomId, roomName) => {
      this.onNewRoom(roomId, roomName);
    });
  }

  // Add event listener
  addEventListener(event, listener) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(listener);
  }

  // Dispatch event
  dispatchEvent(event, detail) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).forEach((listener) => {
        listener({ detail });
      });
    }
  }

  // Get local media stream
  getLocalStream(audio = true, video = true) {
    return navigator.mediaDevices
     .getUserMedia({
        video: video,
        audio: audio,
      })
     .then((stream) => {
        this.localStream = stream;
        return stream;
      })
     .catch((error) => {
        this.dispatchEvent('error', { error: error.message });
      });
  }

  // Create a new room
  createRoom(roomName) {
    this.socket.emit('create-room', roomName);
  }

  // Join a room
  joinRoom(roomId, userId) {
    this.roomId = roomId;
    this.socket.emit('join-room', roomId, userId);
    this.dispatchEvent('joinedRoom', { roomId: roomId });
    this.isAdmin = false; // Initially set as not admin

    this.createPeerConnection();
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
    this.localStream.getTracks().forEach((track) => {
      this.peerConnection.addTrack(track, this.localStream);
    });
  }

  // Handle new user connected
  onUserConnected(userId) {
    if (this.isAdmin) {
      // Admin creates offer and sends to new user
      this.createOffer();
    } else {
      // Other users wait for offer
      console.log('Waiting for offer from admin...');
    }
  }

  // Handle user disconnected
  onUserDisconnected(userId) {
    this.dispatchEvent('removeUser', { socketId: userId });
  }

  // Handle ICE candidate
  onIceCandidate(event) {
    if (event.candidate) {
      this.socket.emit('candidate', this.roomId, event.candidate);
    }
  }

  // Handle track received
  onTrack(event) {
    this.dispatchEvent('newUser', {
      socketId: event.streams[0].id,
      stream: event.streams[0],
    });
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
            this.socket.emit('answer', this.roomId, answer);
          });
      })
     .catch((error) => {
        this.dispatchEvent('error', { error: error.message });
      });
  }

  // Handle answer
  onAnswer(answer) {
    this.peerConnection
     .setRemoteDescription(answer)
     .catch((error) => {
        this.dispatchEvent('error', { error: error.message });
      });
  }

  // Handle candidate
  onCandidate(candidate) {
    this.peerConnection
     .addIceCandidate(candidate)
     .catch((error) => {
        this.dispatchEvent('error

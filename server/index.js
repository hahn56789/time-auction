
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const socketToRoom = {};

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ====== 설정 ======
const TOTAL_ROUNDS = 5;
const REQUIRED_PLAYERS = 2;
const rooms = {};

const words = ["tree", "sun", "cloud", "stone", "apple", "fire", "rain", "moon", "wind"];

function generateRoomCode() {
  const word = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return word + num;
}

// ====== 유틸 ======
function createRoom(roomId, requiredPlayers = REQUIRED_PLAYERS) {
  rooms[roomId] = {
    players: {},                   // socket.id -> { nickname, ready, remainingTime }
    participatingPlayers: {},      // socket.id -> { startTime, usedTime, finished }
    spectators: new Set(),
    auctionTime: 0,
    auctionInterval: null,
    currentRound: 1,
    winnerHistory: [],
    auctionStarted: false,
    countdownTimer: null,
    drawTimer: null,
    requiredPlayers
  };
  console.log(`📦 방 생성됨: ${roomId} (필요 인원: ${requiredPlayers})`);
}

function broadcastPlayerCount(roomId) {
  const room = rooms[roomId];
  const count = Object.keys(room.players).length;
  io.to(roomId).emit("playerCount", { current: count, required: room.requiredPlayers });
}

function broadcastPlayerList(roomId) {
  const room = rooms[roomId];
  // Compute win counts for all players in the room
  const winCounts = {};
  if (room.winnerHistory) {
    for (const { winnerId } of room.winnerHistory) {
      winCounts[winnerId] = (winCounts[winnerId] || 0) + 1;
    }
  }
  const list = Object.entries(room.players).map(([id, p]) => {
    const participation = room.participatingPlayers[id];
    return {
      id,
      nickname: p.nickname,
      ready: p.ready,
      participating: !!participation,
      usedTime: participation?.usedTime !== undefined ? participation.usedTime.toFixed(1) : "-",
      remainingTime: p.remainingTime !== undefined ? p.remainingTime.toFixed(1) : "-",
      wins: winCounts[id] || 0,
    };
  });
  io.to(roomId).emit("playerList", list);
  room.spectators?.forEach(sid => {
    io.to(sid).emit("playerList", list);
  });
}

function getNickname(room, socketId) {
  return room.players[socketId]?.nickname || socketId;
}

function resetRoom(room, roomId) {
  clearInterval(room.auctionInterval);
  clearTimeout(room.countdownTimer);
  clearTimeout(room.drawTimer);

  room.participatingPlayers = {};
  room.auctionTime = 0;
  room.auctionStarted = false;

  for (const id in room.players) {
    room.players[id].ready = false;
  }
  broadcastPlayerList(roomId); // ❌ 모두 표시되도록 갱신
}

function checkAndStartRound(roomId) {
  const room = rooms[roomId];
  const allPlayers = Object.values(room.players);
  const readyCount = allPlayers.filter(p => p.ready).length;

  const allReady = allPlayers.length >= 2 && readyCount === allPlayers.length;

  if (readyCount === room.requiredPlayers || allReady) {
    console.log(`⏳ 라운드 ${room.currentRound} 카운트다운 시작 [${roomId}]`);
    io.to(roomId).emit("startCountdown");

    room.countdownTimer = setTimeout(() => {
      room.drawTimer = setTimeout(() => {
        if (!room.auctionStarted && Object.keys(room.participatingPlayers).length === 0) {
          console.log(`⚠️ 라운드 ${room.currentRound} 무승부 (참여자 없음)`);
          io.to(roomId).emit("auctionDraw", { round: room.currentRound });
          advanceRound(roomId);
        }
      }, 3000);
    }, 5000);
  }
}

function advanceRound(roomId) {
  const room = rooms[roomId];

  if (room.currentRound < TOTAL_ROUNDS) {
    room.currentRound++;
    resetRoom(room, roomId);
  } else {
    // 게임 종료 처리
    const winCounts = {};
    for (const { winnerId } of room.winnerHistory) {
      winCounts[winnerId] = (winCounts[winnerId] || 0) + 1;
    }

    const standings = Object.entries(room.players).map(([id, p]) => ({
      playerId: id,
      nickname: p.nickname,
      wins: winCounts[id] || 0,
      remainingTime: p.remainingTime
    }));

    standings.sort((a, b) =>
      b.wins !== a.wins ? b.wins - a.wins : b.remainingTime - a.remainingTime
    );

    let rank = 1;
    standings.forEach((p, i) => {
      if (i > 0 &&
          (p.wins !== standings[i - 1].wins ||
           p.remainingTime !== standings[i - 1].remainingTime)) {
        rank = i + 1;
      }
      p.rank = rank;
    });

    console.log(`🏁 게임 종료 [${roomId}]`);
    standings.forEach(s =>
      console.log(`${s.rank}위: ${s.nickname} (${s.wins}승, ${s.remainingTime.toFixed(1)}초)`)
    );

    io.to(roomId).emit("gameFinished", { standings, roundHistory: room.roundHistory || [] });
  }
}

// ====== 소켓 핸들링 ======
io.on("connection", socket => {
  let currentRoom = null;

  socket.on("requestRoomCode", (customCount = REQUIRED_PLAYERS) => {
    let code;
    do {
      code = generateRoomCode();
    } while (rooms[code]);

    createRoom(code, customCount); // ✅ 방을 실제로 생성함
    io.to(socket.id).emit("roomCode", code);
    io.to(socket.id).emit("roundConfig", TOTAL_ROUNDS);
  });


  socket.on("joinRoom", ({ roomId, nickname, spectator = false }) => {
    if (!rooms[roomId]) {
      socket.emit("roomNotFound");
      return;
    }

    if (!spectator && (rooms[roomId].currentRound > 1 || rooms[roomId].auctionStarted)) {
      socket.emit("roomNotJoinable");
      return;
    }

    // 🚫 Check if room is full (for non-spectators)
    if (
      !spectator &&
      Object.keys(rooms[roomId].players).length >= rooms[roomId].requiredPlayers
    ) {
      socket.emit("roomFull");
      return;
    }

    currentRoom = roomId;
    socket.join(roomId);

    if (spectator) {
        rooms[roomId].spectators.add(socket.id); // ✅ 관전자 추가
    } else {
      rooms[roomId].players[socket.id] = {
        nickname,
        ready: false,
        remainingTime: 300
      };
    }

    socket.emit("roomCode", { code: roomId, completedRoundsCount: rooms[roomId].currentRound - 1 });
    socket.emit("roundConfig", TOTAL_ROUNDS);
    broadcastPlayerCount(roomId);
    broadcastPlayerList(roomId);

    console.log(`✅ 입장: ${nickname} (${socket.id}) → [${roomId}]${spectator ? ' (관전자)' : ''}`);
  });

  socket.on("playerReady", () => {
    const room = rooms[currentRoom];
    if (!room?.players[socket.id]) return;

    room.players[socket.id].ready = true;
    broadcastPlayerList(currentRoom);
    if (room.players[socket.id]) {
      console.log(`🟢 준비 완료: ${getNickname(room, socket.id)}`);
    }
    checkAndStartRound(currentRoom);
  });
    // Respond to requestPlayerList from spectators
    socket.on("requestPlayerList", roomId => {
        if (rooms[roomId]) {
        broadcastPlayerList(roomId);
        }
    });
  socket.on("startParticipation", () => {
    const room = rooms[currentRoom];
    if (!room?.players[socket.id]) return;

    const player = room.players[socket.id];

    // ✅ 남은 시간이 없으면 참여 무효 처리
    if (player.remainingTime <= 0) {
      if (room.players[socket.id]) {
        console.log(`⛔ ${player.nickname}는 남은 시간이 0초라 참여할 수 없습니다.`);
      }
      return;
    }

    // 최초 경매 시작
    if (!room.auctionStarted) {
      room.auctionStarted = true;
      clearTimeout(room.drawTimer);

      room.auctionInterval = setInterval(() => {
        room.auctionTime = parseFloat((room.auctionTime + 0.1).toFixed(1));
        io.to(currentRoom).emit("updateAuctionTime", room.auctionTime);
        room.spectators?.forEach(sid => {
            io.to(sid).emit("updateAuctionTime", room.auctionTime);
        });
      }, 100);
    }

    room.participatingPlayers[socket.id] = {
      startTime: room.auctionTime,
      usedTime: 0,
      finished: false
    };

    if (room.players[socket.id]) {
      console.log(`▶️ 참여 시작: ${getNickname(room, socket.id)}`);
    }
  });

  socket.on("endParticipation", () => {
    const room = rooms[currentRoom];
    const p = room?.participatingPlayers[socket.id];
    if (!room || !p || p.finished) return;

    const player = room.players[socket.id];
    p.usedTime = parseFloat((room.auctionTime - p.startTime).toFixed(1));
    p.finished = true;
    player.remainingTime = Math.max(0, parseFloat((player.remainingTime - p.usedTime).toFixed(1)));

    if (room.players[socket.id]) {
      console.log(`⏹️ 참여 종료: ${player.nickname} → ${p.usedTime}초`);
    }

    // After participation ends, update player list for all
    broadcastPlayerList(currentRoom);

    const allDone = Object.values(room.participatingPlayers).every(p => p.finished);
    if (allDone) {
      clearInterval(room.auctionInterval);

      if (!room.roundHistory) room.roundHistory = [];

      const entries = Object.entries(room.participatingPlayers);
      let roundHistoryPushed = false;

      if (entries.length === 0) {
        io.to(currentRoom).emit("auctionDraw", { round: room.currentRound });
        // Only push once per round, winner set to null
        const roundData = {};
        for (const id in room.players) {
          const nicknamePlayer = room.players[id].nickname;
          const remaining = room.players[id].remainingTime.toFixed(1);
          roundData[nicknamePlayer] = { usedTime: "-", remainingTime: remaining };
        }
        room.roundHistory.push({
          round: room.currentRound,
          data: roundData,
          winner: null
        });
        roundHistoryPushed = true;
      } else {
        entries.sort((a, b) => b[1].usedTime - a[1].usedTime);
        const topTime = entries[0][1].usedTime;
        const topPlayers = entries.filter(([_, v]) => v.usedTime === topTime);

        if (topPlayers.length > 1) {
          console.log(`⚠️ 라운드 ${room.currentRound} 무승부 (동일 시간)`);
          io.to(currentRoom).emit("auctionDraw", { round: room.currentRound });
          // For draw, winner is null, push once
          const roundData = {};
          for (const id in room.players) {
            const nicknamePlayer = room.players[id].nickname;
            const remaining = room.players[id].remainingTime.toFixed(1);
            const used = room.participatingPlayers[id]?.usedTime?.toFixed(1) ?? "-";
            roundData[nicknamePlayer] = { usedTime: used, remainingTime: remaining };
          }
          room.roundHistory.push({
            round: room.currentRound,
            data: roundData,
            winner: null
          });
          roundHistoryPushed = true;
        } else {
          const [winnerId, info] = topPlayers[0];
          const nickname = room.players[winnerId]?.nickname || winnerId;
          room.winnerHistory.push({ round: room.currentRound, winnerId, usedTime: info.usedTime });

          console.log(`🥇 라운드 ${room.currentRound} 낙찰: ${nickname} (${info.usedTime}초)`);

          io.to(currentRoom).emit("auctionEnded", {
            winnerId: nickname,
            usedTime: info.usedTime,
            round: room.currentRound
          });

          // Only push once per round, winner set to nickname
          const roundData = {};
          for (const id in room.players) {
            const nicknamePlayer = room.players[id].nickname;
            const remaining = room.players[id].remainingTime.toFixed(1);
            const used = room.participatingPlayers[id]?.usedTime?.toFixed(1) ?? "-";
            roundData[nicknamePlayer] = { usedTime: used, remainingTime: remaining };
          }
          room.roundHistory.push({
            round: room.currentRound,
            data: roundData,
            winner: nickname
          });
          roundHistoryPushed = true;
        }
      }

      // Ensure only one push per round (remove any accidental duplicates)
      // Remove all but last for this round
      room.roundHistory = room.roundHistory.filter(
        (entry, idx, arr) =>
          entry.round !== room.currentRound || idx === arr.length - 1
      );

      io.to(currentRoom).emit("roundHistoryUpdate", room.roundHistory);

      advanceRound(currentRoom);
    }
  });

  socket.on("rematchYes", ({ nickname }) => {
    const oldRoom = Object.entries(rooms).find(([roomId, room]) =>
      room.players && room.players[socket.id]
    )?.[0];

    const match = oldRoom && oldRoom.match(/^([a-z]+)(\d+)$/);
    let base = "room", num = 1;
    if (match) {
      base = match[1];
      num = parseInt(match[2]) + 1;
    }
    const newCode = base + num;

    // ✅ 이미 존재하면 join, 없으면 create 후 join
    if (!rooms[newCode]) createRoom(newCode);

    rooms[newCode].players[socket.id] = {
      nickname,
      ready: false,
      remainingTime: 300
    };

    socket.leave(oldRoom);
    if (rooms[oldRoom]) {
      delete rooms[oldRoom].players[socket.id];
      delete rooms[oldRoom].participatingPlayers[socket.id];
      if (Object.keys(rooms[oldRoom].players).length === 0) {
        delete rooms[oldRoom];
        console.log(`🗑️ 이전 방 제거됨: ${oldRoom}`);
      }
    }

    socket.join(newCode);
    currentRoom = newCode;
    socketToRoom[socket.id] = newCode;

    const room = rooms[newCode];
    room.currentRound = 1;
    room.winnerHistory = [];
    room.auctionStarted = false;
    room.auctionTime = 0;
    room.participatingPlayers = {};

    for (const id in room.players) {
      room.players[id].ready = false;
      room.players[id].remainingTime = 300;
    }

    broadcastPlayerList(newCode);
    broadcastPlayerCount(newCode);

    console.log(`🔁 ${nickname} → 리매치 방 입장: [${newCode}]`);
    socket.emit("rematchInitialized", newCode);
  });

  socket.on("rematchRequest", () => {
    const room = rooms[currentRoom];
    if (!room) return;

    room.currentRound = 1;
    room.winnerHistory = [];
    for (const id in room.players) {
        room.players[id].ready = false;
        room.players[id].remainingTime = 300;
    }

    broadcastPlayerList(currentRoom);
    io.to(currentRoom).emit("rematchReady"); // 클라이언트 측 UI 초기화 유도
    console.log(`🔁 리매치 요청 처리 완료 [${currentRoom}]`);
  });

  socket.on("leaveRoom", () => {
    const room = rooms[currentRoom];
    if (!room) return;

    if (room.players[socket.id]) {
      const nickname = getNickname(room, socket.id);
      console.log(`👋 리매치 거절로 퇴장: ${nickname}`);
    }

    delete room.players[socket.id];
    delete room.participatingPlayers[socket.id];

    socket.leave(currentRoom);
    broadcastPlayerCount(currentRoom);
    broadcastPlayerList(currentRoom);

    if (Object.keys(room.players).length === 0) {
      clearInterval(room.auctionInterval);
      clearTimeout(room.countdownTimer);
      clearTimeout(room.drawTimer);
      delete rooms[currentRoom];
      console.log(`🗑️ 방 제거됨: ${currentRoom}`);
    }

    currentRoom = null;
  });

  socket.on("disconnect", () => {
    const room = rooms[currentRoom];
    if (!room) return;

    if (room.players[socket.id]) {
      const nickname = getNickname(room, socket.id);
      console.log(`❌ 연결 해제: ${nickname}`);
    }

    delete room.players[socket.id];
    delete room.participatingPlayers[socket.id];
    room.spectators?.delete(socket.id);
    broadcastPlayerCount(currentRoom);
    broadcastPlayerList(currentRoom);

    if (Object.keys(room.players).length === 0) {
      clearInterval(room.auctionInterval);
      clearTimeout(room.countdownTimer);
      clearTimeout(room.drawTimer);
      delete rooms[currentRoom];
      console.log(`🗑️ 방 제거됨: ${currentRoom}`);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 서버 실행 중: http://0.0.0.0:${PORT}`);
});
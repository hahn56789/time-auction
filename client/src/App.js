import React, { useState, useEffect, useRef } from "react";
import Modal from "react-modal";
import SpectatorView from "./SpectatorView";
import "./App.css";

import socket from "./socket";

function App() {
  const [nickname, setNickname] = useState("");
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const [joinTab, setJoinTab] = useState("create");
  const [isSpectator, setIsSpectator] = useState(false);

  const [playerList, setPlayerList] = useState([]);
  const [playerCount, setPlayerCount] = useState({ current: 0, required: 2 });
  // 방 생성 시 필요 인원 선택
  const [customRequiredPlayers, setCustomRequiredPlayers] = useState(2);

  const [remainingTime, setRemainingTime] = useState(300);
  const [auctionTime, setAuctionTime] = useState(0);
  const [countdown, setCountdown] = useState(null);

  const [ready, setReady] = useState(false);
  const [participating, setParticipating] = useState(false);
  const [holding, setHolding] = useState(false);

  const [resultMsg, setResultMsg] = useState("");
  const [winnerInfo, setWinnerInfo] = useState(null);
  const [completedRounds, setCompletedRounds] = useState([]);
  const [standings, setStandings] = useState([]);
  const [showRematchPrompt, setShowRematchPrompt] = useState(false);
  const [showExitPrompt, setShowExitPrompt] = useState(false);

  const [totalRounds, setTotalRounds] = useState(10);

  const [roundHistory, setRoundHistory] = useState([]);
  const [nicknameWinCounts, setNicknameWinCounts] = useState([]);
  const [showDetails, setShowDetails] = useState(false);

  const holdingRef = useRef(false);
  const countdownRef = useRef(null);
  const timerRef = useRef(null);
  const startRef = useRef(0);

  // 🔁 라운드가 끝날 때 준비 상태 초기화

  useEffect(() => {
    socket.on("roomCode", ({ code, completedRoundsCount = 0 }) => {
        setRoomId(code);
        setJoined(true);
        // setIsSpectator(code.includes("spec")); // <-- removed

        // ✅ 새 방 입장 시 모든 상태 초기화
        setAuctionTime(0);
        setCountdown(null);
        setReady(false);
        setParticipating(false);
        setHolding(false);
        setWinnerInfo(null);
        setCompletedRounds(Array.from({ length: completedRoundsCount }, (_, i) => i + 1));
        setStandings([]);
        setRemainingTime(300);
        setResultMsg("");
    });
    socket.on("roundConfig", setTotalRounds);

    return () => {
      socket.off("roomCode");
      socket.off("roundConfig");
    };
  }, []);

  useEffect(() => {
    setReady(false);
    setParticipating(false);
  }, [completedRounds]);

  useEffect(() => {
    socket.on("roomNotFound", () => {
        alert("존재하지 않는 방입니다. 방 코드를 확인해주세요.");
        setJoined(false);
        setRoomId("");
    });

    return () => socket.off("roomNotFound");
  }, []);

  useEffect(() => {
    socket.on("rematchInitialized", (newCode) => {
        setRoomId(newCode); // ✅ update the roomId displayed in top-left
        setJoined(true);    // ✅ ensure UI enters joined state
        setAuctionTime(0);
        setCountdown(null);
        setReady(false);
        setParticipating(false);
        setHolding(false);
        setWinnerInfo(null);
        setCompletedRounds([]);
        setStandings([]);
        setRemainingTime(300);
        setResultMsg("");
        setShowRematchPrompt(false);
        setShowExitPrompt(false);
    });

    return () => socket.off("rematchInitialized");
  }, []); 
  
  useEffect(() => {
    socket.on("rematchReady", () => {
        setReady(false);
        setParticipating(false);
        setResultMsg("");
        setWinnerInfo(null);
    });

    return () => socket.off("rematchReady");
  }, []);

  // New useEffect for roundHistoryUpdate event
  useEffect(() => {
    socket.on("roundHistoryUpdate", updated => {
      setRoundHistory(updated);

      const counts = Object.entries(
        updated.reduce((acc, round) => {
          if (round.winner) {
            acc[round.winner] = (acc[round.winner] || 0) + 1;
          }
          return acc;
        }, {})
      ).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]; // 내림차순
        return a[0].localeCompare(b[0]);       // 승수가 같으면 닉네임 오름차순
      });

      setNicknameWinCounts(counts);
    });
    return () => socket.off("roundHistoryUpdate");
  }, []);

  // 🧠 소켓 이벤트 설정
  useEffect(() => {
    socket.on("updateAuctionTime", setAuctionTime);
    socket.on("playerCount", setPlayerCount);
    // Force re-render playerList
    socket.on("playerList", list => {
      setPlayerList([...list]);
    });

    socket.on("startCountdown", () => {
      setResultMsg("⏳ 카운트다운 시작");
      setCountdown(5);
      setWinnerInfo(null);

      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev === 1) {
            clearInterval(countdownRef.current);
            setCountdown(null);

            if (holdingRef.current) {
              setParticipating(true);
              startRef.current = auctionTime;
              socket.emit("startParticipation");
            } else {
              setParticipating(false);
              setResultMsg("❌ 참여 실패");
            }
          }
          return prev - 1;
        });
      }, 1000);
    });

    socket.on("auctionEnded", ({ winnerId, usedTime, round }) => {
      setResultMsg(`${round} 라운드 낙찰자`);
      setWinnerInfo({ winnerId, usedTime });
      setCompletedRounds(prev => [...prev, round]);
    });

    socket.on("auctionDraw", ({ round }) => {
      setResultMsg(`⚠️ 라운드 ${round} 무승부`);
      setCompletedRounds(prev => [...prev, round]);
    });

    socket.on("gameFinished", ({ standings, roundHistory }) => {
        setResultMsg("🎉 게임 종료!");
        setStandings(standings);
        setRoundHistory(roundHistory || []);

        // ✅ 순위표를 먼저 보여주고, 3초 뒤에 리매치 창 띄움
        setTimeout(() => {
            setShowRematchPrompt(true);
        }, 5000);
    });

    return () => {
      socket.off("updateAuctionTime");
      socket.off("playerCount");
      socket.off("playerList");
      socket.off("roomCode");
      socket.off("startCountdown");
      socket.off("auctionEnded");
      socket.off("auctionDraw");
      socket.off("gameFinished");
    };
  }, [auctionTime]);

  // Spectator: refresh playerList on countdown or auctionTime change
  useEffect(() => {
    if (isSpectator) {
      socket.emit("requestPlayerList", roomId); // emit custom event to ask for refresh
    }
  }, [countdown, auctionTime, isSpectator, roomId]);

  // 🕐 시간 차감
  useEffect(() => {
    if (participating && holding && countdown === null) {
      timerRef.current = setInterval(() => {
        setRemainingTime(prev => parseFloat((prev - 0.1).toFixed(1)));
      }, 100);
    } else {
      clearInterval(timerRef.current);
    }
  }, [participating, holding, countdown]);

  // ✋ 참여 종료
  useEffect(() => {
    if (participating && !holding) {
      const used = parseFloat((auctionTime - startRef.current).toFixed(1));
      setResultMsg(`✅ 사용 ${used}초`);
      socket.emit("endParticipation");
    }
  }, [holding, auctionTime, participating]);
  // 🚫 이미 시작된 방 입장 차단
  useEffect(() => {
    socket.on("roomNotJoinable", () => {
      alert("이 방은 이미 게임이 시작되어 입장할 수 없습니다.");
      setJoined(false);
      setRoomId("");
    });
    return () => socket.off("roomNotJoinable");
  }, []);

  // 🚫 정원 초과 방 입장 차단
  useEffect(() => {
    socket.on("roomFull", () => {
      alert("해당 방은 정원이 가득 찼습니다.");
      setJoined(false);
      setRoomId("");
    });
    return () => socket.off("roomFull");
  }, []);

  // 🛈 게임 설명 모달 상태 및 함수
  const [showHelpModal, setShowHelpModal] = useState(false);
  const openHelpModal = () => setShowHelpModal(true);
  const closeHelpModal = () => setShowHelpModal(false);

  // 입장 관련
  const handleCreateRoom = () => {
    if (!nickname) return alert("닉네임을 입력해주세요.");
    socket.emit("requestRoomCode", customRequiredPlayers);
    socket.once("roomCode", code => {
      socket.emit("joinRoom", { roomId: code, nickname });
    //   setJoined(true);
    });
  };

  const handleJoinRoom = () => {
    if (!nickname || !roomId) return alert("방 코드와 닉네임을 입력해주세요.");
    setIsSpectator(false);
    socket.emit("joinRoom", { roomId, nickname });
    // setJoined(true);
  };

  const handleSpectateRoom = () => {
    if (!nickname || !roomId) return alert("방 코드와 닉네임을 입력해주세요.");
    setIsSpectator(true);
    socket.emit("joinRoom", { roomId, nickname, spectator: true });
  };

  const handleReady = () => {
    setReady(true);
    setResultMsg("🟢 준비 완료");
    socket.emit("playerReady");

    // Update the local playerList state to reflect readiness
    setPlayerList(prev =>
      prev.map(p =>
        p.nickname === nickname ? { ...p, ready: true } : p
      )
    );
  };

  const handleHold = (value) => {
    setHolding(value);
    holdingRef.current = value;
  };

  const handleRematchYes = () => {
    socket.emit("rematchYes", { nickname });
    setShowRematchPrompt(false);
  };

  const handleRematchNo = () => {
    setShowRematchPrompt(false);
    setShowExitPrompt(true); // ✅ 나가기 버튼만 표시
  };

    console.log("🏅 nicknameWinCounts:", nicknameWinCounts);
    console.log("📜 roundHistory:", roundHistory);  
  // 📺 렌더링
  return (
    <div className="App">
      {roomId && (
        <div className="room-code-fixed">
            방 코드: <strong>{roomId}</strong>
        </div>
      )}
      {!joined ? (
        <>
          <div className="title-wrapper">
            <img src="/img/main_title.png" alt="시간 경매" className="cropped-img" />
          </div>
          {/* <h3 className="main-title">Time Auction</h3> */}
          <div className="nickname-box-global">
            <input
              type="text"
              placeholder="닉네임을 입력하세요"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
            />
          </div>

          <div className="join-area">
            <div className="tab-selector folder-style">
              <button
                className={joinTab === "create" ? "active" : ""}
                onClick={() => setJoinTab("create")}
              >
                🚪 방 생성
              </button>
              <button
                className={joinTab === "join" ? "active" : ""}
                onClick={() => setJoinTab("join")}
              >
                🚪 방 입장
              </button>
              <button
                className={joinTab === "spectate" ? "active" : ""}
                onClick={() => setJoinTab("spectate")}
              >
                👁️ 관전
              </button>
            </div>
            <div className="tab-content">
              {joinTab === "create" && (
                <div className="square-box">
                  <label>필요 인원 수:
                    <select
                      value={customRequiredPlayers}
                      onChange={e => setCustomRequiredPlayers(Number(e.target.value))}
                    >
                      {[2, 3, 4, 5, 6, 7, 8].map(n => (
                        <option key={n} value={n}>{n}명</option>
                      ))}
                    </select>
                  </label>
                  <button onClick={handleCreateRoom}>방 생성</button>
                </div>
              )}
              {joinTab === "join" && (
                <div className="square-box">
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      handleJoinRoom();
                    }}
                  >
                    <input
                      type="text"
                      placeholder="방 코드 입력"
                      value={roomId}
                      onChange={e => setRoomId(e.target.value)}
                    />
                    <button type="submit">입장</button>
                  </form>
                </div>
              )}
              {joinTab === "spectate" && (
                <div className="square-box">
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      handleSpectateRoom();
                    }}
                  >
                    <input
                      type="text"
                      placeholder="관전할 방 코드 입력"
                      value={roomId}
                      onChange={e => setRoomId(e.target.value)}
                    />
                    <button type="submit">관전 시작</button>
                  </form>
                </div>
              )}
            </div>
          </div>
          <button onClick={openHelpModal} style={{ marginTop: "1rem", fontSize: "1rem" }}>
            ❔ 게임 설명 보기
          </button>

          <Modal
            isOpen={showHelpModal}
            onRequestClose={closeHelpModal}
            contentLabel="게임 설명"
            ariaHideApp={false}
            style={{
              content: {
                maxWidth: "600px",
                margin: "auto",
                padding: "2rem",
                borderRadius: "12px",
                border: "2px solid #5e412f",
                backgroundColor: "#fffaf5",
                color: "#3e2e1a",
                fontFamily: "'Playfair Display', serif",
              }
            }}
          >
            <h2>⏱️ 시간 경매 게임 규칙</h2>
            <p>
              <strong>‘시간 경매’</strong>는 플레이어들이 제한된 시간(5분)을 자산으로 삼아 경매 라운드에서 낙찰을 겨루는 게임입니다.
            </p>
            <ul style={{ textAlign: "left", paddingLeft: "1.2rem" }}>
              <li>각 플레이어는 <b>5분(300초)의 시간을 보유</b>하고 시작합니다. 기록은 0.1초 단위로 이루어집니다.</li>
              <li>방에 입장한 모든 플레이어가 <img src="/img/ready_button_icon.png" alt="준비완료 버튼" style={{ width: "50px", verticalAlign: "middle", margin: "0 3px" }} /> 상태가 되면 카운트다운이 시작됩니다.</li>
              <li><b>5초의 카운트다운이 진행되며, 이 안에 <img src="/img/participate_button_icon.png" alt="버튼" style={{ width: "50px", verticalAlign: "middle", margin: "0 3px" }} /> 버튼에서 손을 떼면 해당 라운드에 참여하지 않게 됩니다.</b></li>
              <li>카운트다운 종료 후, 버튼을 계속 누르고 있는 플레이어들은 참여자로 간주되며, <b>보유 시간이 소모되기 시작합니다.</b></li>
              <li><b>참여자는 경매 도중 원하는 순간에 버튼에서 손을 떼어 입찰 시간을 정지시킬 수 있습니다.</b></li>
              <li>남은 시간을 모두 소진하면 자동으로 버튼에서 손이 떼어지며, 해당 입찰이 최종 시간으로 기록됩니다.</li>
              <li><b>가장 오랫동안 버튼을 누르고 있다가 손을 뗀 플레이어가 해당 라운드를 낙찰받습니다.</b></li>
              <li>단, 두 명 이상이 동일한 시간(0.1초 단위까지)으로 입찰했을 경우, 해당 라운드는 유찰됩니다.</li>
              <li>낙찰자와 사용 시간은 공개되지만, 누가 경매에 참여했는지는 공개되지 않습니다.</li>
              <li>전광판에는 오직 현재 경매 시간이 실시간으로 표시되며, 개인의 남은 시간은 본인에게만 표시됩니다.</li>
              <li><b>가장 많은 라운드를 낙찰받은 사람 순서로 순위가 결정됩니다.</b></li>
              <li><b>라운드 낙찰 수가 동일할 경우 개인 보유시간이 더 많이 남은 사람이 순위가 높게 측정됩니다.</b></li>
              
            </ul>
            <button onClick={closeHelpModal} style={{ marginTop: "1rem" }}>
              닫기
            </button>
          </Modal>
        </>
      ) : isSpectator ? (
        <SpectatorView
            playerList={playerList}
            auctionTime={auctionTime}
            round={completedRounds.length + 1}
            roundHistory={roundHistory}
            countdown={countdown}
        >
          {/* Centered scoreboard-style auction timer for spectator view */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "1.5rem" }}>
            <h1
              className="scoreboard-display"
              style={{
                backgroundImage: "url('/img/wood_texture.jpg')",
                backgroundSize: "cover",
                backgroundRepeat: "no-repeat",
                margin: 0,
                minWidth: "200px",
                minHeight: "70px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "2.5rem"
              }}
            >
              {auctionTime.toFixed(1)} s
            </h1>
          </div>
        </SpectatorView>
      ) : (
        <>
          <div className="game-area">
            <div className="info-area">
              <h1
                className="scoreboard-display"
                style={{
                  backgroundImage: "url('/img/wood_texture.jpg')",
                  backgroundSize: "cover",
                  backgroundRepeat: "no-repeat"
                }}
              >
                {auctionTime.toFixed(1)} s
              </h1>
              <h2>🕐 남은 시간: {remainingTime.toFixed(1)}초</h2>

              <h4>👥 인원: {playerCount.current} / {playerCount.required}</h4>

              <div
                className="player-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    playerList.length <= 2 ? "repeat(2, 1fr)" :
                    playerList.length <= 4 ? "repeat(2, 1fr)" :
                    playerList.length <= 6 ? "repeat(3, 1fr)" :
                    "repeat(4, 1fr)",
                  gap: "1rem",
                  justifyItems: "center",
                  margin: "1rem 0"
                }}
              >
                {playerList.map(p => (
                  <div key={p.id} className="player-cell">
                    <span>{p.nickname}</span>
                    <span
                      className="status-dot"
                      style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        display: "inline-block",
                        backgroundColor: p.ready ? "#28a745" : "#dc3545",
                        marginLeft: "8px"
                      }}
                    />
                  </div>
                ))}
              </div>

              {countdown !== null && (
                <h2>
                    <span className="countdown-blink">{countdown}</span>
                </h2>
                )}
              {resultMsg && <p>{resultMsg}</p>}
              {winnerInfo && (
                <p>🥇 {winnerInfo.winnerId} ({winnerInfo.usedTime}초)</p>
              )}

              {!ready && completedRounds.length < totalRounds && (
                <button onClick={handleReady}>🟢 준비 완료</button>
              )}
            </div>

            <div className="round-tracker">
              {Array.from({ length: totalRounds }).map((_, i) => {
                const r = i + 1;
                const done = completedRounds.includes(r);
                const cur = completedRounds.length + 1 === r;
                return (
                  <div
                    key={r}
                    className={`round-box ${done ? "completed" : ""} ${cur ? "current" : ""}`}
                  >
                    {r}
                  </div>
                );
              })}
            </div>
            <div className="win-table">
              <h4>🏅 닉네임별 낙찰 수</h4>
              <table>
                <thead>
                  <tr>
                    <th>닉네임</th>
                    <th>낙찰 수</th>
                  </tr>
                </thead>
                <tbody>
                  {nicknameWinCounts.length > 0 ? (
                    nicknameWinCounts.map(([name, count]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td>{count}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2}>아직 낙찰된 기록이 없습니다</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        
          {standings.length === 0 && (
            <button
                className={`octagon-button ${holding ? "pressed" : ""}`}
                onMouseDown={() => handleHold(true)}
                onMouseUp={() => handleHold(false)}
                onMouseLeave={() => handleHold(false)}
                onTouchStart={() => handleHold(true)}
                onTouchEnd={() => handleHold(false)}
            >
                참여
            </button>
          )}

          {standings.length > 0 && (
            <div className="final-standings">
              <h2>🏆 최종 순위</h2>
              <table>
                <thead>
                  <tr>
                    <th>순위</th>
                    <th>닉네임</th>
                    <th>승리</th>
                    <th>남은 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map(({ nickname, wins, remainingTime, rank }) => (
                    <tr key={nickname}>
                      <td>{rank}</td>
                      <td>{nickname}</td>
                      <td>{wins}</td>
                      <td>{remainingTime.toFixed(1)}초</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {standings.length > 0 && roundHistory.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <button onClick={() => setShowDetails(prev => !prev)}>
                {showDetails ? "기록 숨기기" : "📋 라운드별 상세 기록 보기"}
              </button>
            </div>
          )}

          {showDetails && roundHistory.length > 0 && (
            <div className="round-details">
              <table>
                <thead>
                  <tr>
                    <th>라운드</th>
                    {Object.keys(roundHistory[0]?.data || {}).flatMap(name => [
                      <th key={`${name}-used`}>{name} 사용시간</th>,
                      <th key={`${name}-rem`}>{name} 남은시간</th>
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {roundHistory.map((round, idx) => (
                    <tr key={idx}>
                      <td>{round.round}</td>
                      {Object.entries(round.data).flatMap(([name, player], i) => {
                        const isWinner = round.winner === name;
                        return [
                          <td
                            key={`u-${idx}-${i}`}
                            style={isWinner ? { backgroundColor: '#d0e9ff', fontWeight: 'bold' } : {}}
                          >
                            {player.usedTime}
                          </td>,
                          <td key={`r-${idx}-${i}`}>{player.remainingTime}</td>
                        ];
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showRematchPrompt && (
            <div className="rematch-modal">
                <h3>같은 인원으로 다시 시작할까요?</h3>
                <button onClick={handleRematchYes}>예</button>
                <button onClick={handleRematchNo}>아니오</button>
            </div>
          )}
          {showExitPrompt && (
            <div className="exit-prompt">
                <p>게임이 종료되었습니다.</p>
                <button onClick={() => {
                socket.emit("leaveRoom");
                setJoined(false);
                setRoomId("");
                setNickname("");
                setShowExitPrompt(false);
                }}>
                메인 화면으로 돌아가기
                </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
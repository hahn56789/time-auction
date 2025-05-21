import React, { useEffect, useState } from "react";
import "./styles/SpectatorView.css";
import "./styles/GameScreen.css";
import socket from "./socket";

function SpectatorView({ playerList, auctionTime, round, roundHistory, countdown }) {
  const radius = 160;
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    socket.on("auctionEnded", ({ winnerId, usedTime, round }) => {
      setLastResult(`${round} 라운드 우승자: ${winnerId} (${usedTime.toFixed(1)}초)`);
      setTimeout(() => setLastResult(null), 4000);
    });

    socket.on("auctionDraw", ({ round }) => {
      setLastResult(`${round} 라운드 무승부`);
      setTimeout(() => setLastResult(null), 4000);
    });

    return () => {
      socket.off("auctionEnded");
      socket.off("auctionDraw");
    };
  }, []);

  return (
    <div className="spectator-container">
      <h2>🎥 관전 모드</h2>
      <div className="spectator-scoreboard">
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
        <div className="round-tracker">
          {Array.from({ length: 5 }).map((_, i) => {
            const r = i + 1;
            const done = round > r;
            const cur = round === r && !lastResult;
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
      </div>

      {/* countdown/resultMsg UI removed as per instructions */}

      {lastResult && <div className="spectator-result-message">{lastResult}</div>}

      {playerList.length > 0 && (
        <div className="spectator-circle">
            {countdown !== null && (
                <div className="spectator-countdown-center">
                    <span className="countdown-blink">{countdown}</span>
                </div>
            )}
            {playerList.map((p, idx) => {
            const angle = (360 / playerList.length) * idx;
            const transform = `rotate(${angle}deg) translate(${radius}px) rotate(-${angle}deg)`;
            let orbClass = "";
            if (p.participating) {
              orbClass = "active";
            } 
            else if (p.ready) {
              orbClass = "ready";
            } else {
              orbClass = ""; // remove 'inactive' class
            }

            return (
                <div
                key={p.id}
                className={`player-orb ${orbClass}`}
                style={{ transform }}
                >
                <div className="player-name">{p.nickname}</div>
                <div className="player-status-icon">
                    {p.participating ? "🔥" : p.ready ? "✅" : "🕓"}
                </div>
                <div className="player-info">사용: {p.usedTime === "-" ? "-" : `${p.usedTime}초`}</div>
                <div className="player-info">남음: {p.remainingTime === "-" ? "-" : `${p.remainingTime}초`}</div>
                </div>
            );
            })}
        </div>
        )}

      {roundHistory?.length > 0 && (
        <div className="round-details">
            <table>
            <thead>
                <tr>
                <th>라운드</th>
                {Object.keys(roundHistory[0].data).flatMap(name => [
                    <th key={`${name}-used`}>{name} 사용</th>,
                    <th key={`${name}-rem`}>{name} 남음</th>
                ])}
                </tr>
            </thead>
            <tbody>
                {roundHistory.map((r, i) => (
                <tr key={i}>
                    <td>{r.round}</td>
                    {Object.entries(r.data).flatMap(([name, d]) => [
                    <td key={`${name}-used`} style={r.winner === name ? { backgroundColor: '#d0e9ff', fontWeight: 'bold' } : {}}>
                        {d.usedTime}
                    </td>,
                    <td key={`${name}-rem`}>{d.remainingTime}</td>
                    ])}
                </tr>
                ))}
            </tbody>
            </table>
        </div>
      )}
      {/* Only one lastResult message */}

      {/* --- 최종 순위 테이블 (관전자용) --- */}
      {playerList.length > 0 && (
        <div className="final-standings" style={{ marginTop: '2rem' }}>
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
              {[...playerList]
                .filter(p => p.wins !== undefined)
                .sort((a, b) =>
                  b.wins !== a.wins
                    ? b.wins - a.wins
                    : parseFloat(b.remainingTime) - parseFloat(a.remainingTime)
                )
                .map((p, index, arr) => {
                  let rank = 1;
                  if (
                    index > 0 &&
                    (p.wins !== arr[index - 1].wins ||
                      p.remainingTime !== arr[index - 1].remainingTime)
                  ) {
                    rank = index + 1;
                  } else if (index > 0) {
                    rank = arr[index - 1].rank;
                  }
                  p.rank = rank;
                  return (
                    <tr key={p.id}>
                      <td>{p.rank}</td>
                      <td>{p.nickname}</td>
                      <td>{p.wins}</td>
                      <td>{p.remainingTime}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default SpectatorView;
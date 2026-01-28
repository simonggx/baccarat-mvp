import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

// 自动判断环境：生产环境使用相对路径（同源），开发环境使用 localhost:3000
const SOCKET_URL = import.meta.env.PROD ? undefined : 'http://localhost:3000';
const socket = io(SOCKET_URL);

interface Card {
  suit: string;
  rank: string;
  value: number;
}

interface GameState {
  status: 'BETTING' | 'DEALING' | 'RESULT';
  timer: number;
  history: string[];
  hands: {
    player: Card[];
    banker: Card[];
  };
  scores: {
    player: number;
    banker: number;
  };
  result: 'PLAYER' | 'BANKER' | 'TIE' | null;
  roundId: number;
}

interface Player {
  id: string;
  nickname: string;
  balance: number;
  currentBet: {
    type: 'PLAYER' | 'BANKER' | 'TIE';
    amount: number;
  } | null;
}

function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [myId, setMyId] = useState<string>('');
  const [nickname, setNickname] = useState('');
  const [selectedChip, setSelectedChip] = useState(100);
  const [timer, setTimer] = useState(0);

  useEffect(() => {
    socket.on('connect', () => {
      setMyId(socket.id || '');
    });

    socket.on('gameUpdate', (state: GameState) => {
      setGameState(state);
      setTimer(state.timer);
    });

    socket.on('playersUpdate', (updatedPlayers: Record<string, Player>) => {
      setPlayers(updatedPlayers);
    });

    socket.on('timerUpdate', (time: number) => {
      setTimer(time);
    });

    return () => {
      socket.off('connect');
      socket.off('gameUpdate');
      socket.off('playersUpdate');
      socket.off('timerUpdate');
    };
  }, []);

  const handleSetNickname = () => {
    if (nickname.trim()) {
      socket.emit('setNickname', nickname);
    }
  };

  const placeBet = (type: 'PLAYER' | 'BANKER' | 'TIE') => {
    socket.emit('placeBet', { type, amount: selectedChip });
  };

  const myPlayer = players[myId];

  if (!gameState || !myPlayer) return <div className="text-white p-10">Connecting...</div>;

  return (
    <div className="min-h-screen bg-green-900 text-white p-4 font-sans">
      {/* 顶部状态栏 */}
      <div className="flex justify-between items-center bg-green-800 p-4 rounded-lg mb-4 shadow-md">
        <div className="flex gap-4 items-center">
          <span className="font-bold text-xl">Baccarat MVP</span>
          <div className="flex gap-2">
            <input 
              className="px-2 py-1 text-black rounded"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={myPlayer.nickname}
            />
            <button 
              onClick={handleSetNickname}
              className="bg-blue-600 px-3 py-1 rounded hover:bg-blue-500"
            >
              Update Name
            </button>
          </div>
        </div>
        <div className="text-right">
          <div className="text-yellow-300 font-mono text-xl">Balance: ${myPlayer.balance}</div>
          <div className="text-sm text-gray-300">ID: {myId.substr(0, 6)}</div>
        </div>
      </div>

      {/* 游戏主区域 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* 左侧：历史记录 */}
        <div className="bg-green-800 p-4 rounded-lg shadow-md">
          <h3 className="font-bold mb-2">History (Last 20)</h3>
          <div className="grid grid-cols-5 gap-1">
            {gameState.history.map((res, idx) => (
              <div key={idx} className={`
                w-8 h-8 flex items-center justify-center rounded-full text-xs font-bold
                ${res === 'P' ? 'bg-blue-600' : res === 'B' ? 'bg-red-600' : 'bg-green-500'}
              `}>
                {res}
              </div>
            ))}
          </div>
        </div>

        {/* 中间：牌桌 */}
        <div className="md:col-span-2 bg-green-700 p-6 rounded-lg shadow-xl relative border-4 border-yellow-600">
          
          {/* 状态提示 */}
          <div className="absolute top-2 left-1/2 transform -translate-x-1/2 bg-black/50 px-6 py-2 rounded-full">
            <span className="text-2xl font-bold text-yellow-400">
              {gameState.status === 'BETTING' ? `BETTING CLOSES IN ${timer}s` : 
               gameState.status === 'DEALING' ? 'DEALING...' : 
               `RESULT: ${gameState.result}`}
            </span>
          </div>

          <div className="mt-16 grid grid-cols-2 gap-8 text-center">
            
            {/* 闲家区域 */}
            <div className="border-r-2 border-green-600/30 pr-4">
              <h2 className="text-3xl font-bold text-blue-400 mb-4">PLAYER</h2>
              <div className="text-6xl font-mono mb-4">{gameState.scores.player}</div>
              <div className="flex justify-center gap-2 min-h-[100px]">
                {gameState.hands.player.map((card, idx) => (
                  <div key={idx} className="bg-white text-black w-16 h-24 rounded flex flex-col items-center justify-center shadow-lg border border-gray-300">
                    <span className={`text-xl ${['H','D'].includes(card.suit) ? 'text-red-600' : 'text-black'}`}>
                      {card.rank}{card.suit === 'H' ? '♥' : card.suit === 'D' ? '♦' : card.suit === 'C' ? '♣' : '♠'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 庄家区域 */}
            <div className="pl-4">
              <h2 className="text-3xl font-bold text-red-400 mb-4">BANKER</h2>
              <div className="text-6xl font-mono mb-4">{gameState.scores.banker}</div>
              <div className="flex justify-center gap-2 min-h-[100px]">
                {gameState.hands.banker.map((card, idx) => (
                  <div key={idx} className="bg-white text-black w-16 h-24 rounded flex flex-col items-center justify-center shadow-lg border border-gray-300">
                    <span className={`text-xl ${['H','D'].includes(card.suit) ? 'text-red-600' : 'text-black'}`}>
                      {card.rank}{card.suit === 'H' ? '♥' : card.suit === 'D' ? '♦' : card.suit === 'C' ? '♣' : '♠'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* 下注控制区 */}
      <div className="mt-4 bg-green-800 p-6 rounded-lg shadow-md text-center">
        <div className="mb-4 text-gray-300">
          Selected Chip: <span className="text-yellow-400 font-bold">${selectedChip}</span>
        </div>
        
        <div className="flex justify-center gap-4 mb-6">
          {[100, 500, 1000, 5000].map(amt => (
            <button
              key={amt}
              onClick={() => setSelectedChip(amt)}
              className={`
                w-16 h-16 rounded-full border-4 flex items-center justify-center font-bold shadow-lg transition-transform hover:scale-110
                ${selectedChip === amt ? 'border-yellow-400 bg-yellow-600 text-white' : 'border-gray-400 bg-gray-600 text-gray-200'}
              `}
            >
              {amt}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
          <button 
            disabled={gameState.status !== 'BETTING' || !!myPlayer.currentBet}
            onClick={() => placeBet('PLAYER')}
            className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed p-6 rounded-xl border-b-8 border-blue-900 transition-all active:border-b-0 active:translate-y-2"
          >
            <div className="text-2xl font-bold">PLAYER</div>
            <div className="text-sm opacity-80">1:1</div>
            {myPlayer.currentBet?.type === 'PLAYER' && <div className="mt-2 bg-yellow-500 text-black text-xs px-2 py-1 rounded-full w-max mx-auto">${myPlayer.currentBet.amount}</div>}
          </button>

          <button 
            disabled={gameState.status !== 'BETTING' || !!myPlayer.currentBet}
            onClick={() => placeBet('TIE')}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed p-6 rounded-xl border-b-8 border-green-800 transition-all active:border-b-0 active:translate-y-2"
          >
            <div className="text-2xl font-bold">TIE</div>
            <div className="text-sm opacity-80">8:1</div>
            {myPlayer.currentBet?.type === 'TIE' && <div className="mt-2 bg-yellow-500 text-black text-xs px-2 py-1 rounded-full w-max mx-auto">${myPlayer.currentBet.amount}</div>}
          </button>

          <button 
            disabled={gameState.status !== 'BETTING' || !!myPlayer.currentBet}
            onClick={() => placeBet('BANKER')}
            className="bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed p-6 rounded-xl border-b-8 border-red-900 transition-all active:border-b-0 active:translate-y-2"
          >
            <div className="text-2xl font-bold">BANKER</div>
            <div className="text-sm opacity-80">0.95:1</div>
            {myPlayer.currentBet?.type === 'BANKER' && <div className="mt-2 bg-yellow-500 text-black text-xs px-2 py-1 rounded-full w-max mx-auto">${myPlayer.currentBet.amount}</div>}
          </button>
        </div>
        
        {myPlayer.currentBet && gameState.status === 'BETTING' && (
           <div className="mt-4 text-yellow-300 animate-pulse">
             Bet Placed! Waiting for other players...
           </div>
        )}
      </div>
      
      {/* 底部：在线玩家列表简略 */}
      <div className="mt-8 text-center text-sm text-gray-400">
        Online Players: {Object.keys(players).length}
      </div>
    </div>
  )
}

export default App

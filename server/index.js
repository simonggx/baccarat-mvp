const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// 托管前端静态文件
app.use(express.static(path.join(__dirname, '../client/dist')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // 允许所有来源
        methods: ["GET", "POST"]
    }
});

// --- 游戏常量 ---
const BETTING_TIME = 20; // 下注时间（秒）
const RESULT_SHOW_TIME = 5000; // 结果展示时间（毫秒）
const DECKS_COUNT = 8;
const MIN_CARDS_BEFORE_SHUFFLE = 20;

// --- 内存数据 ---
let players = {}; // socketId -> { id, nickname, balance, currentBet: { type, amount } }
let gameState = {
    status: 'BETTING', // BETTING, DEALING, RESULT
    timer: BETTING_TIME,
    history: [], // 最近结果 ['P', 'B', 'T', ...]
    hands: { player: [], banker: [] }, // 当前手牌
    scores: { player: 0, banker: 0 },
    result: null, // 'PLAYER', 'BANKER', 'TIE'
    roundId: 1
};
let deck = [];

// --- 核心逻辑：洗牌 ---
function createDeck() {
    const suits = ['H', 'D', 'C', 'S']; // Hearts, Diamonds, Clubs, Spades
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const values = {
        'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
        '10': 0, 'J': 0, 'Q': 0, 'K': 0
    };
    
    let newDeck = [];
    for (let i = 0; i < DECKS_COUNT; i++) {
        for (let suit of suits) {
            for (let rank of ranks) {
                newDeck.push({ suit, rank, value: values[rank] });
            }
        }
    }
    return shuffle(newDeck);
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 初始化牌堆
deck = createDeck();

// --- 核心逻辑：计算点数 ---
function calculateScore(cards) {
    let total = cards.reduce((sum, card) => sum + card.value, 0);
    return total % 10;
}

// --- 核心逻辑：补牌规则 ---
function getThirdCardRule(playerScore, bankerScore, playerThirdCardValue) {
    // 闲家补牌规则：0-5补，6-7停，8-9天牌(已处理)
    // 此时只考虑是否给庄家补牌
    
    // 如果闲家没补牌（只有两张），庄家0-5补，6-7停
    if (playerThirdCardValue === undefined) {
        return bankerScore <= 5;
    }

    // 闲家补了牌，根据闲家第三张牌的值判断庄家是否补牌
    if (bankerScore <= 2) return true;
    if (bankerScore === 3) return playerThirdCardValue !== 8;
    if (bankerScore === 4) return [2,3,4,5,6,7].includes(playerThirdCardValue);
    if (bankerScore === 5) return [4,5,6,7].includes(playerThirdCardValue);
    if (bankerScore === 6) return [6,7].includes(playerThirdCardValue);
    return false; // 7 points stands
}

// --- 游戏主循环 ---
function dealGame() {
    // 检查牌数，不够则洗牌
    if (deck.length < MIN_CARDS_BEFORE_SHUFFLE) {
        deck = createDeck();
        console.log("Reshuffled deck");
    }

    // 发头两张牌
    let pCards = [deck.pop(), deck.pop()];
    let bCards = [deck.pop(), deck.pop()];

    let pScore = calculateScore(pCards);
    let bScore = calculateScore(bCards);

    let pThird = null;
    let bThird = null;

    // 天牌判定 (Natural)
    let isNatural = pScore >= 8 || bScore >= 8;

    if (!isNatural) {
        // 闲家补牌
        if (pScore <= 5) {
            let card = deck.pop();
            pCards.push(card);
            pThird = card.value;
            pScore = calculateScore(pCards);
        }

        // 庄家补牌
        if (getThirdCardRule(pScore, calculateScore(bCards), pThird)) {
            let card = deck.pop();
            bCards.push(card);
            bScore = calculateScore(bCards);
        }
    }

    // 判定结果
    let result = '';
    if (pScore > bScore) result = 'PLAYER';
    else if (bScore > pScore) result = 'BANKER';
    else result = 'TIE';

    // 更新状态
    gameState.hands = { player: pCards, banker: bCards };
    gameState.scores = { player: pScore, banker: bScore };
    gameState.result = result;
    gameState.history.unshift(result === 'PLAYER' ? 'P' : result === 'BANKER' ? 'B' : 'T');
    if (gameState.history.length > 20) gameState.history.pop();

    // 结算
    settleBets(result);

    // 广播结果
    io.emit('gameUpdate', gameState);

    // 5秒后开始新一局
    setTimeout(() => {
        startNewRound();
    }, RESULT_SHOW_TIME);
}

function settleBets(result) {
    Object.values(players).forEach(player => {
        if (!player.currentBet) return;
        
        const { type, amount } = player.currentBet;
        let win = 0;

        if (type === result) {
            if (type === 'PLAYER') win = amount * 2; // 1:1 + 本金
            if (type === 'TIE') win = amount * 9; // 8:1 + 本金
            if (type === 'BANKER') win = amount * 1.95; // 0.95:1 + 本金
        } else if (result === 'TIE' && (type === 'PLAYER' || type === 'BANKER')) {
            // 和局退还闲庄注码
            win = amount;
        }

        if (win > 0) {
            player.balance += win;
        }
        // 清除下注
        player.currentBet = null;
    });
    
    // 广播玩家最新余额
    io.emit('playersUpdate', players);
}

function startNewRound() {
    gameState.status = 'BETTING';
    gameState.timer = BETTING_TIME;
    gameState.hands = { player: [], banker: [] };
    gameState.scores = { player: 0, banker: 0 };
    gameState.result = null;
    gameState.roundId++;
    
    io.emit('gameUpdate', gameState);
    
    // 启动倒计时
    let timerInterval = setInterval(() => {
        gameState.timer--;
        io.emit('timerUpdate', gameState.timer);
        
        if (gameState.timer <= 0) {
            clearInterval(timerInterval);
            gameState.status = 'DEALING';
            io.emit('gameUpdate', gameState);
            dealGame();
        }
    }, 1000);
}

// --- Socket.io 事件 ---
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // 初始化玩家
    players[socket.id] = {
        id: socket.id,
        nickname: 'Guest' + socket.id.substr(0, 4),
        balance: 10000,
        currentBet: null
    };

    // 发送初始状态
    socket.emit('gameUpdate', gameState);
    socket.emit('playersUpdate', players);
    socket.emit('timerUpdate', gameState.timer);

    // 修改昵称
    socket.on('setNickname', (name) => {
        if (players[socket.id]) {
            players[socket.id].nickname = name.substr(0, 10);
            io.emit('playersUpdate', players);
        }
    });

    // 下注
    socket.on('placeBet', ({ type, amount }) => {
        const player = players[socket.id];
        if (!player || gameState.status !== 'BETTING') return;
        if (player.balance < amount) return;
        if (player.currentBet) return; // 每局只能注一次 (简化MVP)

        player.balance -= amount;
        player.currentBet = { type, amount };
        
        io.emit('playersUpdate', players);
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete players[socket.id];
        io.emit('playersUpdate', players);
    });
});

// 启动第一局
startNewRound();

// 处理所有其他路由，返回前端 index.html (SPA支持)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

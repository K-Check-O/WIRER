'use client';

import { useEffect, useState, useRef } from 'react';
import { useDebounce } from './hooks/useDebounce';

interface WireMessage {
  key: string;
  text: string;
  sender: string;
  timestamp: number;
  deleted?: boolean;
}

export default function Home() {
  const [wirerModule, setWirerModule] = useState<any>(null);
  const [inputText, setInputText] = useState('');
  const [fontMode, setFontMode] = useState<'default' | 'dot'>('default');
  const [integrity, setIntegrity] = useState<number | null>(null);
  const [messages, setMessages] = useState<WireMessage[]>([]);
  const gunRef = useRef<any>(null);

  // 🔑 擬態ログイン用の状態
  const [myWireId, setMyWireId] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [showAuthForm, setShowAuthForm] = useState<boolean>(false);

  const debouncedInput = useDebounce(inputText, 300);

  // 🛡️ メアド＋パスワードから「秘密鍵」を計算し、さらに「Wire ID」を作る
  const generateIdentityFromCredentials = async (userEmail: string, userPass: string) => {
    // メアドとパスワードを結合してソルト（塩）を効かせる
    const combinedInput = `WIRER_SALT:${userEmail.toLowerCase().trim()}:${userPass}`;
    const msgUint8 = new TextEncoder().encode(combinedInput);
    
    // 1回目のハッシュ（秘密鍵の代わりになるシード）
    const secretBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
    const secretArray = Array.from(new Uint8Array(secretBuffer));
    const secretHex = secretArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // 2回目のハッシュ（公開IDの計算）
    const idBuffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretHex));
    const idArray = Array.from(new Uint8Array(idBuffer));
    const idHex = idArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    
    return {
      wireId: `WIRE-${idHex.slice(0, 4)}-${idHex.slice(4, 8)}`,
      secret: secretHex
    };
  };

  // 1. 初期の臨時（使い捨て）ID生成
  const initAnonymousIdentity = async () => {
    // ログインしていない時は、ブラウザごとにランダムなセッションIDを割り振る（Nothingのゲストモード的発想）
    let sessionId = sessionStorage.getItem('wirer_anonymous_id');
    if (!sessionId) {
      const array = new Uint8Array(4);
      window.crypto.getRandomValues(array);
      const hex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      sessionId = `GUEST-${hex}`;
      sessionStorage.setItem('wirer_anonymous_id', sessionId);
    }
    setMyWireId(sessionId);
  };

  // 2. Wasm、Gun.jsの初期化
  useEffect(() => {
    const initApp = async () => {
      // 最初はゲストモードで起動
      await initAnonymousIdentity();

      // Wasmの初期化
      const win = window as any;
      if (win.createWirerCore) {
        const module = await win.createWirerCore();
        setWirerModule(module);
      }

      // Gun.jsの初期化 (ローカル中継基地へ接続)
      const Gun = (await import('gun' as any)).default;
      const gun = Gun({
        peers: ['http://localhost:8765/gun']
      });
      gunRef.current = gun;

      // 共通空間の監視
      gun.get('wirer-proto-local-hub').get('chat').map().on((data: any, key: string) => {
        if (data === null) {
          // 他のピアによる物理削除をハンドル
          setMessages(prev => prev.filter(m => m.key !== key));
          return;
        }

        if (data && data.text && data.sender) {
          const newMsg: WireMessage = {
            key: key,
            text: data.text,
            sender: data.sender,
            timestamp: data.timestamp,
            deleted: data.deleted || false,
          };

          setMessages(prev => {
            const existingIndex = prev.findIndex(m => m.key === key);
            if (existingIndex !== -1) {
              // 既存メッセージの更新（例: 削除フラグの変更）
              const updated = [...prev];
              updated[existingIndex] = newMsg;
              return updated;
            }
            // 新規メッセージの追加
            return [...prev, newMsg].sort((a, b) => a.timestamp - b.timestamp);
          });
        }
      });
    };

    initApp();
  }, []);

  // 3. 入力値が変わった時のC++判定
  useEffect(() => {
    if (wirerModule && debouncedInput) {
      const result = wirerModule.ccall(
        'check_signal_integrity',
        'number',
        ['string'],
        [debouncedInput]
      );
      setIntegrity(result);
    }
  }, [debouncedInput, wirerModule]);

  // 4. メッセージ送信
  const sendMessage = () => {
    if (!inputText.trim() || !gunRef.current || !myWireId) return;

    if (integrity !== null && integrity < 50) {
      alert("ノイズが多すぎるため、送信回路が絶縁されました。");
      return;
    }

    gunRef.current.get('wirer-proto-local-hub').get('chat').set({
      text: inputText,
      sender: myWireId,
      timestamp: Date.now(),
      deleted: false,
    });

    setInputText('');
    setIntegrity(null);
  };

  // 🔐 クライアントサイドでのWeb3ログイン処理
  const handleWeb3Login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    // 入力された情報からIDを決定論的に計算
    const identity = await generateIdentityFromCredentials(email, password);
    
    setMyWireId(identity.wireId);
    setIsLoggedIn(true);
    setShowAuthForm(false);
    alert(`アイデンティティ [${identity.wireId}] を復元しました。`);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setEmail('');
    setPassword('');
    initAnonymousIdentity();
  };

  // 🗑️ メッセージの削除（論理削除）
  const handleDeleteMessage = (messageKey: string) => {
    if (!gunRef.current) return;
    if (window.confirm('このシグナルを削除しますか？（他のユーザーからも見えなくなります）')) {
      // `deleted: true` を書き込むことで論理削除を表現し、全ピアに同期させる
      gunRef.current.get('wirer-proto-local-hub').get('chat').get(messageKey).put({ deleted: true });
    }
  };

  return (
    <div className={`flex flex-col min-h-screen bg-black text-white p-6 justify-between ${
      fontMode === 'dot' ? 'font-dot text-sm' : 'font-sans'
    }`}>
      <div className="w-full max-w-lg mx-auto space-y-4">
        <h1 className={`text-4xl font-bold text-center ${fontMode === 'dot' ? 'tracking-tighter' : 'tracking-[0.3em]'}`}>W I R E R</h1>

        {/* 🔒 アカウント状態モニター */}
        <div className="border border-zinc-800 p-3 bg-zinc-950 flex justify-between items-center text-xs">
          <div className="flex items-center gap-4">
            <span className={`w-2 h-2 rounded-full ${isLoggedIn ? 'bg-emerald-500' : 'bg-zinc-600'}`}></span>
            <span className="text-zinc-500 uppercase tracking-widest text-[10px]">
              {isLoggedIn ? 'Secured Identity' : 'Guest Mode'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setFontMode(fontMode === 'default' ? 'dot' : 'default')}
              className="text-zinc-400 hover:text-white underline text-[10px] uppercase"
            >
              {fontMode === 'default' ? 'DOT-MATRIX' : 'DEFAULT FONT'}
            </button>
            <button 
              onClick={() => isLoggedIn ? handleLogout() : setShowAuthForm(!showAuthForm)}
              className="text-zinc-400 hover:text-white underline text-[10px] uppercase"
            >
              {isLoggedIn ? 'Disconnect' : showAuthForm ? 'Close' : 'Sync Account'}
            </button>
          </div>
        </div>

        {/* 🔐 ログインフォームエリア */}
        {showAuthForm && !isLoggedIn && (
          <form onSubmit={handleWeb3Login} className="border border-zinc-800 p-4 bg-zinc-950 text-xs space-y-3 animate-fade-in">
            <p className="text-[9px] text-zinc-500 uppercase tracking-wider">
              ※サーバーへの登録はありません。手元での暗号計算によってIDを復元します。
            </p>
            <div className="space-y-1">
              <label className="text-zinc-500 uppercase text-[9px]">Email</label>
              <input 
                type="email" 
                required
                placeholder="example@wire.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-zinc-500 uppercase text-[9px]">Password</label>
              <input 
                type="password" 
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500"
              />
            </div>
            <button 
              type="submit"
              className="w-full py-2 bg-white text-black font-bold uppercase text-[10px] tracking-widest"
            >
              Secure Sync
            </button>
          </form>
        )}

        {/* 🆔 現在のWire ID表示 */}
        <div className="text-right text-[10px] text-zinc-500 tracking-widest">
          ID: <span className="text-zinc-300 font-bold">{myWireId}</span>
        </div>

        {/* 受信メッセージの表示エリア */}
        <div className="border border-zinc-800 p-4 h-52 overflow-y-auto space-y-3 bg-zinc-900/10">
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Incoming Wires</p>
          {messages.map((msg) => (
            <div key={msg.key} className="text-sm p-2 border-l border-zinc-700 bg-zinc-900/30 group relative">
              <div className="flex justify-between items-start">
                <div>
                  <span className={`text-[9px] block uppercase tracking-wider mb-1 ${
                    msg.sender === myWireId ? 'text-emerald-400' : msg.sender.startsWith('GUEST') ? 'text-zinc-600' : 'text-zinc-400'
                  }`}>
                    {msg.sender === myWireId ? 'You' : msg.sender}
                  </span>
                  {msg.deleted ? (
                    <span className="text-zinc-500 italic">[ signal deleted ]</span>
                  ) : (
                    <span className="text-zinc-200">{msg.text}</span>
                  )}
                </div>
                {msg.sender === myWireId && !msg.deleted && (
                  <button onClick={() => handleDeleteMessage(msg.key)} className="text-red-500/50 text-[9px] uppercase hover:text-red-500 hover:underline opacity-0 group-hover:opacity-100 transition-opacity">
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 信号モニター */}
        <div className="border border-zinc-800 p-4 bg-zinc-900/30 text-center relative">
          <span className="text-[10px] text-zinc-500 absolute top-2 left-4">INTEGRITY</span>
          <div className="text-3xl font-bold mt-1">{integrity !== null ? `${integrity}%` : '--%'}</div>
        </div>

        {/* 入力と送信 */}
        <div className="space-y-4">
          <textarea
            className={`w-full h-20 bg-transparent border border-zinc-800 p-4 focus:outline-none focus:border-white transition-colors resize-none ${
              fontMode === 'dot' ? 'text-sm' : 'text-base'
            }`}
            placeholder="Type a wire..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />
          <button 
            onClick={sendMessage}
            className="w-full py-3 bg-white text-black font-bold uppercase text-xs tracking-widest hover:bg-zinc-200 transition-colors"
          >
            Transmit Signal
          </button>
        </div>
      </div>
    </div>
  );
}